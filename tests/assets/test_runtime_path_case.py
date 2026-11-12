import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('runtime_path_case', ROOT/'tools/assets/character/runtime_path_case.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RuntimePathCaseTest(unittest.TestCase):
    def test_shared_texture_reference_uses_real_case_without_copying_or_rewriting_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'vc').mkdir(); (root/'rf/fx/textures').mkdir(parents=True)
            file = root/'rf/fx/textures/Steam_Bp-proof.png'; file.write_bytes(b'independent-source-bytes')
            before = {'templates': {'Original': {'textures': {'Steam_BP.DDS': {'file': '../rf/fx/textures/Steam_BP-proof.png', 'source': {'sha256': 'frozen'}}}}}}
            index = copy.deepcopy(before)
            changes = module.canonicalize_effect_paths(index, root/'vc')
            self.assertEqual(index['templates']['Original']['textures']['Steam_BP.DDS']['file'], '../rf/fx/textures/Steam_Bp-proof.png')
            self.assertEqual(len(changes), 1); self.assertEqual(file.read_bytes(), b'independent-source-bytes')
            self.assertEqual(len(list(file.parent.iterdir())), 1)
            self.assertEqual(module.canonicalize_effect_paths(index, root/'vc'), [])

    def test_missing_asset_is_rejected_instead_of_guessing_a_texture(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises((ValueError, FileNotFoundError)):
                module.canonical_runtime_path(directory, 'missing.png')


if __name__ == '__main__':
    unittest.main()
