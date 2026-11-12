"""Actual four original-X keys and malformed evidence; never regenerate gold."""
from pathlib import Path
import copy, hashlib, json, sys, tempfile, unittest

ROOT=Path(__file__).resolve().parents[2]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'tools/assets/character'))
import native_d3dx_keys as decoder
from build_rf import load_x
from directx_animation import decode_animations

class ArcStartNativeKeysTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request=(ROOT/decoder.ARC_START_REQUEST).read_bytes()
        cls.rows=json.loads(cls.request)['sources']
        cls.manifest=json.loads((ROOT/decoder.ARC_START_MANIFEST).read_bytes())
        cls.artifact=(ROOT/cls.manifest['artifact']['path']).read_bytes()
        cls.source=Path(cls.rows[0]['source'])
        cls.parsed=decode_animations(load_x(cls.source),include_native_matrices=True)

    def setUp(self):
        (ROOT/'runtime').mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'runtime',prefix='arc-native-test-')
        self.addCleanup(self.temp.cleanup)
        self.repo=Path(self.temp.name)
        self.manifest=copy.deepcopy(self.__class__.manifest)
        self.artifact=bytearray(self.__class__.artifact)
        path=self.repo/decoder.ARC_START_REQUEST
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(self.request)
        self.save()

    def save(self):
        path=self.repo/self.manifest['artifact']['path']
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(self.artifact)
        target=self.repo/decoder.ARC_START_MANIFEST
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps(self.manifest),'utf8')

    def decode(self):
        return decoder.decode_measured_native_keys(self.source,self.parsed,self.repo)

    def test_actual_four_sources_use_measured_dll_keys(self):
        for row in self.rows:
            path=Path(row['source']);raw=path.read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sourceSha256'])
            parsed=decode_animations(load_x(path),include_native_matrices=True)
            result=decoder.decode_measured_native_keys(path,parsed,ROOT)
            self.assertEqual(result[0]['ticks_per_second'],4800)
            self.assertTrue(result[0]['native_d3dx_keys'])
            self.assertEqual(result[0]['duration_seconds'],row['nativeAnimations'][0]['period'])

    def test_bad_artifact_hash_and_truncation_fail_closed(self):
        for altered in (self.artifact[:-1],b'corrupt native key artifact'):
            self.artifact=altered;self.save()
            with self.assertRaisesRegex(ValueError,'hash/size mismatch'):self.decode()

    def test_bad_manifest_clock_and_missing_registry_fail_closed(self):
        self.manifest['sources'][0]['animations'][0]['ticksPerSecond']=60
        self.save()
        with self.assertRaisesRegex(ValueError,'metadata differs'):self.decode()
        (self.repo/decoder.ARC_START_REQUEST).unlink()
        with self.assertRaisesRegex(ValueError,'registry missing'):self.decode()

if __name__=='__main__':unittest.main()
