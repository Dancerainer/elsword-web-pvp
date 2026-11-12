"""Apply only the reviewed update-file proxy settings, with digest guards and rollback."""
import argparse
import getpass
import importlib.util
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
UPDATE_LOCATION='''    location = /api/client-update/plan {
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no always;
    }
    location = /api/client-update/file {
        proxy_pass http://127.0.0.1:4209;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 3600s;
        add_header X-Accel-Buffering no always;
    }
'''

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-release',required=True)
    parser.add_argument('--expected-sha256',required=True)
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--password-stdin',action='store_true')
    parser.add_argument('--host',required=True)
    parser.add_argument('--user',required=True)
    parser.add_argument('--host-fingerprint',required=True)
    args=parser.parse_args()
    args.key=None
    cloud=module('proxy_cloud','scripts/deploy-cloud.py');patch=module('proxy_patch','scripts/deploy-cloud-patch.py')
    password=sys.stdin.readline().rstrip('\r\n') if args.password_stdin else getpass.getpass('SSH password: ')
    client=cloud.connect_ssh(args,password)
    try:
        code=patch.REMOTE_HELPERS+'\nexpected_release='+repr(args.expected_release)+'\nexpected_sha='+repr(args.expected_sha256)+'\nexecute='+repr(args.execute)+'\nlocation='+repr(UPDATE_LOCATION)+r'''
import fcntl
lock=open('/var/lock/rf-pvp-deploy.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if str(current_release())!=expected_release:raise RuntimeError('Release changed before proxy preparation')
file=Path('/etc/nginx/sites-available/rf-pvp');before=file.read_bytes();before_sha=sha(before)
if before_sha!=expected_sha:raise RuntimeError('Reviewed proxy configuration changed')
text=before.decode()
if '/api/client-update/' in text or text.count('    location / {')!=1:raise RuntimeError('Proxy structure requires a new review')
after=text.replace('    location / {',location+'    location / {').encode()
accounts_before=persistent();mode=stat.S_IMODE(file.stat().st_mode)
def write(data):
    temporary=file.with_name(file.name+'.update-priority.next')
    with temporary.open('xb') as output:output.write(data);output.flush();os.fsync(output.fileno())
    os.chmod(temporary,mode);os.replace(temporary,file)
if execute:
    write(after)
    try:
        subprocess.run(['nginx','-t'],check=True,capture_output=True)
        subprocess.run(['systemctl','reload','nginx'],check=True,capture_output=True)
    except Exception:
        write(before);subprocess.run(['nginx','-t'],check=True,capture_output=True)
        subprocess.run(['systemctl','reload','nginx'],check=True,capture_output=True);raise
    if persistent()!=accounts_before:raise RuntimeError('Account content changed during proxy configuration; never overwritten')
print(json.dumps({'executed':execute,'release':expected_release,'path':str(file),'beforeSha256':before_sha,
'afterSha256':sha(after),'accountsUnchanged':True,'accountFiles':len(accounts_before),
'scope':'Only exact update plan/file locations; online streams and other routes unchanged','proxyReadTimeoutSeconds':3600,
'buffering':False,'nginxReloaded':execute,'applicationRestarted':False}))
'''
        result=json.loads(patch.remote_python_stream(client,code,timeout=60))
        (ROOT/'runtime/client-update-proxy-priority.json').write_text(json.dumps(result,indent=2)+'\n')
        print(json.dumps(result))
    finally:client.close()

if __name__=='__main__':main()
