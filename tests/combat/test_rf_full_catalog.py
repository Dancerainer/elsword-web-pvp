"""Expected values are target fields/source contracts, not a simulator trace."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
from prepare_rf_skill_declarations import EnumTable
from rf_skill_catalog import trait_catalog, buff_catalog, verify_native
from build_rf_profile import build


class GuardTests(unittest.TestCase):
    def test_missing_enum_symbol_is_not_lua_nil(self):
        namespace = copy.deepcopy(EnumTable({'BUFF_FACTOR_ID': {'EXISTS': 437}}))
        self.assertEqual(namespace['BUFF_FACTOR_ID'].get('EXISTS'), 437)
        self.assertEqual(namespace['BUFF_FACTOR_ID'].get('ABSENT')['$symbol'], 'BUFF_FACTOR_ID.ABSENT')
        self.assertIsNone({'literalNil': None}.get('literalNil'))

    def test_replacement_cycle_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            trait_catalog({'nativeCalls': []}, {'globals': {'MEMO_ID': {}}},
                          {1: {'m_DeleteSkillIDByUpgrade': 2}, 2: {'m_DeleteSkillIDByUpgrade': 1}}, [{'m_iSkillID': 1}])

    def test_duplicate_factor_and_missing_factor_do_not_guess(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            call = {'target': 'x', 'args': [{'BUFF_FACTOR_ID': 437, 'BUFF_FACTOR': {}}], 'prototype': 0, 'instruction': 1}
            (path / 'buff-factor-declarations.json').write_text(json.dumps({'source': {}, 'nativeCalls': [call, call]}))
            with self.assertRaisesRegex(ValueError, 'Duplicate'):
                buff_catalog(path, {'BUFF_FACTOR': {'1': 437}})
            (path / 'buff-factor-declarations.json').unlink()
            factors, provenance = buff_catalog(path, {'BUFF_FACTOR': {'1': 999}})
            self.assertEqual(factors, {})
            self.assertEqual(provenance['missingIds'], [999])


class ActualTargetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cache = ROOT / '.cache/rf-skills-v1'
        cls.assets = ROOT / 'artifacts/rf'
        if not (cls.cache / 'skill-note-declarations.json').is_file() or not (cls.assets / 'clips.json').is_file():
            raise unittest.SkipTest('Prepare isolated target declaration/clip cache first')
        cls.profile = build(cls.cache, cls.assets, ROOT / '.cache/native-skills-source')
        cls.skills = {r['skillId']: r for r in cls.profile['skillCatalog']}

    def test_36_nodes_26_highest_six_default_passives(self):
        self.assertEqual(len(self.skills), 36)
        self.assertEqual(sum(r['topTier'] for r in self.skills.values()), 26)
        self.assertEqual(self.profile['defaultPassiveSkillIds'], [24400, 24401, 24402, 24403, 24404, 24405])
        self.assertEqual(sum(r['selectable'] for r in self.skills.values()), 20)
        self.assertTrue(all(not self.skills[s]['slotEligible'] for s in range(24400, 24406)))

    def test_upgrade_families_preserve_actual_branch_positions(self):
        branches = self.skills[24027]['branches']
        self.assertEqual([(r['memoId'], r['memoType'], r['originalSkillId'], r['parameters']) for r in branches],
                         [(14, 4, 24002, [1.4, 1.5]), (21, 3, 24002, [.8])])
        self.assertEqual(sum(len(r['branches']) for r in self.skills.values() if r['topTier']), 36)
        self.assertTrue(all(not r['supported'] for s in self.skills.values() for r in s['branches']))
        self.assertNotIn('m_MPConsumption', self.skills[900]['raw'])
        self.assertEqual(self.skills[900]['mpCost'], 0)

    def test_original_buff_and_missing_symbol_preserved(self):
        p = self.profile
        self.assertEqual(p['buffFactors']['632']['raw']['BEHAVIOR']['COMBINATION'], {'1': 55})
        self.assertEqual(p['enums']['BUFF_BEHAVIOR_TYPE']['BBT_EMPTY'], 55)
        self.assertEqual(p['buffFactors']['437']['raw']['FINALIZER']['BFT_HIT_COUNT']['COUNT']['3'], 7)
        self.assertEqual(p['buffFactors']['437']['raw']['BEHAVIOR']['BBT_CHANGE_CRITICAL_ATTACK']['PERCENT']['3'], 1.1)
        self.assertEqual(self.skills[24206]['raw']['BUFF_FACTOR']['1']['$symbol'], 'BUFF_FACTOR_ID.BFI_BUFF_A_RRF_ENHANCE_HAND')
        self.assertEqual(p['buffTemplates']['37']['raw']['BEHAVIOR']['BBT_CHANGE_NOW_HP_PER_SECOND']['TIME_INTERVAL'], 1)
        self.assertEqual(p['buffTemplates']['52']['raw']['FINALIZER']['COMBINATION'], {'1': 1, '2': 3})
        self.assertTrue(all(name in p['effectSets'] for name in ['EffectSet_DEBUFF_FIRE', 'EffectSet_DEBUFF_WOUND', 'EffectSet_DEBUFF_STUN']))

    def test_power_curve_and_actual_callback_fields(self):
        self.assertEqual(self.skills[24008]['powerRateType'], 2)
        self.assertEqual(self.skills[24008]['levelPowerRate'], 1)
        self.assertEqual(self.profile['skillBranches']['powerRateTables']['2']['values']['30'], 2.305)
        self.assertIn('targetConflict', self.skills[24008]['referenceBinding'])
        f = self.skills[24009]['referenceBinding']['functions']
        charge = next(x for x in f if x['function'].endswith('WILD_CHARGING_FrameMove'))
        self.assertEqual(charge['lineStart'], 16928)
        self.assertNotIn('SA_ATK_REL', charge['luaReadFields'])
        self.assertIn('EffectSet_WILD_CHARGE_MAX', charge['stringLiterals'])
        shadow = self.skills[24217]
        self.assertEqual(shadow['raw']['SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE']['1'], 0)
        self.assertEqual(shadow['strengtheningPowerRate']['rawValue'], 0)
        self.assertFalse(shadow['strengtheningPowerRate']['supported'])
        self.assertEqual(shadow['powerMultiplier'], 1)
        self.assertIsNone(shadow['levelPowerRate'])
        self.assertEqual(self.skills[24027]['powerMultiplier'], 1.2)

    def test_modified_source_rejected_before_function_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'X2Lib').mkdir()
            (path / 'X2Lib/X2GURaven.cpp').write_bytes(b'void changed() {}')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                verify_native(path)


if __name__ == '__main__':
    unittest.main()
