from pathlib import Path
import hashlib,json,re,struct,sys,unittest
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog
from build_rf_fx import declaration
from build_critical_fx import inspect_wave

class CriticalFxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=Catalog(Path('asset_work'))
        cls.index=json.loads((ROOT/'contracts/rf-critical-fx-index-v11.json').read_text('utf-8'))

    def test_actual_original_declaration_pixels_and_wave_copy(self):
        t=self.index['templates']['CriticalHit01'];raw=self.catalog.path(t['source']['name']).read_bytes()
        text=raw.decode('latin1')[t['source']['byteOffset']:]
        m=re.match(r'eventsequence\s+"CriticalHit01"\s*\{([^{}]*)\}',text)
        self.assertEqual(hashlib.sha256(m[0].encode('latin1')).hexdigest(),t['declarationSha256'])
        parsed=declaration(m[1])
        for field in ('fields','events','repeated','unsupported'):self.assertEqual(parsed[field],t[field])
        self.assertEqual(t['fields']['TriggerCount'],1);self.assertEqual(t['fields']['Lifetime'],.5)
        for name,texture in t['textures'].items():
            a=Image.open(self.catalog.path(name)).convert('RGBA');b=Image.open(ROOT/'artifacts/rf'/texture['file']).convert('RGBA')
            self.assertEqual(a.size,b.size);self.assertEqual(a.tobytes(),b.tobytes())
        audio=self.index['audio'];wave=self.catalog.path(audio['name']).read_bytes()
        self.assertEqual((ROOT/'artifacts/rf'/audio['file']).read_bytes(),wave)
        self.assertEqual(hashlib.sha256(wave).hexdigest(),audio['sha256'])
        self.assertEqual(inspect_wave(wave),audio['format'])

    def test_actual_wave_damage_and_format_corruption_rejected(self):
        source=self.catalog.path('Critical_Hit.wav').read_bytes()
        for size in (0,4,11,len(source)-1):
            with self.subTest(size=size),self.assertRaises(ValueError):inspect_wave(source[:size])
        for offset,value in [(0,b'XXXX'),(4,struct.pack('<I',len(source))), (8,b'OGGS'),(16,struct.pack('<I',len(source)*2))]:
            damaged=bytearray(source);damaged[offset:offset+len(value)]=value
            with self.subTest(offset=offset),self.assertRaises(ValueError):inspect_wave(bytes(damaged))
        damaged=bytearray(source);fmt=damaged.index(b'fmt ')+8;struct.pack_into('<H',damaged,fmt,999)
        with self.assertRaisesRegex(ValueError,'PCM'):inspect_wave(bytes(damaged))

if __name__=='__main__':unittest.main()
