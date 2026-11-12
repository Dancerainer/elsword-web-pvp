"""Audit or apply a bounded program/asset patch to a pinned cloud release.

Default: SSH read-only audit and local payload preparation. --execute uploads and
switches an independently prepared release; it never provisions or migrates accounts.
Passwords are prompted with getpass, or read once from stdin with --password-stdin.
"""
import argparse
import base64
import difflib
import getpass
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
HEX = re.compile(r'^[a-f0-9]{64}$')
BROWSER_DELTA_LIMIT = 256 * 1024
KNOWN_PROFESSIONS = ('RF', 'LK', 'VC', 'RS', 'BM', 'IS', 'GM', 'BH', 'CA', 'LP', 'MM', 'DE')


def validate_professions(professions):
    if not isinstance(professions, (list, tuple)) or not professions or len(professions) > len(KNOWN_PROFESSIONS) \
            or any(value not in KNOWN_PROFESSIONS for value in professions) or len(set(professions)) != len(professions):
        raise ValueError('Known bounded profession inventory required')


def validate_profession_inventory(professions, candidate_assets):
    """Every requested profession must have a sealed manifest and be checked."""
    validate_professions(professions)
    names = {row['path'] for row in candidate_assets}
    present = {p for p in KNOWN_PROFESSIONS if any(name.startswith('artifacts/' + p.lower() + '/') for name in names)}
    if 'RF' not in professions or set(professions) != present \
            or any('artifacts/' + p.lower() + '/manifest.json' not in names for p in professions):
        raise ValueError('Every candidate profession requires a manifest and activation validation')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(data):
    """Git/Windows newline compatibility only; no other content normalization."""
    return sha(data.replace(b'\r\n', b'\n'))


