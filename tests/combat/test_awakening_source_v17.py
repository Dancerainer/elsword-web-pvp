"""Fail-closed extraction fixture tests; original source execution is separate."""
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
from check_rf_awakening_source_v17 import method


class AwakeningMethodExtraction(unittest.TestCase):
    def test_whole_unchanged_method_and_lines(self):
        body = b'int Unit::Time()\n{\n  if (true) { return 30; }\n  return 0;\n}'
        data = b'// preceding\n' + body + b'\n// trailing\n'
        extracted, first, last = method(data, 'Unit::Time()')
        self.assertEqual(extracted, body)
        self.assertEqual((first, last), (2, 6))

    def test_missing_ambiguous_or_truncated_method_rejected(self):
        for data in [b'int Other() {}', b'int Unit::Time() {}\nint Unit::Time() {}', b'int Unit::Time() { if(true) { }']:
            with self.subTest(data=data), self.assertRaises(ValueError):
                method(data, 'Unit::Time()')


if __name__ == '__main__':
    unittest.main()
