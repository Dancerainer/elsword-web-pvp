import importlib.util,struct,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('common',ROOT/'tools/assets/build-common-presentation-v28.py')
common=importlib.util.module_from_spec(spec);spec.loader.exec_module(common)
class OriginalHeader(unittest.TestCase):
    def test_actual_original_headers(self):
        for filename,center in [('Motion_Raven.x',[7.840678691864014,98.48628234863281,-11.275622367858887]),
                                ('Motion_Elsword.x',[-3.96160888671875,76.36903381347656,-6.137977600097656])]:
            b=(common.RAW/'data/data033.kom'/filename).read_bytes()
            self.assertEqual(common.read_motion_center(b)['center'],center)
    def test_corrupt_header_and_nonfinite_center_rejected(self):
        original=(common.RAW/'data/data033.kom/Motion_Raven.x').read_bytes()
        candidates=[original[:31],b'BAD!'+original[4:]]
        for offset,value,fmt in [(4,0x201,'<I'),(12,float('nan'),'<f'),(16,float('inf'),'<f'),(24,-1,'<f'),(28,4097,'<I'),(28,0,'<I')]:
            b=bytearray(original);struct.pack_into(fmt,b,offset,value);candidates.append(b)
        for b in candidates:
            with self.subTest(header=bytes(b[:32]).hex()),self.assertRaises(ValueError):common.read_motion_center(b)
if __name__=='__main__':unittest.main()
