import os,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets'))
from build_lk_skill_sword_ui import build
from build_lk_sword_ui import inspect_picture_groups,Catalog
SOURCE=Path('asset_work');NATIVE=ROOT/'.cache/native-reference'
EVIDENCE=Path(os.environ.get('RF_SWORD_UI_EVIDENCE_ROOT',ROOT/'.cache/sword-ui-v2/KTDXLIB'))

class SkillSwordSourceTest(unittest.TestCase):
    def test_actual_new_layout_and_corrupt_inputs(self):
        data=Catalog(SOURCE).path('DLG_GAME_SKILL_SLOT_NEW.lua').read_bytes();groups=inspect_picture_groups(data)
        for name in ['Static_EL_SKILL_B','Static_EL_SKILL_B_B','Static_EL_SKILL_R','Static_EL_SKILL_R_B']:
            self.assertEqual(len(groups[name]),4)
            self.assertEqual(groups[name][0]['sizeDelta'],[-4,-4])
            self.assertEqual(groups[name][0]['slotPoint']['args'][-2:],[-6,-5])
        for broken in (data[:100],b'not Lua'):
            with self.assertRaises((ValueError,IndexError)):inspect_picture_groups(broken)
    def test_original_atlas_and_read_only_output(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory);r=build(SOURCE,NATIVE,p/'pixels',p,evidence_root=EVIDENCE)
            self.assertEqual(r['resources']['blue']['slotSize'],[47,47]);self.assertEqual(r['resources']['blue']['displaySize'],[59,59])
            self.assertEqual(r['resources']['red']['displaySize'],[59,57]);self.assertEqual(len(list((p/'pixels').glob('*.png'))),2)
            self.assertFalse(r['targetClientMeasured'])
        with self.assertRaises(ValueError):build(SOURCE,NATIVE,SOURCE/'must-not-write',ROOT)
if __name__=='__main__':unittest.main()
