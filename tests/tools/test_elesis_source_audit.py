"""Authored legal parser samples; never a copied client fixture."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path(__file__).resolve().parents[2]/'tools/combat/audit_elesis_source.py')
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
class SourceAudit(unittest.TestCase):
 def test_lines_braces_and_literals(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'sample.cpp';out=Path(d)/'out.json'
   p.write_bytes(b'// authored fixture\r\n\r\nvoid CX2GUEL::Example()\r\n{\r\n // ignored } 2026\r\n auto resource=L"EffectSet_authored"; /* { */\r\n}\r\n')
   audit.build(p,out);r=json.loads(out.read_text())['methods'][0]
   self.assertEqual((r['line'],r['lastLine']),(3,7));self.assertEqual(r['literalResources'],['EffectSet_authored']);self.assertTrue(r['contains2026'])
 def test_broken_body_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'sample.cpp';p.write_text('void CX2GUEL::Broken(){')
   with self.assertRaisesRegex(ValueError,'Unclosed'):audit.build(p,Path(d)/'out.json')
if __name__=='__main__':unittest.main()
