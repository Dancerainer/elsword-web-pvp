"""Authored parser cases plus byte/hash checks against read-only 2016 sources."""
from pathlib import Path
import hashlib
import json
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from build_rf import Catalog
from build_rf_fx import declaration, expression, split_arguments


class EffectDslTests(unittest.TestCase):
    def test_numeric_vectors_and_random_are_data(self):
        self.assertEqual(expression('XYZ(random(-1, 2), 1e-2, +3)'), [{'random': [-1, 2]}, .01, 3])
        self.assertEqual(expression('RGBA(1,0,.5,1)'), [1, 0, .5, 1])
        self.assertEqual(expression('TRUE'), True)
        self.assertEqual(expression('false'), False)
        self.assertEqual(expression('TrUe'), True)
        self.assertEqual(expression('random(0,-90)'), {'random': [0, -90]})
        self.assertEqual(expression('random(.7,.5)'), {'random': [.7, .5]})
        self.assertEqual(expression('D3DBLEND_DESTALPHA'), 'D3DBLEND_DESTALPHA')

    def test_corrupt_and_executable_expressions_are_rejected(self):
        for value in ('XYZ(1,2)', 'XYZ(1,2,TRUE)', 'random("x",1)',
                      'XYZ(RGBA(1,2,3,4),1,2)', '1e999', 'os.execute("erase")', 'nan', 'random(0,1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                expression(value)
        with self.assertRaises(ValueError):
            split_arguments('1,2)')

    def test_events_repeated_children_and_comments_preserve_order(self):
        result = declaration('''Initial Texture = "path//file.dds" // comment
Initial AniName = "Normal", XAP_LOOP
TraceParticleList = "child-one"
TraceParticleList = "child-two"
Fade so From .1 to .3 Color = RGBA(1,0,0,0)
''')
        self.assertEqual(result['unsupported'], [])
        self.assertEqual(result['events'][0]['value'], 'path//file.dds')
        self.assertEqual(result['events'][1]['value'], {'animation': 'Normal', 'playback': 'XAP_LOOP'})
        self.assertEqual(result['repeated']['TraceParticleList'], ['child-one', 'child-two'])
        self.assertEqual(result['events'][2]['start'], .1)
        self.assertEqual(result['events'][2]['end'], .3)

    def test_native_minor_tokens_are_case_insensitive_but_quoted_names_are_not(self):
        result = declaration('''BillboardType = BT_all
particleTYPE = pt_3d_plane
initial texture = "Smoke.MixedCase.dds"
initial aniname = "OriginalClipCase", xap_loop
''', casefold_tokens=True)
        self.assertEqual(result['unsupported'], [])
        self.assertEqual(result['fields']['BillBoardType'], 'BT_ALL')
        self.assertEqual(result['fields']['particleType'], 'PT_3D_PLANE')
        self.assertEqual(result['events'][0]['value'], 'Smoke.MixedCase.dds')
        self.assertEqual(result['events'][1]['value'], {'animation': 'OriginalClipCase', 'playback': 'XAP_LOOP'})
        for value in ('nan', 'NaN', 'INF', 'infinity', 'os.execute("erase")', 'XYZ(1,2)', 'random(0,1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                expression(value, casefold_tokens=True)

    def test_actual_wild_charge_smoke_minor_declaration_preserves_hash_and_fields(self):
        entry = json.loads((ROOT / 'contracts/rf-skill-fx-index-v11.json').read_text('utf-8'))['templates']['SI_SA_RRF_WILD_CHARGE_Smoke']
        catalog = Catalog(Path('asset_work'))
        raw = catalog.path(entry['source']['name']).read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), entry['source']['sha256'])
        match = re.match(r'eventsequence\s+"([^"]+)"\s*\{([^{}]*)\}', raw.decode('latin1')[entry['source']['byteOffset']:])
        self.assertIsNotNone(match)
        self.assertEqual(hashlib.sha256(match[0].encode('latin1')).hexdigest(), entry['declarationSha256'])
        self.assertIn('BT_all', match[2])
        parsed = declaration(match[2], casefold_tokens=True)
        self.assertEqual(parsed['unsupported'], [])
        self.assertEqual(parsed['fields']['BillBoardType'], 'BT_ALL')
        for key in ('fields', 'events', 'repeated', 'unsupported'):
            self.assertEqual(parsed[key], entry[key])

    def test_minor_unknown_symbols_and_wrong_field_types_remain_unsupported(self):
        for text in ('BillboardType = bt_invalid\nNumParticles = garbage',
                     'BillboardType = BT_INVALID\nNumParticles = GARBAGE',
                     'BillboardType = pt_3d_plane\nNumParticles = bt_all',
                     'BillboardType = 1\nNumParticles = "70"'):
            with self.subTest(text=text):
                parsed = declaration(text, casefold_tokens=True)
                self.assertEqual(parsed['fields'], {})
                self.assertEqual(len(parsed['unsupported']), 2)
        for value in ('bt_invalid', 'garbage', 'BT_INVALID', 'GARBAGE'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                expression(value, casefold_tokens=True)
        self.assertEqual(expression('BT_all', casefold_tokens=True), 'BT_ALL')
        self.assertEqual(len(declaration('initial AniName = "OriginalClip", xap_unknown', casefold_tokens=True)['unsupported']), 1)

    def test_unknown_syntax_and_invalid_times_remain_unsupported(self):
        result = declaration('''at 1e999 Size = XYZ(1,1,1)
Fade so From .5 to .1 Color = RGBA(1,1,1,0)
Initial Texture = system("arbitrary")
Initial Size = 5
unexpected statement
''')
        self.assertEqual(len(result['unsupported']), 5)
        self.assertEqual(result['events'], [])
        self.assertEqual(result['fields'], {})

    def test_actual_bounded_declarations_reparse_and_match_recorded_bytes(self):
        catalog = Catalog(Path('asset_work'))
        index = json.loads((ROOT / 'contracts/rf-fx-index.json').read_text('utf-8'))
        raw_cache = {}
        for name in index['templates']:
            with self.subTest(name=name):
                entry = index['templates'][name]
                path = catalog.path(entry['source']['name'])
                if path not in raw_cache:
                    raw_cache[path] = path.read_bytes()
                raw = raw_cache[path]
                self.assertEqual(hashlib.sha256(raw).hexdigest(), entry['source']['sha256'])
                text = raw.decode('latin1')[entry['source']['byteOffset']:]
                match = re.match(r'(?:TEMPLET|eventsequence)\s+"([^"]+)"\s*\{([^{}]*)\}', text)
                self.assertIsNotNone(match)
                self.assertEqual(match[1], name)
                self.assertEqual(hashlib.sha256(match[0].encode('latin1')).hexdigest(), entry['declarationSha256'])
                parsed = declaration(match[2])
                for key in ('fields', 'events', 'repeated', 'unsupported'):
                    self.assertEqual(parsed[key], entry[key])


if __name__ == '__main__':
    unittest.main()
