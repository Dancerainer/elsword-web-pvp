import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('direction_v16', ROOT / 'tools/native/check_rf_direction_source_v16.py')
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class DirectionSourceV16Test(unittest.TestCase):
    def test_actual_pinned_consumers(self):
        for path, names in AUDIT.METHODS.items():
            data = (ROOT / '.cache/native-source-runtime' / path).read_bytes()
            self.assertEqual(AUDIT.digest(data), AUDIT.HASHES[path])
            for name in names:
                body, first, last = AUDIT.method(data, name)
                self.assertTrue(body.startswith(b'void '))
                self.assertTrue(body.endswith(b'}'))
                self.assertLess(first, last)

    def test_missing_or_ambiguous_rejected(self):
        declaration = b'void C::Jump(){return;}\n'
        for data in (b'', declaration + declaration):
            with self.assertRaisesRegex(ValueError, 'Missing or ambiguous'):
                AUDIT.method(data, 'Jump')

    def test_truncated_body_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Truncated'):
            AUDIT.method(b'void C::Jump(){if(true){', 'Jump')


if __name__ == '__main__':
    unittest.main()
