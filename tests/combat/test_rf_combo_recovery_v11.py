"""Independent raw KL/source re-read; never generate expected combat traces."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
sys.path.insert(0,str(ROOT/'tools/native'))
from kl82_static import read_declarations
from prepare_rf_skill_declarations import EnumTable
from build_rf_profile import build
from build_command_recovery import generate

CONTRACT=json.loads((ROOT/'contracts/rf-combo-recovery-source-v11.json').read_text('utf8'))
PROFILE=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf8'))


class TargetComboEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=Path(os.environ.get('ELSWORD_TARGET_RAW','asset_work/raw/data/data036.kom'))
        if not cls.raw.is_dir():
            raise unittest.SkipTest('Actual read-only target KL inputs absent')
        cls.enum=read_declarations(cls.raw/'Enum.lua')
        provenance_enums=EnumTable(cls.enum['globals'])
        cls.raven=read_declarations(cls.raw/'RAVEN_FIGHTER.lua',provenance_enums)
        cls.damage=read_declarations(cls.raw/'DamageEffect.lua',provenance_enums,capture_calls=True,capture_unresolved=True)

    def test_raw_target_hashes_and_full_selected_declarations(self):
        for category,source in [('enum',self.enum),('raven',self.raven),('damage',self.damage)]:
            self.assertEqual(source['source']['sha256'],CONTRACT['targetSources'][category]['sha256'])
        for name,row in CONTRACT['targetStates'].items():
            self.assertEqual(json.loads(json.dumps(self.raven['globals'][name])),row['raw'],name)
            self.assertEqual(self.raven['locations'][name],row['sourcePc'])
        for name,row in CONTRACT['targetDamageEffects'].items():
            self.assertEqual(json.loads(json.dumps(self.damage['globals'][name])),row['raw'],name)
            self.assertEqual(self.damage['locations'][name],row['sourcePc'])

    def test_full_combo_protection_inventory_is_original_target_data(self):
        actual_names={name for name in PROFILE['states'] if 'COMBO' in name}
        self.assertEqual(actual_names,{r['state'] for r in CONTRACT['protectionInventory']})
        for row in CONTRACT['protectionInventory']:
            raw=self.raven['globals'][row['state']]
            self.assertEqual(raw.get('SUPER_ARMOR',0),row['stateArmor'])
            self.assertEqual(json.loads(json.dumps({k:v for k,v in raw.items() if k.startswith('SUPER_ARMOR_TIME')})),row['timedArmor'])
            self.assertEqual(raw.get('SUPER_ARMOR_NOT_RED','reference-loader-default-true'),row['superArmorNotRed'])
            self.assertEqual(raw.get('INVINCIBLE'),row['invincible'])

    def test_four_spines_and_typo_are_target_declarations_not_user_memory_or_reference_comment(self):
        parent=self.damage['globals']['DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX']
        events=[v for k,v in parent.items() if k.startswith('CREATE_DAMAGE_EFFECT')]
        self.assertEqual(len(events),4)
        self.assertEqual([v['EVENT_TIME'] for v in events],[.01,.11,.21,.31])
        self.assertNotIn('HT_METEL_PUNCH_HIT',self.enum['globals']['HIT_TYPE'])
        self.assertEqual(self.enum['globals']['HIT_TYPE']['HT_DEFAULT'],0)
        self.assertEqual(self.enum['globals']['HIT_TYPE']['HT_METAL_PUNCH_HIT'],25)
        raw=self.damage['globals']['Damage_Effect_Raven_ROT_Dash_ZX']['DAMAGE_DATA']
        self.assertEqual(raw['HIT_TYPE']['$symbol'],'HIT_TYPE.HT_METEL_PUNCH_HIT')
        # Independently resolve the original lookup with a stock Lua-table
        # representation, proving that the provenance token represents nil.
        plain=read_declarations(self.raw/'DamageEffect.lua',self.enum['globals'],capture_calls=True,capture_unresolved=True)
        self.assertIsNone(plain['globals']['Damage_Effect_Raven_ROT_Dash_ZX']['DAMAGE_DATA']['HIT_TYPE'])

    def test_real_profile_build_includes_command_fx_closure_without_fixture_injection(self):
        cache=ROOT/'.cache/declarations-v11'
        if not cache.is_dir():
            self.skipTest('Prepare task-local declaration cache before regeneration test')
        built=build(cache,ROOT/'artifacts/rf',ROOT/'.cache/native-skills-source')
        actual=built['effectTemplates']['RRF_DASHJUMP_X']
        self.assertEqual(actual['fields']['LifeType'],'LT_TIME')
        self.assertEqual(actual['fields']['LifeTime'],.7)
        self.assertEqual(actual['declarationSha256'],'82905aeeafa390accf4282e8450481f6ebc798bc789cb0c1fd704fa0a1569409')
        self.assertEqual(actual,PROFILE['effectTemplates']['RRF_DASHJUMP_X'])
        self.assertEqual(built['states']['RSI_OVER_TAKER_DASH_COMBO_ZX']['raw'],CONTRACT['targetStates']['RSI_OVER_TAKER_DASH_COMBO_ZX']['raw'])
        for name,effect in built['damageEffects'].items():
            main=effect['raw'].get('MAIN_EFFECT_NAME')
            if main:self.assertIn(main,built['effectTemplates'],name)

    def test_actual_parser_rejects_truncation_before_using_a_partial_declaration(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='combo-kl-invalid-') as directory:
            bad=Path(directory)/'raven-truncated.lua'
            original=(self.raw/'RAVEN_FIGHTER.lua').read_bytes()
            bad.write_bytes(original[:101])
            with self.assertRaises((ValueError,IndexError,EOFError,RuntimeError)):
                read_declarations(bad,self.enum['globals'])


class RecoverySourceEvidence(unittest.TestCase):
    def test_actual_recovery_generator_preserves_source_and_rejects_drift(self):
        source=ROOT/'.cache/reference-combat-fixes-v11/X2GURaven.cpp'
        generated,record=generate(ROOT/'.cache/native-source-runtime',source)
        self.assertEqual(record['sourceSha256'],CONTRACT['sourceSha256'])
        self.assertEqual(record['functions'],CONTRACT['functions'])
        self.assertEqual(hashlib.sha256(generated).hexdigest(),
            CONTRACT.get('generatedCppCanonicalSha256',CONTRACT['generatedCppSha256']))
        with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='combo-source-invalid-') as directory:
            bad=Path(directory)/'X2GURaven.cpp'
            bad.write_bytes(source.read_bytes()+b'\n// source drift\n')
            with self.assertRaisesRegex(ValueError,'Recovery source drift'):
                generate(ROOT/'.cache/native-source-runtime',bad)

    def test_reference_loader_and_no_damage_rejection_sections_keep_exact_source_hashes(self):
        for row in CONTRACT['baselineSections']:
            raw=(ROOT/'.cache/native-source-runtime'/row['path']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sourceSha256'])
            self.assertEqual(hashlib.sha256(b''.join(raw.splitlines(keepends=True)[row['lineStart']-1:row['lineEnd']])).hexdigest(),row['sha256'])
        self.assertFalse(CONTRACT['targetClientMeasured'])
        self.assertEqual(CONTRACT['targetGoldenTraces'],0)


if __name__=='__main__':unittest.main()
