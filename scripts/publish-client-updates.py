"""Publish sealed small-client updates and start an explicitly approved release.

Keep update artifacts separate from accounts. No dependencies are installed,
no accounts are restored, and no ordinary resource downloads are enabled.
"""
import argparse
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tarfile
import re
import uuid

ROOT = Path(__file__).resolve().parents[1]


def archive_update_files(updates, archive):
    """Windows is_file silently returns False at MAX_PATH without this prefix.
    Never turn a complete catalog into an archive that omits all its blobs.
    """
    source = updates.resolve()
    if updates.is_symlink() or not source.is_dir():
        raise ValueError('Physical sealed update directory required')
    if os.name == 'nt' and not str(source).startswith('\\\\?\\'):
        source = Path('\\\\?\\' + str(source))
    count = 0
    with tarfile.open(archive, 'w:gz') as output:
        for file in sorted(source.rglob('*')):
            if file.is_symlink():
                raise ValueError('Linked update input')
            if file.is_file():
                output.add(file, arcname=file.relative_to(source).as_posix(), recursive=False)
                count += 1
            elif not file.is_dir():
                raise ValueError('Unreadable update input: ' + str(file))
    return count


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('updates', 'start'))
    parser.add_argument('--expected-release', required=True, help='Exact absolute /opt/rf-pvp/releases/... path; not just the release ID')
    parser.add_argument('--updates', type=Path)
    parser.add_argument('--enable-stun', action='store_true')
    parser.add_argument('--ssh-python-dir', type=Path, required=True)
    parser.add_argument('--password-stdin', action='store_true')
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--host-fingerprint', required=True)
    parser.add_argument('--stun-url', help='Public STUN URL advertised when enabling the STUN service')
    args = parser.parse_args()
    args.key = None
    if args.enable_stun and not re.fullmatch(r'stun:(?:[A-Za-z0-9.-]+|\[[A-Fa-f0-9:]+\]):3478', args.stun_url or ''):
        parser.error('--enable-stun requires --stun-url stun:hostname:3478')
    sys.path.insert(0, str(args.ssh_python_dir))
    cloud = module('client_cloud', ROOT / 'scripts/deploy-cloud.py')
    patch = module('client_patch', ROOT / 'scripts/deploy-cloud-patch.py')
    password = sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('SSH password: ')
    client = cloud.connect_ssh(args, password)
    remote = None
    runtime = ROOT / 'runtime'
    runtime.mkdir(exist_ok=True)
    preamble = patch.REMOTE_HELPERS + '\nexpected_release=' + repr(args.expected_release) + '''
base=current_release()
if str(base)!=expected_release:raise RuntimeError('Approved release changed')
accounts_before=persistent();before_infrastructure=infrastructure()
'''
    try:
        if args.phase == 'updates':
            if not args.updates or not args.updates.is_dir():
                raise ValueError('Sealed update directory required')
            archive = runtime / ('client-updates-' + uuid.uuid4().hex + '.tar.gz')
            archive_update_files(args.updates, archive)
            archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
            with client.open_sftp() as sftp:
                remote = sftp.normalize('.') + '/' + archive.name
            client = cloud.upload_release(client, archive, remote, reconnect=lambda: cloud.connect_ssh(args, password))
            code = preamble + '\narchive=Path(' + repr(remote) + ');archive_hash=' + repr(archive_hash) + r'''
import fcntl,tarfile,gzip,shutil
lock=open('/var/lock/rf-pvp-deploy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if sha(archive.read_bytes())!=archive_hash:raise RuntimeError('Update upload digest differs')
destination=Path('/var/lib/rf-pvp/client-updates')
if destination.is_symlink():raise RuntimeError('Linked update destination')
destination.mkdir(parents=True,exist_ok=True,mode=0o755)
staging=destination/('.stage-'+archive_hash[:16])
staging.mkdir(mode=0o700)
try:
    with tarfile.open(archive,'r:gz') as source:
        for member in source.getmembers():
            name=member.name
            if not member.isfile() or member.size>100_000_000 or not re.fullmatch(r'(?:current.json|[a-f0-9]{64}/catalog.json|[a-f0-9]{64}/blobs/[a-f0-9]{64}.gz)',name):raise RuntimeError('Invalid update archive entry')
            file=staging/name;file.parent.mkdir(parents=True,exist_ok=True)
            file.write_bytes(source.extractfile(member).read())
    pointer=json.loads((staging/'current.json').read_text())
    if pointer['buildSha256']!=sha((base/'dist/game.js').read_bytes()):raise RuntimeError('Update version differs from active source')
    for folder in staging.iterdir():
        if not folder.is_dir():continue
        catalog=json.loads((folder/'catalog.json').read_text());manifest=catalog['manifest']
        if sha(json.dumps(manifest,separators=(',',':'),ensure_ascii=False).encode())!=folder.name:raise RuntimeError('Client release digest differs')
        for name,row in catalog.get('transport',{}).items():
            blob=(folder/'blobs'/(row['gzipSha256']+'.gz')).read_bytes()
            raw=gzip.decompress(blob)
            if len(blob)!=row['gzipBytes'] or sha(blob)!=row['gzipSha256'] or len(raw)!=row['bytes'] or sha(raw)!=manifest['files'][name]:raise RuntimeError('Update file seal differs')
        target=destination/folder.name
        if target.exists():
            registered=(target/'catalog.json').read_bytes()
            if registered!=(folder/'catalog.json').read_bytes():
                # A base manifest is a reference to its registered immutable
                # catalog, which may also contain historic transport metadata.
                # Never replace it; the new current target remains byte-exact.
                prior=json.loads(registered)
                if folder.name==pointer['releaseId'] or catalog.get('transport') or prior.get('releaseId')!=folder.name or prior.get('manifest')!=manifest:
                    raise RuntimeError('Immutable update release already differs')
        else:
            for item in folder.rglob('*'):os.chmod(item,0o755 if item.is_dir() else 0o644)
            os.chmod(folder,0o755);os.rename(folder,target)
    os.chmod(staging/'current.json',0o644);os.replace(staging/'current.json',destination/'current.json')
    accounts_after=persistent()
    if accounts_before!=accounts_after:raise RuntimeError('Account files changed during update publication; never overwritten')
    result={'status':'published','release':str(base),'clientReleaseId':pointer['releaseId'],'buildSha256':pointer['buildSha256'],'archiveSha256':archive_hash,'accountsUnchanged':True,'accountFiles':len(accounts_before),'ordinaryResourceDownloadsChanged':False,'infrastructureUnchanged':infrastructure()==before_infrastructure}
finally:
    shutil.rmtree(staging);archive.unlink(missing_ok=True)
print(json.dumps(result))
'''
        else:
            code = preamble + '\nenable_stun=' + repr(args.enable_stun) + '\nstun_url=' + repr(args.stun_url) + r'''
import subprocess,time,urllib.request
for service in ['rf-pvp','nginx']:
    if subprocess.run(['systemctl','is-active','--quiet',service]).returncode==0:raise RuntimeError('Expected stopped service before approved start')
settings=json.loads((ACCOUNTS/'resource-delivery.json').read_text())
if settings['enabled'] is not False:raise RuntimeError('Ordinary resource downloads must remain closed')
pointer=json.loads(Path('/var/lib/rf-pvp/client-updates/current.json').read_text())
if pointer['buildSha256']!=sha((base/'dist/game.js').read_bytes()):raise RuntimeError('Client update pointer differs from active program')
configuration=[]
if enable_stun:
    dropin=Path('/etc/systemd/system/rf-pvp.service.d/client-release-rtc.conf')
    unit=Path('/etc/systemd/system/rf-pvp-stun.service')
    if dropin.exists() or unit.exists():raise RuntimeError('STUN configuration already exists; review rather than overwrite')
    dropin.parent.mkdir(parents=True,exist_ok=True)
    dropin.write_text('[Service]\nEnvironment=\'RF_RTC_ICE_SERVERS=[{"urls":["' + stun_url + '"]}]\'\nEnvironment=RF_NETWORK_PEER_MODE=hybrid\n')
    unit.write_text('[Unit]\nDescription=RF PvP bounded STUN binding discovery\nAfter=network.target\n[Service]\nType=simple\nUser=rf-pvp\nGroup=rf-pvp\nWorkingDirectory=/opt/rf-pvp/current\nEnvironment=RF_RTC_STUN_HOST=0.0.0.0\nEnvironment=RF_RTC_STUN_PORT=3478\nExecStart=/opt/rf-node/current/bin/node apps/server/stun-server.mjs\nRestart=on-failure\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\n[Install]\nWantedBy=multi-user.target\n')
    for file in [dropin,unit]:os.chmod(file,0o644);configuration.append({'path':str(file),'sha256':sha(file.read_bytes())})
    subprocess.run(['systemctl','daemon-reload'],check=True)
services=['rf-pvp','nginx']+(['rf-pvp-stun'] if enable_stun else [])
try:
    subprocess.run(['systemctl','start',*services],check=True,capture_output=True)
    for attempt in range(45):
        try:
            pid=subprocess.check_output(['systemctl','show','-p','MainPID','--value','rf-pvp'],text=True).strip()
            if (Path('/proc')/pid/'cwd').resolve()!=base:raise RuntimeError('Wrong service release')
            state=json.load(urllib.request.urlopen('http://127.0.0.1:4209/api/resource-delivery',timeout=2))
            update=json.load(urllib.request.urlopen('http://127.0.0.1:4209/api/client-update',timeout=2))
            if state['enabled'] is not False or update['releaseId']!=pointer['releaseId']:raise RuntimeError('Service or update state differs')
            if any(subprocess.run(['systemctl','is-active','--quiet',service]).returncode for service in services):raise RuntimeError('Service not active')
            break
        except Exception:
            if attempt==44:raise
            time.sleep(1)
    after=persistent()
    if accounts_before!=after:raise RuntimeError('Persistent files changed during service start; never restored or overwritten')
    result={'status':'started','release':str(base),'services':services,'mainPid':int(pid),'resourceDelivery':state,'clientReleaseId':update['releaseId'],'accountFiles':len(after),'accountsUnchanged':True,'accountDigest':digest(after),'configuration':configuration,'originalInfrastructureUnchanged':infrastructure()==before_infrastructure,'cloudFirewallChanged':False}
except Exception:
    subprocess.run(['systemctl','stop',*services],capture_output=True)
    raise
print(json.dumps(result))
'''
        result = json.loads(patch.remote_python_stream(client, code, timeout=600))
        (runtime / ('client-update-' + args.phase + '-cloud.json')).write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result), flush=True)
    finally:
        client.close()


if __name__ == '__main__':
    main()
