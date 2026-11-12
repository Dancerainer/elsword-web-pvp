"""Run a transient native HTTP/SSE peer on the cloud VM using pinned SSH.

Does not deploy, restart services, alter accounts/configuration or install packages.
Uses an existing ordinary test account; completed 1v1/2v2 matches may write normal history.
Optional --fight-file is an existing remote /tmp launch signal, read only by the peer.
--plan validates staged dependencies and prints an offline plan without SSH or secrets.
"""
import argparse
import getpass
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import stat
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = '/opt/rf-pvp/current'
UPLOADS = ('network-match-peer.mjs', 'network-peer-controls.mjs', 'node-online-socket.mjs', 'http-event-source-peer.mjs')
MAX_REPORT_BYTES = 8 * 1024 * 1024


def argument_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True)
    parser.add_argument('--user', required=True)
    parser.add_argument('--host-fingerprint', required=True)
    parser.add_argument('--index', type=int, default=8)
    parser.add_argument('--seconds', type=int, default=75)
    parser.add_argument('--mode', choices=('1v1', '2v2'), default='1v1')
    parser.add_argument('--skills', choices=('off', 'cycle'), default=None)
    parser.add_argument('--fight-file', help='Optional remote absolute /tmp launch file; this runner never creates it')
    parser.add_argument('--output', default='runtime/cloud-network-peer.json')
    parser.add_argument('--plan', action='store_true', help='Validate/print offline plan; do not connect or prompt for secrets')
    return parser


def verify_peer_imports(root=ROOT):
    """Fail before SSH if a new relative dependency is not in this staging scope."""
    allowed = {
        'network-match-peer.mjs': {'./network-peer-controls.mjs', './node-online-socket.mjs', './http-event-source-peer.mjs'},
        'network-peer-controls.mjs': {'../packages/combat-core/skill-availability.mjs'},
        'node-online-socket.mjs': set(),
        'http-event-source-peer.mjs': set(),
    }
    for name in UPLOADS:
        source = (root / 'tools' / name).read_text(encoding='utf-8')
        imports = set(re.findall(r"(?:from\s+|import\s*)['\"]([.][^'\"]+)['\"]", source))
        if imports != allowed[name]:
            raise ValueError('Unstaged relative peer imports in ' + name + ': ' + str(sorted(imports)))
    return list(UPLOADS)


def make_plan(args, run_id=None, root=ROOT):
    if args.index < 0 or not 10 <= args.seconds <= 600:
        raise ValueError('Peer index must be nonnegative and seconds must be10..600')
    run_id = run_id or uuid.uuid4().hex
    if not re.fullmatch(r'[0-9a-f]{32}', run_id):
        raise ValueError('Temporary run identity must be32 lowercase UUID hex characters')
    if args.fight_file:
        gate = PurePosixPath(args.fight_file)
        if not gate.is_absolute() or not args.fight_file.startswith('/tmp/') or '..' in gate.parts:
            raise ValueError('Remote fight-file must stay under /tmp')
    output = (root / args.output).resolve()
    if not output.is_relative_to((root / 'runtime').resolve()):
        raise ValueError('Local peer output must stay in this task runtime directory')
    remote = '/tmp/rf-network-peer-' + run_id
    tools = remote + '/tools'
    result = remote + '/peer.json'
    source = tools + '/network-match-peer.mjs'
    skills = args.skills or ('cycle' if args.mode == '2v2' else 'off')
    peer_args = [
        '--root=' + PRODUCTION, '--assets=' + PRODUCTION + '/artifacts',
        '--base=http://127.0.0.1:4209', '--origin=http://127.0.0.1:4209',
        '--account-file=/var/lib/rf-pvp/accounts/dev-accounts.json', '--index=' + str(args.index),
        '--seconds=' + str(args.seconds), '--mode=' + args.mode, '--skills=' + skills,
        '--label=Ubuntu-VM-loopback', '--output=' + result,
    ]
    if args.fight_file:
        peer_args.append('--fight-file=' + args.fight_file)
    command = 'sudo -n /opt/rf-node/current/bin/node ' + shlex.quote(source) + ' ' + ' '.join(map(shlex.quote, peer_args))
    # Each unlink operand is derived from this one validated UUID; rm -f never
    # traverses the packages symlink. Empty-directory cleanup is nonrecursive.
    unlink = [tools + '/' + name for name in UPLOADS] + [result, remote + '/packages']
    cleanup = 'sudo -n rm -f -- ' + ' '.join(map(shlex.quote, unlink))
    remove_directories = 'rmdir -- ' + shlex.quote(tools) + ' ' + shlex.quote(remote)
    return {'remote': remote, 'tools': tools, 'source': source, 'result': result,
            'uploads': [tools + '/' + name for name in UPLOADS],
            'packageLink': {'path': remote + '/packages', 'target': PRODUCTION + '/packages', 'usage': 'read-only dependency input'},
            'mode': args.mode, 'skills': skills, 'fightFile': args.fight_file,
            'localOutput': str(output), 'command': command, 'cleanup': cleanup,
            'removeDirectories': remove_directories}


