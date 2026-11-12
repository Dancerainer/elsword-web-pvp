"""Deploy the built web simulation over SSH; SSH credentials never enter the archive.

Requires paramiko. Use --provision-only before preparing the release assets.
Passwords are prompted, or read once from stdin with --password-stdin.
The first connection requires an explicit, independently obtained host fingerprint.
"""
import argparse
import base64
import errno
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
for directory in (ROOT / 'runtime/ssh-python', ROOT.parent.parent / 'rf-local-pvp-ui/elsword_2016_webpvp/runtime/ssh-python'):
    if directory.is_dir():
        sys.path.insert(0, str(directory))
import paramiko


def say(phase, **details):
    print(json.dumps({'phase': phase, **details}, ensure_ascii=False), flush=True)


class PinnedHost(paramiko.MissingHostKeyPolicy):
    def __init__(self, fingerprint):
        self.fingerprint = fingerprint

    def missing_host_key(self, client, hostname, key):
        actual = 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
        if actual != self.fingerprint:
            raise RuntimeError('SSH server fingerprint differs from the verified host')
        client.get_host_keys().add(hostname, key.get_name(), key)


def execute(client, command, timeout=600):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    stdin.close()
    # Drain both streams to avoid deadlock during package installation.
    channel = stdout.channel
    out, err = bytearray(), bytearray()
    started = time.monotonic()
    while True:
        while channel.recv_ready():
            out.extend(channel.recv(65536))
        while channel.recv_stderr_ready():
            err.extend(channel.recv_stderr(65536))
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if time.monotonic() - started > timeout:
            channel.close()
            raise TimeoutError('Remote operation timed out')
        time.sleep(0.05)
    code = channel.recv_exit_status()
    if code:
        transport = client.get_transport()
        if code == -1 and (transport is None or not transport.is_active()):
            raise paramiko.SSHException('SSH connection dropped before remote exit status')
        raise RuntimeError(f'Remote operation failed ({code}): ' + err.decode(errors='replace')[-4000:] + out.decode(errors='replace')[-2000:])
    return out.decode(errors='replace')


def remote_python(client, code, timeout=600):
    return execute(client, "sudo -n python3 - <<'RF_DEPLOY_PY'\n" + code + '\nRF_DEPLOY_PY', timeout)


