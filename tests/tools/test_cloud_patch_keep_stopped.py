"""Exercise real hardlink preparation and activation with service/SSH mocked."""
import base64
import contextlib
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('cloud_stopped_patch', Path(__file__).resolve().parents[2] / 'scripts/deploy-cloud-patch.py')
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)
STOPPED = {unit: {'ActiveState': 'inactive', 'SubState': 'dead', 'MainPID': '0'} for unit in ['rf-pvp', 'nginx']}
PROFESSIONS = ['RF', 'LK', 'VC', 'RS', 'BM', 'IS', 'GM', 'BH', 'CA', 'LP', 'MM', 'DE']


class CurrentLink:
    """Mock only the managed symlink, avoiding Windows symlink privileges."""
    def __init__(self, target=None):
        self.target = target

    def with_name(self, name):
        return CurrentLink()

    def exists(self):
        return False

    def is_symlink(self):
        return False

    def symlink_to(self, target):
        self.target = target


class KeepStoppedPatchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.candidate = self.root / 'candidate'
        self.releases = self.root / 'releases'
        self.base = self.releases / '20000101-000000-12345678'
        self.accounts = self.root / 'accounts'
        self.accounts.mkdir()
        (self.accounts / 'protected.json').write_bytes(b'private-account-must-stay-identical')
        self.old = {'apps/server/entry.mjs': b'old\n', 'dist/game.js': b'old browser\n',
                    'artifacts/native/manifest.json': b'{"modules":{}}', 'artifacts/bm/storm.json': b'old effect'}
        self.old.update({'artifacts/' + p.lower() + '/manifest.json': b'{"schemaVersion":1}' for p in PROFESSIONS})
        self.new = {**self.old, 'apps/server/entry.mjs': b'new\r\n', 'dist/game.js': b'new browser\n',
                    'artifacts/bm/storm.json': b'new effect', 'artifacts/bm/storm.glb': b'new model'}
        for base, files in [(self.base, self.old), (self.candidate, self.new)]:
            for name, data in files.items():
                target = base / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        self.helpers = {}
        exec(PATCH.REMOTE_HELPERS, self.helpers)
        before = self.helpers['inventory'](self.base)
        assets = lambda files: [{'path': name, 'sha256': PATCH.sha(data)} for name, data in files.items() if name.startswith('artifacts/')]
        writes = ['apps/server/entry.mjs', 'dist/game.js', 'artifacts/bm/storm.json', 'artifacts/bm/storm.glb']
        self.plan = {'baselineCommit': '1' * 40, 'sourceCommit': '2' * 40,
                     'expectedOldBuildSha256': PATCH.sha(self.old['dist/game.js']), 'buildSha256': PATCH.sha(self.new['dist/game.js']),
                     'files': [{'path': name, 'sha256': PATCH.sha(self.new[name]),
                                'baselineSha256': PATCH.sha(self.old[name]) if name in self.old else None,
                                'baselineCanonicalSha256': None} for name in writes],
                     'compatibilityFiles': [{'path': 'apps/server/entry.mjs', 'canonicalSha256': PATCH.canonical_sha(self.old['apps/server/entry.mjs'])}],
                     'baselineAssets': assets(self.old), 'assets': assets(self.new), 'requiredProfessions': PROFESSIONS,
                     'hostProgramDomain': 'rf-online-host-program-sha256-v1',
                     'hostProgramFiles': [{'file': 'apps/server/entry.mjs', 'bytes': len(self.new['apps/server/entry.mjs']), 'sha256': PATCH.sha(self.new['apps/server/entry.mjs'])}]}
        self.audit = {'release': str(self.base), 'files': before, 'inventorySha256': self.helpers['digest'](before),
                      'infrastructure': {'protected-config': 'same'}, 'services': copy.deepcopy(STOPPED)}
        self.plan_file = self.candidate / 'plan.json'

    def read_plan(self, plan=None):
        self.plan_file.write_text(json.dumps(plan or self.plan), encoding='utf8')
        with mock.patch.object(PATCH, 'ROOT', self.candidate):
            return PATCH.read_plan(self.plan_file)

    def payload(self):
        old_bundle = self.base / 'dist/game.js'
        with mock.patch.object(PATCH, 'ROOT', self.candidate):
            return PATCH.prepare_payload(self.plan, self.audit, old_bundle, keep_stopped=True)

    def run_activation(self, service_states=None, diagnostics=None, fail_after_switch=False, wrong_host=False):
        payload, blob = self.payload()
        patch_file = self.root / 'uploaded.json.gz'
        patch_file.write_bytes(blob)
        current = CurrentLink(self.base)
        original_replace = os.replace
        def replace(source, destination):
            if isinstance(destination, CurrentLink):
                destination.target = source.target
            else:
                original_replace(source, destination)
        def states():
            return copy.deepcopy(service_states or STOPPED)
        count = [0]
        def persistent():
            count[0] += 1
            if fail_after_switch and count[0] == 2:
                raise RuntimeError('Injected offline post-switch failure')
            return {'protected.json': PATCH.sha((self.accounts / 'protected.json').read_bytes())}
        def check_output(args, **kwargs):
            self.assertEqual(args[0], '/opt/rf-node/current/bin/node')
            return json.dumps({'sha256': '0' * 64 if wrong_host else payload['expectedHostProgramSha256'], 'files': 1})
        def run(args, **kwargs):
            self.assertNotEqual(args[0], 'systemctl', 'Keep-stopped must never start/restart/stop a service')
            self.assertEqual(args[0], '/opt/rf-node/current/bin/node')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'professions': {p: True for p in PROFESSIONS}, 'diagnostics': diagnostics or []}), stderr='')
        code = PATCH.activation_code(str(patch_file), PATCH.sha(blob))
        injection = '\nROOT=TEST_ROOT;CURRENT=TEST_CURRENT\ncurrent_release=lambda:CURRENT.target\ninfrastructure=lambda:TEST_INFRA\nservice_snapshot=TEST_STATES\npersistent=TEST_PERSISTENT\n'
        code = code.replace('\npatch=Path(', injection + '\npatch=Path(', 1)
        code = code.replace("open('/var/lock/rf-pvp-deploy.lock','a')", 'open(TEST_LOCK,\'a\')')
        namespace = {'TEST_ROOT': self.releases, 'TEST_CURRENT': current, 'TEST_INFRA': self.audit['infrastructure'],
                     'TEST_STATES': states, 'TEST_PERSISTENT': persistent, 'TEST_LOCK': str(self.root / 'deploy.lock')}
        output = io.StringIO()
        with mock.patch.dict('sys.modules', {'fcntl': SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *args: None)}), \
             mock.patch('os.replace', side_effect=replace), mock.patch('shutil.chown', create=True), \
             mock.patch('subprocess.check_output', side_effect=check_output), mock.patch('subprocess.run', side_effect=run), \
             contextlib.redirect_stdout(output):
            try:
                exec(code, namespace)
            finally:
                if namespace.get('lock'):
                    namespace['lock'].close()
        return json.loads(output.getvalue()), current, payload

    def test_asset_writes_are_exact_changed_or_new_target_members(self):
        self.assertEqual(len(self.read_plan()['baselineAssets']), 2 + len(PROFESSIONS))
        for mutation in ['missing', 'unlisted', 'unchanged', 'wrong-baseline', 'no-baseline-inventory']:
            plan = copy.deepcopy(self.plan)
            if mutation == 'missing':
                plan['files'].pop()
            elif mutation == 'unlisted':
                plan['assets'] = [row for row in plan['assets'] if row['path'] != 'artifacts/bm/storm.glb']
            elif mutation == 'unchanged':
                plan['files'].append({'path': 'artifacts/native/manifest.json', 'sha256': PATCH.sha(self.old['artifacts/native/manifest.json'])})
            elif mutation == 'wrong-baseline':
                plan['files'][2]['baselineSha256'] = '0' * 64
            else:
                del plan['baselineAssets']
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.read_plan(plan)

    def test_remote_baseline_rejects_changed_or_unknown_preexisting_assets(self):
        verify = self.helpers['verify_plan']
        verify(self.plan, self.base, self.audit['files'])
        stale = copy.deepcopy(self.audit['files'])
        stale['artifacts/bm/storm.json']['sha256'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'Baseline asset differs'):
            verify(self.plan, self.base, stale)
        stale = copy.deepcopy(self.audit['files'])
        stale['artifacts/bm/storm.glb'] = {'sha256': PATCH.sha(self.new['artifacts/bm/storm.glb'])}
        with self.assertRaisesRegex(RuntimeError, 'outside frozen baseline'):
            verify(self.plan, self.base, stale)

    def test_existing_feedback_plan_keeps_its_unchanged_and_candidate_inventory_contract(self):
        plan = copy.deepcopy(self.plan)
        del plan['baselineAssets']
        plan['candidateAssets'] = plan['assets']
        plan['assets'] = [row for row in plan['assets'] if row['path'].endswith('/manifest.json')]
        plan['changedAssets'] = ['artifacts/bm/storm.json', 'artifacts/bm/storm.glb']
        plan['files'][2]['baselineCanonicalSha256'] = self.audit['files']['artifacts/bm/storm.json']['canonicalSha256']
        self.helpers['verify_plan'](plan, self.base, self.audit['files'])

    def test_offline_success_preserves_accounts_old_hardlinks_and_service_state(self):
        before = self.helpers['inventory'](self.base)
        result, current, payload = self.run_activation()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(current.target, self.releases / payload['release'])
        self.assertEqual(result['readiness']['services'], STOPPED)
        self.assertTrue(result['servicesKeptStopped'])
        self.assertEqual(result['changedAssetCount'], 2)
        self.assertEqual(result['assetCount'], 3 + len(PROFESSIONS))
        self.assertEqual(self.helpers['inventory'](self.base), before)
        self.assertEqual((self.accounts / 'protected.json').read_bytes(), b'private-account-must-stay-identical')
        self.assertEqual((current.target / 'artifacts/bm/storm.glb').read_bytes(), self.new['artifacts/bm/storm.glb'])
        self.assertEqual((current.target / 'artifacts/bm/storm.json').read_bytes(), self.new['artifacts/bm/storm.json'])
        self.assertEqual(result['actualHostProgram']['sha256'], payload['expectedHostProgramSha256'])

    def test_twelve_profession_plan_rejects_missing_unchecked_or_unknown_manifests(self):
        self.assertEqual(self.read_plan()['requiredProfessions'], PROFESSIONS)
        for mutation in ('missing', 'unchecked', 'unknown', 'duplicate'):
            plan = copy.deepcopy(self.plan)
            if mutation == 'missing':
                plan['assets'] = [row for row in plan['assets'] if row['path'] != 'artifacts/ca/manifest.json']
                plan['baselineAssets'] = [row for row in plan['baselineAssets'] if row['path'] != 'artifacts/ca/manifest.json']
            elif mutation == 'unchecked':
                plan['requiredProfessions'].remove('BH')
            elif mutation == 'unknown':
                plan['requiredProfessions'][-1] = 'UNKNOWN'
            else:
                plan['requiredProfessions'][-1] = 'RF'
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, 'profession'):
                self.read_plan(plan)

    def test_remote_missing_profession_manifest_never_switches_even_when_load_mock_claims_success(self):
        # Simulate a malformed sealed candidate while keeping every file/hash
        # internally consistent. The manifest guard must reject before loader.
        name='artifacts/ca/manifest.json'
        del self.old[name];del self.new[name]
        (self.base/name).unlink();(self.candidate/name).unlink()
        for key in ('assets','baselineAssets'):
            self.plan[key]=[row for row in self.plan[key] if row['path']!=name]
        self.audit['files']=self.helpers['inventory'](self.base)
        self.audit['inventorySha256']=self.helpers['digest'](self.audit['files'])
        result,current,_=self.run_activation()
        self.assertEqual(result['status'],'failed')
        self.assertEqual(current.target,self.base)
        self.assertFalse(result['rollback']['attempted'])

    def test_running_nginx_or_application_blocks_before_copy_and_switch(self):
        for unit in ['rf-pvp', 'nginx']:
            states = copy.deepcopy(STOPPED)
            states[unit] = {'ActiveState': 'active', 'SubState': 'running', 'MainPID': '42'}
            with self.subTest(unit=unit), self.assertRaisesRegex(RuntimeError, 'Keep-stopped requires'):
                self.run_activation(service_states=states)
            self.assertEqual(list(self.releases.iterdir()), [self.base])

    def test_offline_validation_failure_never_switches_or_changes_services(self):
        for kwargs in [{'diagnostics': ['missing BM model']}, {'wrong_host': True}]:
            with self.subTest(kwargs=kwargs):
                result, current, _ = self.run_activation(**kwargs)
                self.assertEqual(result['status'], 'failed')
                self.assertFalse(result['rollback']['attempted'])
                self.assertEqual(current.target, self.base)
                self.assertEqual(list(self.releases.iterdir()), [self.base])

    def test_post_switch_failure_rolls_back_only_symlink_and_keeps_services_stopped(self):
        result, current, _ = self.run_activation(fail_after_switch=True)
        self.assertEqual(result['status'], 'failed')
        self.assertTrue(result['rollback']['attempted'])
        self.assertTrue(result['rollback']['succeeded'])
        self.assertEqual(result['rollback']['services'], STOPPED)
        self.assertEqual(current.target, self.base)
        self.assertFalse(result['accountsRestoredOrOverwritten'])

    def test_retired_asset_is_removed_only_from_new_release(self):
        name, data = 'artifacts/bm/Armor_break.png', b'retired texture proof'
        (self.base / name).write_bytes(data)
        row = {'path': name, 'sha256': PATCH.sha(data)}
        self.plan['baselineAssets'].append(row)
        self.plan['assetRemovals'] = [row]
        self.audit['files'] = self.helpers['inventory'](self.base)
        self.audit['inventorySha256'] = self.helpers['digest'](self.audit['files'])
        self.read_plan()
        incomplete = copy.deepcopy(self.plan)
        incomplete['assetRemovals'] = []
        with self.assertRaisesRegex(ValueError, 'retired baseline'):
            self.read_plan(incomplete)
        before = self.helpers['inventory'](self.base)
        result, current, _ = self.run_activation()
        self.assertEqual(result['status'], 'deployed')
        self.assertEqual(result['removedAssetCount'], 1)
        self.assertFalse((current.target / name).exists())
        self.assertEqual((self.base / name).read_bytes(), data)
        self.assertEqual(self.helpers['inventory'](self.base), before)

    def test_service_snapshot_reads_only_state_and_requires_complete_fields(self):
        with mock.patch('subprocess.check_output', return_value='ActiveState=inactive\nSubState=dead\nMainPID=0\n') as query:
            self.assertEqual(self.helpers['require_stopped'](self.helpers['service_snapshot']()), STOPPED)
            self.assertEqual([call.args[0][2] for call in query.call_args_list], ['rf-pvp', 'nginx'])
            self.assertTrue(all(call.args[0][:2] == ['systemctl', 'show'] for call in query.call_args_list))
        with mock.patch('subprocess.check_output', return_value='ActiveState=inactive\nMainPID=0\n'), self.assertRaisesRegex(RuntimeError, 'Incomplete service state'):
            self.helpers['service_snapshot']()

    def test_large_browser_uses_full_data_and_still_checks_exact_old_bundle(self):
        new = b'new large browser\n' * (PATCH.BROWSER_DELTA_LIMIT // 10)
        (self.candidate / 'dist/game.js').write_bytes(new)
        self.plan['buildSha256'] = PATCH.sha(new)
        self.plan['files'][1]['sha256'] = PATCH.sha(new)
        with mock.patch.object(PATCH, 'make_delta', side_effect=AssertionError('Large bundle diff must be bounded')):
            payload, _ = self.payload()
        operation = next(row for row in payload['operations'] if row['path'] == 'dist/game.js')
        self.assertEqual(operation['kind'], 'data')
        self.assertEqual(base64.b64decode(operation['data']), new)
        (self.base / 'dist/game.js').write_bytes(b'wrong base')
        with self.assertRaisesRegex(RuntimeError, 'delta base differs'):
            self.payload()

    def test_merged_host_uses_unchanged_remote_raw_bytes(self):
        other = 'apps/server/unchanged.mjs'
        self.plan['hostProgramFiles'].append({'file': other, 'bytes': 3, 'sha256': PATCH.sha(b'a\r\n')})
        self.audit['files'][other] = {'bytes': 2, 'sha256': PATCH.sha(b'a\n')}
        with mock.patch.object(PATCH, 'ROOT', self.candidate):
            actual = PATCH.merged_host_fingerprint(self.plan, self.audit)
        records = [self.plan['hostProgramFiles'][0], {'file': other, **self.audit['files'][other]}]
        expected = PATCH.sha(json.dumps({'schemaVersion': 1, 'domain': self.plan['hostProgramDomain'], 'files': records}, separators=(',', ':')).encode())
        self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
