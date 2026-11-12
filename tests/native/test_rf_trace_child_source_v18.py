import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('trace_probe', ROOT / 'tools/native/check_rf_trace_child_source_v18.py')
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)
SOURCE = ROOT / '.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp'


class TraceSourcePinTests(unittest.TestCase):
    def test_original_ranges_extract_without_replacing_original_creation(self):
        axis, block = PROBE.original_fragments(SOURCE)
        self.assertIn('INIT_VECTOR3( m_AxisAngleDegree, 0.0f, 0.0f, 0.0f )', axis)
        self.assertEqual(block.count('CreateSequence('), 1)
        self.assertIn('GIANT_UNIT_GIANT_EFFECT_TEST', block)
        self.assertIn('PARTICLE_NOTAPPLY_UNITSCALE', block)

    def test_source_truncation_and_changed_override_are_rejected(self):
        original = SOURCE.read_bytes()
        corrupted = [original[:-1], original.replace(b'NULL, m_TraceSeqNameList[i].c_str()',
                                                    b'this, m_TraceSeqNameList[i].c_str()', 1)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ParticleSystem.cpp'
            for data in corrupted:
                path.write_bytes(data)
                with self.assertRaisesRegex(ValueError, 'source SHA256 mismatch'):
                    PROBE.original_fragments(path)


if __name__ == '__main__':
    unittest.main()