def relative_path(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ValueError('Invalid patch relative path')
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError('Patch path must stay inside the release')
    return value


def make_delta(old, new):
    before, after = old.splitlines(keepends=True), new.splitlines(keepends=True)
    offsets = [0]
    for line in before:
        offsets.append(offsets[-1] + len(line))
    parts = []
    for tag, i, j, k, l in difflib.SequenceMatcher(None, before, after, autojunk=True).get_opcodes():
        if tag == 'equal':
            parts.append({'copy': [offsets[i], offsets[j]]})
        elif tag in ('insert', 'replace'):
            parts.append({'data': base64.b64encode(b''.join(after[k:l])).decode('ascii')})
    if apply_delta(old, parts) != new:
        raise ValueError('Local delta reconstruction failed')
    return parts


def apply_delta(old, parts):
    output = []
    for part in parts:
        if set(part) == {'copy'}:
            first, last = part['copy']
            if not isinstance(first, int) or not isinstance(last, int) or not 0 <= first <= last <= len(old):
                raise ValueError('Invalid delta byte range')
            output.append(old[first:last])
        elif set(part) == {'data'}:
            output.append(base64.b64decode(part['data'], validate=True))
        else:
            raise ValueError('Invalid delta part')
    return b''.join(output)


def make_browser_delta(old, new):
    """Bound literal bytes without running a large-file sequence matcher."""
    if max(len(old), len(new)) < BROWSER_DELTA_LIMIT:
        return make_delta(old, new)
    common = min(len(old), len(new))
    prefix = suffix = 0
    chunk = 65536
    while prefix + chunk <= common and old[prefix:prefix + chunk] == new[prefix:prefix + chunk]:
        prefix += chunk
    while prefix < common and old[prefix] == new[prefix]:
        prefix += 1
    remaining = common - prefix
    while suffix + chunk <= remaining and old[len(old) - suffix - chunk:len(old) - suffix] == new[len(new) - suffix - chunk:len(new) - suffix]:
        suffix += chunk
    while suffix < remaining and old[len(old) - suffix - 1] == new[len(new) - suffix - 1]:
        suffix += 1
    middle = new[prefix:len(new) - suffix]
    if len(middle) >= BROWSER_DELTA_LIMIT:
        return None
    parts = []
    if prefix:
        parts.append({'copy': [0, prefix]})
    if middle:
        parts.append({'data': base64.b64encode(middle).decode('ascii')})
    if suffix:
        parts.append({'copy': [len(old) - suffix, len(old)]})
    if apply_delta(old, parts) != new:
        raise ValueError('Local browser delta reconstruction failed')
    return parts


def read_plan(file):
    plan = json.loads(file.read_text(encoding='utf-8-sig'))
    if not re.fullmatch(r'[a-f0-9]{40}', str(plan.get('baselineCommit', ''))):
        raise ValueError('Full baseline commit required')
    for field in ['expectedOldBuildSha256', 'buildSha256']:
        if not HEX.fullmatch(str(plan.get(field, ''))):
            raise ValueError('Invalid build digest')
    fields = ['files', 'compatibilityFiles', 'assets']
    if 'baselineAssets' in plan:
        fields.append('baselineAssets')
    if 'assetRemovals' in plan:
        fields.append('assetRemovals')
    for field in fields:
        records = plan.get(field)
        if not isinstance(records, list) or (not records and field != 'assetRemovals') or len(records) > 20000:
            raise ValueError('Bounded nonempty inventory required: ' + field)
        seen = set()
        for row in records:
            name = relative_path(row['path'])
            if name in seen:
                raise ValueError('Duplicate inventory path: ' + name)
            seen.add(name)
            digest = row.get('canonicalSha256' if field == 'compatibilityFiles' else 'sha256')
            if not HEX.fullmatch(str(digest)):
                raise ValueError('Invalid file digest: ' + name)
            if field == 'files':
                if not (name.startswith(('apps/', 'packages/', 'config/', 'contracts/', 'dist/', 'artifacts/')) or name in ('package.json', 'package-lock.json', 'tools/assets/character/sample_pose.mjs')):
                    raise ValueError('Program patch cannot alter this path: ' + name)
                for baseline in ['baselineSha256', 'baselineCanonicalSha256']:
                    if row.get(baseline) is not None and not HEX.fullmatch(str(row[baseline])):
                        raise ValueError('Invalid baseline file digest')
                local = ROOT / name
                if local.is_symlink() or not local.is_file() or not local.resolve().is_relative_to(ROOT):
                    raise ValueError('Local patch input is not a regular workspace file: ' + name)
                if sha(local.read_bytes()) != digest:
                    raise ValueError('Local planned file changed: ' + name)
            if field in ('assets', 'baselineAssets', 'assetRemovals') and not name.startswith('artifacts/'):
                raise ValueError('Asset inventory must stay in artifacts')
    validate_asset_patch(plan)
    if not any(row['path'] == 'dist/game.js' and row['sha256'] == plan['buildSha256'] for row in plan['files']):
        raise ValueError('Browser entry digest must be included in the plan')
    if not any(row['path'] == 'artifacts/native/manifest.json' for row in plan['assets']):
        raise ValueError('Native manifest inventory required')
    if 'requiredProfessions' in plan:
        validate_profession_inventory(plan['requiredProfessions'], plan.get('candidateAssets', plan['assets']))
    if 'hostProgramFiles' in plan:
        rows = plan['hostProgramFiles']
        if not isinstance(rows, list) or not rows or len(rows) > 20000 or plan.get('hostProgramDomain') != 'rf-online-host-program-sha256-v1':
            raise ValueError('Bounded host fingerprint inventory required')
        seen = set()
        for row in rows:
            name = relative_path(row['file'])
            if name in seen or not HEX.fullmatch(str(row.get('sha256'))) or type(row.get('bytes')) is not int or row['bytes'] < 0:
                raise ValueError('Invalid host fingerprint entry')
            seen.add(name)
    return plan


def validate_asset_patch(plan):
    """Asset writes/removals require the exact old/new snapshot difference."""
    targets = {row['path']: row['sha256'] for row in plan['assets']}
    baseline = {row['path']: row['sha256'] for row in plan.get('baselineAssets', plan['assets'])}
    changed = {name for name, digest in targets.items() if baseline.get(name) != digest}
    writes = {row['path']: row for row in plan['files'] if row['path'].startswith('artifacts/')}
    if set(writes) != changed:
        raise ValueError('Asset writes must exactly cover changed/new target assets')
    for name, row in writes.items():
        if row['sha256'] != targets[name] or row.get('baselineSha256') != baseline.get(name) or row.get('baselineCanonicalSha256') is not None:
            raise ValueError('Asset write lacks exact snapshot before/after hashes: ' + name)
    removals = {row['path']: row['sha256'] for row in plan.get('assetRemovals', [])}
    if removals != {name: digest for name, digest in baseline.items() if name not in targets}:
        raise ValueError('Asset removals must exactly cover retired baseline snapshot assets')


def merged_host_fingerprint(plan, audit):
    """Seal the mixed remote/new raw bytes, preserving unchanged LF/CRLF files."""
    if 'hostProgramFiles' not in plan:
        return None
    planned = {row['path']: row for row in plan['files']}
    files = []
    for row in sorted(plan['hostProgramFiles'], key=lambda row: row['file']):
        name = row['file']
        if name in planned:
            record = {'file': name, 'bytes': len((ROOT / name).read_bytes()), 'sha256': planned[name]['sha256']}
        else:
            old = audit['files'].get(name)
            if not old:
                raise ValueError('Host fingerprint input absent from merged release: ' + name)
            record = {'file': name, 'bytes': old['bytes'], 'sha256': old['sha256']}
        files.append(record)
    framed = {'schemaVersion': 1, 'domain': plan['hostProgramDomain'], 'files': files}
    return sha(json.dumps(framed, ensure_ascii=False, separators=(',', ':')).encode('utf8'))


# Shared by remote read-only audit and the locked preparation/activation call.
REMOTE_HELPERS = r'''
from pathlib import Path
import os,json,hashlib,base64,gzip,stat,re,subprocess
ROOT=Path('/opt/rf-pvp/releases');CURRENT=Path('/opt/rf-pvp/current')
ACCOUNTS=Path('/var/lib/rf-pvp/accounts')
def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(data):return sha(data.replace(b'\r\n',b'\n'))
def digest(value):return sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode())
def regular(base,name):
    if not isinstance(name,str) or name.startswith('/') or '\\' in name or ':' in name or any(p in ('','.','..') for p in name.split('/')):raise RuntimeError('Invalid inventory path')
    file=base/name
    if not file.resolve().is_relative_to(base):raise RuntimeError('Inventory path escapes release')
    if file.is_symlink() or not file.is_file():raise RuntimeError('Inventory file missing or linked: '+name)
    return file
def current_release():
    if not CURRENT.is_symlink():raise RuntimeError('Current release must be a managed symlink')
    base=CURRENT.resolve(strict=True)
    if base.parent!=ROOT or not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[a-f0-9]{8}',base.name):raise RuntimeError('Unrecognized current release path')
    return base
def inventory(base):
    records={}
    for directory,names,files in os.walk(base,followlinks=False):
        relative=Path(directory).relative_to(base)
        if relative==Path('.'):names[:]=[name for name in names if name!='runtime']
        for name in names:
            file=Path(directory)/name
            if file.is_symlink():raise RuntimeError('Linked directory in release inventory')
        for name in files:
            file=Path(directory)/name
            if file.is_symlink() or not file.is_file():raise RuntimeError('Nonregular release input')
            data=file.read_bytes();key=file.relative_to(base).as_posix()
            records[key]={'sha256':sha(data),'canonicalSha256':canonical(data),'bytes':len(data)}
    return records
def persistent():
    records={}
    for directory,names,files in os.walk(ACCOUNTS,followlinks=False):
        for name in names:
            if (Path(directory)/name).is_symlink():raise RuntimeError('Linked account directory')
        for name in files:
            file=Path(directory)/name
            if file.is_symlink() or not file.is_file():raise RuntimeError('Nonregular persistent input')
            records[file.relative_to(ACCOUNTS).as_posix()]=sha(file.read_bytes())
    if not records:raise RuntimeError('Persistent account tree is empty')
    return records
def infrastructure():
    result={}
    for value in ['/etc/systemd/system/rf-pvp.service','/etc/nginx/sites-available/rf-pvp','/etc/nginx/sites-enabled/rf-pvp','/opt/rf-node/current']:
        file=Path(value)
        if file.is_symlink():result[value]={'link':os.readlink(file)}
        elif file.is_file():result[value]={'sha256':sha(file.read_bytes()),'mode':stat.S_IMODE(file.stat().st_mode)}
        else:raise RuntimeError('Expected infrastructure missing')
    return result
def service_snapshot():
    result={}
    for unit in ['rf-pvp','nginx']:
        output=subprocess.check_output(['systemctl','show',unit,'-p','ActiveState','-p','SubState','-p','MainPID'],text=True)
        row=dict(line.split('=',1) for line in output.splitlines() if '=' in line)
        if set(row)!={'ActiveState','SubState','MainPID'}:raise RuntimeError('Incomplete service state: '+unit)
        result[unit]=row
    return result
def require_stopped(states):
    if set(states)!={'rf-pvp','nginx'}:raise RuntimeError('Both application and nginx states required')
    for unit,row in states.items():
        if row!={'ActiveState':'inactive','SubState':'dead','MainPID':'0'}:raise RuntimeError('Keep-stopped requires inactive/dead/PID0: '+unit)
    return states
def verify_plan(plan,base,records):
    if records.get('dist/game.js',{}).get('sha256')!=plan['expectedOldBuildSha256']:raise RuntimeError('Old cloud browser build differs')
    for row in plan['compatibilityFiles']:
        if records.get(row['path'],{}).get('canonicalSha256')!=row['canonicalSha256']:raise RuntimeError('Baseline source differs: '+row['path'])
    legacy='candidateAssets' in plan and 'baselineAssets' not in plan
    targets={row['path']:row['sha256'] for row in plan.get('candidateAssets',plan['assets'])}
    baseline={row['path']:row['sha256'] for row in plan.get('baselineAssets',plan['assets'])}
    writes={row['path']:row for row in plan['files'] if row['path'].startswith('artifacts/')}
    if legacy:
        for name,row in writes.items():
            if row.get('baselineSha256') is not None:baseline[name]=row['baselineSha256']
    changes={name for name,value in targets.items() if baseline.get(name)!=value}
    if set(writes)!=changes:raise RuntimeError('Asset writes do not exactly cover changed/new target inventory')
    for name,row in writes.items():
        if row['sha256']!=targets[name] or row.get('baselineSha256')!=baseline.get(name) or not legacy and row.get('baselineCanonicalSha256') is not None:raise RuntimeError('Invalid asset update contract')
        if name not in baseline and name in records:raise RuntimeError('New asset already exists outside frozen baseline: '+name)
    for name,value in baseline.items():
        if records.get(name,{}).get('sha256')!=value:raise RuntimeError('Baseline asset differs: '+name)
    if 'baselineAssets' in plan and {name:row['sha256'] for name,row in records.items() if name.startswith('artifacts/')}!=baseline:raise RuntimeError('Complete baseline asset inventory differs')
    removals={row['path']:row['sha256'] for row in plan.get('assetRemovals',[])}
    if removals!={name:value for name,value in baseline.items() if name not in targets}:raise RuntimeError('Retired asset inventory differs')
    for row in plan['files']:
        old=records.get(row['path'])
        raw,normal=row.get('baselineSha256'),row.get('baselineCanonicalSha256')
        if raw or normal:
            if not old or not (raw and old['sha256']==raw or normal and old['canonicalSha256']==normal):raise RuntimeError('Planned source baseline differs: '+row['path'])
'''


def remote_python_stream(client, code, timeout=600):
    """Keep large inventory JSON out of the SSH exec request's size limit."""
    started = time.monotonic()
    stdin, stdout, stderr = client.exec_command('sudo -n python3 -', timeout=timeout)
    stdin.write(code + '\n');stdin.flush();stdin.channel.shutdown_write();stdin.close()
    channel = stdout.channel
    output, errors = bytearray(), bytearray()
    while True:
        while channel.recv_ready():output.extend(channel.recv(65536))
        while channel.recv_stderr_ready():errors.extend(channel.recv_stderr(65536))
        if channel.exit_status_ready() and (channel.eof_received or channel.closed) and not channel.recv_ready() and not channel.recv_stderr_ready():break
        if time.monotonic() - started > timeout:
            channel.close();raise TimeoutError('Remote patch operation timed out')
        time.sleep(0.05)
    status = channel.recv_exit_status()
    if status:raise RuntimeError('Remote patch operation failed: ' + errors.decode(errors='replace')[-2000:])
    return output.decode('utf8')


def remote_audit(module, client, plan, keep_stopped=False):
    code = REMOTE_HELPERS + '\nkeep_stopped=' + repr(keep_stopped) + '\nplan=json.loads(' + repr(json.dumps(plan)) + ''')
services=service_snapshot() if keep_stopped else None
if keep_stopped:require_stopped(services)
base=current_release();records=inventory(base);verify_plan(plan,base,records)
accounts=persistent()
if keep_stopped:require_stopped(service_snapshot())
result={'release':str(base),'files':records,'inventorySha256':digest(records),'accounts':{'files':len(accounts),'sha256':digest(accounts)},'infrastructure':infrastructure(),'services':services}
print(base64.b64encode(gzip.compress(json.dumps(result).encode())).decode())
'''
    encoded = remote_python_stream(client, code)
    decoded = gzip.decompress(base64.b64decode(encoded.strip(), validate=True))
    if len(decoded) > 32 * 1024 * 1024:
        raise RuntimeError('Remote inventory exceeded its limit')
    return json.loads(decoded)


def prepare_payload(plan, audit, old_bundle, keep_stopped=False, full_browser=False):
    by_hash = {record['sha256']: name for name, record in audit['files'].items()}
    operations = []
    for row in plan['files']:
        name, expected = row['path'], row['sha256']
        old = audit['files'].get(name)
        if old and old['sha256'] == expected:
            continue
        data = (ROOT / name).read_bytes()
        if sha(data) != expected:
            raise RuntimeError('Local planned file changed before packaging: ' + name)
        operation = {'path': name, 'sha256': expected, 'beforeSha256': old['sha256'] if old else None}
        if expected in by_hash:
            operation.update(kind='copy', source=by_hash[expected])
        elif name == 'dist/game.js' and not full_browser:
            if old_bundle is None:
                raise ValueError('--old-bundle is required for differential browser patches')
            previous = old_bundle.read_bytes()
            if sha(previous) != plan['expectedOldBuildSha256'] or not old or sha(previous) != old['sha256']:
                raise RuntimeError('Read-only local browser delta base differs from cloud')
            parts = make_browser_delta(previous, data)
            if parts is not None:
                operation.update(kind='delta', baseSha256=sha(previous), parts=parts)
            else:
                operation.update(kind='data', data=base64.b64encode(data).decode('ascii'))
        else:
            operation.update(kind='data', data=base64.b64encode(data).decode('ascii'))
        operations.append(operation)
    for row in plan.get('assetRemovals', []):
        old = audit['files'].get(row['path'])
        if not old or old['sha256'] != row['sha256']:
            raise RuntimeError('Retired asset baseline differs: ' + row['path'])
        operations.append({'kind': 'remove', 'path': row['path'], 'beforeSha256': row['sha256'], 'sha256': None})
    release = time.strftime('%Y%m%d-%H%M%S', time.gmtime()) + '-' + uuid.uuid4().hex[:8]
    payload = {'schemaVersion': 1, 'release': release, 'base': audit['release'], 'plan': plan,
               'baseInventorySha256': audit['inventorySha256'], 'infrastructure': audit['infrastructure'], 'operations': operations,
               'expectedHostProgramSha256': merged_host_fingerprint(plan, audit),
               'keepStopped': keep_stopped, 'services': audit.get('services')}
    return payload, gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), compresslevel=6)


