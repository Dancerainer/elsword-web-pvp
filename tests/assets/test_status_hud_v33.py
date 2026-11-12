"""Original 2016 resource evidence, kept separate from browser display checks."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('status_hud_v33', ROOT / 'tools/assets/audit_status_hud_v33.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class StatusHudSourceTest(unittest.TestCase):
    def test_full_original_coordinates_match_frozen_contract(self):
        self.assertEqual(audit.audit(), json.loads((ROOT / 'contracts/status-hud-source-v33.json').read_text('utf8')))

    def test_reused_assets_match_fresh_original_crops(self):
        result = audit.verify_pixels(ROOT / 'artifacts')
        self.assertEqual(result['imagesVerified'], 32)
        self.assertEqual(result['resourceChanges'], 0)
        self.assertFalse(result['nativeClientMeasured'])

    def test_name_declarations_reject_damaged_source(self):
        source = audit.Catalog(Path('asset_work')).path('DLG_PVP_Game_My_State_NEW.lua').read_bytes()
        for damaged in (source[:20], source[:-1], b'INVALID' + source[7:]):
            with self.subTest(bytes=len(damaged)), self.assertRaises(ValueError):
                audit.name_strings(damaged)


if __name__ == '__main__':
    unittest.main()
