"""Synthetic legal format samples + optional actual 2016 RF provenance checks.

These fixtures are authored here. They contain no client geometry or game data.
No simulated game output is used as an original-client expected answer.
"""
from __future__ import annotations

import os
from pathlib import Path
import struct
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[3] / 'tools/assets/character'
sys.path.insert(0, str(TOOLS))
from ksm_convert import FormatError, expanded_track, parse_kac, parse_ksm
from build_rf import Catalog, load_x, walk, parse_template_vector, selected_templates, build_effect

IDENTITY = (1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)


def synthetic_ksm():
    # Two frames, second unnamed; no meshes; empty KAC.
    names = struct.pack('<I', 4) + b'Root'
    header = struct.pack('<4sII4fI', b'KSM ', 0x200, 208, 0,0,0,1, 2)
    frame0 = struct.pack('<I16fIIii', 200, *IDENTITY, 0,0,-1,1)
    frame1 = struct.pack('<I16fIIii', 0, *IDENTITY, 0,0,-1,-1)
    return bytearray(header + frame0 + frame1 + names + struct.pack('<4sII', b'KAC ', 0x100, 0))


def synthetic_kac():
    track = struct.pack('<IIfB10f', 1, 1, 0, 0x7f, 1,1,1,4,5,6,0,0,0,1)
    name_pointer = 16 + 24 + 4 + len(track)
    return bytearray(struct.pack('<4sIII', b'KAC ', 0x100, 1, 16)
        + struct.pack('<IIdII', name_pointer, 0, 4800, 0, 1)
        + struct.pack('<I', len(track)) + track + struct.pack('<I', 4) + b'Test')


class SyntheticKsmTests(unittest.TestCase):
    def parse(self, data):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'synthetic.x'; path.write_bytes(data)
            return parse_ksm(path)

    def test_preserves_null_name_and_source_hierarchy(self):
        result = self.parse(synthetic_ksm())
        self.assertEqual(result['frames'][0]['name'], 'Root')
        self.assertEqual(result['frames'][1]['source_name'], None)
        self.assertEqual(result['frames'][1]['name'], 'KSM_UnnamedFrame_1')
        self.assertEqual(result['frames'][1]['parent'], 0)
        self.assertEqual(result['unreachable_frames'], [])

    def test_rejects_header_frame_count_bomb(self):
        data = synthetic_ksm(); struct.pack_into('<I', data, 28, 0xffffffff)
        with self.assertRaises(FormatError): self.parse(data)

    def test_rejects_cycle(self):
        data = synthetic_ksm(); struct.pack_into('<i', data, 32 + 84 + 80, 0)
        with self.assertRaises(FormatError): self.parse(data)

    def test_rejects_invalid_name_pointer(self):
        data = synthetic_ksm(); struct.pack_into('<I', data, 32, len(data)+1)
        with self.assertRaises(FormatError): self.parse(data)

    def test_rejects_nonfinite_frame_matrix(self):
        data = synthetic_ksm(); struct.pack_into('<f', data, 36, float('nan'))
        with self.assertRaises(FormatError): self.parse(data)

    def test_rejects_invalid_stored_radius(self):
        for radius in (-1, float('nan')):
            data = synthetic_ksm(); struct.pack_into('<f', data, 100, radius)
            with self.subTest(radius=radius), self.assertRaises(FormatError): self.parse(data)

    def test_rejects_animation_offset_in_frame_table(self):
        data = synthetic_ksm(); struct.pack_into('<I', data, 8, 32)
        with self.assertRaises(FormatError): self.parse(data)

    def test_rejects_truncated_inputs(self):
        for length in (0, 4, 16, 31, 115, 199, 209, 219):
            with self.subTest(length=length), self.assertRaises(FormatError):
                self.parse(synthetic_ksm()[:length])


class SyntheticKacTests(unittest.TestCase):
    def test_raw_keys_and_declared_tick_rate(self):
        clip = parse_kac(synthetic_kac(), 2)[0]
        self.assertEqual(clip['ticks_per_second'], 4800)
        self.assertEqual(clip['tracks'][0]['keys'][0]['translation'], [4,5,6])
        self.assertEqual(clip['tracks'][0]['frame'], 1)

    def test_sparse_keys_carry_components(self):
        track = {'keys': [
            {'time_ticks': 0, 'scale': [1,2,3], 'translation': [4,5,6], 'rotation': [0,0,0,1]},
            {'time_ticks': 2400, 'scale': [None,None,None], 'translation': [None,9,None], 'rotation': None}]}
        expanded = expanded_track(track, 4800)
        self.assertEqual(expanded[1], {'time': .5, 'scale': [1,2,3], 'translation': [4,9,6], 'rotation': [0,0,0,1]})

    def test_rejects_invalid_clip_count(self):
        data = synthetic_kac(); struct.pack_into('<I', data, 8, 0xffffffff)
        with self.assertRaises(FormatError): parse_kac(data, 2)

    def test_rejects_invalid_tick_rate(self):
        for rate in (0, -1, float('nan')):
            data = synthetic_kac(); struct.pack_into('<d', data, 24, rate)
            with self.subTest(rate=rate), self.assertRaises(FormatError): parse_kac(data, 2)

    def test_rejects_invalid_bone_index(self):
        data = synthetic_kac(); struct.pack_into('<I', data, 44, 2)
        with self.assertRaises(FormatError): parse_kac(data, 2)

    def test_rejects_unknown_mask(self):
        data = synthetic_kac(); data[56] = 0xff
        with self.assertRaises(FormatError): parse_kac(data, 2)

    def test_rejects_nonfinite_translation(self):
        data = synthetic_kac(); struct.pack_into('<f', data, 69, float('inf'))
        with self.assertRaises(FormatError): parse_kac(data, 2)


