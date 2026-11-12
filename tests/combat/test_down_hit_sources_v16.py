"""Check real sources and damaged inputs; no simulated original oracle."""
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/combat'))
from audit_rf_down_hit_sources_v16 import build
from kl82_static import parse


class DownHitSourceTests(unittest.TestCase):
    def test_actual_original_target_and_source_contract(self):
        self.assertEqual(build(), json.loads((ROOT / 'contracts/rf-down-hit-source-v16.json').read_bytes()))

    def test_damaged_target_declarations_are_rejected(self):
        raw = Path('asset_work/raw/data/data036.kom/RAVEN_FIGHTER.lua').read_bytes()
        for broken in (b'', raw[:8], raw[:len(raw)//2], bytes([raw[0]^255])+raw[1:]):
            with self.subTest(size=len(broken)):
                with self.assertRaises((ValueError, IndexError, KeyError)):
                    parse(broken)


if __name__ == '__main__':
    unittest.main()
