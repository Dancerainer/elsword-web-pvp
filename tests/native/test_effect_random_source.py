"""Actual pinned source and corrupt-input checks; generated source stays ignored."""
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from build_effect_random import original_functions

CONTRACT=json.loads((ROOT/'contracts/rf-native-effect-random.json').read_text('utf-8'))
CACHE=Path(os.environ.get('RF_EFFECT_RANDOM_SOURCE_CACHE',ROOT/'.cache/native-effect-random-source'))

class EffectRandomSourceTests(unittest.TestCase):
    def test_actual_bodies_are_preserved(self):
        combined=original_functions(CACHE,CONTRACT)
        source=(CACHE/'KTDXLIB/MinMax.cpp').read_bytes()
        for entry in CONTRACT['extractions']:
            self.assertIn(entry['signature'].encode(),combined)
        self.assertIn(source[source.index(b'int RandomNumber'):].split(b'float RandomNumber')[0].rstrip(),combined)
        self.assertIn(source[source.index(b'float RandomNumber'):].rstrip(),combined)

    def test_modified_body_or_header_is_rejected(self):
        for name in ['MinMax.h','MinMax.cpp']:
            with tempfile.TemporaryDirectory() as temporary:
                cache=Path(temporary);(cache/'KTDXLIB').mkdir()
                for filename in ['MinMax.h','MinMax.cpp']:
                    body=(CACHE/'KTDXLIB'/filename).read_bytes()
                    if filename==name:body+=b'\n// changed\n'
                    (cache/'KTDXLIB'/filename).write_bytes(body)
                with self.assertRaisesRegex(ValueError,'Source hash mismatch'):
                    original_functions(cache,CONTRACT)

    def test_missing_source_and_changed_extraction_or_macro_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(FileNotFoundError):original_functions(Path(temporary),CONTRACT)
        contract=copy.deepcopy(CONTRACT);contract['extractions'][0]['sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'Original RandomNumber bytes changed'):
            original_functions(CACHE,contract)
        contract=copy.deepcopy(CONTRACT);contract['macros']['RAND_MAX']=2147483647
        with self.assertRaisesRegex(ValueError,'Windows rand ABI changed'):
            original_functions(CACHE,contract)

if __name__=='__main__':unittest.main()
