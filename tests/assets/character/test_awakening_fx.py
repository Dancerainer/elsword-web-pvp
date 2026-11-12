"""Actual target bytes/pixels and corrupt Final syntax; no synthetic golden PvP."""
from pathlib import Path
import hashlib
import json
import re
import sys
import unittest
from PIL import Image
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/assets/character'))
from build_rf import Catalog
from build_rf_fx import declaration


class AwakeningFxTests(unittest.TestCase):
    def test_actual_minor_declarations_reparse_with_source_hash_and_native_final_endpoint(self):
        index = json.loads((ROOT / 'contracts/rf-awakening-fx-index.json').read_text('utf-8'))
        catalog = Catalog(Path('asset_work'))
        for name, t in index['templates'].items():
            raw = catalog.path(t['source']['name']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), t['source']['sha256'])
            source = raw.decode('latin1')[t['source']['byteOffset']:]
            match = re.match(r'eventsequence\s+"([^"]+)"\s*\{([^{}]*)\}', source)
            self.assertEqual(match[1], name)
            self.assertEqual(hashlib.sha256(match[0].encode('latin1')).hexdigest(), t['declarationSha256'])
            parsed = declaration(match[2], casefold_tokens=True)
            for field in ('fields', 'events', 'repeated', 'unsupported'):
                self.assertEqual(parsed[field], t[field])
            final = [e for e in parsed['events'] if e['property']=='Size' and e['fade']][0]
            self.assertEqual((final['start'], final['end'], final['value']), (0, .2, [128,40,1]))
            self.assertEqual(parsed['unsupported'], [])

    def test_original_energy_pixels_and_all_task_output_hashes_match(self):
        report = json.loads((ROOT / 'reports/rf-awakening-fx-v8.json').read_text('utf-8'))
        for output in report['outputInventory']:
            data = (ROOT / output['path']).read_bytes()
            self.assertEqual(len(data), output['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), output['sha256'])
        index = json.loads((ROOT / 'contracts/rf-awakening-fx-index.json').read_text('utf-8'))
        t = index['templates']['HyperBoostRightBlack']['textures']['Energy.dds']
        catalog = Catalog(Path('asset_work'))
        source = Image.open(catalog.path('Energy.dds')).convert('RGBA')
        png = Image.open(ROOT / 'artifacts/rf' / t['file']).convert('RGBA')
        self.assertEqual(source.size, png.size);self.assertEqual(source.tobytes(), png.tobytes())

    def test_final_fade_rejects_missing_corrupt_lifetime_and_invalid_vectors(self):
        cases = ['fade so final size = XYZ(1,1,1)',
            'lifetime=-1\nfade so final size = XYZ(1,1,1)',
            'lifetime=1e999\nfade so final size = XYZ(1,1,1)',
            'lifetime=.2\nfade so final size = XYZ(1,2)',
            'lifetime=.2\nfade so final size = os.execute("erase")']
        for body in cases:
            with self.subTest(body=body):
                result = declaration(body, casefold_tokens=True)
                self.assertTrue(result['unsupported']);self.assertEqual(result['events'], [])
        result=declaration('lifetime=random(.1,.3)\nfade so final size=XYZ(1,1,1)',casefold_tokens=True)
        self.assertEqual(result['events'][0]['end'],.3,'Native final uses declared maximum, not sampled particle lifetime')


if __name__ == '__main__':
    unittest.main()
