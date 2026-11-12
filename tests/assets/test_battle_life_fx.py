"""Actual original declarations/textures and shipped DLL keys; corrupt inputs."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'tools/assets'), str(ROOT/'tools/assets/character')]
from build_battle_life_fx import build
from build_rf import Catalog, load_x
from directx_animation import decode_animations
from native_d3dx_keys import decode_measured_native_keys, BATTLE_LIFE_REQUEST, BATTLE_LIFE_MANIFEST

sha = lambda b: hashlib.sha256(b).hexdigest()


class BattleLifeFxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((ROOT/'contracts/battle-life-fx-index-v1.json').read_bytes())
        cls.catalog = Catalog(Path('asset_work'))

    def test_original_namespace_and_exact_effect_set_hand_bindings(self):
        index = self.index
        self.assertEqual(len(index['templates']), 14)
        self.assertEqual(index['meshFailures'], [])
        self.assertEqual(index['missingTemplates'], [])
        self.assertFalse(index['clientMeasured'])
        for name in index['callbacks']['respawn']['initialTemplates'] + ['RespawnLanding_P04']:
            self.assertEqual(index['templates'][name]['sourceFamily'], 'game-minor')
            self.assertIn('GameMinor', index['templates'][name]['source']['name'])
        raw = index['effectSets']['EffectSet_ChanceToReverse']['raw']
        self.assertEqual([raw['EFFECT3']['BONE_NAME'], raw['EFFECT4']['BONE_NAME']], ['Dummy1_Rhand', 'Dummy2_Lhand'])
        self.assertEqual(raw['EFFECT3']['TRACE_MORE'], 1)
        hero = index['effectSets']['EffectSet_SacrificeOfHero']['raw']
        self.assertEqual([hero['EFFECT0']['START_TIME'], hero['EFFECT2']['START_TIME'], hero['EFFECT3']['START_TIME']], [.1, .65, .65])

    def test_actual_source_declaration_hashes_and_original_texture_pixels(self):
        for row in self.index['templates'].values():
            source = Path('asset_work')/row['source']['rawPath']
            raw = source.read_bytes()
            self.assertEqual(sha(raw), row['source']['sha256'])
            start = row['source']['byteOffset']
            end = raw.index(b'}', start)+1
            self.assertEqual(sha(raw[start:end]), row['declarationSha256'])
            for texture in row['textures'].values():
                original = Path('asset_work')/texture['source']['rawPath']
                self.assertEqual(sha(original.read_bytes()), texture['source']['sha256'])
                with Image.open(original) as a, Image.open(ROOT/'artifacts/battle-life'/texture['file']) as b:
                    self.assertEqual(a.convert('RGBA').tobytes(), b.convert('RGBA').tobytes())

    def test_two_actual_skin_animations_use_measured_4800_tick_clock_and_native_keys(self):
        for name in ('RespawnLanding01', 'RespawnLanding02'):
            path = self.catalog.path(name+'.X')
            parsed = decode_animations(load_x(path), include_native_matrices=True)
            decoded = decode_measured_native_keys(path, parsed)
            self.assertEqual(decoded[0]['name'], 'Normal')
            self.assertEqual(decoded[0]['ticks_per_second'], 4800)
            self.assertEqual(decoded[0]['duration_seconds'], 1.2000000476837158)
            self.assertTrue(decoded[0]['native_d3dx_keys'])
            self.assertTrue(all(t['native_d3dx_keys'] for t in decoded[0]['tracks']))
            row = self.index['templates'][name]
            pose = json.loads((ROOT/'artifacts/battle-life'/row['poseData']).read_bytes())
            self.assertEqual(pose['unsupportedTracks'], [])
            self.assertTrue(pose['clips'][0]['nativeD3dxKeys'])

    def test_corrupted_registry_and_truncated_native_key_artifact_fail_closed(self):
        path = self.catalog.path('RespawnLanding01.X')
        parsed = decode_animations(load_x(path), include_native_matrices=True)
        manifest = json.loads((ROOT/BATTLE_LIFE_MANIFEST).read_bytes())
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            for file in (BATTLE_LIFE_REQUEST, BATTLE_LIFE_MANIFEST, manifest['artifact']['path']):
                target = repo/file
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT/file).read_bytes())
            self.assertEqual(decode_measured_native_keys(path, parsed, repo)[0]['ticks_per_second'], 4800)
            target = repo/manifest['artifact']['path']
            target.write_bytes(target.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, 'artifact hash/size mismatch'):
                decode_measured_native_keys(path, parsed, repo)
            (repo/BATTLE_LIFE_REQUEST).write_bytes((ROOT/BATTLE_LIFE_REQUEST).read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
                decode_measured_native_keys(path, parsed, repo)

    def test_static_original_mesh_never_acquires_an_invented_animation(self):
        path = self.catalog.path('RespawnLanding03.Y')
        parsed = decode_animations(load_x(path), include_native_matrices=True)
        self.assertEqual(parsed, [])
        self.assertIsNone(decode_measured_native_keys(path, parsed))
        self.assertEqual(self.index['templates']['RespawnLanding_P03']['animationClips'], [])

    def test_output_overlap_is_rejected_without_modifying_read_only_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError, 'task artifacts'):
                build(root, root/'ref', root/'output')
            self.assertFalse((root/'output').exists())


if __name__ == '__main__':
    unittest.main()
