import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
from vc_gatling_resources import target_declarations, supplemented


class GatlingSupplementTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = json.loads((ROOT/'packages/combat-core/vc-profile.json').read_text('utf8'))
        cls.sets, cls.damages = target_declarations()

    def test_actual_original_records_and_only_four_changes(self):
        before = copy.deepcopy(self.profile)
        for name in self.sets:
            del before['effectSets'][name]
            before['resourceOnlyEffectSets'].remove(name)
        for name in self.damages:
            del before['damageEffects'][name]
        after = supplemented(before, self.sets, self.damages)
        self.assertEqual(after, self.profile)
        self.assertEqual(supplemented(after, self.sets, self.damages), after)
        self.assertEqual(len(after['effectTemplates']), len(before['effectTemplates']))

    def test_missing_closure_is_rejected_without_input_mutation(self):
        broken = copy.deepcopy(self.profile)
        del broken['effectTemplates']['RWT_HellFireEP02']
        snapshot = copy.deepcopy(broken)
        with self.assertRaisesRegex(ValueError, 'Missing target particle'):
            supplemented(broken, self.sets, self.damages)
        self.assertEqual(snapshot, broken)
        with self.assertRaisesRegex(ValueError, 'Exactly two'):
            supplemented(broken, {}, self.damages)

    def test_actual_profile_seals_and_all_runtime_file_hashes(self):
        read = lambda p: json.loads(p.read_text('utf8'))
        normalized = (ROOT/'packages/combat-core/vc-profile.json').read_bytes().replace(b'\r\n', b'\n')
        seal = hashlib.sha256(normalized).hexdigest()
        report = read(ROOT/'reports/vc-assets-runtime.json')
        self.assertEqual(read(ROOT/'artifacts/vc/manifest.json')['profile']['sha256'], seal)
        self.assertEqual(read(ROOT/'artifacts/vc/fx/index.json')['profileSha256'], seal)
        self.assertEqual(read(ROOT/'contracts/vc-fx-index.json')['profileSha256'], seal)
        self.assertEqual(report['profile']['sha256'], seal)
        for row in report['outputs']:
            data = (ROOT/'artifacts/vc'/row['file']).read_bytes()
            self.assertEqual(len(data), row['bytes'], row['file'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), row['sha256'], row['file'])


if __name__ == '__main__':
    unittest.main()
