"""Verify the importer fails before writes when any receipt becomes stale."""
import copy
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from apply_prepared_asset_import import execute,receipt

class PreparedImport(unittest.TestCase):
    def fixture(self,directory):
        root=Path(directory);source=root/'source';target=root/'target';source.mkdir();target.mkdir()
        (source/'new').write_bytes(b'new');(source/'metadata').write_bytes(b'merged metadata');(target/'metadata').write_bytes(b'previous metadata')
        (target/'unrelated').write_bytes(b'preserve me')
        files=[{'file':name,'source':str(source/name),**receipt(source/name),'prior':receipt(target/name)if(target/name).exists()else None}for name in ('new','metadata')]
        return source,target,{'targetRoot':str(target),'files':files,'inputs':[{'path':str(target/'unrelated'),**receipt(target/'unrelated')}]}
    def test_verified_only_writes_nothing_and_apply_is_idempotent(self):
        with tempfile.TemporaryDirectory()as directory:
            source,target,plan=self.fixture(directory)
            self.assertEqual(execute(plan)['mode'],'verified-only');self.assertFalse((target/'new').exists())
            self.assertEqual(execute(plan,True)['copied'],2);self.assertEqual((target/'metadata').read_bytes(),b'merged metadata')
            self.assertEqual((target/'unrelated').read_bytes(),b'preserve me');self.assertEqual(execute(plan,True)['alreadyPresent'],2)
    def test_stale_last_source_or_target_fails_before_first_copy(self):
        with tempfile.TemporaryDirectory()as directory:
            source,target,plan=self.fixture(directory)
            (source/'metadata').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'source changed'):execute(plan,True)
            self.assertFalse((target/'new').exists())
            (source/'metadata').write_bytes(b'merged metadata');(target/'metadata').write_bytes(b'concurrent edit')
            with self.assertRaisesRegex(ValueError,'Destination changed'):execute(plan,True)
            self.assertFalse((target/'new').exists())
    def test_path_escape_and_changed_preservation_dependency_are_rejected(self):
        with tempfile.TemporaryDirectory()as directory:
            source,target,plan=self.fixture(directory);bad=copy.deepcopy(plan);bad['files'][0]['file']='../escape'
            with self.assertRaisesRegex(ValueError,'Unsafe'):execute(bad,True)
            (target/'unrelated').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'Pinned input changed'):execute(plan,True)
            self.assertFalse((target/'new').exists())
if __name__=='__main__':unittest.main()
