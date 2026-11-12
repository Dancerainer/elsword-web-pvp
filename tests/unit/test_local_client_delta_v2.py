import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('client_delta', Path(__file__).resolve().parents[2] / 'tools/package-local-client-delta-v2.py')
delta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delta)


class LocalClientDeltaTests(unittest.TestCase):
    def package(self, root, files):
        hashes = {}
        for name, body in files.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(body)
            hashes[name] = hashlib.sha256(body).hexdigest()
        manifest = {'schemaVersion': 1, 'remoteOrigin': 'http://example.test',
                    'buildSha256': hashes['dist/game.js'], 'files': hashes,
                    'assets': {name[7:]: digest for name, digest in hashes.items() if name.startswith('assets/')}}
        (root / 'client-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        return manifest

    def test_zip_and_unchanged_base_form_complete_target_without_runtime_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = {'dist/game.js': b'old', 'runtime/node.exe': b'installed runtime', 'assets/pose.json': b'old pose'}
            new = {**old, 'dist/game.js': b'new', 'assets/pose.json': b'new pose', 'assets/sword.glb': b'original sword'}
            self.package(root / 'old', old)
            expected = self.package(root / 'new', new)
            report = delta.create_delta(root / 'old', root / 'new', root / 'patch.zip')
            self.assertFalse(report['nodeRuntimeIncluded'])
            self.assertEqual(report['changedFileCount'], 3)
            with zipfile.ZipFile(root / 'patch.zip') as archive:
                self.assertNotIn('runtime/node.exe', archive.namelist())
                for name, digest in expected['files'].items():
                    body = archive.read(name) if name in archive.namelist() else (root / 'old' / name).read_bytes()
                    self.assertEqual(hashlib.sha256(body).hexdigest(), digest)
            self.assertEqual((root / 'old/assets/pose.json').read_bytes(), b'old pose')

    def test_corrupt_unchanged_base_is_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {'dist/game.js': b'game', 'runtime/node.exe': b'runtime'}
            self.package(root / 'old', files)
            self.package(root / 'new', files)
            (root / 'old/runtime/node.exe').write_bytes(b'corrupt')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                delta.create_delta(root / 'old', root / 'new', root / 'patch.zip')
            self.assertFalse((root / 'patch.zip').exists())

    def test_path_traversal_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.package(root, {'dist/game.js': b'game'})
            manifest['files']['../outside'] = 'a' * 64
            (root / 'client-manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Invalid client file'):
                delta.package(root)

    def test_new_output_cannot_overwrite_input_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {'dist/game.js': b'game'}
            self.package(root / 'old', files)
            self.package(root / 'new', files)
            with self.assertRaisesRegex(ValueError, 'separate'):
                delta.create_delta(root / 'old', root / 'new', root / 'old/patch.zip')


if __name__ == '__main__':
    unittest.main()
