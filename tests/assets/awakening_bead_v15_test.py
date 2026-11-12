import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/assets'))
from build_awakening_bead_v14 import Catalog
from build_awakening_bead_v15 import align_birth_band


class AwakeningBeadAlignment(unittest.TestCase):
    def test_actual_target_frame_layout_and_source_band_generate_current_alignment(self):
        original = json.loads((ROOT / 'contracts/rf-awakening-bead-fx-v14.json').read_text('utf-8'))
        align_birth_band(original, Catalog(Path('asset_work')))
        current = json.loads((ROOT / 'contracts/rf-awakening-bead-fx-v15.json').read_text('utf-8'))
        self.assertEqual(original, current)
        self.assertEqual(original['targetFrameLayout']['instruction'], 707)
        self.assertEqual(original['presentation']['hudLocalPosition'], [73, 55.5, 0])

    def test_changed_birth_band_is_rejected_instead_of_silently_repositioning(self):
        index = json.loads((ROOT / 'contracts/rf-awakening-bead-fx-v14.json').read_text('utf-8'))
        index['templates']['raven_powrUp_UI_01']['fields']['Emitradius'][1]['random'] = [0, 22]
        with self.assertRaisesRegex(ValueError, 'birth band changed'):
            align_birth_band(index, Catalog(Path('asset_work')))


if __name__ == '__main__': unittest.main()
