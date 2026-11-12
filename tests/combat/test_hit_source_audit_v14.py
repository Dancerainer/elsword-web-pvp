"""Actual target KL / damaged raw PE audit checks, separate from simulation."""
from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
spec = importlib.util.spec_from_file_location('hit_audit', ROOT / 'tools/combat/audit_rf_hit_sources_v14.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class HitSourceAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.actual = audit.build(Path('asset_work/raw/data/data036.kom'), Path('asset_sources/client/data/x2.exe'))
        cls.frozen = json.loads((ROOT / 'contracts/rf-hits-source-v14.json').read_bytes())

    def test_actual_full_target_kl_and_original_exe_match_frozen_audit(self):
        self.assertEqual(json.loads(json.dumps(self.actual)), self.frozen)

    def test_only_raven_prototype_contains_no_executable_xxx_owner_binding(self):
        target = self.actual['targetRaven']
        self.assertEqual(target['prototypes'], 1)
        self.assertEqual(target['rootCallInstructionCount'], 0)
        xxx = target['states'][0]
        self.assertEqual(xxx['instructionEvidence']['lastPc'], 506)
        self.assertEqual(xxx['instructionEvidence']['instructions'][-1]['gcConstant'], 'RSI_COMBO_XXX')
        for field in ('DAMAGE_DATA', 'ATTACK_TIME0', 'EFFECT_SET_LIST_EX', 'EFFECT_SET_LIST'):
            self.assertNotIn(field, xxx['raw'])
        self.assertFalse(any('EffectSet_A_RF_XXX' in row['value'] or 'DamageEffect_RF_XXX' in row['value'] for row in target['xxxNameConstants']))

    def test_resource_set_relative_time_is_not_an_animation_trigger(self):
        roots = self.actual['targetXxxResources']
        self.assertEqual(roots['effectSet']['raw']['EFFECT1']['START_TIME'], .25)
        self.assertEqual(roots['damageEffect']['raw']['DAMAGE_TIME'], 18)
        self.assertEqual(roots['damageEffect']['raw']['DAMAGE_DATA']['DAMAGE']['MAGIC'], 1.2)
        self.assertEqual(roots['damageEffect']['raw']['DAMAGE_DATA_CHANGE_TIME_GLOBAL_TIME'], {'1': .15})
        self.assertEqual(self.actual['fixedRavenLiteralCounts']['EffectSet_A_RF_XXX'], 0)
        self.assertEqual(self.actual['fixedRavenLiteralCounts']['DamageEffect_RF_XXX'], 0)

    def test_exe_search_is_limited_to_literal_raw_bytes(self):
        evidence = self.actual['originalExe']
        self.assertEqual(len(evidence['searches']), 12)
        self.assertTrue(all(row['count'] == 0 for row in evidence['searches']))
        self.assertIn('No literal match proves neither', evidence['limit'])
        self.assertGreater(len(evidence['sections']), 0)

    def test_damaged_executable_headers_are_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as cache:
            path = Path(cache) / 'damaged.exe'
            for raw in (b'', b'MZ' + bytes(60), b'MZ' + bytes(62), b'MZ' + bytes(58) + b'\xff\xff\xff\xff'):
                path.write_bytes(raw)
                with self.assertRaises(ValueError):
                    audit.exe_evidence(path)


if __name__ == '__main__':
    unittest.main()
