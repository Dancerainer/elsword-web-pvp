"""Map animation decoding against frozen original DLL key bytes, not web gold."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from build_rf import load_x
from directx_animation import decode_animations
from native_d3dx_keys import (decode_measured_native_keys, PVP_MAP_REQUEST,
    PVP_MAP_REQUEST_SHA, PVP_MAP_MANIFEST, BATTLE_LIFE_MANIFEST)


class MapAnimationAssetsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.receipt = (ROOT / PVP_MAP_REQUEST).read_bytes()
        cls.request = json.loads(cls.receipt)
        cls.manifest = json.loads((ROOT / PVP_MAP_MANIFEST).read_bytes())
        cls.keys = (ROOT / cls.manifest['artifact']['path']).read_bytes()
        cls.native = json.loads(cls.keys)

    def temporary_repo(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for name, data in ((PVP_MAP_REQUEST, self.receipt),
                (PVP_MAP_MANIFEST, json.dumps(self.manifest).encode()),
                (self.manifest['artifact']['path'], self.keys)):
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        return root

    def test_three_original_animations_preserve_all_54_sdk_key_groups_and_static_mesh(self):
        self.assertEqual(hashlib.sha256(self.receipt).hexdigest(), PVP_MAP_REQUEST_SHA)
        self.assertEqual(hashlib.sha256(self.keys).hexdigest(), self.manifest['artifact']['sha256'])
        self.assertFalse(self.native['fullClientExecuted'])
        self.assertEqual(len(self.request['sources']), 4)
        groups = animated = static = 0
        for source in self.request['sources']:
            parsed = decode_animations(load_x(Path(source['source'])), include_native_matrices=True)
            decoded = decode_measured_native_keys(source['source'], parsed)
            if not source['nativeAnimations']:
                self.assertEqual(parsed, [])
                self.assertIsNone(decoded)
                static += 1
                continue
            animated += 1
            original = next(s for s in self.native['sources'] if s['sourceSha256'] == source['sourceSha256'])
            clip = decoded[0]
            self.assertEqual(clip['name'], 'Normal')
            self.assertEqual(clip['ticks_per_second'], 4800)
            self.assertEqual(clip['duration_seconds'], source['nativeAnimations'][0]['period'])
            # Respawn01/02 are also used by battle-life displays. Either
            # independently pinned receipt must reproduce the map's original
            # SDK key bytes, checked channel by channel below.
            allowed=(PVP_MAP_MANIFEST,BATTLE_LIFE_MANIFEST) if Path(source['source']).name.lower() in (
                'respawnlanding01.x','respawnlanding02.x') else (PVP_MAP_MANIFEST,)
            self.assertIn(clip['native_d3dx_evidence']['manifest'],allowed)
            tracks = {track['frame_name']: track for track in clip['tracks']}
            for channel in original['animations'][0]['channels']:
                for field, property_name in (('translationKeys', 'translation'),
                        ('scaleKeys', 'scale'), ('rotationKeys', 'rotation')):
                    group = channel[field]
                    raw = base64.b64decode(group['keyBytesBase64'], validate=True)
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), group['keyBytesSha256'])
                    rows = list(struct.iter_unpack('<' + 'f' * group['stride'], raw))
                    values = [[-value if property_name == 'rotation' and i < 3 else value
                        for i, value in enumerate(row[1:])] for row in rows]
                    track = tracks[channel['name']][property_name]
                    self.assertEqual(track['ticks'], [row[0] for row in rows])
                    # Packing also checks the signs of zero, not just numeric equality.
                    self.assertEqual(b''.join(struct.pack('<' + 'f' * len(v), *v) for v in track['values']),
                        b''.join(struct.pack('<' + 'f' * len(v), *v) for v in values))
                    groups += 1
        self.assertEqual((animated, static, groups), (3, 1, 54))

    def test_missing_map_keys_cannot_borrow_another_profession_receipt(self):
        root = self.temporary_repo()
        (root / self.manifest['artifact']['path']).unlink()
        source = next(s for s in self.request['sources'] if 'rana_B_damageUp' in s['source'])
        with self.assertRaisesRegex(ValueError, 'artifact missing'):
            decode_measured_native_keys(source['source'], [{'name': 'Normal'}], root)

    def test_measured_source_and_static_registry_fail_closed(self):
        root = self.temporary_repo()
        source = self.request['sources'][0]
        changed = root / Path(source['source']).name
        changed.write_bytes(Path(source['source']).read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'source hash mismatch'):
            decode_measured_native_keys(changed, [{'name': 'Normal'}], root)
        (root / PVP_MAP_REQUEST).unlink()
        static = next(s for s in self.request['sources'] if not s['nativeAnimations'])
        with self.assertRaisesRegex(ValueError, 'registry missing'):
            decode_measured_native_keys(static['source'], [], root)


if __name__ == '__main__':
    unittest.main()
