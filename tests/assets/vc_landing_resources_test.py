import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
from vc_landing_resources import json_bytes, sealed_documents, write_profile_with_seals, refresh_runtime_inventory


class VCLandingSealTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile_bytes = (ROOT/'packages/combat-core/vc-profile.json').read_bytes()
        cls.profile = json.loads(cls.profile_bytes)
        cls.manifest = json.loads((ROOT/'artifacts/vc/manifest.json').read_text('utf8'))
        cls.index = json.loads((ROOT/'artifacts/vc/fx/index.json').read_text('utf8'))
        cls.report = json.loads((ROOT/'reports/vc-assets-runtime.json').read_text('utf8'))

    def fixture(self, root):
        for directory in ('packages/combat-core', 'artifacts/vc/fx', 'contracts', 'reports'):
            (root/directory).mkdir(parents=True)
        (root/'artifacts/vc/manifest.json').write_bytes(json_bytes(self.manifest))
        (root/'reports/vc-assets-runtime.json').write_bytes(json_bytes(self.report))
        write_profile_with_seals(self.profile, self.index, root)

    def test_actual_profile_lf_and_crlf_share_one_seal_without_mutating_documents(self):
        inputs = (self.manifest, self.index, self.report)
        before = copy.deepcopy(inputs)
        lf = self.profile_bytes.replace(b'\r\n', b'\n')
        expected = hashlib.sha256(lf).hexdigest()
        for data in (lf, lf.replace(b'\n', b'\r\n')):
            normalized, manifest, index, report = sealed_documents(data, *inputs)
            self.assertEqual(normalized, lf)
            self.assertEqual(manifest['profile']['sha256'], expected)
            self.assertEqual(index['profileSha256'], expected)
            self.assertEqual(report['profile'], manifest['profile'])
            self.assertEqual(report['summary'], self.report['summary'])
        self.assertEqual(inputs, before)

    def test_malformed_profile_or_conflicting_metadata_fail_closed(self):
        for data in (b'\xff', b'{"profileId":', b'{}'):
            with self.subTest(data=data), self.assertRaises((ValueError, UnicodeDecodeError)):
                sealed_documents(data, self.manifest, self.index, self.report)
        for document in ('manifest', 'report'):
            for key, value in (('profileId', 'not-vc'), ('hashNormalization', 'raw bytes')):
                manifest, index, report = copy.deepcopy((self.manifest, self.index, self.report))
                (manifest if document == 'manifest' else report)['profile'][key] = value
                with self.subTest(document=document, key=key), self.assertRaises(ValueError):
                    sealed_documents(self.profile_bytes, manifest, index, report)
        index = {**self.index, 'schemaVersion': 99}
        with self.assertRaisesRegex(ValueError, 'versioned'):
            sealed_documents(self.profile_bytes, self.manifest, index, self.report)

    def test_actual_document_write_is_idempotent_and_rejection_does_not_partially_write(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            before = {path: path.read_bytes() for path in root.rglob('*.json')}
            write_profile_with_seals(self.profile, self.index, root)
            self.assertEqual({path: path.read_bytes() for path in before}, before)
            self.assertEqual(json.loads((root/'packages/combat-core/vc-profile.json').read_bytes()), self.profile)
            self.assertTrue(all(b'\r\n' not in data for data in before.values()))
            damaged = copy.deepcopy(self.report)
            damaged['profile']['profileId'] = 'different-profile'
            (root/'reports/vc-assets-runtime.json').write_bytes(json_bytes(damaged))
            before = {path: path.read_bytes() for path in root.rglob('*.json')}
            with self.assertRaisesRegex(ValueError, 'identity differs'):
                write_profile_with_seals(self.profile, self.index, root)
            self.assertEqual({path: path.read_bytes() for path in before}, before)

    def test_inventory_refresh_checks_coverage_and_preserves_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            profile_before = (root/'packages/combat-core/vc-profile.json').read_bytes()
            outputs = [{'file': name, 'bytes': 0, 'sha256': 'stale'} for name in ('manifest.json', 'fx/index.json')]
            reuse = {'outputs': outputs}
            first = refresh_runtime_inventory(reuse, root)
            second = refresh_runtime_inventory(reuse, root)
            self.assertEqual(first, second)
            self.assertEqual((root/'packages/combat-core/vc-profile.json').read_bytes(), profile_before)
            self.assertEqual(first['summary']['files'], 2)
            for row in first['outputs']:
                data = (root/'artifacts/vc'/row['file']).read_bytes()
                self.assertEqual((row['bytes'], row['sha256']), (len(data), hashlib.sha256(data).hexdigest()))
            for rows in (outputs[:-1], [*outputs, outputs[0]], [*outputs, {'file': '../outside'}]):
                with self.subTest(rows=rows), self.assertRaises(ValueError):
                    refresh_runtime_inventory({'outputs': rows}, root)

    def test_real_packed_files_and_all_profile_seals_agree(self):
        sha = hashlib.sha256(self.profile_bytes.replace(b'\r\n', b'\n')).hexdigest()
        self.assertEqual(self.manifest['profile']['sha256'], sha)
        self.assertEqual(self.index['profileSha256'], sha)
        self.assertEqual(self.report['profile']['sha256'], sha)
        self.assertEqual(json.loads((ROOT/'contracts/vc-fx-index.json').read_text('utf8')), self.index)
        reuse = json.loads((ROOT/'reports/vc-resource-reuse-v1.json').read_text('utf8'))
        self.assertEqual(reuse['outputs'], self.report['outputs'])
        output = ROOT/'artifacts/vc'
        actual = {path.relative_to(output).as_posix() for path in output.rglob('*')
                  if path.is_file() and not path.is_relative_to(output/'source-proof')}
        self.assertEqual({row['file'] for row in reuse['outputs']}, actual)
        self.assertEqual(len(reuse['outputs']), len(actual))
        for row in reuse['outputs']:
            data = (output/row['file']).read_bytes()
            self.assertEqual((row['bytes'], row['sha256']), (len(data), hashlib.sha256(data).hexdigest()), row['file'])
        self.assertEqual(sum(row['bytes'] for row in reuse['outputs']), self.report['summary']['bytes'])


if __name__ == '__main__':
    unittest.main()
