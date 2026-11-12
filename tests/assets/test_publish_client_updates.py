import importlib.util
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('publish_updates', ROOT/'scripts/publish-client-updates.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

def extended(path):
    return Path('\\\\?\\'+str(path.resolve())) if os.name == 'nt' else path

class UpdateArchiveTests(unittest.TestCase):
    def test_actual_long_blob_is_included_and_read_back(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as directory:
            base=Path(directory)
            source=base/('source'+'s'*65)
            blob=source/('a'*64)/'blobs'/('b'*64+'.gz')
            self.assertGreaterEqual(len(str(blob)),260)
            actual=extended(blob)
            actual.parent.mkdir(parents=True)
            actual.write_bytes(b'compressed-fixture')
            archive=base/'bundle.tar.gz'
            try:
                self.assertEqual(publisher.archive_update_files(source,archive),1)
                with tarfile.open(archive) as stored:
                    members=stored.getmembers()
                    self.assertEqual(len(members),1)
                    self.assertEqual(members[0].name,'a'*64+'/blobs/'+'b'*64+'.gz')
                    self.assertEqual(stored.extractfile(members[0]).read(),b'compressed-fixture')
            finally:
                actual.unlink(missing_ok=True)
                actual.parent.rmdir()
                actual.parent.parent.rmdir()
                extended(source).rmdir()

    def test_missing_root_is_rejected_before_archive_creation(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime') as directory:
            base=Path(directory)
            with self.assertRaises(ValueError):
                publisher.archive_update_files(base/'missing',base/'bundle.tar.gz')
            self.assertFalse((base/'bundle.tar.gz').exists())

if __name__ == '__main__':
    unittest.main()
