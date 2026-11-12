"""Blade Master original sample, damaged input and packed resource checks."""
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT/'tools/assets/character'), str(ROOT/'tools/assets')]
from build_rf import Catalog, load_x, build_effect
from build_rf_fx import read_definitions, select_templates
from ksm_convert import parse_ksm
from directx_animation import decode_animations
from runtime_path_case import canonical_runtime_path
import native_d3dx_keys as decoder
import audio

sha = lambda data: hashlib.sha256(data).hexdigest()
read = lambda path: json.loads(path.read_bytes())


class BmAssetsTest(unittest.TestCase):
    def test_original_same_named_mesh_and_particle_keep_separate_namespaces(self):
        catalog = Catalog(Path('asset_work'))
        definitions = read_definitions(catalog)
        name = 'EffectSet_RBM_HYPER_STEP_EXPLO_P13'
        profile = {'effectSets': {'test': {'NAME': name, 'EFFECT_TYPE': 4}},
                   'damageEffects': {'test': {'TIME_PARTICLE0': {'PARTICLE_NAME': name}}}}
        selected, missing = select_templates(definitions, profile)
        self.assertEqual(missing, [])
        self.assertEqual(selected[name]['kind'], 'particle')
        mesh = selected['mesh::'+name]
        self.assertEqual((mesh['kind'], mesh['sourceName'], mesh['fields']['MeshName'], mesh['fields']['PlayCount']),
                         ('mesh', name, 'Sprriggan_AirCurren_02.X', 1))
        self.assertEqual(mesh['declarationSha256'], 'eb265152fa5cb651afa33181df472b988188d2e6b0070bb7151210ed453abe67')
        with self.assertRaisesRegex(ValueError, 'explicit namespace'):
            select_templates(definitions, {'resourceOnlyTemplates': [name]})
        damaged = dict(definitions)
        damaged[name] = {**definitions[name], 'alternateKindDeclarations': [definitions[name]]}
        with self.assertRaisesRegex(ValueError, 'unique typed'):
            select_templates(damaged, {'effectSets': {'test': {'NAME': name, 'EFFECT_TYPE': 4}}})

    def test_fatal_wound_source_is_only_attack_helpers_without_display_children(self):
        catalog = Catalog(Path('asset_work'))
        with tempfile.TemporaryDirectory() as tmp:
            converted = build_effect(catalog, Path(tmp), 'RVC_A_bleedingSlicer_attackLine.X')
        self.assertIsNone(converted['glb'])
        self.assertEqual(converted['asset']['meshes'], 0)
        self.assertEqual({r['name'] for r in converted['helpers']}, {'ATTACK_LINE_END0', 'ATTACK_LINE_START0_Sword'})
        template = read(ROOT/'artifacts/bm/fx/index.json')['templates']['BleedingSlicerAttackBox_Ground']
        self.assertEqual(template['fields']['PlayCount'], 999999)
        self.assertTrue(all(k not in template['fields'] and k not in template['repeated']
                            for k in ('TraceParticleList', 'FinalParticleList', 'ParticleList')))

    def test_actual_motion_sources_and_damaged_inputs(self):
        catalog = Catalog(Path('asset_work'))
        for name, animations, expected in (
            ('Motion_Raven_BM.x', 22, 'a70c91700f47491c73e0381a1c78e9ae04e6a18fbf06e86fddc88b9d71d1ebc6'),
            ('Motion_Raven_ST.x', 29, 'f6ac70eb7090986decf780b568bb047b3db2840bca47f5bf345ada4d996a32d5')):
            path = catalog.path(name)
            raw = path.read_bytes()
            self.assertEqual(sha(raw), expected)
            parsed = parse_ksm(path)
            self.assertEqual((len(parsed['frames']), len(parsed['animations'])), (75, animations))
            with tempfile.TemporaryDirectory() as tmp:
                sample = Path(tmp)/name
                for bad in (raw[:16], raw[:-1], b'BROKEN'+raw[6:]):
                    sample.write_bytes(bad)
                    with self.assertRaises((ValueError, IndexError, EOFError)):
                        parse_ksm(sample)

    def test_43_original_dll_sources_preserve_animation_identities_and_clocks(self):
        request_bytes = (ROOT/decoder.BM_FX_REQUEST).read_bytes()
        request = json.loads(request_bytes)
        self.assertEqual(sha(request_bytes), decoder.BM_FX_REQUEST_SHA)
        self.assertEqual(len(request['sources']), 43)
        for row in request['sources']:
            path = Path(row['source'])
            self.assertEqual(sha(path.read_bytes()), row['sourceSha256'])
            parsed = decode_animations(load_x(path), include_native_matrices=True)
            decoded = decoder.decode_measured_native_keys(path, parsed)
            if not row['nativeAnimations']:
                self.assertIsNone(decoded)
                continue
            self.assertEqual({r['name'] for r in decoded}, {r['name'] for r in row['nativeAnimations']})
            for clip in decoded:
                expected = next(r for r in row['nativeAnimations'] if r['name'] == clip['name'])
                self.assertEqual((clip['ticks_per_second'], clip['duration_seconds'], clip['nativePlaybackField']),
                                 (expected['ticksPerSecond'], expected['period'], expected['playbackType']))
                self.assertTrue(clip['native_d3dx_keys'])

    def test_corrupt_registry_source_and_native_keys_fail_closed(self):
        request = read(ROOT/decoder.BM_FX_REQUEST)
        row = next(r for r in request['sources'] if r['nativeAnimations'])
        source = Path(row['source'])
        parsed = decode_animations(load_x(source), include_native_matrices=True)
        manifest = read(ROOT/decoder.BM_FX_MANIFEST)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for filename in (decoder.BM_FX_REQUEST, decoder.BM_FX_MANIFEST, manifest['artifact']['path']):
                target = root/filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT/filename).read_bytes())
            request_file = root/decoder.BM_FX_REQUEST
            request_file.write_bytes(request_file.read_bytes()+b' ')
            with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
                decoder.decode_measured_native_keys(source, parsed, root)
            request_file.write_bytes((ROOT/decoder.BM_FX_REQUEST).read_bytes())
            damaged = root/source.name
            damaged.write_bytes(source.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, 'source hash mismatch'):
                decoder.decode_measured_native_keys(damaged, parsed, root)
            artifact = root/manifest['artifact']['path']
            artifact.write_bytes(artifact.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError, 'artifact hash/size mismatch'):
                decoder.decode_measured_native_keys(source, parsed, root)

    def test_all_runtime_inventory_hashes_seals_and_exact_case_references(self):
        root = ROOT/'artifacts/bm'
        reuse, report = [read(ROOT/f'reports/bm-{suffix}.json') for suffix in ('resource-reuse-v1', 'assets-runtime')]
        manifest, index = read(root/'manifest.json'), read(root/'fx/index.json')
        self.assertEqual(reuse['outputs'], report['outputs'])
        # v1 stays an immutable receipt. The current user-authorized XXX
        # overlay changes four metadata files and reuses existing RF bytes.
        overlay = read(ROOT/'reports/bm-feedback-overlay-v4.json')
        handoff = read(ROOT/'reports/bm-feedback-handoff-v4.json')
        current_outputs = {r['file']: r for r in reuse['outputs']}
        self.assertEqual({r['file'] for r in handoff['metadata']}, {
            'artifacts/bm/manifest.json', 'artifacts/bm/effect-assets.json',
            'artifacts/bm/fx/index.json', 'artifacts/bm/audio/manifest.json'})
        for row in handoff['metadata']:
            file = row['file'].removeprefix('artifacts/bm/')
            self.assertIn(file, current_outputs)
            current_outputs[file] = {**row, 'file': file}
        actual = {p.relative_to(root).as_posix() for p in root.rglob('*')
                  if p.is_file() and not p.is_relative_to(root/'source-proof')}
        self.assertEqual(actual, set(current_outputs))
        for row in current_outputs.values():
            data = (root/row['file']).read_bytes()
            self.assertEqual((len(data), sha(data)), (row['bytes'], row['sha256']), row['file'])
        profile_sha = sha((ROOT/'packages/combat-core/bm-profile.json').read_bytes().replace(b'\r\n', b'\n'))
        self.assertEqual(report['profile']['sha256'], overlay['beforeProfileSha256LF'])
        self.assertEqual(profile_sha, overlay['afterProfileSha256LF'])
        self.assertEqual(profile_sha, handoff['profileSha256'])
        for seal in (manifest['profile'], read(root/'audio/manifest.json')['profile']):
            self.assertEqual(seal['sha256'], profile_sha)
        self.assertEqual(index['profileSha256'], profile_sha)
        self.assertEqual(index, read(ROOT/'contracts/bm-fx-index.json'))
        self.assertEqual(index['meshFailures'], [])
        self.assertEqual(index['missingTemplates'], ['RAVEN_HYPER_SONIC_STAB_DOWN'])
        for template in index['templates'].values():
            self.assertEqual(template.get('unsupported', []), [], template['name'])
            self.assertFalse(template.get('animationRequiresUnconfirmedRate'), template['name'])
            files = [template.get(k) for k in ('glb', 'poseData')]
            files += [t['file'] for t in template['textures'].values()]
            for file in filter(None, files):
                self.assertEqual(canonical_runtime_path(root, file), file)

    def test_source_gap_is_audited_without_invented_particle_alias(self):
        contract = read(ROOT/'contracts/bm-presentation-source-v1.json')
        gap = contract['missingParticleReference']
        self.assertEqual(gap['raw']['PARTICLE_NAME'], 'RAVEN_HYPER_SONIC_STAB_DOWN')
        self.assertEqual(gap['sameNamedDamageEffect']['MAIN_EFFECT_NAME'], 'Raven_ST_Sp1_SonicStab')
        self.assertEqual(gap['matches'], [])
        self.assertEqual(len(gap['searchedOriginalParticleAndMeshScripts']), 66)
        for source in gap['searchedOriginalParticleAndMeshScripts']:
            raw = (Path('asset_work')/source['rawPath']).read_bytes()
            self.assertEqual(sha(raw), source['sha256'])
            self.assertNotIn(b'RAVEN_HYPER_SONIC_STAB_DOWN', raw)

    def test_original_audio_and_damage_sound_closure(self):
        root = ROOT/'artifacts/bm'
        manifest = read(root/'audio/manifest.json')
        profile = read(ROOT/'packages/combat-core/bm-profile.json')
        self.assertEqual(manifest['effectSounds'], audio.effect_sound_references(profile))
        names = audio.sound_references(profile, audio.reference_sound_contract(profile))[1]
        self.assertEqual(set(names), set(manifest['files']))
        for record in manifest['files'].values():
            original = (Path('asset_work')/record['source']['raw_path']).read_bytes()
            actual = (root/record['file']).read_bytes()
            self.assertEqual(actual, original)
            self.assertEqual(sha(actual), record['sha256'])
            self.assertTrue(audio.inspect_ogg(actual)['crcValidated'])
        raw = (root/next(iter(manifest['files'].values()))['file']).read_bytes()
        for bad in (raw[:12], raw[:-1], raw[:-1]+bytes([raw[-1]^1])):
            with self.assertRaises(ValueError):
                audio.inspect_ogg(bad)

    def test_original_portraits_awakening_and_shared_animation_keys(self):
        root = ROOT/'artifacts/bm'
        manifest = read(root/'manifest.json')
        self.assertEqual(manifest['unitClass'], 106)
        self.assertEqual(set(manifest['portraits']), {'party', 'icon', 'state'})
        for key, row in manifest['portraits'].items():
            self.assertEqual(row['piece'], 'B_MASTER_'+key.upper())
            self.assertEqual(sha((root/row['file']).read_bytes()), row['sha256'])
        self.assertTrue((root/manifest['mechanismResources']['ravenNasodCore']['glb']).is_file())
        index = read(root/'fx/index.json')
        for name in ('HyperBoostLeftBlack', 'HyperBoostRightBlack', 'DropDown', 'GroundShockWave', 'AirDownTick', 'DownSmoke'):
            self.assertIn('sharedResourceEvidence', index['templates'][name])
        rf = read(ROOT/'artifacts/rf/manifest.json')
        rf_keys = {row['name']: row['decodedKeysSha256'] for row in rf['clips']}
        bm_keys = {row['name']: row['decodedKeysSha256'] for row in manifest['clips']}
        for name in manifest['sharedCharacterAnimations']['clips']:
            self.assertEqual(bm_keys[name], rf_keys[name])
        pose = read(root/'runtime-pose.json')
        full = json.loads(gzip.decompress((root/'source-proof/pose-tracks.json.gz').read_bytes()))
        source_frames = {row['name']: row for row in full['frames']}
        for row in pose['frames']:
            self.assertEqual(row['nativeRowMatrix'], source_frames[row['name']]['nativeRowMatrix'])
        names = {row['name'] for row in pose['clips']} | set(pose.get('sharedClips', []))
        required = {row['animationName'] for row in read(ROOT/'packages/combat-core/bm-profile.json')['states'].values()}
        self.assertTrue(required <= names)


if __name__ == '__main__':
    unittest.main()
