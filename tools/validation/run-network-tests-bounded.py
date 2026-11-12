"""Windows-only runner: label followed by Node arguments; RF_TEST_NODE or PATH.
Create suspended, assign to a limited Job, then resume the primary thread.
Own child tree only: below normal, 15% total CPU, 2 GiB committed Job memory.
RF_TEST_RESOURCE_PROFILE=browser permits 6 GiB for two production WebGL pages,
but requires 10 GiB free before launch and still aborts below 4 GiB free.
RF_TEST_RESOURCE_PROFILE=light tightens the Job to 1 GiB for file/CLI probes,
requires 5 GiB free, and retains the same 4 GiB host abort boundary.
RF_TEST_RESOURCE_PROFILE=capacity is explicitly authorized for the two-room
capacity job only: 6 GiB Job, 10 GiB free before start, 4 GiB host abort floor,
and 60% total CPU. Other profiles retain 15% CPU and their prior limits.
All profiles retain below normal priority and own-child cleanup.
RF_TEST_RESOURCE_PROFILE=capacity-workers is authorized only for the separate
four-OS-host capacity method: 8 GiB Job, start-free 12 GiB, abort-free 4 GiB,
75% total CPU. Insufficient initial reserve defers without launching.
Exit 75 defers launch on host pressure; it is not a passing test receipt.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
WAIT_OBJECT_0, WAIT_TIMEOUT, WAIT_FAILED = 0, 258, 0xFFFFFFFF
CREATE_SUSPENDED, CREATE_NO_WINDOW = 0x4, 0x08000000
BELOW_NORMAL_PRIORITY_CLASS, EXTENDED_STARTUPINFO_PRESENT = 0x4000, 0x80000
STARTF_USESTDHANDLES, PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x100, 0x20002

# These are policy limits, not workload-derived settings. In particular the
# capacity profile reserves more host memory for other processes.
RESOURCE_PROFILES_GIB = {
    'native': (2, 6, 4),
    'browser': (6, 10, 4),
    'light': (1, 5, 4),
    'capacity': (6, 10, 4),
    'capacity-workers': (8, 12, 4),
}


def resource_limits(profile):
    if profile not in RESOURCE_PROFILES_GIB:
        raise ValueError('Unknown RF_TEST_RESOURCE_PROFILE')
    job, start, abort = RESOURCE_PROFILES_GIB[profile]
    return dict(jobMemoryLimitBytes=job * 1024**3,
                minimumStartFreeBytes=start * 1024**3,
                abortFreeBytes=abort * 1024**3,
                cpuCapPercent=75 if profile == 'capacity-workers' else 60 if profile == 'capacity' else 15)


class Memory(c.Structure):
    _fields_ = [('length', w.DWORD), ('load', w.DWORD)] + [
        (name, c.c_ulonglong) for name in ['total', 'available', 'totalPage',
        'availablePage', 'totalVirtual', 'availableVirtual', 'extended']]


class Basic(c.Structure):
    _fields_ = [('perProcess', c.c_longlong), ('perJob', c.c_longlong),
        ('flags', w.DWORD), ('minWorkingSet', c.c_size_t),
        ('maxWorkingSet', c.c_size_t), ('activeProcesses', w.DWORD),
        ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]


class IO(c.Structure):
    _fields_ = [(name, c.c_ulonglong) for name in [
        'readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes']]


class Extended(c.Structure):
    _fields_ = [('basic', Basic), ('io', IO)] + [(name, c.c_size_t) for name in [
        'processMemory', 'jobMemory', 'peakProcessMemory', 'peakJobMemory']]


class Cpu(c.Structure):
    _fields_ = [('flags', w.DWORD), ('rate', w.DWORD)]


class Startup(c.Structure):
    _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR),
        ('title', w.LPWSTR)] + [(name, w.DWORD) for name in [
        'x', 'y', 'xSize', 'ySize', 'xChars', 'yChars', 'fill', 'flags']] + [
        ('show', w.WORD), ('reservedSize', w.WORD), ('reservedBytes', c.c_void_p),
        ('stdin', w.HANDLE), ('stdout', w.HANDLE), ('stderr', w.HANDLE)]


class StartupEx(c.Structure):
    _fields_ = [('startup', Startup), ('attributes', c.c_void_p)]


class ProcessInfo(c.Structure):
    _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE),
        ('pid', w.DWORD), ('tid', w.DWORD)]


def main():
    if len(sys.argv) < 3 or not sys.argv[1].replace('-', '').replace('_', '').isalnum():
        print('Usage: run-network-tests-bounded.py safe-label <Node arguments>', file=sys.stderr)
        return 2
    name, args = sys.argv[1], sys.argv[2:]
    profile = os.environ.get('RF_TEST_RESOURCE_PROFILE', 'native')
    if profile not in RESOURCE_PROFILES_GIB:
        print('Unknown RF_TEST_RESOURCE_PROFILE', file=sys.stderr)
        return 2
    output = ROOT / 'runtime' / name
    output.parent.mkdir(parents=True, exist_ok=True)
    receipt, log = output.with_suffix('.resources.json'), output.with_suffix('.log')
    configured = os.environ.get('RF_TEST_NODE') or shutil.which('node')
    node = Path(configured).resolve() if configured else None
    proof = {'command': [str(node), *args], 'cwd': str(ROOT), 'status': 'initializing',
        'exitCode': None, 'resourceProfile': profile, **resource_limits(profile),
        'priority': 'below-normal', 'samples': [], 'cleanupErrors': [],
        'launch': {'createdSuspended': False, 'assignedBeforeResume': False,
                   'resumed': False, 'inheritedHandles': 'stdout/stderr log and NUL stdin only'}}
    started = time.monotonic()
    kernel, job, process = None, None, None
    assigned = False

    def checked(ok):
        if not ok:
            raise c.WinError(c.get_last_error())

    def bind(name, arguments, result):
        function = getattr(kernel, name)
        function.argtypes, function.restype = arguments, result

    def available():
        memory = Memory()
        memory.length = c.sizeof(memory)
        checked(kernel.GlobalMemoryStatusEx(c.byref(memory)))
        return memory.available

    def cpu():
        values = [w.FILETIME() for _ in range(3)]
        checked(kernel.GetSystemTimes(*(c.byref(value) for value in values)))
        return [(value.dwHighDateTime << 32) + value.dwLowDateTime for value in values]

    def load(before, after):
        delta = [y - x for x, y in zip(before, after)]
        return 100 * (1 - delta[0] / max(1, delta[1] + delta[2]))

    def exit_code():
        value = w.DWORD()
        checked(kernel.GetExitCodeProcess(process.process, c.byref(value)))
        return value.value

    def close(handle, label):
        if handle and not kernel.CloseHandle(handle):
            proof['cleanupErrors'].append({'operation': label, 'winerror': c.get_last_error()})

    try:
        if sys.platform != 'win32' or node is None or not node.is_file():
            raise RuntimeError('Windows and an existing RF_TEST_NODE or PATH Node executable are required')
        import msvcrt
        kernel = c.WinDLL('kernel32', use_last_error=True)
        bind('GlobalMemoryStatusEx', [c.POINTER(Memory)], w.BOOL)
        bind('GetSystemTimes', [c.POINTER(w.FILETIME)] * 3, w.BOOL)
        bind('CreateJobObjectW', [c.c_void_p, w.LPCWSTR], w.HANDLE)
        bind('SetInformationJobObject', [w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL)
        bind('AssignProcessToJobObject', [w.HANDLE, w.HANDLE], w.BOOL)
        bind('QueryInformationJobObject', [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL)
        bind('TerminateJobObject', [w.HANDLE, w.UINT], w.BOOL)
        bind('CloseHandle', [w.HANDLE], w.BOOL)
        bind('CreateFileW', [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE], w.HANDLE)
        bind('InitializeProcThreadAttributeList', [c.c_void_p, w.DWORD, w.DWORD, c.POINTER(c.c_size_t)], w.BOOL)
        bind('UpdateProcThreadAttribute', [c.c_void_p, w.DWORD, c.c_size_t, c.c_void_p, c.c_size_t, c.c_void_p, c.c_void_p], w.BOOL)
        bind('DeleteProcThreadAttributeList', [c.c_void_p], None)
        bind('CreateProcessW', [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL,
             w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(StartupEx), c.POINTER(ProcessInfo)], w.BOOL)
        bind('ResumeThread', [w.HANDLE], w.DWORD)
        bind('WaitForSingleObject', [w.HANDLE, w.DWORD], w.DWORD)
        bind('GetExitCodeProcess', [w.HANDLE, c.POINTER(w.DWORD)], w.BOOL)
        bind('TerminateProcess', [w.HANDLE, w.UINT], w.BOOL)

        before = cpu()
        time.sleep(1)
        initial_cpu, initial_ram = load(before, cpu()), available()
        proof.update(initialCpuPercent=initial_cpu, initialFreeBytes=initial_ram)
        if initial_ram < proof['minimumStartFreeBytes'] or initial_cpu > 85:
            proof['status'] = 'deferred-host-pressure'
        else:
            job = kernel.CreateJobObjectW(None, None)
            checked(job)
            limits = Extended()
            limits.basic.flags = 0x2000 | 0x200  # KILL_ON_JOB_CLOSE | JOB_MEMORY
            limits.jobMemory = proof['jobMemoryLimitBytes']
            checked(kernel.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)))
            cap = Cpu(1 | 4, proof['cpuCapPercent'] * 100)  # ENABLE | HARD_CAP, hundredths of a percent
            checked(kernel.SetInformationJobObject(job, 15, c.byref(cap), c.sizeof(cap)))

            with log.open('wb') as log_file:
                log_handle = msvcrt.get_osfhandle(log_file.fileno())
                stdin_handle, attributes = None, None
                try:
                    stdin_handle = kernel.CreateFileW('NUL', 0x80000000, 3, None, 3, 0x80, None)
                    checked(stdin_handle != c.c_void_p(-1).value)
                    os.set_handle_inheritable(stdin_handle, True)
                    os.set_handle_inheritable(log_handle, True)
                    size = c.c_size_t()
                    kernel.InitializeProcThreadAttributeList(None, 1, 0, c.byref(size))
                    checked(size.value > 0)
                    attribute_buffer = c.create_string_buffer(size.value)
                    checked(kernel.InitializeProcThreadAttributeList(attribute_buffer, 1, 0, c.byref(size)))
                    attributes = c.cast(attribute_buffer, c.c_void_p)
                    inherited = (w.HANDLE * 2)(stdin_handle, log_handle)
                    checked(kernel.UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                        c.cast(inherited, c.c_void_p), c.sizeof(inherited), None, None))
                    startup = StartupEx()
                    startup.startup.cb = c.sizeof(startup)
                    startup.startup.flags = STARTF_USESTDHANDLES
                    startup.startup.stdin = stdin_handle
                    startup.startup.stdout = startup.startup.stderr = log_handle
                    startup.attributes = attributes
                    # Keep the output handles reachable even if Python receives
                    # Ctrl+C immediately after CreateProcessW returns.
                    process = ProcessInfo()
                    command = c.create_unicode_buffer(subprocess.list2cmdline([str(node), *args]))
                    flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS | EXTENDED_STARTUPINFO_PRESENT
                    checked(kernel.CreateProcessW(str(node), command, None, None, True, flags,
                        None, str(ROOT), c.byref(startup), c.byref(process)))
                    proof['launch'].update(createdSuspended=True, pid=process.pid, primaryThreadId=process.tid)
                finally:
                    if attributes:
                        kernel.DeleteProcThreadAttributeList(attributes)
                    os.set_handle_inheritable(log_handle, False)
                    if stdin_handle and stdin_handle != c.c_void_p(-1).value:
                        close(stdin_handle, 'close-stdin')

                # No Node instruction or descendant can run before these limits
                # apply. On assignment failure the still-suspended process is
                # terminated by the cleanup below; it is never resumed.
                checked(kernel.AssignProcessToJobObject(job, process.process))
                assigned = True
                proof['launch']['assignedBeforeResume'] = True
                proof['launch'].update(resumeAttempted=True, resumed=None)
                previous_count = kernel.ResumeThread(process.thread)
                checked(previous_count != WAIT_FAILED)
                proof['launch'].update(resumed=True, previousSuspendCount=previous_count)
                if previous_count != 1:
                    raise RuntimeError('Unexpected initial primary-thread suspend count')
                proof['status'] = 'running'
                running_started, previous = time.monotonic(), cpu()
                while True:
                    wait = kernel.WaitForSingleObject(process.process, 1000)
                    if wait == WAIT_FAILED:
                        checked(False)
                    if wait not in (WAIT_OBJECT_0, WAIT_TIMEOUT):
                        raise RuntimeError(f'Unexpected process wait result {wait}')
                    current, ram, measured = cpu(), available(), Extended()
                    checked(kernel.QueryInformationJobObject(job, 9, c.byref(measured), c.sizeof(measured), None))
                    proof['samples'].append({'seconds': time.monotonic() - running_started,
                        'hostCpuPercent': load(previous, current), 'freeBytes': ram,
                        'jobPeakCommittedBytes': measured.peakJobMemory})
                    # Keep a bounded-run checkpoint even if the terminal is
                    # externally interrupted while a browser is shutting down.
                    if len(proof['samples']) % 5 == 0:
                        receipt.write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
                    previous = current
                    if wait == WAIT_OBJECT_0:
                        proof['exitCode'] = exit_code()
                        proof['status'] = 'passed' if proof['exitCode'] == 0 else 'failed'
                        break
                    if ram < proof['abortFreeBytes']:
                        proof['status'] = 'aborted-low-host-memory'
                        break
                    if time.monotonic() - running_started > 900:
                        proof['status'] = 'aborted-15-minute-deadline'
                        break
    except KeyboardInterrupt:
        proof.update(status='aborted-interrupted', error={'type': 'KeyboardInterrupt', 'message': 'Runner interrupted'})
    except Exception as error:
        proof.update(status='failed-error', error={'type': type(error).__name__, 'message': str(error)})
    finally:
        if process and process.process:
            proof['launch'].update(createdSuspended=True, pid=process.pid, primaryThreadId=process.tid)
            if kernel.WaitForSingleObject(process.process, 0) != WAIT_OBJECT_0:
                operation = 'TerminateJobObject' if assigned else 'TerminateProcess'
                proof['terminationRequested'] = operation
                succeeded = kernel.TerminateJobObject(job, 1) if assigned else kernel.TerminateProcess(process.process, 1)
                if not succeeded:
                    proof['cleanupErrors'].append({'operation': operation, 'winerror': c.get_last_error()})
            # Closing the exclusively owned Job also retires any child that
            # outlived a normally exited test runner. No PID discovery occurs.
            if job:
                close(job, 'close-job')
                job = None
                proof['jobClosed'] = True
            waited = kernel.WaitForSingleObject(process.process, 10000)
            proof['terminationWaitTimedOut'] = waited != WAIT_OBJECT_0
            if waited == WAIT_OBJECT_0:
                try:
                    proof['exitCode'] = exit_code()
                except Exception as error:
                    proof['cleanupErrors'].append({'operation': 'read-exit-code', 'message': str(error)})
            close(process.thread, 'close-primary-thread')
            close(process.process, 'close-process')
        elif job:
            close(job, 'close-job')
            proof['jobClosed'] = True
        if proof['cleanupErrors'] or proof.get('terminationWaitTimedOut'):
            if proof['status'] == 'passed':
                proof['status'] = 'failed-cleanup'
        proof['elapsedSeconds'] = time.monotonic() - started
        receipt.write_text(json.dumps(proof, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in proof.items() if key != 'samples'}))
    if proof['status'] == 'deferred-host-pressure':
        return 75
    if proof['status'] == 'aborted-interrupted':
        return 130
    return 0 if proof['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
