"""Three actual original-DLL models; damaged provenance must fail closed."""
import copy,hashlib,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
import native_d3dx_keys as decoder
from build_rf import load_x
from directx_animation import decode_animations
REQUEST='reports/player-feedback-d3dx-sources-v30.json'
MANIFEST='reports/player-feedback-d3dx-keyframes-v30.json'
class BloodCutterKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request=(ROOT/REQUEST).read_bytes();cls.rows=json.loads(cls.request)['sources']
        cls.manifest=(ROOT/MANIFEST).read_bytes();cls.m=json.loads(cls.manifest)
        cls.artifact=(ROOT/cls.m['artifact']['path']).read_bytes()
    def test_three_original_models_preserve_measured_clock_and_keys(self):
        self.assertEqual(len(self.rows),3)
        for row in self.rows:
            path=Path(row['source']);self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),row['sourceSha256'])
            parsed=decode_animations(load_x(path),include_native_matrices=True)
            output=decoder.decode_measured_native_keys(path,parsed)
            for clip,native in zip(output,row['nativeAnimations']):
                self.assertTrue(clip['native_d3dx_keys']);self.assertEqual(clip['ticks_per_second'],native['ticksPerSecond'])
                self.assertEqual(clip['duration_seconds'],native['period']);self.assertTrue(clip['tracks'])
    def test_changed_source_registry_and_missing_or_corrupt_keys_are_rejected(self):
        row=self.rows[0];source=Path(row['source']);parsed=decode_animations(load_x(source),include_native_matrices=True)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);request=root/REQUEST;request.parent.mkdir(parents=True);request.write_bytes(self.request)
            (root/MANIFEST).write_bytes(self.manifest);artifact=root/self.m['artifact']['path'];artifact.parent.mkdir(parents=True);artifact.write_bytes(self.artifact)
            request.write_bytes(self.request+b' ')
            with self.assertRaisesRegex(ValueError,'registry hash mismatch'):decoder.decode_measured_native_keys(source,parsed,root)
            request.write_bytes(self.request);bad=root/source.name;bad.write_bytes(source.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decoder.decode_measured_native_keys(bad,parsed,root)
            artifact.write_bytes(self.artifact[:-1])
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decoder.decode_measured_native_keys(source,parsed,root)
            artifact.unlink()
            with self.assertRaisesRegex(ValueError,'artifact missing'):decoder.decode_measured_native_keys(source,parsed,root)
if __name__=='__main__':unittest.main()