def activation_code(remote_file, payload_digest):
    return REMOTE_HELPERS + '\nKNOWN_PROFESSIONS=' + repr(KNOWN_PROFESSIONS) + '\npatch=Path(' + repr(remote_file) + ');expected_payload=' + repr(payload_digest) + r'''
import fcntl,shutil,subprocess,time,urllib.request
lock=open('/var/lock/rf-pvp-deploy.lock','a');os.chmod(lock.name,0o600)
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
blob=patch.read_bytes()
if sha(blob)!=expected_payload:raise RuntimeError('Uploaded patch checksum differs')
payload=json.loads(gzip.decompress(blob));plan=payload['plan'];base=current_release()
keep_stopped=payload.get('keepStopped',False)
if type(keep_stopped) is not bool:raise RuntimeError('Invalid activation service policy')
if keep_stopped:
    require_stopped(payload.get('services',{}));require_stopped(service_snapshot())
    if not payload.get('expectedHostProgramSha256') or not plan.get('requiredProfessions'):raise RuntimeError('Offline activation requires host and profession validation')
if str(base)!=payload['base']:raise RuntimeError('Current release changed after audit')
if not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[a-f0-9]{8}',payload['release']):raise RuntimeError('Invalid new release identity')
before=inventory(base);verify_plan(plan,base,before)
if digest(before)!=payload['baseInventorySha256']:raise RuntimeError('Old release changed after audit')
if infrastructure()!=payload['infrastructure']:raise RuntimeError('Infrastructure changed after audit')
destination=ROOT/payload['release']
if destination.exists() or destination.is_symlink():raise RuntimeError('New release path already exists')
switched=False;prepared=False;accounts_before=None
def switch(target):
    temporary=CURRENT.with_name('current.'+payload['release']+'.next')
    if temporary.exists() or temporary.is_symlink():raise RuntimeError('Switch temporary path already exists')
    temporary.symlink_to(target);os.replace(temporary,CURRENT)
def ready(target,build):
    for attempt in range(30):
        try:
            state=subprocess.run(['systemctl','is-active','--quiet','rf-pvp'],capture_output=True)
            pid=subprocess.check_output(['systemctl','show','-p','MainPID','--value','rf-pvp'],text=True).strip()
            cwd=Path('/proc')/pid/'cwd'
            response=urllib.request.urlopen('http://127.0.0.1:4209/',timeout=2)
            if state.returncode==0 and cwd.resolve()==target and response.status==200:
                if sha(regular(target,'dist/game.js').read_bytes())!=build:raise RuntimeError('Active browser build differs')
                return {'mainPid':int(pid),'applicationCwd':str(cwd.resolve()),'httpStatus':200,'buildSha256':build}
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('Patched application did not become ready')
try:
    shutil.copytree(base,destination,copy_function=os.link,ignore=shutil.ignore_patterns('runtime'))
    prepared=True
    expected={name:dict(row) for name,row in before.items()}
    retired={row['path']:row['sha256'] for row in plan.get('assetRemovals',[])}
    planned={row['path']:row['sha256'] for row in plan['files']}
    seen=set()
    for operation in payload['operations']:
        name=operation['path'];target=destination/name
        if name in seen:raise RuntimeError('Duplicate patch operation')
        seen.add(name)
        if not target.resolve().is_relative_to(destination):raise RuntimeError('Patch target escapes new release')
        old=before.get(name)
        if (old['sha256'] if old else None)!=operation['beforeSha256']:raise RuntimeError('Patch source changed')
        if operation['kind']=='remove':
            if retired.get(name)!=operation['beforeSha256'] or operation['sha256'] is not None:raise RuntimeError('Unplanned asset removal')
            regular(destination,name).unlink();expected.pop(name);continue
        if planned.get(name)!=operation['sha256']:raise RuntimeError('Unplanned patch write')
        if operation['kind']=='copy':data=regular(base,operation['source']).read_bytes()
        elif operation['kind']=='data':data=base64.b64decode(operation['data'],validate=True)
        elif operation['kind']=='delta':
            original=regular(base,name).read_bytes()
            if sha(original)!=operation['baseSha256']:raise RuntimeError('Remote delta base differs')
            segments=[]
            for part in operation['parts']:
                if set(part)=={'copy'}:
                    first,last=part['copy']
                    if not isinstance(first,int) or not isinstance(last,int) or not 0<=first<=last<=len(original):raise RuntimeError('Invalid delta byte range')
                    segments.append(original[first:last])
                elif set(part)=={'data'}:segments.append(base64.b64decode(part['data'],validate=True))
                else:raise RuntimeError('Invalid delta part')
            data=b''.join(segments)
        else:raise RuntimeError('Unknown patch operation')
        if sha(data)!=operation['sha256']:raise RuntimeError('Reconstructed patch file differs')
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_name(target.name+'.'+payload['release']+'.next')
        with temporary.open('xb') as output:output.write(data);output.flush();os.fsync(output.fileno())
        os.chmod(temporary,0o644);os.replace(temporary,target)
        expected[name]={'sha256':sha(data),'canonicalSha256':canonical(data),'bytes':len(data)}
    actual=inventory(destination)
    if digest(actual)!=digest(expected):raise RuntimeError('New raw release inventory differs from merged patch')
    for row in plan['files']+plan['assets']:
        if actual.get(row['path'],{}).get('sha256')!=row['sha256']:raise RuntimeError('Prepared release file differs: '+row['path'])
    if 'baselineAssets' in plan and {name:row['sha256'] for name,row in actual.items() if name.startswith('artifacts/')}!={row['path']:row['sha256'] for row in plan['assets']}:raise RuntimeError('Complete target asset inventory differs')
    if digest(inventory(base))!=digest(before):raise RuntimeError('Patch mutated the old hardlinked release')
    runtime=destination/'runtime';runtime.mkdir(mode=0o700);shutil.chown(runtime,user='rf-pvp',group='rf-pvp')
    node='/opt/rf-node/current/bin/node'
    fingerprint_code="import{fingerprintHostProgram}from'./packages/combat-assets/program-fingerprint.mjs';const p=await fingerprintHostProgram({root:process.cwd()});console.log(JSON.stringify({sha256:p.sha256,files:p.files.length}));"
    host=json.loads(subprocess.check_output([node,'--input-type=module','-e',fingerprint_code],cwd=destination,text=True))
    if payload.get('expectedHostProgramSha256') and host['sha256']!=payload['expectedHostProgramSha256']:raise RuntimeError('Staged raw host fingerprint differs')
    profession_check=None
    if plan.get('requiredProfessions'):
        requested=plan['requiredProfessions']
        present={p for p in KNOWN_PROFESSIONS if any(name.startswith('artifacts/'+p.lower()+'/') for name in actual)}
        if not isinstance(requested,list) or any(p not in KNOWN_PROFESSIONS for p in requested) or len(requested)!=len(set(requested)) or 'RF' not in requested or set(requested)!=present or any('artifacts/'+p.lower()+'/manifest.json' not in actual for p in requested):raise RuntimeError('Staged profession manifest inventory differs')
        check="import{loadServerCombatAssets}from'./packages/combat-assets/server-assets.mjs';const a=await loadServerCombatAssets({root:process.cwd(),assetRoot:process.cwd()+'/artifacts'});console.log(JSON.stringify({professions:a.professions,diagnostics:a.assetDiagnostics}));"
        profession_run=subprocess.run([node,'--input-type=module','-e',check],cwd=destination,text=True,capture_output=True)
        if profession_run.returncode:raise RuntimeError('Staged combat assets failed to load: '+profession_run.stderr[-500:])
        profession_check=json.loads(profession_run.stdout)
        if any(not profession_check.get('professions',{}).get(p) for p in plan['requiredProfessions']) or profession_check.get('diagnostics'):raise RuntimeError('Staged profession diagnostics differ')
    accounts_before=persistent()
    if keep_stopped:require_stopped(service_snapshot())
    switch(destination);switched=True
    if keep_stopped:
        services_after=require_stopped(service_snapshot())
        readiness={'mode':'offline','services':services_after,'buildSha256':plan['buildSha256'],'httpProbed':False}
    else:
        subprocess.run(['systemctl','restart','rf-pvp'],check=True,capture_output=True)
        readiness=ready(destination,plan['buildSha256'])
    accounts_after=persistent()
    if accounts_after!=accounts_before:raise RuntimeError('Persistent content changed during activation; accounts are never restored or overwritten')
    if infrastructure()!=payload['infrastructure']:raise RuntimeError('Infrastructure content changed during activation')
    if digest(inventory(base))!=digest(before):raise RuntimeError('Old release changed during activation')
    if digest(inventory(destination))!=digest(expected):raise RuntimeError('Active raw inventory changed during activation')
    if keep_stopped:require_stopped(service_snapshot())
    result={'status':'deployed','release':str(destination),'previous':str(base),'readiness':readiness,
      'actualHostProgram':host,'mergedRawInventorySha256':digest(expected),'oldReleaseUnchanged':True,
      'assetsUnchanged':not any(row['path'].startswith('artifacts/') for row in payload['operations']),
      'baselineAssetCount':sum(name.startswith('artifacts/') for name in before),'assetCount':len(plan.get('candidateAssets',plan['assets'])),
      'changedAssetCount':sum(row['path'].startswith('artifacts/') for row in payload['operations']),
      'removedAssetCount':len(plan.get('assetRemovals',[])),
      'stagedProfessions':profession_check,'servicesKeptStopped':keep_stopped,'infrastructureUnchanged':True,
      'persistentContent':{'beforeSha256':digest(accounts_before),'afterSha256':digest(accounts_after),'files':len(accounts_before),'unchanged':True}}
except Exception as failure:
    rollback={'attempted':switched,'succeeded':not switched}
    if switched:
        try:
            switch(base)
            if keep_stopped:
                rollback['services']=require_stopped(service_snapshot())
            else:
                subprocess.run(['systemctl','restart','rf-pvp'],check=True,capture_output=True)
                rollback['readiness']=ready(base,plan['expectedOldBuildSha256'])
            rollback['succeeded']=True
        except Exception as error:rollback.update(succeeded=False,errorType=type(error).__name__)
    if prepared and not switched and destination.parent==ROOT:shutil.rmtree(destination)
    result={'status':'failed','failureType':type(failure).__name__,'failureMessage':str(failure)[:600],'rollback':rollback,
      'accountsRestoredOrOverwritten':False,'release':str(destination),'previous':str(base)}
finally:patch.unlink(missing_ok=True)
print(json.dumps(result))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, default=ROOT / 'runtime/cloud-network-patch-plan.json')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--execute', action='store_true')
    mode.add_argument('--inspect', action='store_true', help='Explicit alias for the default SSH read-only audit')
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', default='ubuntu')
    parser.add_argument('--host-fingerprint', required=True)
    parser.add_argument('--key')
    parser.add_argument('--password-stdin', action='store_true')
    parser.add_argument('--keep-stopped', action='store_true', help='Require application/nginx stopped; activate and validate offline without any service command')
    parser.add_argument('--full-browser', action='store_true', help='Send the frozen browser file compressed in full; all remote baseline and activation guards remain')
    parser.add_argument('--old-bundle', type=Path, help='Previous game.js used to prepare differential browser patches')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', args.host):
        parser.error('Host must be an IP or DNS name')
    plan = read_plan(args.plan)
    if args.keep_stopped and (not plan.get('hostProgramFiles') or not plan.get('requiredProfessions')):
        parser.error('Keep-stopped requires a complete host and profession inventory')
    spec = importlib.util.spec_from_file_location('cloud_deploy_shared', ROOT / 'scripts/deploy-cloud.py')
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    password = None if args.key else sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('SSH password: ')
    client = module.connect_ssh(args, password)
    uploaded = None
    report_file = ROOT / 'runtime/cloud-network-patch-deployment.json'
    try:
        audit = remote_audit(module, client, plan, args.keep_stopped)
        payload, blob = prepare_payload(plan, audit, args.old_bundle, args.keep_stopped, args.full_browser)
        ROOT.joinpath('runtime').mkdir(exist_ok=True)
        local = ROOT / 'runtime' / ('rf-network-patch-' + payload['release'] + '.json.gz')
        with local.open('xb') as output:output.write(blob)
        os.chmod(local,0o600)
        report = {'schemaVersion':1,'mode':'execute' if args.execute else 'audit-only','status':'audited',
          'baselineCommit':plan['baselineCommit'],'sourceCommit':plan.get('sourceCommit'),'previous':audit['release'],'releaseId':payload['release'],
          'expectedOldBuildSha256':plan['expectedOldBuildSha256'],'buildSha256':plan['buildSha256'],
          'localHostProgramSha256':plan.get('hostProgramSha256'),'oldReleaseInventorySha256':audit['inventorySha256'],
          'candidateFiles':len(plan['files']),'changedFiles':len(payload['operations']),
          'changedPaths':[row['path'] for row in payload['operations']][:100],
          'compatibilityFilesVerified':len(plan['compatibilityFiles']),'assetsVerified':len(plan.get('baselineAssets',plan['assets'])),
          'targetAssetCount':len(plan['assets']),'keepStopped':args.keep_stopped,'auditedServices':audit.get('services'),
          'expectedRemoteHostProgramSha256':payload.get('expectedHostProgramSha256'),
          'patchBytes':len(blob),'patchSha256':sha(blob),'payloadFile':str(local),'accountAudit':audit['accounts'],
          'credentialsIncluded':False,'provisioned':False,'nginxRestarted':False,'accountsMigrated':False}
        dry_file = ROOT / 'runtime/cloud-network-patch-audit.json'
        dry_file.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report),flush=True)
        if args.execute:
            name=local.name
            with client.open_sftp() as sftp:uploaded=sftp.normalize('.')+'/'+name
            module.upload_release(client,local,uploaded)
            result=json.loads(remote_python_stream(client,activation_code(uploaded,sha(blob)),timeout=900))
            report.update(result)
            report_file.write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report),flush=True)
            if report['status']!='deployed':raise RuntimeError('Cloud program patch failed; see bounded deployment report')
    finally:
        if uploaded:
            try:
                with client.open_sftp() as sftp:sftp.remove(uploaded)
            except OSError:pass
        client.close()


if __name__=='__main__':
    main()
