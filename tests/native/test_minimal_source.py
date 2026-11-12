import importlib.util, os, sys, tempfile, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from build_minimal_runtime import generate,DEVICE,HEADER,GAME,RAVEN
from run_camera_source import extract,sha

class MinimalSource(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=Path(os.environ['ELSWORD_NATIVE_SOURCE_ROOT'])
    def test_actual_source_bodies_are_present_unchanged(self):
        units,contract=generate(self.source)
        self.assertEqual(len(contract['fragments']),15)
        for record in contract['fragments']:
            body,first,last=extract((self.source/record['path']).read_bytes(),record['signature'].encode())
            self.assertEqual(sha(body),record['sha256'])
            self.assertTrue(any(body in unit for unit in units.values()))
    def test_corrupt_and_truncated_source_rejected_before_compilation(self):
        (ROOT/'runtime').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as tmp:
            target=Path(tmp)
            for p in [DEVICE,HEADER,GAME,RAVEN]:
                (target/p).parent.mkdir(parents=True,exist_ok=True)
                (target/p).write_bytes((self.source/p).read_bytes())
            original=(target/DEVICE).read_bytes()
            for bad in [original[:-1],original+b'// drift']:
                (target/DEVICE).write_bytes(bad)
                with self.assertRaisesRegex(ValueError,'Source hash mismatch'):generate(target)

if __name__=='__main__':unittest.main()
