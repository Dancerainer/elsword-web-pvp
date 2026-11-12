"""The read-only GLB URI inventory rejects truncated or forged containers."""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from audit_twelve_profession_runtime import glb_external_uris

class RuntimeUriAudit(unittest.TestCase):
    def sample(self):
        payload=json.dumps({'images':[{'uri':'../textures/Smoke.png'},{'bufferView':0},{'uri':'data:image/png;base64,AA=='}],'buffers':[{'uri':'external.bin'}]}).encode()
        payload+=b' '*((-len(payload))%4)
        return struct.pack('<5I',0x46546c67,2,len(payload)+20,len(payload),0x4e4f534a)+payload
    def test_external_and_embedded_image_forms(self):
        with tempfile.TemporaryDirectory()as directory:
            path=Path(directory)/'mesh.glb';path.write_bytes(self.sample())
            self.assertEqual(glb_external_uris(path),['../textures/Smoke.png','external.bin'])
    def test_corrupt_header_length_and_json_are_rejected(self):
        valid=self.sample()
        broken=[valid[:19],valid[:-1],b'BAD!'+valid[4:],valid[:12]+struct.pack('<I',2**31)+valid[16:],valid[:20]+b'!'+valid[21:]]
        with tempfile.TemporaryDirectory()as directory:
            path=Path(directory)/'mesh.glb'
            for data in broken:
                with self.subTest(data=data[:20]):
                    path.write_bytes(data)
                    with self.assertRaises(ValueError):glb_external_uris(path)
if __name__=='__main__':unittest.main()
