"""Extraction integrity and damaged-source handling, using actual pinned samples."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('geometry_build',ROOT/'tools/native/geometry-build.py')
build=importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
SOURCE=ROOT/'.cache/native-source-runtime/KTDXLIB'
if not SOURCE.is_dir(): SOURCE=ROOT/'.cache/native-reference/KTDXLIB'
COMPAT=ROOT/'tools/native/geometry-compat.hpp'

@unittest.skipUnless(all((SOURCE/f).exists() for f in build.HASHES),'Pinned C++ source inputs unavailable')
class ExtractionTests(unittest.TestCase):
    def test_exact_raw_fragment_bytes_and_body_hashes(self):
        generated,contract=build.extract(SOURCE,COMPAT)
        by_name={f['name']:f for f in contract['functions']}
        for entries in build.FRAGMENTS.values():
            for file,start,end,name in entries:
                fragment=b''.join((SOURCE/file).read_bytes().splitlines(keepends=True)[start-1:end])
                self.assertEqual(generated.count(fragment),1,name)
                self.assertEqual(hashlib.sha256(fragment).hexdigest(),by_name[name]['sha256'])
                body=fragment[fragment.find(b'{'):fragment.rfind(b'}')+1]
                self.assertEqual(hashlib.sha256(body).hexdigest(),by_name[name]['bodySha256'])
        self.assertNotIn(b'// @@',generated)

    def test_damaged_source_is_rejected_before_extraction(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)
            for file in build.HASHES:
                shutil.copyfile(SOURCE/file,source/file)
            path=source/'KTDGLineMap.h'
            path.write_bytes(path.read_bytes().replace(b'GetNearestWithBound',b'GetNearestWithBounX',1))
            with self.assertRaisesRegex(ValueError,'Pinned source hash mismatch'):
                build.extract(source,COMPAT)

    def test_missing_compatibility_marker_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'compat.hpp'
            path.write_bytes(COMPAT.read_bytes().replace(b'// @@COLLISION@@',b'// missing'))
            with self.assertRaisesRegex(ValueError,'Missing or duplicate compatibility marker'):
                build.extract(SOURCE,path)

if __name__=='__main__':
    unittest.main()
