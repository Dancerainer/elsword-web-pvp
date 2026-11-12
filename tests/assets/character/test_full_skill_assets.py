"""Full RF resource closure and actual shipped-DLL output, not simulation gold."""
from pathlib import Path
import base64
import bisect
import copy
import hashlib
import json
import math
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
sys.path.insert(0, str(Path(__file__).parent))
from build_rf import Catalog, SUPPLEMENTAL_MOTIONS, load_x, supplemental_motion_binding
from build_rf_fx import select_templates
from directx_animation import decode_animations
from ksm_convert import parse_ksm
from native_d3dx_keys import decode_measured_native_keys, FULL_REQUEST, FULL_MANIFEST, FULL_REQUEST_SHA
from test_native_d3dx_keys import sample


def sdk_srt_channel(channel, time, quaternion=False):
    """Compare decoded keys to independent DLL GetSRT, before controller blend."""
    if not quaternion: return sample(channel, time)
    times, values = channel['times'], channel['values']
    index = bisect.bisect_left(times, time)
    if index == 0: return values[0]
    if index == len(times): return values[-1]
    if times[index] == time: return values[index]
    a, b = values[index-1], values[index]
    if sum(x*y for x,y in zip(a,b)) < 0: b = [-x for x in b]
    weight = (time-times[index-1])/(times[index]-times[index-1])
    q = [x+(y-x)*weight for x,y in zip(a,b)]
    length = math.sqrt(sum(x*x for x in q))
    return [x/length for x in q]


class ResourceClosureTests(unittest.TestCase):
    def test_recursive_actual_reference_fields_and_cycles(self):
        definitions = {
            # read_definitions preserves each declaration's quoted source name;
            # typed mesh/particle selection may give additional variants aliases.
            'a': {'name': 'a', 'fields': {'TraceParticleList': ['b'], 'MeshName': 'b.X'}, 'repeated': {}},
            'b': {'name': 'b', 'fields': {'FinalParticleList': ['a', 'c']}, 'repeated': {}},
            'c': {'name': 'c', 'fields': {'ParticleList': ['missing']}, 'repeated': {}},
            'unused': {'name': 'unused', 'fields': {}, 'repeated': {}},
        }
        profile = {'damageEffects': {'x': {'MAIN_EFFECT_NAME': 'a', 'sound': 'voice.ogg', 'label': 'unused'}}}
        selected, missing = select_templates(definitions, profile)
        self.assertEqual(set(selected), {'a', 'b', 'c', 'unused'})  # Exact labels matching known definitions retain conservative resource coverage.
        self.assertEqual(missing, ['missing'])

    def test_missing_explicit_roots_and_defaults_fail_visible(self):
        selected, missing = select_templates({}, {'effectSets': {'a': {'PARTICLE_NAME': 'needed'}}, 'resourceOnlyTemplates': ['extra']}, ['default'])
        self.assertEqual(selected, {})
        self.assertEqual(missing, ['default', 'extra', 'needed'])

    def test_unknown_sounds_enums_and_descriptions_are_not_missing_templates(self):
        _, missing = select_templates({}, {'damageEffects': {'x': {'sound': 'voice.ogg', 'enum': 'DT_FIRE', 'description': 'not a template'}}})
        self.assertEqual(missing, [])

    def test_actual_supplemental_original_named_tracks_and_bad_parent_rejected(self):
        catalog = Catalog('asset_work')
        base = parse_ksm(catalog.path('Motion_Raven.x'))
        for filename, expected_tracks in (('Motion_Raven_WT.x', 68), ('Motion_Raven_VC.x', 74)):
            source = parse_ksm(catalog.path(filename))
            names = SUPPLEMENTAL_MOTIONS[filename]['clips']
            proof = supplemental_motion_binding(source, base, names)
            self.assertEqual(len(proof['registeredTrackNames']), expected_tracks)
            self.assertEqual((proof['sourceFrameCount'], proof['baseFrameCount']), (75, 75))
            broken = copy.deepcopy(source)
            next(f for f in broken['frames'] if f['name'] == 'Bip01')['parent'] = None
            with self.assertRaisesRegex(ValueError, 'parent paths differ'):
                supplemental_motion_binding(broken, base, names)
            with self.assertRaisesRegex(ValueError, 'animation missing'):
                supplemental_motion_binding(source, base, ['not an original animation'])


class FullNativeKeysTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request_bytes = (ROOT / FULL_REQUEST).read_bytes()
        cls.request = json.loads(cls.request_bytes)
        cls.manifest = json.loads((ROOT / FULL_MANIFEST).read_bytes())
        cls.artifact_bytes = (ROOT / cls.manifest['artifact']['path']).read_bytes()
        cls.artifact = json.loads(cls.artifact_bytes)
        cls.report = json.loads((ROOT / 'reports/rf-full-skill-d3dx-execution.json').read_bytes())

    def test_all_actual_60_meshes_51_sets_1680_groups_and_2240_sdk_srt_poses(self):
        self.assertEqual(hashlib.sha256(self.request_bytes).hexdigest(), FULL_REQUEST_SHA)
        self.assertEqual(len(self.request['sources']), 60)
        sources = {s['sourceSha256']: s for s in self.artifact['sources']}
        gold = {t['sourceSha256']: t for t in self.report['traces'] if t.get('sourceSha256')}
        groups = poses = sets = static = 0
        for source in self.request['sources']:
            path = Path(source['source'])
            parsed = decode_animations(load_x(path), default_ticks_per_second=4800, include_native_matrices=True)
            decoded = decode_measured_native_keys(path, parsed)
            if not source['nativeAnimations']:
                self.assertIsNone(decoded); self.assertEqual(parsed, []); static += 1; continue
            native = sources[source['sourceSha256']]
            actual_sets = {a['name']: a for a in decoded}
            self.assertEqual(set(actual_sets), {a['name'] for a in parsed})
            for animation in native['animations']:
                sets += 1
                clip = actual_sets[animation['name']]
                self.assertEqual(clip['duration_seconds'], animation['period'])
                self.assertEqual(clip['nativePlaybackField'], animation['playbackType'])
                tracks = {t['frame_name']: t for t in clip['tracks']}
                for channel in animation['channels']:
                    track = tracks[channel['name']]
                    for key, property in (('translationKeys', 'translation'), ('scaleKeys', 'scale'), ('rotationKeys', 'rotation')):
                        group = channel[key]
                        raw = base64.b64decode(group['keyBytesBase64'])
                        self.assertEqual(hashlib.sha256(raw).hexdigest(), group['keyBytesSha256'])
                        rows = list(struct.iter_unpack('<' + 'f' * group['stride'], raw))
                        self.assertEqual(track[property]['ticks'], [r[0] for r in rows])
                        for actual, row in zip(track[property]['values'], rows):
                            expected = [-x if property == 'rotation' and i < 3 else x for i, x in enumerate(row[1:])]
                            self.assertEqual(actual, expected)
                            for x, y in zip(actual, expected):
                                if x == 0: self.assertEqual(math.copysign(1, x), math.copysign(1, y))
                        groups += 1
                native_gold = next(a for a in gold[source['sourceSha256']]['animations'] if a['name'] == animation['name'])
                for channel in native_gold['channels']:
                    track = tracks[channel['name']]
                    for pose in channel['poses']:
                        for property in ('translation', 'scale', 'rotation'):
                            actual = sdk_srt_channel(track[property], pose['timeSeconds'], property == 'rotation')
                            expected = pose[property]
                            if property == 'rotation' and sum(x*y for x, y in zip(actual, expected)) < 0: actual = [-x for x in actual]
                            # D3DX runs float32 arithmetic and the Framework
                            # serializer prints single-precision decimal gold.
                            # Key bytes above remain exact, with no tolerance.
                            magnitude = max(abs(x) for row in track[property]['values'] for x in row)
                            tolerance = 2e-6 if property == 'rotation' else max(3e-6, magnitude*5e-7)
                            for x, y in zip(actual, expected): self.assertAlmostEqual(x, y, delta=tolerance,
                                msg=f'{path.name}/{animation["name"]}/{channel["name"]}/{property} t={pose["timeSeconds"]}')
                        poses += 1
        self.assertEqual((static, sets, groups, poses), (15, 51, 1680, 2240))

    def temporary_repo(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        repo = Path(temp.name)
        for path, raw in ((FULL_REQUEST, self.request_bytes), (FULL_MANIFEST, json.dumps(self.manifest).encode()), (self.manifest['artifact']['path'], self.artifact_bytes)):
            destination = repo / path; destination.parent.mkdir(parents=True, exist_ok=True); destination.write_bytes(raw)
        return repo

    def first_animated(self):
        row = next(r for r in self.request['sources'] if r['nativeAnimations'])
        return row, [{'name': a['name']} for a in row['nativeAnimations']]

    def test_registry_cannot_whitelist_an_unmeasured_hash(self):
        repo = self.temporary_repo()
        request = copy.deepcopy(self.request); request['sources'][0]['sourceSha256'] = '0'*64
        (repo / FULL_REQUEST).write_text(json.dumps(request), encoding='utf-8')
        row, parsed = self.first_animated()
        with self.assertRaisesRegex(ValueError, 'registry hash mismatch'):
            decode_measured_native_keys(row['source'], parsed, repo)

    def test_missing_artifact_clock_or_exact_set_names_rejected(self):
        row, parsed = self.first_animated()
        repo = self.temporary_repo(); (repo / self.manifest['artifact']['path']).unlink()
        with self.assertRaisesRegex(ValueError, 'artifact missing'):
            decode_measured_native_keys(row['source'], parsed, repo)
        repo = self.temporary_repo()
        with self.assertRaisesRegex(ValueError, 'names differ'):
            decode_measured_native_keys(row['source'], [{'name': 'different name'}], repo)
        with self.assertRaisesRegex(ValueError, 'Duplicate actual AnimationSet name'):
            decode_measured_native_keys(row['source'], parsed + parsed, repo)
        artifact = copy.deepcopy(self.artifact)
        native = next(s for s in artifact['sources'] if s['sourceSha256'] == row['sourceSha256'])
        native['animations'][0]['ticksPerSecond'] += 1
        raw = json.dumps(artifact).encode(); (repo / self.manifest['artifact']['path']).write_bytes(raw)
        manifest = copy.deepcopy(self.manifest); manifest['artifact']['sha256'] = hashlib.sha256(raw).hexdigest(); manifest['artifact']['bytes'] = len(raw)
        (repo / FULL_MANIFEST).write_text(json.dumps(manifest), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'metadata differs'):
            decode_measured_native_keys(row['source'], parsed, repo)


if __name__ == '__main__':
    unittest.main()