def connect_ssh(args, password):
    """Every connection, including retries, checks the same pinned host key."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHost(args.host_fingerprint))
    try:
        client.connect(args.host, username=args.user, password=password, key_filename=args.key,
                       timeout=15, auth_timeout=15, allow_agent=False, look_for_keys=False)
        transport = client.get_transport()
        if transport is None:
            raise paramiko.SSHException('SSH transport unavailable')
        # Packaging can be lengthy: keep the authenticated session alive before
        # any archive is built, rather than only after SFTP starts.
        transport.set_keepalive(15)
        return client
    except Exception:
        client.close()
        raise


def file_sha256(file, length=None):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        remaining = length
        while remaining is None or remaining:
            chunk = source.read(1024 * 1024 if remaining is None else min(remaining, 1024 * 1024))
            if not chunk:
                if remaining:
                    raise RuntimeError('Local release archive is shorter than its resume offset')
                break
            digest.update(chunk)
            if remaining is not None:
                remaining -= len(chunk)
    return digest.hexdigest()


def remote_prefix_sha256(client, remote_archive, size):
    # Hash on the server; do not download the already transferred prefix again.
    code = f'''
from pathlib import Path
import hashlib,json,os,stat
file=Path({remote_archive!r})
before=file.lstat()
if not stat.S_ISREG(before.st_mode) or before.st_size!={size!r}:raise RuntimeError('Remote archive changed before prefix verification')
digest=hashlib.sha256()
with file.open('rb') as source:
    remaining={size!r}
    while remaining:
        chunk=source.read(min(remaining,1048576))
        if not chunk:raise RuntimeError('Remote archive prefix is incomplete')
        digest.update(chunk);remaining-=len(chunk)
after=file.lstat()
if (before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_ino,after.st_size,after.st_mtime_ns):raise RuntimeError('Remote archive changed during prefix verification')
print(json.dumps({{'bytes':{size!r},'sha256':digest.hexdigest()}}))
'''
    result = json.loads(remote_python(client, code))
    if result.get('bytes') != size or not re.fullmatch(r'[a-f0-9]{64}', str(result.get('sha256', ''))):
        raise RuntimeError('Invalid remote archive prefix checksum')
    return result['sha256']


def retryable_upload_error(error):
    if isinstance(error, (paramiko.AuthenticationException, paramiko.BadHostKeyException)):
        return False
    if isinstance(error, paramiko.ssh_exception.NoValidConnectionsError):
        return bool(error.errors) and all(retryable_upload_error(reason) for reason in error.errors.values())
    if isinstance(error, (paramiko.SSHException, EOFError, TimeoutError, ConnectionError)):
        return True
    return isinstance(error, OSError) and (
        error.errno in {errno.ECONNRESET, errno.ECONNABORTED, errno.ECONNREFUSED, errno.ETIMEDOUT, errno.EPIPE,
                       errno.ENETDOWN, errno.ENETRESET, errno.ENETUNREACH, errno.EHOSTUNREACH,
                       10053, 10054, 10060, 10061, 10065}
        or getattr(error, 'winerror', None) in {10053, 10054, 10060, 10061, 10065}
        or error.errno is None and str(error) == 'Socket is closed')


def upload_release(client, output, remote_archive, *, reconnect=None, max_reconnects=3):
    """Resume this one immutable package only after checking its remote prefix."""
    if not isinstance(max_reconnects, int) or not 0 <= max_reconnects <= 3:
        raise ValueError('Upload permits at most three reconnects')
    total = output.stat().st_size
    started = time.monotonic()
    for attempt in range(max_reconnects + 1):
        try:
            if attempt:
                client.close()
                say('upload-reconnect', reconnect=attempt, maximum=max_reconnects)
                client = reconnect()
            with client.open_sftp() as sftp:
                sftp.get_channel().settimeout(45)
                try:
                    attributes = sftp.lstat(remote_archive)
                except OSError as error:
                    if error.errno != errno.ENOENT:
                        raise
                    attributes = None
                if attributes is not None:
                    if not attempt:
                        raise FileExistsError('Unique release archive already exists')
                    if not stat.S_ISREG(attributes.st_mode) or not 0 <= attributes.st_size <= total:
                        raise RuntimeError('Remote partial archive has an invalid type or size')
                    sftp.chmod(remote_archive, 0o600)
                    offset = attributes.st_size
                    say('upload-verify-prefix', reconnect=attempt, prefixBytes=offset, archiveBytes=total)
                    if remote_prefix_sha256(client, remote_archive, offset) != file_sha256(output, offset):
                        raise RuntimeError('Partial release archive prefix checksum mismatch; refusing resume')
                    say('upload-prefix-verified', prefixBytes=offset)
                else:
                    offset = 0
                written = offset
                last_report = time.monotonic()
                last_report_bytes = offset

                def progress():
                    elapsed = max(0.001, time.monotonic() - started)
                    say('upload-progress', attempt=attempt + 1, uploadedBytes=written, archiveBytes=total,
                        percent=round(100 * written / total, 2) if total else 100,
                        elapsedSeconds=round(elapsed, 1), bytesPerSecond=round(written / elapsed))

                progress()
                if offset < total or attributes is None:
                    with sftp.open(remote_archive, 'r+b' if attributes is not None else 'wx') as uploaded:
                        # No credential bytes are written before private mode is applied.
                        sftp.chmod(remote_archive, 0o600)
                        if uploaded.stat().st_size != offset:
                            raise RuntimeError('Remote partial archive changed before resume')
                        uploaded.seek(offset)
                        uploaded.set_pipelined(True)
                        window = 0
                        with output.open('rb') as source:
                            source.seek(offset)
                            while chunk := source.read(256 * 1024):
                                checkpoint = window + len(chunk) >= 2 * 1024 * 1024 or written + len(chunk) == total
                                if checkpoint:
                                    # Paramiko flush only empties its local buffer. A final
                                    # synchronous write collects every pending write reply,
                                    # bounding the pipeline to 2MiB (about 64 requests).
                                    tail = min(len(chunk), 32 * 1024)
                                    if len(chunk) > tail:
                                        uploaded.write(chunk[:-tail])
                                    uploaded.set_pipelined(False)
                                    uploaded.write(chunk[-tail:])
                                    uploaded.set_pipelined(True)
                                else:
                                    uploaded.write(chunk)
                                written += len(chunk)
                                window += len(chunk)
                                if checkpoint:
                                    if uploaded.stat().st_size != written:
                                        raise RuntimeError('Remote release archive length differs after acknowledged writes')
                                    window = 0
                                current = time.monotonic()
                                if current - last_report >= 5 or written - last_report_bytes >= 8 * 1024 * 1024:
                                    progress()
                                    last_report, last_report_bytes = current, written
                if written != total or sftp.lstat(remote_archive).st_size != total:
                    raise RuntimeError('Release upload is incomplete')
                progress()
            return client
        except Exception as error:
            if reconnect is None or not retryable_upload_error(error) or attempt >= max_reconnects:
                raise
            # Exception strings may contain third-party diagnostics. Only the
            # class is logged; passwords remain in the connection closure.
            say('upload-interrupted', attempt=attempt + 1, errorType=type(error).__name__)
            time.sleep(min(2 ** attempt, 4))


def provision(client):
    say('install-system-packages')
    execute(client, 'sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update -qq && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends nginx ca-certificates python3 xz-utils', timeout=600)
    say('install-node-lts')
    output = remote_python(client, r'''
import urllib.request, re, hashlib, tarfile, os, shutil, json
from pathlib import Path
base='https://nodejs.org/dist/latest-v22.x/'
checks=urllib.request.urlopen(base+'SHASUMS256.txt',timeout=30).read().decode()
match=re.search(r'^([a-f0-9]{64})\s+(node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz)$',checks,re.M)
if not match: raise RuntimeError('Official Node.js Linux x64 checksum unavailable')
expected,name=match.groups();version=name[:-7]
target=Path('/opt/rf-node')/version
if not target.exists():
    archive=Path('/tmp')/name
    with urllib.request.urlopen(base+name,timeout=60) as response,archive.open('wb') as file:
        shutil.copyfileobj(response,file)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise RuntimeError('Node checksum mismatch')
    target.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive) as package:package.extractall(target.parent,filter='data')
    archive.unlink()
link=Path('/opt/rf-node/current')
temporary=link.with_name('current.next')
if temporary.is_symlink():temporary.unlink()
temporary.symlink_to(target)
os.replace(temporary,link)
print(json.dumps({'node':version,'sha256':expected}))
''')
    say('node-ready', details=json.loads(output))
    execute(client, 'id rf-pvp >/dev/null 2>&1 || sudo -n useradd --system --home-dir /var/lib/rf-pvp --shell /usr/sbin/nologin rf-pvp')
    execute(client, 'sudo -n install -d -o root -g root -m 755 /opt/rf-pvp/releases && sudo -n install -d -o rf-pvp -g rf-pvp -m 700 /var/lib/rf-pvp/accounts && sudo -n install -d -o root -g root -m 700 /var/backups/rf-pvp')
    say('provisioned')


def package_release(asset_root, account_root, output):
    output.touch(mode=0o600, exist_ok=False)
    with tarfile.open(output, 'w:gz', compresslevel=5) as package:
        for directory in ['apps', 'packages', 'config', 'contracts', 'dist']:
            for file in sorted((ROOT / directory).rglob('*')):
                if file.is_file() and file.suffix != '.map' and file.name != 'deployment.json':
                    package.add(file, arcname=str(file.relative_to(ROOT)).replace('\\', '/'), recursive=False)
        for relative in ['package.json', 'pnpm-lock.yaml', 'tools/assets/character/sample_pose.mjs',
                         'tools/verify-multimode-online.mjs', 'tools/verify-public-runtime.mjs', 'tools/verify-public-accounts.mjs',
                         'tools/verify-public-online-transport.mjs']:
            file = ROOT / relative
            if file.is_file():
                package.add(file, arcname=relative, recursive=False)
        for file in sorted(asset_root.rglob('*')):
            if file.is_file():
                package.add(file, arcname='artifacts/' + file.relative_to(asset_root).as_posix(), recursive=False)
        if account_root:
            for file in sorted(account_root.rglob('*')):
                if file.is_file() and file.suffix == '.json':
                    package.add(file, arcname='migration-accounts/' + file.relative_to(account_root).as_posix(), recursive=False)
    os.chmod(output, 0o600)


def migration_script(remote_archive, digest, release):
    return f'''
from pathlib import Path
import hashlib,tarfile,shutil,os,json
archive=Path({remote_archive!r})
destination=Path('/opt/rf-pvp/releases')/{release!r}
accounts=Path('/var/lib/rf-pvp/accounts')
stage=accounts.parent/({release!r}+'-accounts-stage')
marker='.initial-cloud-migration.json'
try:
    if hashlib.sha256(archive.read_bytes()).hexdigest()!={digest!r}:raise RuntimeError('Release archive checksum mismatch')
    # Credentials extracted here remain private even if validation or copying fails.
    destination.mkdir(mode=0o700)
    with tarfile.open(archive) as package:package.extractall(destination,filter='data')
    migration=destination/'migration-accounts'
    if migration.exists():
        files=sorted(file for file in migration.rglob('*') if file.is_file())
        fingerprints={{}}
        decoded={{}}
        for file in files:
            if file.is_symlink() or file.suffix!='.json':raise RuntimeError('Invalid account migration file')
            relative=file.relative_to(migration).as_posix()
            try:decoded[relative]=json.loads(file.read_text(encoding='utf-8-sig'))
            except (ValueError,UnicodeError):raise RuntimeError('Invalid account migration JSON: '+relative) from None
            fingerprints[relative]=hashlib.sha256(file.read_bytes()).hexdigest()
        primary=decoded.get('dev-account.json')
        extra=decoded.get('dev-accounts.json',{{'schemaVersion':1,'accounts':[]}})
        player=decoded.get('dev-player-account.json')
        if not isinstance(extra,dict) or extra.get('schemaVersion')!=1 or not isinstance(extra.get('accounts'),list):raise RuntimeError('Invalid migration account catalogue')
        identities=[primary,*extra['accounts'],*([player] if player is not None else [])]
        usernames=set()
        for identity in identities:
            if not isinstance(identity,dict) or not isinstance(identity.get('username'),str) or not identity['username'] or not isinstance(identity.get('password'),str) or not identity['password']:raise RuntimeError('Invalid migration account credentials')
            if identity['username'] in usernames:raise RuntimeError('Duplicate migration account identity')
            usernames.add(identity['username'])
        fingerprint=hashlib.sha256(json.dumps(fingerprints,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        previous_marker=accounts/marker
        if any(accounts.iterdir()):
            # An activation failure may be retried with the same initial import.
            # Never replace the persistent account tree or its newer histories.
            try:previous=json.loads(previous_marker.read_text())
            except (OSError,ValueError):previous={{}}
            if previous.get('sourceFingerprint')!=fingerprint:raise RuntimeError('Account migration cannot overwrite existing cloud data')
        else:
            stage.mkdir(mode=0o700)
            shutil.copytree(migration,stage,dirs_exist_ok=True)
            for relative,expected in fingerprints.items():
                if hashlib.sha256((stage/relative).read_bytes()).hexdigest()!=expected:raise RuntimeError('Staged account checksum mismatch')
            (stage/marker).write_text(json.dumps({{'schemaVersion':1,'sourceFingerprint':fingerprint}})+'\\n')
            for file in [stage,*stage.rglob('*')]:
                os.chmod(file,0o700 if file.is_dir() else 0o600)
                shutil.chown(file,user='rf-pvp',group='rf-pvp')
            if any(accounts.iterdir()):raise RuntimeError('Account storage changed during migration')
            # POSIX rename replaces the still-empty directory in one operation.
            os.replace(stage,accounts)
        shutil.rmtree(migration)
    for file in [accounts,*accounts.rglob('*')]:
        os.chmod(file,0o700 if file.is_dir() else 0o600)
        shutil.chown(file,user='rf-pvp',group='rf-pvp')
    os.chmod(destination,0o755)
except Exception:
    # This destination is unique to the unpublished release.
    if destination.exists():shutil.rmtree(destination)
    raise
finally:
    if stage.exists():shutil.rmtree(stage)
    archive.unlink(missing_ok=True)
'''


def activation_script(release, unit, nginx, host):
    return f'''
from pathlib import Path
import os,subprocess,json,time,urllib.request,base64,stat,hashlib
release=Path('/opt/rf-pvp/releases')/{release!r}
if not release.is_dir() or release.is_symlink():raise RuntimeError('Uploaded release directory is unavailable')
if not (release/'apps/server/dev-server.mjs').is_file() or not (release/'dist/game.js').is_file():raise RuntimeError('Uploaded release files are incomplete')
current=Path('/opt/rf-pvp/current')
previous=str(current.resolve()) if current.is_symlink() else None
unit_file=Path('/etc/systemd/system/rf-pvp.service')
site=Path('/etc/nginx/sites-available/rf-pvp')
enabled=Path('/etc/nginx/sites-enabled/rf-pvp')
default=Path('/etc/nginx/sites-enabled/default')
paths=[unit_file,site,enabled,default,current]
def capture(path):
    if path.is_symlink():return {{'kind':'symlink','target':os.readlink(path)}}
    if path.exists():
        if not path.is_file():raise RuntimeError('Unexpected deployment path type: '+str(path))
        return {{'kind':'file','mode':stat.S_IMODE(path.stat().st_mode),'data':base64.b64encode(path.read_bytes()).decode()}}
    return {{'kind':'missing'}}
snapshots={{str(path):capture(path) for path in paths}}
def write_atomic(path,data,mode=0o644):
    temporary=path.with_name(path.name+'.'+{release!r}+'.next')
    temporary.write_bytes(data);os.chmod(temporary,mode);os.replace(temporary,path)
def replace_link(path,target):
    temporary=path.with_name(path.name+'.'+{release!r}+'.next')
    if temporary.is_symlink():temporary.unlink()
    temporary.symlink_to(target);os.replace(temporary,path)
def restore(path,snapshot):
    if snapshot['kind']=='missing':path.unlink(missing_ok=True)
    elif snapshot['kind']=='symlink':replace_link(path,snapshot['target'])
    else:write_atomic(path,base64.b64decode(snapshot['data']),snapshot['mode'])
def is_active(service):
    return subprocess.run(['systemctl','is-active','--quiet',service],capture_output=True).returncode==0
def is_enabled(service):
    return subprocess.run(['systemctl','is-enabled','--quiet',service],capture_output=True).returncode==0
states={{name:{{'active':is_active(name),'enabled':is_enabled(name)}} for name in ['rf-pvp','nginx']}}
backup=Path('/var/backups/rf-pvp')/({release!r}+'-activation.json')
write_atomic(backup,(json.dumps({{'paths':snapshots,'services':states}},indent=2)+'\\n').encode(),0o600)
try:
    (release/'runtime').mkdir(exist_ok=True)
    subprocess.run(['chown','rf-pvp:rf-pvp',str(release/'runtime')],check=True)
    write_atomic(unit_file,{unit!r}.encode())
    write_atomic(site,{nginx!r}.encode())
    replace_link(enabled,str(site))
    if default.is_symlink():default.unlink()
    subprocess.run(['nginx','-t'],check=True,capture_output=True)
    replace_link(current,str(release))
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','enable','rf-pvp','nginx'],check=True,capture_output=True)
    # Restart belongs inside the rollback scope, including immediate unit failures.
    subprocess.run(['systemctl','restart','rf-pvp'],check=True)
    for retry in range(30):
        try:
            response=urllib.request.urlopen('http://127.0.0.1:4209/',timeout=2)
            if response.status==200:break
        except Exception:time.sleep(1)
    else:raise RuntimeError('Game service failed readiness')
    subprocess.run(['systemctl','reload-or-restart','nginx'],check=True)
except Exception as failure:
    try:
        subprocess.run(['systemctl','stop','rf-pvp'],check=False,capture_output=True)
        for path in paths:restore(path,snapshots[str(path)])
        subprocess.run(['systemctl','daemon-reload'],check=True)
        for service,state in states.items():
            if service=='rf-pvp' and snapshots[str(unit_file)]['kind']=='missing':
                # A first deployment has no previous unit to enable or restart.
                subprocess.run(['systemctl','disable','rf-pvp'],check=False,capture_output=True)
                subprocess.run(['systemctl','stop','rf-pvp'],check=False,capture_output=True)
                continue
            subprocess.run(['systemctl','enable' if state['enabled'] else 'disable',service],check=state['enabled'],capture_output=True)
            if state['active']:subprocess.run(['systemctl','restart',service],check=True)
            else:subprocess.run(['systemctl','stop',service],check=False)
        subprocess.run(['nginx','-t'],check=True,capture_output=True)
    except Exception as rollback_failure:
        raise RuntimeError('Deployment failed and rollback needs attention: '+type(rollback_failure).__name__) from failure
    raise
print(json.dumps({{'release':{release!r},'previous':previous,'service':'rf-pvp','url':'http://{host}/',
    'buildSha256':hashlib.sha256((release/'dist/game.js').read_bytes()).hexdigest()}}))
'''


def release_templates(host):
    unit = '''[Unit]
Description=Elsword web PvP match service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rf-pvp
Group=rf-pvp
WorkingDirectory=/opt/rf-pvp/current
Environment=NODE_ENV=production
Environment=RF_PORT=4209
Environment=RF_ASSET_ROOT=/opt/rf-pvp/current/artifacts
Environment=RF_ACCOUNT_ROOT=/var/lib/rf-pvp/accounts
Environment=RF_ONLINE_EVENT_TRANSPORT=sse
Environment=RF_TRUST_LOOPBACK_PROXY=1
ExecStart=/opt/rf-node/current/bin/node /opt/rf-pvp/current/apps/server/dev-server.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/rf-pvp /opt/rf-pvp/current/runtime
MemoryMax=2G
UMask=0077

[Install]
WantedBy=multi-user.target
'''
    nginx = f'''server {{
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name {host};
    client_max_body_size 256k;
    gzip on;
    gzip_min_length 1024;
    gzip_types text/javascript application/javascript application/json application/wasm model/gltf-binary text/css;
    location = /api/online/socket {{
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }}
    location = /api/online/events {{
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no;
    }}
    location = /api/client-update/plan {{
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
    }}
    location = /api/client-update/file {{
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
    }}
    location / {{
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_read_timeout 60s;
    }}
}}
'''
    return unit, nginx


def deploy(client, asset_root, account_root, host, *, reconnect=None):
    release = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    output = ROOT / 'runtime' / ('cloud-release-' + release + '.tar.gz')
    output.parent.mkdir(parents=True, exist_ok=True)
    remote_archive = None
    try:
        package_release(asset_root, account_root, output)
        digest = file_sha256(output)
        say('upload-release', archiveBytes=output.stat().st_size, sha256=digest)
        # SSH exec and SFTP both start in the authenticated user's home. This
        # unique relative path survives reconnection without a new archive name.
        remote_archive = 'rf-release-' + release + '.tar.gz'
        client = upload_release(client, output, remote_archive, reconnect=reconnect)
        # Verify archive and retire stale credential migration copies before opening the service.
        remote_python(client, migration_script(remote_archive, digest, release))
        unit, nginx = release_templates(host)
        say('activate-release', release=release)
        metadata = remote_python(client, activation_script(release, unit, nginx, host))
        result = json.loads(metadata)
        result.update({'archiveSha256': digest, 'buildSha256': hashlib.sha256((ROOT / 'dist/game.js').read_bytes()).hexdigest()})
        (ROOT / 'runtime/cloud-deployment.json').write_text(json.dumps(result, indent=2) + '\n')
        # The local archive includes passwords for initial migration; remove once transferred.
        say('deployed', **result)
    finally:
        output.unlink(missing_ok=True)
        if remote_archive:
            try:
                with client.open_sftp() as sftp:
                    try:sftp.remove(remote_archive)
                    except OSError as error:
                        if error.errno != 2:raise
            except Exception:
                # No passwords are printed, even when transport cleanup fails.
                say('private-upload-cleanup-pending', path=remote_archive)



def resume_activation(client, release, host):
    if not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[a-f0-9]{8}', release):
        raise ValueError('Invalid uploaded release identifier')
    unit, nginx = release_templates(host)
    say('activate-uploaded-release', release=release)
    result = json.loads(remote_python(client, activation_script(release, unit, nginx, host)))
    result['reactivated'] = True
    metadata = ROOT / 'runtime/cloud-deployment.json'
    metadata.parent.mkdir(parents=True, exist_ok=True)
    metadata.write_text(json.dumps(result, indent=2) + '\n')
    say('deployed', **result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', default='ubuntu')
    parser.add_argument('--host-fingerprint', required=True)
    parser.add_argument('--key')
    parser.add_argument('--password-stdin', action='store_true')
    parser.add_argument('--provision-only', action='store_true')
    parser.add_argument('--skip-provision', action='store_true')
    parser.add_argument('--activate-release', help='Activate an already uploaded release without provision, upload or migration')
    parser.add_argument('--asset-root', type=Path)
    parser.add_argument('--account-root', type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', args.host):
        parser.error('Host must be an IP or DNS name')
    if args.activate_release and (not re.fullmatch(r'[0-9]{8}-[0-9]{6}-[a-f0-9]{8}', args.activate_release)
                                 or args.provision_only or args.asset_root or args.account_root):
        parser.error('Activation requires a valid release ID and no provision-only/asset/account arguments')
    if not args.provision_only and not args.activate_release and (not args.asset_root or not args.asset_root.is_dir()):
        parser.error('A verified runtime asset snapshot is required')
    password = None if args.key else sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('SSH password: ')
    clients = []
    def reconnect():
        client = connect_ssh(args, password)
        clients.append(client)
        return client
    client = reconnect()
    try:
        if args.activate_release:
            resume_activation(client, args.activate_release, args.host)
            return
        if not args.skip_provision:
            provision(client)
        if not args.provision_only:
            deploy(client, args.asset_root.resolve(), args.account_root.resolve() if args.account_root else None, args.host, reconnect=reconnect)
    finally:
        for connection in clients:
            connection.close()


if __name__ == '__main__':
    main()
