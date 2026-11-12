"""Audit-reader bounds tests; source samples stay outside Git and read-only."""
import importlib.util
from pathlib import Path
import struct
import sys
import unittest
import zlib

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stardust_audit', ROOT/'tools/assets/audit_de_stardust_sources.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def packed_x(body):
    compressor = zlib.compressobj(wbits=-15)
    packed = compressor.compress(body) + compressor.flush()
    return b'xof 0303tzip0032' + struct.pack('<IHH', len(body)+16, len(body), len(packed)+2) + b'CK' + packed


def named_kac(name):
    text = name.encode('utf8')
    return struct.pack('<4sIII', b'KAC ', 0x100, 1, 16) + struct.pack('<IIdII', 40, 0, 4800, 1, 0) + struct.pack('<I', len(text)) + text


class AuditReaderTests(unittest.TestCase):
    def test_expands_names_inside_valid_mszip(self):
        body = b'AnimationSet SI_SA_ATT_STARDUST_SHOWER_END {}'
        self.assertEqual(audit.expand_x(packed_x(body)), b'xof 0303txt 0032'+body)

    def test_rejects_truncated_corrupt_or_wrong_sized_mszip(self):
        packed = packed_x(b'AnimationSet Original {}')
        for sample in [packed[:-1], packed[:24]+b'NO'+packed[26:], packed[:16]+struct.pack('<I',999)+packed[20:],
                       packed[:26]+b'\xff'*len(packed[26:])]:
            with self.subTest(sample=sample[:30]):
                with self.assertRaises((ValueError,zlib.error)): audit.expand_x(sample)

    def test_reads_declared_kac_name_without_suffix_aliasing(self):
        name = 'SI_SA_ATT_STARDUST_SHOWER'
        self.assertEqual(audit.kac_names(named_kac(name))[0]['name'], name)
        self.assertNotEqual(audit.kac_names(named_kac(name))[0]['name'], name+'_LOOP')

    def test_rejects_kac_pointers_and_lengths_outside_payload(self):
        original = named_kac('Original')
        for offset in (12,16,40):
            sample = bytearray(original); struct.pack_into('<I',sample,offset,0xFFFFFFFF)
            with self.subTest(offset=offset):
                with self.assertRaises(ValueError): audit.kac_names(sample)
        with self.assertRaises(ValueError): audit.kac_names(b'KSM '+struct.pack('<II',0x200,999)+b'\0'*20)

    @unittest.skipUnless(Path('asset_sources/client/data/data033.kom').exists(), 'Original read-only source not installed')
    def test_actual_target_tt_package_has_start_but_no_loop_end_or_memo_end(self):
        kom = audit.reader()
        with Path('asset_sources/client/data/data033.kom').open('rb') as stream:
            entries, _ = kom.index(stream)
            entry = next(e for e in entries if e['Name'].lower() == 'motion_add_tt.x')
            stream.seek(entry['offset']); raw = kom.unpack(entry,stream.read(int(entry['CompressedSize'])))
        names = {r['name'] for r in audit.kac_names(raw)}
        self.assertIn('SI_SA_ATT_STARDUST_SHOWER',names)
        self.assertTrue(all('SI_SA_ATT_STARDUST_SHOWER_'+suffix not in names for suffix in ('LOOP','END','MEMO_END')))


if __name__ == '__main__': unittest.main()
