"""Exercise the actual publisher guard against reference and target catalogs."""
import json
from pathlib import Path
import tempfile
import textwrap
import unittest

ROOT=Path(__file__).resolve().parents[2]
source=(ROOT/'scripts/publish-client-updates.py').read_text(encoding='utf-8')
start=source.index('        if target.exists():')
GUARD=compile(textwrap.dedent(source[start:source.index('        else:',start)]),'<actual publisher registry guard>','exec')

class RegistryReferences(unittest.TestCase):
 def check_catalog(self,staged,registered,current):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);folder=root/'stage'/('a'*64);target=root/'registered'
   folder.mkdir(parents=True);target.mkdir()
   (folder/'catalog.json').write_text(json.dumps(staged,separators=(',',':')))
   original=json.dumps(registered,indent=2).encode();(target/'catalog.json').write_bytes(original)
   namespace={'folder':folder,'target':target,'catalog':staged,'manifest':staged['manifest'],'pointer':{'releaseId':current},'json':json}
   try:exec(GUARD,namespace)
   finally:self.assertEqual((target/'catalog.json').read_bytes(),original,'registered bytes must never be rewritten')
 def catalog(self):
  return {'schemaVersion':1,'releaseId':'a'*64,'manifest':{'schemaVersion':1,'files':{'dist/game.js':'1'*64}}}
 def test_registered_base_reference_preserves_historic_metadata(self):
  staged=self.catalog();registered={**staged,'transport':{'dist/game.js':{'gzipBytes':20}}}
  self.check_catalog(staged,registered,'b'*64)
 def test_current_target_requires_exact_bytes(self):
  with self.assertRaisesRegex(RuntimeError,'Immutable'):
   self.check_catalog(self.catalog(),self.catalog(),'a'*64)
 def test_base_reference_cannot_change_file_hashes(self):
  staged=self.catalog();registered={**staged,'manifest':{'schemaVersion':1,'files':{'dist/game.js':'2'*64}}}
  with self.assertRaisesRegex(RuntimeError,'Immutable'):self.check_catalog(staged,registered,'b'*64)
 def test_base_reference_cannot_alias_another_release(self):
  staged=self.catalog();registered={**staged,'releaseId':'c'*64}
  with self.assertRaisesRegex(RuntimeError,'Immutable'):self.check_catalog(staged,registered,'b'*64)
 def test_transport_changes_are_not_manifest_references(self):
  staged={**self.catalog(),'transport':{'dist/game.js':{'gzipBytes':20}}}
  registered={**staged,'transport':{'dist/game.js':{'gzipBytes':21}}}
  with self.assertRaisesRegex(RuntimeError,'Immutable'):self.check_catalog(staged,registered,'b'*64)

if __name__=='__main__':unittest.main()
