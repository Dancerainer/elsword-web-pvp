"""Independent actual target KL82/X bytes and fixed-source checks; no game oracle."""
from pathlib import Path
import hashlib
import json
import os
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from kl82_static import read_declarations
from build_rf_fx import declaration

CONTRACT = json.loads((ROOT / 'contracts/rf-guardian-reaction-source-v17.json').read_text('utf8'))
normalize = lambda v: json.loads(json.dumps(v))
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()


class GuardianActualSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = Path(os.environ.get('ELSWORD_TARGET_RAW', 'asset_work/raw/data/data036.kom'))
        if not cls.raw.is_dir():
            raise unittest.SkipTest('Read-only target2016 raw inputs unavailable')
        cls.enum = read_declarations(cls.raw / 'Enum.lua')
        cls.raven = read_declarations(cls.raw / 'RAVEN_FIGHTER.lua', cls.enum['globals'])
        cls.damage = read_declarations(cls.raw / 'DamageEffect.lua', cls.enum['globals'], capture_calls=True, capture_unresolved=True)
        cls.effect = read_declarations(cls.raw / 'EffectSet.lua', cls.enum['globals'], capture_calls=True, capture_unresolved=True)

    def test_actual_hashes_enums_states_and_absent_selected_hyper(self):
        for item in CONTRACT['targetSources']:
            self.assertEqual(digest(self.raw / Path(item['path']).name), item['sha256'])
        for name, value in CONTRACT['targetEnums'].items():
            self.assertEqual(self.enum['globals']['REACT_TYPE'][name], value)
        for expected in CONTRACT['targetStates']:
            name = expected['state']
            self.assertEqual(self.raven['locations'][name], expected['sourcePc'])
            self.assertEqual(normalize(self.raven['globals'][name]), expected['raw'])
        self.assertEqual(sorted(k for k in self.raven['globals'] if 'GUARDIAN_STRIKE' in k), CONTRACT['targetStateHyperDeclarations'])
        self.assertEqual(self.enum['globals']['DAMAGE_TYPE']['DT_BUFF'], 6)

    def test_actual_effect_set_and_complete_selected_child_closure(self):
        expected = CONTRACT['targetEffectSet']
        row = next(c for c in self.effect['nativeCalls'] if c.get('target') == 'g_pEffectSet.AddEffectSetTemplet_LUA'
                   and len(c.get('args', [])) > 1 and c['args'][1].get('NAME') == expected['raw']['NAME'])
        self.assertEqual(normalize(row['args'][1]), expected['raw'])
        self.assertEqual({'prototype': row['prototype'], 'instruction': row['instruction']}, expected['sourcePc'])
        names = set()
        queue = [v['NAME'] for k, v in expected['raw'].items() if re.fullmatch(r'EFFECT\d+', k)]
        while queue:
            name = queue.pop()
            if name in names:
                continue
            names.add(name)
            raw = self.damage['globals'][name]
            for key, value in raw.items():
                if isinstance(value, dict) and re.match(r'(DIE|CREATE|HIT)_DAMAGE_EFFECT\d+', key):
                    queue.append(value['DAMAGE_EFFECT_NAME'])
        self.assertEqual(names, {v['name'] for v in CONTRACT['targetDamageClosure']})
        for expected in CONTRACT['targetDamageClosure']:
            self.assertEqual(normalize(self.damage['globals'][expected['name']]), expected['raw'])
            self.assertEqual(self.damage['locations'][expected['name']], expected['sourcePc'])
        for legacy in CONTRACT['legacyGuardianDamageDeclarations']:
            self.assertNotIn(legacy['name'], names)
            self.assertEqual(self.damage['locations'][legacy['name']], legacy['sourcePc'])
            for key, value in legacy['fields'].items():
                self.assertEqual(normalize(self.damage['globals'][legacy['name']][key]), value)

    def test_actual_template_and_authored_reaction_animation_identity(self):
        expected = CONTRACT['targetTemplate']
        script = self.raw / 'GameMajorXMeshPlayer.txt'
        self.assertEqual(digest(script), expected['source']['sha256'])
        matches = list(re.finditer(r'TEMPLET\s+"ROT_GuardianStrike01_NEW_MEMO"\s*\{([^{}]*)\}', script.read_text('latin1')))
        self.assertEqual(len(matches), 1)
        parsed = declaration(matches[0][1])
        self.assertEqual(parsed['fields'], expected['fields'])
        self.assertEqual(parsed['events'], expected['events'])
        clips = json.loads((ROOT / 'artifacts/rf/clips.json').read_text('utf8'))
        source_root = Path(os.environ.get('ELSWORD_TARGET_SOURCE_ROOT', 'asset_work'))
        for row in CONTRACT['animationSources']:
            self.assertEqual(digest(source_root / row['source']), row['sourceSha256'])
            actual = next(c for c in clips if c['name'] == row['name'])
            for key, value in actual.items():
                self.assertEqual(value, row[key])

    def test_fixed_source_blob_ranges_and_literal_consumers_are_separate_evidence(self):
        for item in CONTRACT['reference']['files']:
            path = ROOT / '.cache/native-reference' / item['path']
            self.assertEqual(digest(path), item['sha256'])
            lines = path.read_text('utf8', errors='replace').splitlines()
            for block in item['ranges']:
                text = '\n'.join(lines[block['start'] - 1:block['end']]) + '\n'
                self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), block['textSha256'])
        user = (ROOT / '.cache/native-reference/X2Lib/X2GUUser.cpp').read_text('utf8', errors='replace')
        self.assertIn('SetStopTime( pDamageData->fStopTimeDef );', user)
        self.assertIn('SetStop2Time( 0.0f );', user)
        self.assertIn('m_FrameDataFuture.unitCondition.fStopTime = fStopTime;', user)
        self.assertIn('m_FrameDataFuture.unitCondition.stateChangeNum++;', user)
        self.assertIn('m_FrameDataNow.syncData.bDirectChange == true', user)
        self.assertIn('StateChange( USI_DAMAGE_BIG_FRONT, true );', user)
        self.assertIn('StateChange( USI_DAMAGE_AIR_FLY_FRONT, true );', user)
        self.assertFalse(CONTRACT['targetClientMeasured'])
        self.assertEqual(CONTRACT['targetGoldenTraces'], 0)


if __name__ == '__main__':
    unittest.main()
