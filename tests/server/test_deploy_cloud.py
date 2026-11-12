"""Upload/connection regressions use an in-memory SFTP server, never cloud credentials."""
import base64
import contextlib
import errno
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tarfile
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('rf_deploy_cloud', ROOT / 'scripts/deploy-cloud.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class MemoryRemote:
    def __init__(self):
        self.files, self.permissions, self.opens = {}, {}, []
        self.written = 0

    def attributes(self, path):
        if path not in self.files:
            raise FileNotFoundError(errno.ENOENT, 'not found')
        return types.SimpleNamespace(st_size=len(self.files[path]), st_mode=stat.S_IFREG | self.permissions[path])


class MemoryFile:
    def __init__(self, client, path, mode):
        self.client, self.remote, self.path, self.position = client, client.remote, path, 0
        self.pipelined = False
        self.remote.opens.append(mode)
        if mode == 'wx':
            if path in self.remote.files:
                raise FileExistsError(errno.EEXIST, 'already exists')
            self.remote.files[path] = bytearray()
            self.remote.permissions[path] = 0o644
        elif mode != 'r+b':
            raise AssertionError('Unexpected upload mode')

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        if kind is None and self.client.fail_close:
            self.client.fail_close = False
            raise ConnectionResetError(errno.ECONNRESET, 'lost close acknowledgement')

    def stat(self):
        if self.client.pending:
            raise AssertionError('stat cannot replace collecting pending write acknowledgements')
        return self.remote.attributes(self.path)

    def seek(self, offset):
        self.position = offset

    def set_pipelined(self, value):
        self.pipelined = value

    def write(self, chunk):
        if self.remote.permissions[self.path] != 0o600:
            raise AssertionError('Release bytes were written before setting private permissions')
        length = len(chunk)
        fail = self.client.fail_after is not None and self.client.sent + length > self.client.fail_after
        if fail:
            length = max(0, self.client.fail_after - self.client.sent)
        target = self.remote.files[self.path]
        target[self.position:self.position + length] = chunk[:length]
        self.position += length
        self.client.sent += length
        self.remote.written += length
        self.client.pending += length
        self.client.max_pending = max(self.client.max_pending, self.client.pending)
        if not self.pipelined:
            self.client.pending = 0
        if fail:
            self.client.fail_after = None
            raise ConnectionResetError(errno.ECONNRESET, 'connection dropped with arbitrary partial packet')


class MemorySftp:
    def __init__(self, client):
        self.client, self.remote = client, client.remote

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def get_channel(self):
        return types.SimpleNamespace(settimeout=lambda seconds: self.client.timeouts.append(seconds))

    def lstat(self, path):
        return self.remote.attributes(path)

    def chmod(self, path, mode):
        self.remote.permissions[path] = mode

    def open(self, path, mode):
        return MemoryFile(self.client, path, mode)

    def remove(self, path):
        self.remote.attributes(path)
        del self.remote.files[path]


class MemoryClient:
    def __init__(self, remote, fail_after=None, fail_close=False):
        self.remote, self.fail_after, self.fail_close = remote, fail_after, fail_close
        self.sent, self.pending, self.max_pending, self.closed = 0, 0, 0, False
        self.timeouts = []

    def close(self):
        self.closed = True

    def open_sftp(self):
        if self.closed:
            raise deploy.paramiko.SSHException('closed transport')
        return MemorySftp(self)


class DeployUploadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.file = Path(self.temporary.name) / 'release.tar.gz'
        self.payload = (b'first-segment\0' * 360000) + b'last-segment'
        self.file.write_bytes(self.payload)
        self.remote = MemoryRemote()
        self.path = 'rf-release-unit-test.tar.gz'
        self.messages = []
        self.prefixes = []
        self.clients = []
        self.patch_say = patch.object(deploy, 'say', lambda phase, **value: self.messages.append({'phase': phase, **value}))
        self.patch_sleep = patch.object(deploy.time, 'sleep', lambda seconds: None)
        self.patch_prefix = patch.object(deploy, 'remote_prefix_sha256', side_effect=self.prefix)
        for p in [self.patch_say, self.patch_sleep, self.patch_prefix]:
            p.start()
            self.addCleanup(p.stop)

    def prefix(self, client, path, size):
        self.prefixes.append(size)
        return hashlib.sha256(self.remote.files[path][:size]).hexdigest()

    def client(self, **options):
        value = MemoryClient(self.remote, **options)
        self.clients.append(value)
        return value

    def test_partial_packet_resumes_from_verified_remote_offset_and_bounds_pipeline(self):
        first = self.client(fail_after=786451)
        latest = deploy.upload_release(first, self.file, self.path, reconnect=self.client)
        self.assertIs(latest, self.clients[-1])
        self.assertTrue(first.closed)
        self.assertEqual(self.prefixes, [786451])
        self.assertEqual(self.remote.files[self.path], self.payload)
        self.assertEqual(self.remote.written, len(self.payload), 'resume must not resend the valid prefix')
        self.assertEqual(self.remote.opens, ['wx', 'r+b'])
        self.assertTrue(all(client.max_pending <= 2 * 1024 * 1024 for client in self.clients))
        self.assertTrue(all(client.timeouts == [45] for client in self.clients))
        progress = [message for message in self.messages if message['phase'] == 'upload-progress']
        self.assertEqual(progress[-1]['uploadedBytes'], len(self.payload))
        self.assertEqual(progress[-1]['percent'], 100)

    def test_complete_remote_upload_with_lost_close_response_is_verified_without_retransmission(self):
        deploy.upload_release(self.client(fail_close=True), self.file, self.path, reconnect=self.client)
        self.assertEqual(self.prefixes, [len(self.payload)])
        self.assertEqual(self.remote.opens, ['wx'])
        self.assertEqual(self.remote.written, len(self.payload))

    def test_corrupt_remote_prefix_is_never_appended_or_retried(self):
        def reconnect():
            self.remote.files[self.path][0] ^= 1
            return self.client()
        with self.assertRaisesRegex(RuntimeError, 'prefix checksum mismatch'):
            deploy.upload_release(self.client(fail_after=500021), self.file, self.path, reconnect=reconnect)
        self.assertEqual(len(self.clients), 2)
        self.assertEqual(self.remote.opens, ['wx'])
        self.assertEqual(self.remote.written, 500021)

    def test_oversized_partial_and_preexisting_first_archive_are_rejected(self):
        self.remote.files[self.path] = bytearray(b'foreign archive')
        self.remote.permissions[self.path] = 0o600
        with self.assertRaises(FileExistsError):
            deploy.upload_release(self.client(), self.file, self.path, reconnect=self.client)
        del self.remote.files[self.path]
        def reconnect():
            self.remote.files[self.path].extend(b'x' * len(self.payload))
            return self.client()
        with self.assertRaisesRegex(RuntimeError, 'invalid type or size'):
            deploy.upload_release(self.client(fail_after=10), self.file, self.path, reconnect=reconnect)
        self.assertEqual(self.prefixes, [])

    def test_three_reconnections_include_connection_failures_and_do_not_repackage(self):
        reconnects = []
        def reconnect():
            reconnects.append(True)
            if len(reconnects) == 1:
                raise deploy.paramiko.ssh_exception.NoValidConnectionsError({('test.example', 22): ConnectionRefusedError(errno.ECONNREFUSED, 'temporary connection failure')})
            return self.client(fail_after=10)
        with self.assertRaises(ConnectionResetError):
            deploy.upload_release(self.client(fail_after=10), self.file, self.path, reconnect=reconnect)
        self.assertEqual(len(reconnects), 3)
        self.assertEqual(self.file.read_bytes(), self.payload)
        with self.assertRaises(ValueError):
            deploy.upload_release(self.client(), self.file, self.path, reconnect=reconnect, max_reconnects=4)

    def test_authentication_permission_and_host_identity_failures_are_not_retryable(self):
        reconnect = Mock()
        for error in [deploy.paramiko.AuthenticationException('denied'), RuntimeError('fingerprint differs'), PermissionError(errno.EACCES, 'denied')]:
            client = self.client()
            client.open_sftp = Mock(side_effect=error)
            with self.assertRaises(type(error)):
                deploy.upload_release(client, self.file, self.path, reconnect=reconnect)
        reconnect.assert_not_called()

    def test_remote_prefix_script_reads_exact_bytes_and_rejects_mutated_file_length(self):
        self.patch_prefix.stop()
        def execute_local(client, code):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(code, {})
            return output.getvalue()
        with patch.object(deploy, 'remote_python', side_effect=execute_local):
            size = self.file.stat().st_size
            self.assertEqual(deploy.remote_prefix_sha256(None, str(self.file), size), hashlib.sha256(self.payload).hexdigest())
            with self.assertRaisesRegex(RuntimeError, 'changed before prefix'):
                deploy.remote_prefix_sha256(None, str(self.file), size - 1)

    def test_remote_hash_connection_loss_remains_retryable_instead_of_becoming_an_integrity_failure(self):
        client, channel = Mock(), Mock()
        channel.recv_ready.return_value = False
        channel.recv_stderr_ready.return_value = False
        channel.exit_status_ready.return_value = True
        channel.recv_exit_status.return_value = -1
        client.get_transport.return_value.is_active.return_value = False
        client.exec_command.return_value = (Mock(), types.SimpleNamespace(channel=channel), Mock())
        with self.assertRaises(deploy.paramiko.SSHException) as raised:
            deploy.execute(client, 'unit readonly hash command')
        self.assertTrue(deploy.retryable_upload_error(raised.exception))

    def test_connection_enables_keepalive_immediately_and_pins_each_host_without_logging_password(self):
        args = types.SimpleNamespace(host='test.example', user='ubuntu', key=None, host_fingerprint='SHA256:pinned')
        client = Mock()
        output = io.StringIO()
        with patch.object(deploy.paramiko, 'SSHClient', return_value=client), contextlib.redirect_stdout(output):
            self.assertIs(deploy.connect_ssh(args, 'test-only-private-password'), client)
        client.connect.assert_called_once_with('test.example', username='ubuntu', password='test-only-private-password', key_filename=None,
                                               timeout=15, auth_timeout=15, allow_agent=False, look_for_keys=False)
        client.get_transport.return_value.set_keepalive.assert_called_once_with(15)
        self.assertEqual(client.set_missing_host_key_policy.call_args.args[0].fingerprint, 'SHA256:pinned')
        self.assertNotIn('test-only-private-password', output.getvalue())
        key = types.SimpleNamespace(asbytes=lambda: b'unit host key', get_name=lambda: 'ssh-ed25519')
        actual = 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
        deploy.PinnedHost(actual).missing_host_key(client, 'test.example', key)
        with self.assertRaisesRegex(RuntimeError, 'fingerprint differs'):
            deploy.PinnedHost('SHA256:different').missing_host_key(client, 'test.example', key)

    def test_deploy_repackages_once_then_uses_the_same_complete_sha_and_latest_connection(self):
        root = Path(self.temporary.name)
        (root / 'dist').mkdir()
        (root / 'dist/game.js').write_text('unit build', encoding='utf8')
        packages, commands = [], []
        def package(asset_root, account_root, output):
            packages.append(output)
            output.write_bytes(self.payload)
        def remote_command(client, code):
            self.assertIs(client, self.clients[-1], 'migration and activation use the reconnected client')
            commands.append(code)
            if len(commands) == 1:
                self.assertIn("if hashlib.sha256(archive.read_bytes()).hexdigest()!=" + repr(hashlib.sha256(self.payload).hexdigest()), code)
                self.assertEqual(list(self.remote.files.values()), [bytearray(self.payload)])
                return ''
            return json.dumps({'release': 'unit-release', 'service': 'rf-pvp'})
        with patch.object(deploy, 'ROOT', root), patch.object(deploy, 'package_release', side_effect=package), patch.object(deploy, 'remote_python', side_effect=remote_command):
            deploy.deploy(self.client(fail_after=786451), root, None, 'test.example', reconnect=self.client)
        self.assertEqual(len(packages), 1, 'reconnection never creates a different compressed package')
        self.assertEqual(len(commands), 2)
        self.assertFalse(packages[0].exists(), 'the private local package is removed after deployment')
        self.assertEqual(self.remote.files, {}, 'remote archive cleanup uses the latest connection')
        metadata = json.loads((root / 'runtime/cloud-deployment.json').read_text())
        self.assertEqual(metadata['archiveSha256'], hashlib.sha256(self.payload).hexdigest())

    def test_migration_rejects_wrong_complete_sha_before_extracting_and_accepts_correct_sha(self):
        root = Path(self.temporary.name)
        accounts, releases = root / 'accounts', root / 'releases'
        accounts.mkdir()
        releases.mkdir()
        def archive():
            with tarfile.open(self.file, 'w:gz') as output:
                body = b'unit release contents'
                member = tarfile.TarInfo('apps/server/dev-server.mjs')
                member.size = len(body)
                output.addfile(member, io.BytesIO(body))
        def code(expected, release):
            # Only platform directories move into this test's private sandbox;
            # the production verification, extraction and cleanup execute intact.
            result = deploy.migration_script(str(self.file), expected, release)
            return result.replace("Path('/opt/rf-pvp/releases')", 'Path(' + repr(str(releases)) + ')').replace("Path('/var/lib/rf-pvp/accounts')", 'Path(' + repr(str(accounts)) + ')')
        archive()
        with self.assertRaisesRegex(RuntimeError, 'Release archive checksum mismatch'):
            exec(code('0' * 64, 'invalid-unit'), {})
        self.assertEqual(list(releases.iterdir()), [])
        self.assertFalse(self.file.exists())
        archive()
        digest = hashlib.sha256(self.file.read_bytes()).hexdigest()
        with patch('shutil.chown'):
            exec(code(digest, 'valid-unit'), {})
        self.assertEqual((releases / 'valid-unit/apps/server/dev-server.mjs').read_bytes(), b'unit release contents')
        self.assertFalse(self.file.exists())


if __name__ == '__main__':
    unittest.main()