def load_cloud_module():
    spec = importlib.util.spec_from_file_location('rf_cloud', ROOT / 'scripts/deploy-cloud.py')
    cloud = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cloud)
    return cloud


def retrieve_report(sftp, plan):
    """Read exact report bytes via SFTP; persist locally before any cleanup."""
    sftp.get_channel().settimeout(60)
    attributes = sftp.lstat(plan['result'])
    if not stat.S_ISREG(attributes.st_mode):
        raise ValueError('Remote peer report is not a regular file')
    if not isinstance(attributes.st_size, int) or not 0 <= attributes.st_size <= MAX_REPORT_BYTES:
        raise ValueError('Remote peer report exceeds the8MiB size limit or has invalid size')
    with sftp.open(plan['result'], 'rb') as remote_file:
        raw = remote_file.read(attributes.st_size + 1)
    if not isinstance(raw, bytes) or len(raw) != attributes.st_size:
        raise IOError('Remote peer report read length differs from its stat size')
    report = json.loads(raw.decode('utf-8'))
    if not isinstance(report, dict):
        raise ValueError('Remote peer report must be a JSON object')
    output = Path(plan['localOutput'])
    output.parent.mkdir(parents=True, exist_ok=True)
    # Keep the exact original JSON bytes; formatting must not replace the raw
    # evidence that was produced by the remote peer.
    output.write_bytes(raw)
    return len(raw)


def run(args, cloud, plan):
    args.key = None
    password = getpass.getpass('SSH password: ') if sys.stdin.isatty() else sys.stdin.readline().rstrip('\r\n')
    try:
        client = cloud.connect_ssh(args, password)
    finally:
        password = None
    sftp = None
    created = False
    try:
        sftp = client.open_sftp()
        sftp.mkdir(plan['remote'], mode=0o700)
        created = True
        sftp.mkdir(plan['tools'], mode=0o700)
        for name, remote_path in zip(UPLOADS, plan['uploads']):
            sftp.put(str(ROOT / 'tools' / name), remote_path)
            sftp.chmod(remote_path, 0o600)
        sftp.symlink(plan['packageLink']['target'], plan['packageLink']['path'])
        cloud.execute(client, 'test -f ' + shlex.quote(plan['packageLink']['path'] + '/combat-core/skill-availability.mjs'), timeout=15)
        print('Cloud peer staged in isolated UUID directory; mode ' + plan['mode'] + ', skills ' + plan['skills'] + '.', flush=True)
        if plan['fightFile']:
            print('Waiting on remote read-only launch signal: ' + plan['fightFile'], flush=True)
        print(cloud.execute(client, plan['command'], timeout=max(180, args.seconds + 60) + args.seconds + 30), flush=True)
    finally:
        try:
            if created:
                try:
                    size = retrieve_report(sftp, plan)
                    print('Cloud peer report saved locally: ' + str(size) + ' bytes.', flush=True)
                except Exception as error:
                    print('Cloud peer report retrieval failed: ' + type(error).__name__ + ': ' + str(error), flush=True)
                    print('Preserved this UUID directory for recovery: ' + plan['remote'], flush=True)
                    raise RuntimeError('Cloud peer report was not saved; UUID directory preserved for recovery') from error
                try:
                    cloud.execute(client, plan['cleanup'], timeout=15)
                    cloud.execute(client, plan['removeDirectories'], timeout=15)
                except Exception as error:
                    print('Cloud peer temporary cleanup failed: ' + str(error), flush=True)
        finally:
            try:
                if sftp is not None:
                    sftp.close()
            finally:
                client.close()


def main(argv=None):
    args = argument_parser().parse_args(argv)
    verify_peer_imports()
    plan = make_plan(args)
    if args.plan:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    run(args, load_cloud_module(), plan)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