class TemplateLiteralTests(unittest.TestCase):
    def test_only_explicit_numeric_xyz_is_decoded(self):
        self.assertIsNone(parse_template_vector(None))
        self.assertEqual(parse_template_vector('XYZ(1, -2.5, +3e-2)'), [1, -2.5, .03])
        for literal in ('XYZ(1, 2)', 'XYZ(1, 2, DEFAULT)', 'XYZ(0, nan, 1)',
                        'XYZ(1, 2, 1e999)', 'XYZ(1, 2, 3) trailing'):
            with self.subTest(literal=literal), self.assertRaises(ValueError):
                parse_template_vector(literal)


@unittest.skipUnless(os.getenv('ELSWORD_2016_ASSET_ROOT'), 'Set ELSWORD_2016_ASSET_ROOT for actual-sample tests')
class Actual2016Tests(unittest.TestCase):
    def test_vc_effect_with_x_extension_uses_actual_ksm_signature_and_rejects_truncation(self):
        catalog = Catalog(os.environ['ELSWORD_2016_ASSET_ROOT'])
        name = 'NEPHILIM_MagicAttack_03.X'
        source = catalog.path(name)
        self.assertEqual(source.read_bytes()[:4], b'KSM ')
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            result = build_effect(catalog, output, name)
            self.assertTrue(any(output.glob('*.glb')))
            self.assertTrue(any(output.glob('*.pose.json')))
            broken = output / 'truncated.X'
            broken.write_bytes(source.read_bytes()[:32])
            class BrokenCatalog:
                def path(self, unused): return broken
            with self.assertRaises((ValueError, FormatError)):
                build_effect(BrokenCatalog(), output, 'truncated.X')

    def test_rf_four_motion_files(self):
        catalog = Catalog(os.environ['ELSWORD_2016_ASSET_ROOT'])
        expected = {'Motion_Raven.x': 83, 'Motion_Raven_Common.x': 35, 'Motion_Raven_OT.x': 28, 'Motion_Raven_RF.x': 21}
        for name, count in expected.items():
            path = catalog.path(name); data = path.read_bytes(); decoded = parse_ksm(path)
            # Independently read the file header's counts and explicit KAC marker.
            frame_count, = struct.unpack_from('<I', data, 28)
            animation_offset, = struct.unpack_from('<I', data, 8)
            clip_count, = struct.unpack_from('<I', data, animation_offset+8)
            self.assertEqual(data[animation_offset:animation_offset+4], b'KAC ')
            self.assertEqual(len(decoded['frames']), frame_count)
            self.assertEqual(len(decoded['animations']), clip_count)
            self.assertEqual(clip_count, count)
            self.assertEqual(decoded['unreachable_frames'], [])
            self.assertEqual(decoded['frames'][74]['source_name'], None)
            if name == 'Motion_Raven.x':
                # This scalar is present directly in the original KSM frame.
                frame = next(f for f in decoded['frames'] if f['name']=='ATTACK_SPHERE1_Lhand1')
                radius, = struct.unpack_from('<f', data, 32 + 84*frame['index'] + 68)
                self.assertEqual(radius, frame['bounding_radius'])
                self.assertEqual(radius, 51.96151351928711)

    def test_actual_compressed_weapon_and_nasod(self):
        catalog = Catalog(os.environ['ELSWORD_2016_ASSET_ROOT'])
        for name in ('Mesh_Raven_RRF_Cash_Weapon_Sorted.X', 'Motion_Raven_RageMode_Nasod.x'):
            path = catalog.path(name)
            self.assertEqual(path.read_bytes()[:16], b'xof 0303bzip0032')
            tree = load_x(path)
            self.assertTrue(any(n.kind == 'Mesh' for n, _ in walk(tree)))
            self.assertTrue(any(n.kind == 'AnimationSet' for n, _ in walk(tree)))
            with tempfile.TemporaryDirectory() as folder:
                broken = Path(folder)/'broken.x'; broken.write_bytes(path.read_bytes()[:-11])
                with self.assertRaises((ValueError, OSError)): load_x(broken)

    def test_actual_weapon_dummy_template_is_not_a_visible_effect(self):
        catalog = Catalog(os.environ['ELSWORD_2016_ASSET_ROOT'])
        records = selected_templates(catalog, [])
        weapon = next(record for record in records if record['name']=='Raven_WeaponDummy01')
        self.assertEqual(weapon['meshName'], 'DummyAttackBox_50x50x50.X')
        self.assertEqual(weapon['fieldsLiteral']['DrawCount'], '0')
        self.assertEqual(weapon['fieldsLiteral']['Global Initial AniName'], '"Normal", XAP_LOOP')
        self.assertEqual(parse_template_vector(weapon['fieldsLiteral']['Global Initial Size']), [1,1,1])
        self.assertNotIn('Global Initial Velocity', weapon['fieldsLiteral'])
        raw = catalog.path('GameMajorXMeshPlayer.txt').read_bytes()
        self.assertEqual(raw[weapon['sourceByteOffset']:weapon['sourceByteOffset']+len(weapon['definition'])],
                         weapon['definition'].encode('latin1'))
        self.assertNotIn(b'TEMPLET "Raven_WeaponDummy02"', raw)


if __name__ == '__main__':
    unittest.main()
