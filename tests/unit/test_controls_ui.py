import hashlib
import json
import os
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets'))
from build_controls_ui import layout_prefix

class ControlsUiTests(unittest.TestCase):
    def test_real_keyboard_prefix_and_truncated_input(self):
        source = Path(os.environ.get('ELSWORD_2016_ASSET_ROOT', 'asset_work'))
        raw = (source/'raw/data/data034.kom/DLG_UI_KEY_SETTING.LUA').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),'85eac39476bef99e786ef082d241ec4fcacfbb338b9ea2bb8f4c826b5a59b4bc')
        result = layout_prefix(raw)
        self.assertEqual(result['instructionPrefixEnd'],687)
        self.assertEqual(result['nextOpcode'],0x49)
        self.assertTrue(any(row['args'][-1]=='KEY_1' for row in result['calls']))
        for bad in (raw[:10],raw[:-1],b'not-KL'):
            with self.assertRaises(ValueError): layout_prefix(bad)

    def test_generated_pixel_assets_and_source_catalog(self):
        output = ROOT/'artifacts/ui/online'
        manifest = json.loads((output/'manifest.json').read_text('utf-8'))
        self.assertEqual(len(manifest['pieces']),53)
        for row in manifest['pieces'].values():
            self.assertEqual(hashlib.sha256((output/row['file']).read_bytes()).hexdigest(),row['sha256'])
        buff = json.loads((ROOT/'contracts/rf-buff-bar-source-v1.json').read_text('utf-8'))
        self.assertEqual(buff['inventoryCount'],690)
        self.assertEqual(buff['pvpRevengeIds']['BTI_BUFF_PVP_REVENGE_MODE_LEVEL_1'],130)
        self.assertFalse(buff['nativeClientMeasured'])
        self.assertEqual(len(manifest['buffIcons']),11)

if __name__ == '__main__': unittest.main()
