"""Real pinned-source extraction must not relabel an older compiled publication."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
BUILDER=ROOT/'tools/native/build_command_recovery.py'


class RecoveryExtractionProvenanceTests(unittest.TestCase):
    def extract(self,directory):
        run=subprocess.run([sys.executable,str(BUILDER),'--extract-only','--out-dir',str(directory)],
            capture_output=True,text=True,cwd=ROOT)
        self.assertEqual(run.returncode,0,run.stdout+run.stderr)
        return json.loads(run.stdout)

    def test_extraction_preserves_every_published_byte_and_has_no_compiler_claim(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='recovery-provenance-') as name:
            directory=Path(name)
            original={'source-contract.json':b'{"wasm":{"sha256":"older-module"},"compiler":{"version":"older-compiler"}}\n',
                'commands-recovery.generated.cpp':b'// prior compiled unit\r\n',
                'commands-recovery.wasm':b'\x00asm\x01\x00\x00\x00'}
            for file,data in original.items():(directory/file).write_bytes(data)
            output=self.extract(directory)
            for file,data in original.items():self.assertEqual((directory/file).read_bytes(),data,file)
            extracted=json.loads((directory/'extraction-contract.json').read_text('utf8'))
            self.assertEqual(extracted['compilationStatus'],'not-compiled')
            self.assertEqual(output['compilationStatus'],'not-compiled')
            for key in ('wasm','compiler','compilation'):self.assertNotIn(key,extracted)
            cpp=(directory/extracted['extractedCppFile']).read_bytes()
            self.assertNotIn(b'\r\n',cpp)
            self.assertEqual(hashlib.sha256(cpp).hexdigest(),extracted['generatedCppSha256'])
            authority=json.loads((ROOT/'contracts/rf-combo-recovery-source-v11.json').read_text('utf8'))
            self.assertEqual(extracted['sourceSha256'],authority['sourceSha256'])
            self.assertEqual(extracted['functions'],authority['functions'])

    def test_fresh_extraction_never_creates_compiled_publication(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.cache',prefix='recovery-uncompiled-') as name:
            directory=Path(name);self.extract(directory)
            for file in ('source-contract.json','commands-recovery.generated.cpp','commands-recovery.wasm'):
                self.assertFalse((directory/file).exists(),file)

    def test_omitting_compiler_without_extract_only_is_a_usage_error(self):
        run=subprocess.run([sys.executable,str(BUILDER)],capture_output=True,text=True,cwd=ROOT)
        self.assertEqual(run.returncode,2)
        self.assertIn('--zig is required',run.stderr)


if __name__=='__main__':unittest.main()
