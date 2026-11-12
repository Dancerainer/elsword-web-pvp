"""Independent tiny PE inputs verify the bounded static reader, not original gameplay."""
import importlib.util
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('clock_pe', ROOT / 'tools/combat/audit_rf_clock_pe_v16.py')
clock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(clock)


def sample():
    raw = bytearray(0x400)
    raw[:2] = b'MZ'
    struct.pack_into('<I', raw, 60, 0x80)
    raw[0x80:0x84] = b'PE\0\0'
    struct.pack_into('<HH', raw, 0x84, 0x14c, 1)
    struct.pack_into('<H', raw, 0x94, 0xe0)
    struct.pack_into('<H', raw, 0x98, 0x10b)
    struct.pack_into('<I', raw, 0xa8, 0x1000)
    struct.pack_into('<I', raw, 0xb4, 0x400000)
    struct.pack_into('<I', raw, 0xd0, 0x2000)
    raw[0x178:0x180] = b'.text\0\0\0'
    struct.pack_into('<IIII', raw, 0x180, 0x200, 0x1000, 0x200, 0x200)
    struct.pack_into('<I', raw, 0x19c, 0x60000020)
    struct.pack_into('<f', raw, 0x220, 85.)
    struct.pack_into('<I', raw, 0x250, 0x401020)
    return bytes(raw)


class ClockPeTests(unittest.TestCase):
    def test_maps_numeric_bytes_and_preferred_va_occurrence_without_semantic_claim(self):
        raw = sample()
        layout = clock.pe_layout(raw)
        evidence = clock.pattern_evidence(raw, layout, '85', '<f', 85.)
        self.assertEqual(evidence['wholeFileByteOccurrencesCount'], 1)
        self.assertEqual(evidence['rows'][0]['preferredImageVa'], 0x401020)
        self.assertEqual(evidence['rows'][0]['absoluteAddressByteOccurrences'], [0x250])
        self.assertEqual(layout['entrySectionIndex'], 0)

    def test_rejects_truncated_and_out_of_file_section_inputs(self):
        for raw in [b'MZ', sample()[:0x180], sample()[:0x300]]:
            with self.assertRaises(ValueError):
                clock.pe_layout(raw)

    def test_rejects_virtual_section_outside_image(self):
        raw = bytearray(sample())
        struct.pack_into('<I', raw, 0x180, 0x9000)
        with self.assertRaises(ValueError):
            clock.pe_layout(raw)


if __name__ == '__main__':
    unittest.main()
