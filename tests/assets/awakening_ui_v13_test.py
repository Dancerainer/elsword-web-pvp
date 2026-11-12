import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('awakening_ui_v13', ROOT / 'tools/assets/build_awakening_ui_v13.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AwakeningUI(unittest.TestCase):
    def test_actual_target_countdown_font_and_position_declarations(self):
        source = Path('asset_work/raw/data/data034.kom/DLG_PVP_Game_My_State_NEW.lua')
        declaration = module.inspect_lua(source)
        self.assertEqual(declaration['fontSymbol'], 'XUF_DODUM_13_SEMIBOLD')
        self.assertEqual(declaration['style'], 'FONT_STYLE.FS_SHELL')
        self.assertEqual(declaration['alignment'], 'DRAW_TEXT.DT_CENTER')
        self.assertEqual(declaration['position'], [77, 46])
        self.assertEqual(declaration['outlineColor'], [0, 0, 0, 1])

    def test_original_font_copy_matches_the_source_bytes_and_frozen_contract(self):
        source = Path('asset_sources/client/data/tahoma.ttf').read_bytes()
        generated = (ROOT / 'artifacts/ui/fonts/tahoma.ttf').read_bytes()
        report = json.loads((ROOT / 'contracts/rf-ui-source-v13.json').read_text('utf-8'))
        self.assertEqual(generated, source)
        self.assertEqual(hashlib.sha256(generated).hexdigest(), report['font']['outputSha256'])
        self.assertEqual(report['font']['sha256'], module.FONT_SHA)
        self.assertFalse(report['targetClientMeasured'])
        self.assertIn('mapping unverified', report['adaptation']['mapping'])

    def test_changed_source_bytes_are_rejected_before_ui_or_font_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'changed.lua'
            path.write_bytes(b'TET ')
            with self.assertRaisesRegex(ValueError, 'Source hash changed'):
                module.inspect_lua(path)
            with self.assertRaisesRegex(ValueError, 'Source hash changed'):
                module.checked(path, module.FONT_SHA)


if __name__ == '__main__':
    unittest.main()
