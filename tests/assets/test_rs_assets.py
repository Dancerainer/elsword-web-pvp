"""Original RS inputs, exact sharing, runtime closure and damaged source evidence."""
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog, load_x
from build_rs import SPEC, required_runtime_clips, SWORD_WAIT_RUNTIME_CLIPS, FAST_STANDUP_RUNTIME_CLIPS
from ksm_convert import parse_ksm
from directx_animation import decode_animations
import native_d3dx_keys as decoder


def read(path): return json.loads(path.read_text('utf8'))
def sha(data): return hashlib.sha256(data).hexdigest()


class RsAssetTests(unittest.TestCase):
    def test_dynamic_sword_wait_clips_survive_model_and_pose_packaging(self):
        profile = read(ROOT/'packages/combat-core/rs-profile.json')
        required = required_runtime_clips(profile)
        manifest = read(ROOT/'artifacts/rs/manifest.json')
        self.assertEqual(read(ROOT/'contracts/rs-assets-motion-index.json')['sharedCharacterAnimations'], manifest['sharedCharacterAnimations'])
        pose = read(ROOT/'artifacts/rs/runtime-pose.json')
        model_names = set(manifest['runtimeCharacter']['selection']['included']) | set(manifest['sharedCharacterAnimations']['clips'])
        pose_names = {c['name'] for c in pose['clips']} | set(pose.get('sharedClips', []))
        self.assertTrue(required <= model_names, sorted(required - model_names))
        self.assertTrue(required <= pose_names, sorted(required - pose_names))
        self.assertNotIn('Wait_W1', {s['animationName'] for s in profile['states'].values()})
        for name in SWORD_WAIT_RUNTIME_CLIPS:
            self.assertIn(name, required)
        for name in FAST_STANDUP_RUNTIME_CLIPS:
            self.assertIn(name, required)
            self.assertIn(name, pose_names)
            self.assertIn(name, manifest['sharedCharacterAnimations']['clips'])
        damaged = {**profile, 'clips': {name: clip for name, clip in profile['clips'].items() if name != 'Wait_W1'}}
        with self.assertRaisesRegex(ValueError, 'Wait_W1'):
            required_runtime_clips(damaged)

    def test_original_rs_selection_and_damaged_ksm(self):
        catalog = Catalog(Path('asset_work'))
        self.assertEqual(SPEC['motions'][-2:], ('Motion_Elsword_MK.x', 'Motion_Elsword_RS.x'))
        for name in (*SPEC['body'], SPEC['weapon']):
            self.assertIn('ERS_', name)
            path = catalog.path(name)
            self.assertEqual(sha(path.read_bytes()), catalog.evidence(path)['sha256'])
        path = catalog.path('Motion_Elsword_RS.x')
        original = path.read_bytes()
        decoded = parse_ksm(path)
        self.assertEqual((len(decoded['frames']), len(decoded['animations'])), (68, 16))
        with tempfile.TemporaryDirectory() as tmp:
            damaged = Path(tmp)/path.name
            for raw in (original[:16], original[:-1], b'BROKEN'+original[6:]):
                damaged.write_bytes(raw)
                with self.assertRaises((ValueError, IndexError, EOFError)): parse_ksm(damaged)
        catalog.connection.close()

    def test_shared_model_clips_match_original_key_hashes(self):
        rs = read(ROOT/'artifacts/rs/manifest.json')
        lk = read(ROOT/'artifacts/lk/manifest.json')
        source = {c['name']: c['decodedKeysSha256'] for c in rs['clips']}
        shared = {c['name']: c['decodedKeysSha256'] for c in lk['clips']}
        available = set(lk['runtimeCharacter']['selection']['included'])
        self.assertEqual(rs['sharedCharacterAnimations']['glb'], '../lk/lk-runtime.glb')
        self.assertGreater(len(rs['sharedCharacterAnimations']['clips']), 50)
        for name in rs['sharedCharacterAnimations']['clips']:
            self.assertIn(name, available)
            self.assertEqual(source[name], shared[name])
        self.assertIn('BoostPower', rs['sharedCharacterAnimations']['clips'])
        self.assertIn('RS_DashJumpComboXa1', rs['runtimeCharacter']['selection']['included'])
        self.assertIn('RS_Combo_XZ', rs['runtimeCharacter']['selection']['included'])

    def test_all_runtime_files_match_sealed_hashes_and_shared_references_exist(self):
        root = ROOT/'artifacts/rs'
        report = read(ROOT/'reports/rs-resource-reuse-v1.json')
        expected = {row['file'] for row in report['outputs']}
        actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and not p.is_relative_to(root/'source-proof')}
        self.assertEqual(actual, expected)
        for row in report['outputs']:
            raw = (root/row['file']).read_bytes()
            self.assertEqual((len(raw), sha(raw)), (row['bytes'], row['sha256']))
        fx = read(root/'fx/index.json')
        self.assertEqual(fx['meshFailures'], [])
        self.assertEqual(fx['missingTemplates'], [])
        for template in fx['templates'].values():
            self.assertFalse(template.get('animationRequiresUnconfirmedRate'), template['name'])
            for key in ('glb', 'poseData'):
                if template.get(key): self.assertTrue((root/template[key]).is_file(), template[key])
            for row in template['textures'].values(): self.assertTrue((root/row['file']).is_file(), row['file'])
        portraits = read(root/'manifest.json')['portraits']
        self.assertEqual(set(portraits), {'icon', 'party', 'state'})
        for kind, row in portraits.items():
            self.assertEqual(row['piece'], 'R_SLAYER_'+kind.upper())
            self.assertEqual(sha((root/row['file']).read_bytes()), row['sha256'])

    def test_shared_pose_channels_and_private_rs_helpers_are_original(self):
        root = ROOT/'artifacts/rs'
        pose = read(root/'runtime-pose.json')
        full = json.loads(gzip.decompress((root/'source-proof/runtime-pose-full.json.gz').read_bytes()))
        shared = read(ROOT/'artifacts/lk/runtime-pose.json')
        frames = {f['name'] for f in pose['frames']}
        original = {c['name']: c for c in full['clips']}
        lk = {c['name']: c for c in shared['clips']}
        self.assertEqual(pose['frames'], full['frames'])
        self.assertEqual(pose['helpers'], full['helpers'])
        self.assertIn('Bip01_Head', frames)
        for name in pose['sharedClips']:
            self.assertEqual(original[name]['tracks'], [t for t in lk[name]['tracks'] if t['frame_name'] in frames])
        for clip in pose['clips']: self.assertEqual(clip, original[clip['name']])

    def test_original_audio_and_all_ui_images_are_complete(self):
        audio = read(ROOT/'artifacts/rs/audio/manifest.json')
        self.assertEqual(len(audio['files']), 100)
        for row in audio['files'].values():
            raw = (ROOT/'artifacts/audio'/row['file']).read_bytes()
            self.assertEqual((len(raw), sha(raw)), (row['bytes'], row['sha256']))
            self.assertTrue(raw.startswith(b'OggS'))
        catalog = read(ROOT/'artifacts/ui/skills/rs/catalog.json')
        self.assertEqual(len(catalog['skills']), 37)
        paths = [ROOT/'artifacts/ui/skills'/row['icon'] for row in catalog['skills']]
        paths += [ROOT/'artifacts/rs'/row['file'] for row in read(ROOT/'artifacts/rs/manifest.json')['portraits'].values()]
        for path in paths:
            with Image.open(path) as image: image.verify()

    def test_rune_callback_roots_and_distinct_original_lifetimes_survive_packaging(self):
        profile = read(ROOT/'packages/combat-core/rs-profile.json')
        fx = read(ROOT/'artifacts/rs/fx/index.json')['templates']
        for name in ('ELSWORD_RUNE_SLAYER_DASH_ZZX',
                     'FIREBALL_SMALL_DOWN_ELSWORD', 'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ'):
            row = profile['damageEffects'][name]['raw']
            self.assertIn(row['MAIN_EFFECT_NAME'], fx)
        for name, duration, size in (('Elsword_RS_ComboXZ', .15, 2.5),
            ('Elsword_RS_ComboXZZ', .18, 3.6), ('Elsword_RS_DashJumpComboXZ', .3, 3.0)):
            self.assertEqual(fx[name]['fields']['LifeTime'], duration)
            self.assertEqual(next(e['value'] for e in fx[name]['events'] if e['property'] == 'Size'), [size]*3)
        flying = fx['Elsword_RS_DashJumpComboXa_Mesh01']
        self.assertEqual(flying['fields']['LifeTime'], .8)
        self.assertEqual(next(e['value'] for e in flying['events'] if e['property'] == 'Velocity'), [1000., 0., 0.])
        for name in ('RevengeImpactSlashCW', 'RevengeImpactSlashCCW', 'RevengeImpact', 'RevengeImpactTick', 'UnitCold', 'UnitPoison'):
            self.assertIn(name, fx)
        self.assertEqual(fx['RevengeImpactTick']['sourceFamily'], 'game-minor')
        self.assertEqual(fx['RevengeImpactTick']['namespaceChoiceEvidence'], 'contracts/rs-reflection-source-v1.json')
        missing = [r for r in profile['unsupported'] if r['id'].startswith('missing-original-template:')]
        self.assertEqual({r['id'] for r in missing}, {'missing-original-template:ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ_DIE',
            'missing-original-template:ELSWORD_RUNE_SLAYER_DASH_ZZX_DIE'})

    def test_actual_d3dx_registry_clocks_and_corruption_fail_closed(self):
        request_bytes = (ROOT/decoder.RS_FX_REQUEST).read_bytes()
        request = json.loads(request_bytes)
        manifest = read(ROOT/decoder.RS_FX_MANIFEST)
        self.assertEqual(sha(request_bytes), decoder.RS_FX_REQUEST_SHA)
        self.assertEqual(len(request['sources']), 49)
        artifact = (ROOT/manifest['artifact']['path']).read_bytes()
        self.assertEqual(sha(artifact), manifest['artifact']['sha256'])
        for row in request['sources']:
            path = Path(row['source'])
            self.assertEqual(sha(path.read_bytes()), row['sourceSha256'])
            parsed = decode_animations(load_x(path), include_native_matrices=True)
            decoded = decoder.decode_measured_native_keys(path, parsed) or []
            self.assertEqual(len(decoded), len(row['nativeAnimations']))
            for actual, gold in zip(decoded, row['nativeAnimations']):
                self.assertEqual(actual['ticks_per_second'], gold['ticksPerSecond'])
                self.assertEqual(actual['duration_seconds'], gold['period'])
        source = Path(request['sources'][0]['source'])
        parsed = decode_animations(load_x(source), include_native_matrices=True)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            receipt = root/decoder.RS_FX_REQUEST
            receipt.parent.mkdir(parents=True)
            receipt.write_bytes(request_bytes+b' ')
            with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
                decoder.decode_measured_native_keys(source, parsed, root)
            receipt.write_bytes(request_bytes)
            (root/decoder.RS_FX_MANIFEST).write_bytes((ROOT/decoder.RS_FX_MANIFEST).read_bytes())
            keys = root/manifest['artifact']['path']
            keys.parent.mkdir(parents=True)
            keys.write_bytes(artifact[:-1])
            with self.assertRaisesRegex(ValueError, 'artifact hash/size mismatch'):
                decoder.decode_measured_native_keys(source, parsed, root)


if __name__ == '__main__': unittest.main()
