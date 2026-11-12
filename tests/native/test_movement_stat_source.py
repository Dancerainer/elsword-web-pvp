"""Actual pinned source and damaged-input checks for the bounded probe."""
from pathlib import Path
import os
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from check_movement_stat_source import original_method


class MovementStatSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source=Path(os.environ.get('RF_NATIVE_MOVEMENT_SOURCE',ROOT/'.cache/native-reference/X2Lib/X2BuffTemplet.h'))
        cls.data=source.read_bytes()

    def test_actual_pinned_method_boundary(self):
        method=original_method(self.data)
        self.assertTrue(method.startswith(b'template<typename Func>'))
        self.assertIn(b'fMultiplier *= fModifier_;',method)
        self.assertNotIn(b'void CX2AdditionalStatByBuff::CheckAndUpdate',method)

    def test_modified_velocity_formula_rejected(self):
        broken=self.data.replace(b'fMultiplier *= fModifier_;',b'fMultiplier *= 1.0f;',1)
        with self.assertRaisesRegex(ValueError,'source hash mismatch'):
            original_method(broken)

    def test_truncated_source_rejected(self):
        with self.assertRaisesRegex(ValueError,'source hash mismatch'):
            original_method(self.data[:500])


if __name__=='__main__':
    unittest.main()
