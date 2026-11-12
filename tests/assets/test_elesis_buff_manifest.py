"""Small receipt fixtures for the common-buff manifest correction."""
import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
from patch_elesis_buff_manifest import reconcile

class CommonBuffManifest(unittest.TestCase):
    def fixture(self, root):
        files = {'fx/index.json': json.dumps({'templates': {'test': {'glb': 'mesh.glb', 'poseData': 'mesh.pose.json'}}}),
                 'mesh.glb': 'sample mesh', 'mesh.pose.json': '{}', 'prior-only.png': 'sample image'}
        rows = []
        for name, content in files.items():
            path = root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(content)
            rows.append({'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size})
        (root/'manifest.json').write_text(json.dumps({'scope': 'preserved', 'outputs': [rows[-1]]}))
        reviewed = {'outputs': rows[:-1]+[{'file': 'mesh.animation.json', 'sha256': 'unused converter cache', 'bytes': 12}]}
        return reviewed

    def test_preserves_prior_only_receipts_and_drops_unreferenced_converter_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); reviewed = self.fixture(root)
            manifest, removed = reconcile(root, reviewed)
            self.assertEqual(manifest['scope'], 'preserved')
            self.assertEqual([r['file'] for r in manifest['outputs']], ['fx/index.json', 'mesh.glb', 'mesh.pose.json', 'prior-only.png'])
            self.assertEqual([r['file'] for r in removed], ['mesh.animation.json'])

    def test_missing_and_corrupt_runtime_files_are_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); reviewed = self.fixture(root)
            changed = copy.deepcopy(reviewed); changed['outputs'][1]['sha256'] = 'wrong'
            with self.assertRaisesRegex(ValueError, 'differs from reviewed'): reconcile(root, changed)
            (root/'mesh.glb').unlink()
            with self.assertRaisesRegex(ValueError, 'Missing runtime receipt'): reconcile(root, reviewed)

    def test_referenced_intermediate_cannot_be_removed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); reviewed = self.fixture(root)
            (root/'fx/index.json').write_text(json.dumps({'templates': {'test': {'poseData': 'mesh.animation.json'}}}))
            with self.assertRaisesRegex(ValueError, 'intermediate is referenced'): reconcile(root, reviewed)

if __name__ == '__main__': unittest.main()
