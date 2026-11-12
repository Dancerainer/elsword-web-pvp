import importlib.util,struct,tempfile,unittest
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('toon_builder',root/'tools/assets/build-character-toon-v27.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class CharacterRampParser(unittest.TestCase):
    def blob(self):
        data=bytearray(62);data[:2]=b'BM';struct.pack_into('<I',data,10,54)
        struct.pack_into('<IiiHHI',data,14,40,2,1,1,24,0)
        data[54:60]=bytes([11,22,33,44,55,66]);return data
    def parse(self,data):
        with tempfile.TemporaryDirectory(prefix='toon-v27-') as directory:
            file=Path(directory)/'tiny.bmp';file.write_bytes(data);return builder.read_ramp(file)
    def test_independent_bgr_sample(self):
        self.assertEqual(self.parse(self.blob())['rgba'],[33,22,11,255,66,55,44,255])
    def test_invalid_signature(self):
        data=self.blob();data[:2]=b'ZZ'
        with self.assertRaises(ValueError):self.parse(data)
    def test_truncated_pixels(self):
        with self.assertRaises(ValueError):self.parse(self.blob()[:59])
    def test_invalid_offset(self):
        data=self.blob();struct.pack_into('<I',data,10,1000)
        with self.assertRaises(ValueError):self.parse(data)
    def test_unsupported_pixel_format(self):
        data=self.blob();struct.pack_into('<H',data,28,16)
        with self.assertRaises(ValueError):self.parse(data)
    def test_compressed_input(self):
        data=self.blob();struct.pack_into('<I',data,30,1)
        with self.assertRaises(ValueError):self.parse(data)
    def test_invalid_dimensions(self):
        for width,height in [(-1,1),(0,1),(2,2),(2,0)]:
            with self.subTest(width=width,height=height):
                data=self.blob();struct.pack_into('<ii',data,18,width,height)
                with self.assertRaises(ValueError):self.parse(data)
    def test_invalid_planes(self):
        data=self.blob();struct.pack_into('<H',data,26,2)
        with self.assertRaises(ValueError):self.parse(data)
if __name__=='__main__':unittest.main()
