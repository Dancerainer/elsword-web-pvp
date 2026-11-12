"""Actual 2016 source bytes and corrupt-reference rejection, not web goldens."""
import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cast_builder',ROOT/'tools/assets/build_cast_display.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class CastSourceTest(unittest.TestCase):
 def test_actual_resource_and_reference_hashes(self):
  index=json.loads((ROOT/'contracts/cast-display-index-v1.json').read_text(encoding='utf-8'))
  for row in index['sourceFiles']:
   raw=(Path('asset_work')/row['rawPath']).read_bytes()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sha256'])
  for name,row in index['references'].items():
   raw=(ROOT/'.cache/battle-cast-source'/name).read_bytes()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sha256'])
  text=(ROOT/'.cache/battle-cast-source/X2GUUser.cpp').read_bytes().decode('latin1')
  block=text[text.index('void CX2GUUser::ActiveSkillShow( D3DXVECTOR3'):]
  self.assertIn('#if 0',block[:block.index('L"SpecialEnergyCenter"')])
 def test_corrupt_reference_fails_before_resource_output(self):
  with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as directory:
   reference=Path(directory);(reference/'X2GUUser.cpp').write_bytes(b'corrupt source')
   with self.assertRaisesRegex(ValueError,'Frozen reference hash differs'):
    builder.build('asset_work',reference,ROOT/'artifacts/cast-test-must-not-exist')
   self.assertFalse((ROOT/'artifacts/cast-test-must-not-exist').exists())
 def test_original_vorbis_samples_determine_announcement_duration(self):
  import struct
  contract=json.loads((ROOT/'contracts/rf-pvp-audio-assets-v1.json').read_text())
  for row in contract['files']:
   raw=(Path('asset_work/raw')/row['source']).read_bytes()
   self.assertEqual(hashlib.sha256(raw).hexdigest(),row['sha256'])
   rate=struct.unpack_from('<I',raw,raw.index(b'\x01vorbis')+12)[0]
   last=raw.rfind(b'OggS');samples=struct.unpack_from('<Q',raw,last+6)[0]
   self.assertEqual(samples/rate,row['durationSeconds'])
if __name__=='__main__':unittest.main()
