import json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'tools/assets'))
import stage_add_common_buff_baseline as tool

class CopyPlan(unittest.TestCase):
    def test_visual_contract_may_be_merged_before_resources_but_metadata_is_exact(self):
        base={'ordinary':{'pose':'old'},'add':{'pose':'legacy-path'}}
        delta={'effectTemplates':{'add':{'pose':'add-fx/final-path'}}}
        before={'ordinary':{'pose':'old'}};after={**before,**delta['effectTemplates']}
        self.assertEqual(tool.frozen_baseline_templates(before,base,delta),before)
        self.assertEqual(tool.frozen_baseline_templates(after,base,delta),before)
        for corrupt in ({'ordinary':{'pose':'changed'}},{**after,'add':{'pose':'foreign'}},{**after,'unknown':{}}):
            with self.assertRaisesRegex(ValueError,'metadata differs'):tool.frozen_baseline_templates(corrupt,base,delta)

    def fixture(self,root):
        prepared=root/'prepared';destination=root/'target';destination.mkdir()
        files=['artifacts/common-buffs/fx/index.json','artifacts/ui/buffs/icons/stigma.png']
        rows=[]
        for i,file in enumerate(files):
            path=prepared/'stage'/file;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(bytes([i,3,6]))
            rows.append({**tool.record(path,file),'previousSha256':None})
        tool.inc.write_json(prepared/'copy-receipt.json',{'destination':str(destination.resolve()),'readOnlyInputs':[str(root/'baseline')],'outputs':rows})
        return prepared,destination,files

    def test_copy_is_idempotent_and_keeps_unlisted_target_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared,destination,files=self.fixture(Path(tmp));(destination/'keep.bin').write_bytes(b'old')
            self.assertEqual(tool.apply(prepared,destination),2);self.assertEqual(tool.apply(prepared,destination),0)
            self.assertEqual((destination/'keep.bin').read_bytes(),b'old')
            for file in files:self.assertEqual((destination/file).read_bytes(),(prepared/'stage'/file).read_bytes())

    def test_changed_late_destination_fails_before_earlier_file_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared,destination,files=self.fixture(Path(tmp));last=destination/files[-1];last.parent.mkdir(parents=True);last.write_bytes(b'foreign new edit')
            with self.assertRaisesRegex(ValueError,'Destination changed'):tool.apply(prepared,destination)
            self.assertFalse((destination/files[0]).exists())

    def test_corrupt_stage_fails_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared,destination,files=self.fixture(Path(tmp));(prepared/'stage'/files[-1]).write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'Prepared resource changed'):tool.apply(prepared,destination)
            self.assertEqual(list(destination.iterdir()),[])

    def test_existing_late_temporary_fails_before_any_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            prepared,destination,files=self.fixture(Path(tmp));last=destination/files[-1];last.parent.mkdir(parents=True)
            last.with_name(last.name+'.add-buff-stage-tmp').write_bytes(b'other task')
            with self.assertRaisesRegex(ValueError,'temporary already exists'):tool.apply(prepared,destination)
            self.assertFalse((destination/files[0]).exists())

if __name__=='__main__':unittest.main()
