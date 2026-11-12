"""Offline staging/argument/cleanup contracts. No SSH, accounts or matches."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shlex
import stat
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('cloud_network_peer', ROOT / 'tools/run-cloud-network-peer.py')
PEER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PEER)
RUN_ID = '0123456789abcdef' * 2


class CloudNetworkPeerTests(unittest.TestCase):
    def args(self, *values):
        return PEER.argument_parser().parse_args(['--host', 'peer.example.org', '--user', 'operator', '--host-fingerprint', 'SHA256:example', *values])

    def test_actual_js_relative_dependencies_have_complete_staged_shape(self):
        self.assertEqual(PEER.verify_peer_imports(), ['network-match-peer.mjs', 'network-peer-controls.mjs',
                                                   'node-online-socket.mjs', 'http-event-source-peer.mjs'])
        plan = PEER.make_plan(self.args(), RUN_ID)
        peer_parent = Path(plan['source']).parent.as_posix()
        self.assertEqual(peer_parent + '/network-peer-controls.mjs', plan['uploads'][1])
        self.assertEqual(peer_parent + '/http-event-source-peer.mjs', plan['uploads'][3])
        self.assertEqual(plan['packageLink']['target'], '/opt/rf-pvp/current/packages')
        self.assertEqual(plan['packageLink']['path'], plan['remote'] + '/packages')

    def test_modes_keep_default_one_v_one_and_only_enable_legal_skill_policy(self):
        default = PEER.make_plan(self.args(), RUN_ID)
        self.assertEqual((default['mode'], default['skills']), ('1v1', 'off'))
        team = PEER.make_plan(self.args('--mode=2v2'), RUN_ID)
        self.assertEqual((team['mode'], team['skills']), ('2v2', 'cycle'))
        off = PEER.make_plan(self.args('--mode=2v2', '--skills=off'), RUN_ID)
        self.assertEqual(off['skills'], 'off')
        tokens = shlex.split(team['command'])
        self.assertIn('--mode=2v2', tokens)
        self.assertIn('--skills=cycle', tokens)
        self.assertIn('--root=/opt/rf-pvp/current', tokens)

    def test_uuid_cleanup_unlinks_known_files_and_symlink_without_recursing_into_production(self):
        plan = PEER.make_plan(self.args(), RUN_ID)
        unlink = shlex.split(plan['cleanup'])
        self.assertEqual(unlink[:5], ['sudo', '-n', 'rm', '-f', '--'])
        self.assertEqual(unlink[5:], plan['uploads'] + [plan['result'], plan['packageLink']['path']])
        self.assertTrue(all(path.startswith(plan['remote'] + '/') for path in unlink[5:]))
        self.assertNotIn('/opt/rf-pvp/current/packages', unlink)
        self.assertEqual(shlex.split(plan['removeDirectories']), ['rmdir', '--', plan['tools'], plan['remote']])
        for run_id in ['../production', 'a' * 31, 'A' * 32, '$(touch bad)']:
            with self.subTest(run_id=run_id), self.assertRaises(ValueError):
                PEER.make_plan(self.args(), run_id)

    def test_remote_gate_is_read_only_tmp_input_and_quotes_as_one_shell_argument(self):
        gate = '/tmp/rf gate; literal signal'
        plan = PEER.make_plan(self.args('--fight-file=' + gate), RUN_ID)
        self.assertIn('--fight-file=' + gate, shlex.split(plan['command']))
        self.assertNotIn(gate, shlex.split(plan['cleanup']))
        for gate in ['/opt/rf-pvp/current/launch', '/tmp/../var/launch', 'relative/gate']:
            with self.subTest(gate=gate), self.assertRaises(ValueError):
                PEER.make_plan(self.args('--fight-file=' + gate), RUN_ID)

    def test_invalid_ranges_output_escape_and_new_dependency_fail_before_ssh(self):
        for options in [('--index=-1',), ('--seconds=9',), ('--seconds=601',), ('--output=../outside.json',)]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                PEER.make_plan(self.args(*options), RUN_ID)
        original_read = Path.read_text
        def changed_read(path, **kwargs):
            text = original_read(path, **kwargs)
            return text + "\nimport './new-relative-dependency.mjs';" if path.name == 'network-match-peer.mjs' else text
        with patch.object(Path, 'read_text', changed_read), self.assertRaisesRegex(ValueError, 'Unstaged'):
            PEER.verify_peer_imports()

    def test_staged_sse_helper_cannot_silently_add_or_lose_its_own_dependency(self):
        original_read = Path.read_text
        def changed_helper(path, **kwargs):
            text = original_read(path, **kwargs)
            return text + "\nimport './network-peer-controls.mjs';" if path.name == 'http-event-source-peer.mjs' else text
        with patch.object(Path, 'read_text', changed_helper), self.assertRaisesRegex(ValueError, 'Unstaged'):
            PEER.verify_peer_imports()
        def missing_helper(path, **kwargs):
            if path.name == 'http-event-source-peer.mjs':
                raise FileNotFoundError('Required SSE helper missing')
            return original_read(path, **kwargs)
        with patch.object(Path, 'read_text', missing_helper), self.assertRaises(FileNotFoundError):
            PEER.verify_peer_imports()

    def test_plan_does_not_load_ssh_or_request_a_secret(self):
        out = io.StringIO()
        with (patch.object(PEER, 'load_cloud_module', side_effect=AssertionError('No SSH in plan')),
             patch.object(PEER.getpass, 'getpass', side_effect=AssertionError('No secret in plan')),
             contextlib.redirect_stdout(out)):
            self.assertEqual(PEER.main(['--plan', '--mode=2v2', '--skills=cycle']), 0)
        self.assertEqual(json.loads(out.getvalue())['mode'], '2v2')

    def test_mock_staging_copies_all_js_with_private_permissions_and_always_closes(self):
        runtime = (ROOT / 'runtime').resolve()
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='cloud-peer-contract-', dir=runtime) as directory:
            # Verify the exact target before TemporaryDirectory's recursive
            # cleanup. This test never creates a symlink or a remote process.
            self.assertTrue(Path(directory).resolve().is_relative_to(runtime))
            args = self.args('--mode=2v2', '--seconds=180', '--output=' + str(Path(directory) / 'peer.json'))
            plan = PEER.make_plan(args, RUN_ID)
            sftp, client = Mock(), Mock()
            client.open_sftp.return_value = sftp
            raw = json.dumps({'requestedMode': '2v2', 'stats': {}}).encode()
            sftp.lstat.return_value = types.SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_size=len(raw))
            sftp.open.return_value = io.BytesIO(raw)
            calls = []
            def execute(_client, command, **_kwargs):
                calls.append(command)
                if command == plan['cleanup']:
                    self.assertEqual(Path(plan['localOutput']).read_bytes(), raw, 'raw report saved before unlink')
                return 'ok'
            cloud = types.SimpleNamespace(connect_ssh=Mock(return_value=client), execute=execute)
            out = io.StringIO()
            with (patch.object(PEER.sys.stdin, 'isatty', return_value=True),
                 patch.object(PEER.getpass, 'getpass', return_value='synthetic-secret'),
                 contextlib.redirect_stdout(out)):
                PEER.run(args, cloud, plan)
            self.assertEqual(sftp.put.call_count, 4)
            self.assertEqual(sftp.chmod.call_args_list[0].args[1], 0o600)
            self.assertEqual([call.args for call in sftp.put.call_args_list],
                             [(str(ROOT / 'tools' / name), target) for name, target in zip(PEER.UPLOADS, plan['uploads'])])
            self.assertEqual([call.args for call in sftp.chmod.call_args_list],
                             [(target, 0o600) for target in plan['uploads']])
            self.assertEqual(sftp.mkdir.call_args_list[0].kwargs['mode'], 0o700)
            sftp.symlink.assert_called_once_with(plan['packageLink']['target'], plan['packageLink']['path'])
            self.assertEqual(calls[-2:], [plan['cleanup'], plan['removeDirectories']])
            sftp.close.assert_called_once()
            client.close.assert_called_once()
            self.assertNotIn('synthetic-secret', out.getvalue())
            self.assertNotIn('synthetic-secret', Path(plan['localOutput']).read_text())

    def test_uuid_directory_collision_does_not_delete_an_unowned_run(self):
        args = self.args()
        plan = PEER.make_plan(args, RUN_ID)
        sftp, client = Mock(), Mock()
        client.open_sftp.return_value = sftp
        sftp.mkdir.side_effect = FileExistsError('collision')
        cloud = types.SimpleNamespace(connect_ssh=Mock(return_value=client), execute=Mock())
        with (patch.object(PEER.sys.stdin, 'isatty', return_value=True),
             patch.object(PEER.getpass, 'getpass', return_value='synthetic-secret'),
             self.assertRaises(FileExistsError)):
            PEER.run(args, cloud, plan)
        cloud.execute.assert_not_called()
        sftp.close.assert_called_once()
        client.close.assert_called_once()

    def report_case(self, raw, *, read_error=None, declared_size=None, mode=stat.S_IFREG | 0o644):
        runtime = (ROOT / 'runtime').resolve()
        runtime.mkdir(exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='cloud-report-contract-', dir=runtime)
        self.assertTrue(Path(temporary.name).resolve().is_relative_to(runtime))
        self.addCleanup(temporary.cleanup)
        args = self.args('--output=' + str(Path(temporary.name) / 'peer.json'))
        plan = PEER.make_plan(args, RUN_ID)
        sftp, client = Mock(), Mock()
        client.open_sftp.return_value = sftp
        sftp.lstat.return_value = types.SimpleNamespace(st_mode=mode, st_size=len(raw) if declared_size is None else declared_size)
        if read_error:
            sftp.open.side_effect = read_error
        else:
            sftp.open.return_value = io.BytesIO(raw)
        calls = []
        def execute(_client, command, **_kwargs):
            calls.append(command)
            if command == plan['cleanup']:
                self.assertEqual(Path(plan['localOutput']).read_bytes(), raw, 'local persistence precedes cleanup')
            return 'native peer complete; errors[]'
        cloud = types.SimpleNamespace(connect_ssh=Mock(return_value=client), execute=execute)
        return args, plan, sftp, client, cloud, calls

    def run_report_case(self, case, output):
        args, plan, _sftp, _client, cloud, _calls = case
        with (patch.object(PEER.sys.stdin, 'isatty', return_value=True),
              patch.object(PEER.getpass, 'getpass', return_value='synthetic-secret'),
              contextlib.redirect_stdout(output)):
            PEER.run(args, cloud, plan)

    def test_sftp_preserves_exact_large_json_above256k_before_cleanup(self):
        raw = json.dumps({'requestedMode': '2v2', 'sample': 'x' * 400000}, indent=2).encode() + b'\n'
        self.assertGreater(len(raw), 256 * 1024)
        case = self.report_case(raw)
        output = io.StringIO()
        self.run_report_case(case, output)
        _args, plan, sftp, client, _cloud, calls = case
        self.assertEqual(Path(plan['localOutput']).read_bytes(), raw)
        sftp.open.assert_called_once_with(plan['result'], 'rb')
        sftp.get_channel().settimeout.assert_called_once_with(60)
        self.assertEqual(calls[-2:], [plan['cleanup'], plan['removeDirectories']])
        self.assertNotIn('x' * 100, output.getvalue())
        self.assertNotIn('synthetic-secret', output.getvalue())
        client.close.assert_called_once()

    def test_sftp_read_failure_raises_preserves_uuid_and_never_unlinks(self):
        case = self.report_case(b'{"errors":[]}', read_error=PermissionError('SFTP read denied'))
        output = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, 'preserved for recovery'):
            self.run_report_case(case, output)
        _args, plan, sftp, client, _cloud, calls = case
        self.assertNotIn(plan['cleanup'], calls)
        self.assertNotIn(plan['removeDirectories'], calls)
        self.assertFalse(Path(plan['localOutput']).exists())
        self.assertIn('PermissionError: SFTP read denied', output.getvalue())
        self.assertIn(plan['remote'], output.getvalue())
        sftp.close.assert_called_once()
        client.close.assert_called_once()

    def test_oversized_or_nonregular_report_fails_before_read_and_preserves_uuid(self):
        for size, mode in [(PEER.MAX_REPORT_BYTES + 1, stat.S_IFREG | 0o644),
                           (12, stat.S_IFLNK | 0o777)]:
            case = self.report_case(b'{"errors":[]}', declared_size=size, mode=mode)
            with self.subTest(size=size, mode=mode), self.assertRaises(RuntimeError):
                self.run_report_case(case, io.StringIO())
            _args, plan, sftp, client, _cloud, calls = case
            sftp.open.assert_not_called()
            self.assertNotIn(plan['cleanup'], calls)
            self.assertNotIn(plan['removeDirectories'], calls)
            client.close.assert_called_once()

    def test_short_read_or_invalid_json_is_not_saved_and_cannot_return_success(self):
        for raw, declared_size in [(b'{"errors":[]}', 30), (b'{invalid-json', None)]:
            case = self.report_case(raw, declared_size=declared_size)
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                self.run_report_case(case, io.StringIO())
            _args, plan, _sftp, _client, _cloud, calls = case
            self.assertFalse(Path(plan['localOutput']).exists())
            self.assertNotIn(plan['cleanup'], calls)
            self.assertNotIn(plan['removeDirectories'], calls)


if __name__ == '__main__':
    unittest.main()
