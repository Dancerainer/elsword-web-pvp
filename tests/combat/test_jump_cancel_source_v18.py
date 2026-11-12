import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
SPEC = importlib.util.spec_from_file_location('jump_cancel_v18', ROOT / 'tools/native/check_rf_jump_cancel_source_v18.py')
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)

class JumpSourceV18Test(unittest.TestCase):
    def test_actual_source_spans_unchanged(self):
        cpp, fragments, _ = AUDIT.build_source(ROOT / '.cache/native-source-runtime')
        self.assertEqual(len(fragments), 7)
        for span in fragments:
            body, _, _ = AUDIT.method((ROOT / '.cache/native-source-runtime' / span['file']).read_bytes(), span['method'])
            self.assertIn(body, cpp)
            self.assertEqual(AUDIT.digest(body), span['sha256'])

    def test_independent_compiled_observations(self):
        result = json.loads((ROOT / 'reports/rf-jump-consumer-source-v18.json').read_text(encoding='utf-8'))
        AUDIT.validate_cases(result['cases'])
        self.assertFalse(result['targetClientMeasured'])

    def test_missing_or_truncated_source_is_rejected(self):
        for data in [b'', b'void C::Jump(){if(true){']:
            with self.assertRaises(ValueError):
                AUDIT.method(data, 'Jump')

    def test_changed_expected_case_is_rejected(self):
        result = json.loads((ROOT / 'reports/rf-jump-consumer-source-v18.json').read_text(encoding='utf-8'))
        result['cases'][0]['afterFacing'] = -1
        with self.assertRaises(AssertionError):
            AUDIT.validate_cases(result['cases'])

if __name__ == '__main__':
    unittest.main()
