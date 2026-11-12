"""Independent original declaration expectations and damaged conversion inputs."""
import os
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog, digest
from build_rf_fx import read_definitions
from lk_presentation_roots import PRESENTATION_ROOTS, minor_declarations, reuse_dropdown


class LkPresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = Catalog(Path('asset_work'))
        cls.index = json.loads((ROOT/'contracts/lk-fx-index.json').read_text('utf8'))

    @classmethod
    def tearDownClass(cls):
        cls.catalog.connection.close()

    @unittest.skipUnless(os.environ.get('WEB_PVP_LK_TEMPLATE_REF'), 'Set WEB_PVP_LK_TEMPLATE_REF to check an archived template set')
    def test_previous_237_templates_are_unchanged(self):
        previous = json.loads(subprocess.check_output(['git', 'show', os.environ['WEB_PVP_LK_TEMPLATE_REF'] + ':contracts/lk-fx-index.json'], cwd=ROOT))
        self.assertEqual(len(previous['templates']), 237)
        self.assertTrue(set(PRESENTATION_ROOTS).issubset(set(self.index['templates'])-set(previous['templates'])))
        for name, original in previous['templates'].items():
            # Measured source animation metadata and converted files may be
            # added, while original target declarations remain byte-derived.
            for key in ('fields','events','repeated','unsupported','source','declarationSha256'):
                self.assertEqual(self.index['templates'][name][key], original[key], (name,key))
        self.assertEqual(self.index['meshFailures'], [])
        self.assertEqual(self.index['missingTemplates'], [])

    def test_eight_roots_match_actual_target_fields_and_declaration_hashes(self):
        originals = read_definitions(self.catalog)
        originals.update(minor_declarations(self.catalog))
        contract = json.loads((ROOT/'contracts/lk-presentation-roots.json').read_text('utf8'))
        self.assertTrue(set(contract['roots']).issubset(PRESENTATION_ROOTS))
        self.assertEqual(self.index['presentationRoots'], list(PRESENTATION_ROOTS))
        for name in PRESENTATION_ROOTS:
            for key in ('fields','events','repeated','unsupported','source','declarationSha256'):
                self.assertEqual(self.index['templates'][name][key], originals[name][key], (name,key))
        self.assertNotIn('HyperBoostRightBlack', self.index['templates'])
        self.assertNotIn('HyperBoostLeftBlack', self.index['templates'])

    def test_actual_dropdown_conversion_and_corrupted_prerequisites(self):
        input_dir = ROOT/'artifacts/lk-presentation-prerequisites/landing-fx'
        if not input_dir.is_dir():
            input_dir = Path('./artifacts/rf/landing-fx')
        if not input_dir.is_dir(): self.skipTest('Hash-frozen original landing conversion unavailable')
        originals = minor_declarations(self.catalog)
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); source = base/'landing-fx'; (source/'meshes').mkdir(parents=True)
            files = ('index.json','meshes/Effect_ElSword_dropdown.glb','meshes/Effect_ElSword_dropdown.pose.json')
            for file in files: (source/file).write_bytes((input_dir/file).read_bytes())
            converted = reuse_dropdown(self.catalog, base/'accepted', originals['DropDown'], source)
            self.assertFalse(converted['missingExplicitTickRate'])
            for key in ('glb','poseData'):
                evidence = next(row for row in originals['DropDown']['convertedArtifactReuse']['files'] if row['file']==converted[key])
                self.assertEqual(digest((base/'accepted'/converted[key]).read_bytes()), evidence['sha256'])
            for file in files:
                raw = (source/file).read_bytes(); (source/file).write_bytes(raw+b'damaged')
                with self.assertRaisesRegex(ValueError,'SHA256'):
                    reuse_dropdown(self.catalog, base/'rejected', originals['DropDown'], source)
                self.assertFalse((base/'rejected').exists(), 'bad inputs cannot leave partially accepted files')
                (source/file).write_bytes(raw)
            wrong = minor_declarations(self.catalog)['DropDown']; wrong['fields']['PlayCount'] = 2
            with self.assertRaisesRegex(ValueError,'original declaration'):
                reuse_dropdown(self.catalog, base/'rejected', wrong, source)


if __name__ == '__main__': unittest.main()
