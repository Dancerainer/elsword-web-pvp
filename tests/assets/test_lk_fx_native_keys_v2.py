"""46 actual target DLL extractions and damaged source/key evidence; no client run."""
import base64,copy,hashlib,json,struct,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
import native_d3dx_keys as decoder
from build_rf import load_x
from directx_animation import decode_animations
sha=lambda b:hashlib.sha256(b).hexdigest()

class LkNativeKeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.request_bytes=(ROOT/decoder.LK_FX_REQUEST).read_bytes();cls.request=json.loads(cls.request_bytes)
        cls.manifest=json.loads((ROOT/decoder.LK_FX_MANIFEST).read_bytes())
        cls.artifact=(ROOT/cls.manifest['artifact']['path']).read_bytes();cls.native=json.loads(cls.artifact)
    def test_actual_46_sources_preserve_each_float32_group_and_native_clock(self):
        self.assertEqual(len(self.request['sources']),46)
        self.assertEqual(sha(self.request_bytes),decoder.LK_FX_REQUEST_SHA)
        self.assertEqual(sha(self.artifact),self.manifest['artifact']['sha256'])
        self.assertEqual(sha(Path(self.manifest['dll']['path']).read_bytes()),decoder.DLL_SHA)
        for row in self.request['sources']:
            path=Path(row['source']);self.assertEqual(sha(path.read_bytes()),row['sourceSha256'])
            parsed=decode_animations(load_x(path),include_native_matrices=True)
            result=decoder.decode_measured_native_keys(path,parsed)
            native=next(s for s in self.native['sources'] if s['sourceSha256']==row['sourceSha256'])
            for output,gold in zip(result,native['animations']):
                self.assertEqual(output['ticks_per_second'],gold['ticksPerSecond']);self.assertEqual(output['duration_seconds'],gold['period'])
                tracks={t['frame_name']:t for t in output['tracks']}
                for c in gold['channels']:
                    for prop,key,width in [('translation','translationKeys',4),('scale','scaleKeys',4),('rotation','rotationKeys',5)]:
                        channel=tracks[c['name']][prop];actual=bytearray()
                        for tick,values in zip(channel['ticks'],channel['values']):
                            actual.extend(struct.pack('<'+'f'*width,tick,*[-v if prop=='rotation' and i<3 else v for i,v in enumerate(values)]))
                        self.assertEqual(actual,base64.b64decode(c[key]['keyBytesBase64']),path.name+'/'+c['name']+'/'+key)
    def test_damaged_registry_original_mesh_and_keys_fail_closed(self):
        row=self.request['sources'][-1];source=Path(row['source']);parsed=decode_animations(load_x(source),include_native_matrices=True)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);request=root/decoder.LK_FX_REQUEST;request.parent.mkdir(parents=True);request.write_bytes(self.request_bytes)
            manifest=root/decoder.LK_FX_MANIFEST;manifest.write_bytes((ROOT/decoder.LK_FX_MANIFEST).read_bytes())
            artifact=root/self.manifest['artifact']['path'];artifact.parent.mkdir(parents=True);artifact.write_bytes(self.artifact)
            request.write_bytes(self.request_bytes+b' ')
            with self.assertRaisesRegex(ValueError,'registry hash mismatch'):decoder.decode_measured_native_keys(source,parsed,root)
            request.write_bytes(self.request_bytes);bad=root/source.name;bad.write_bytes(source.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decoder.decode_measured_native_keys(bad,parsed,root)
            artifact.write_bytes(self.artifact[:-1])
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decoder.decode_measured_native_keys(source,parsed,root)
            artifact.unlink()
            with self.assertRaisesRegex(ValueError,'artifact missing'):decoder.decode_measured_native_keys(source,parsed,root)

if __name__=='__main__':unittest.main()
