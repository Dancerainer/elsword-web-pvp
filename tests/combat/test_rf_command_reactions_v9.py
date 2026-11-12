"""Re-read independent target KL82/animation source bytes; no game runtime oracle."""
from pathlib import Path
import hashlib
import json
import os
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
from kl82_static import read_declarations

CONTRACT = json.loads((ROOT / 'contracts/rf-command-reactions-source-v9.json').read_text('utf-8'))


def json_keys(value):
    return json.loads(json.dumps(value))


class ActualTargetSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = Path(os.environ.get('ELSWORD_TARGET_RAW', 'asset_work/raw/data/data036.kom'))
        if not cls.raw.is_dir():
            raise unittest.SkipTest('Read-only original target cache is not present')
        cls.enum = read_declarations(cls.raw / 'Enum.lua')
        cls.raven = read_declarations(cls.raw / 'RAVEN_FIGHTER.lua', cls.enum['globals'])
        cls.damage = read_declarations(cls.raw / 'DamageEffect.lua', cls.enum['globals'], capture_calls=True, capture_unresolved=True)

    def test_actual_target_file_hashes_and_declaration_positions(self):
        for declaration, file in [(self.enum, 'Enum.lua'), (self.raven, 'RAVEN_FIGHTER.lua'), (self.damage, 'DamageEffect.lua')]:
            source = next(s for s in CONTRACT['targetSources'] if Path(s['path']).name == file)
            self.assertEqual(hashlib.sha256((self.raw / file).read_bytes()).hexdigest(), source['sha256'])
            self.assertEqual(declaration['source']['sha256'], source['sha256'])
        for expected in CONTRACT['targetStates']:
            name = expected['state']
            self.assertEqual(self.raven['locations'][name], expected['sourcePc'])
            for key, value in expected['fields'].items():
                self.assertEqual(json_keys(self.raven['globals'][name][key]), value, name + ':' + key)
        for expected in CONTRACT['targetEffects']:
            name = expected['name']
            self.assertEqual(self.damage['locations'][name], expected['sourcePc'])
            self.assertEqual(json_keys(self.damage['globals'][name]), expected['raw'])

    def test_target_enums_are_independent_from_fixed_v5_state_numbers(self):
        for name, value in CONTRACT['targetEnums'].items():
            category = 'HIT_TYPE' if name.startswith('HT_') else 'REACT_TYPE'
            self.assertEqual(self.enum['globals'][category][name], value, name)
        self.assertEqual(self.enum['globals']['HIT_TYPE']['HT_GROUND_HIT'], 26)
        self.assertEqual(self.raven['globals']['RRF_DASH_JUMP_COMBO_XX_LANDING']['DAMAGE_DATA']['DAMAGE_DISTANCE'], 400)

    def test_original_animation_sources_and_separate_decoded_clip_metadata(self):
        source_root = self.raw.parents[2]
        # ELSWORD_TARGET_RAW may name another legal read-only copy of data036.kom.
        if source_root.name != 'asset_work':
            source_root = Path(os.environ.get('ELSWORD_TARGET_SOURCE_ROOT', 'asset_work'))
        clips = json.loads((ROOT / 'artifacts/rf/clips.json').read_text('utf-8'))
        for expected in CONTRACT['animationSources']:
            path = source_root / expected['source']
            self.assertTrue(path.is_file(), str(path))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected['sourceSha256'])
            clip = next(c for c in clips if c['name'] == expected['name'])
            for key in ['source', 'sourceAnimationIndex', 'durationSeconds', 'ticksPerSecond', 'decodedKeysSha256']:
                self.assertEqual(clip[key], expected[key], expected['name'] + ':' + key)
        self.assertFalse(CONTRACT['targetClientMeasured'])
        self.assertEqual(CONTRACT['executionBoundary']['targetGoldenTraces'], 0)


if __name__ == '__main__':
    unittest.main()
