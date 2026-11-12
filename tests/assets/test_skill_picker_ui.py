import importlib.util
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
spec=importlib.util.spec_from_file_location('skill_picker_ui',ROOT/'tools/assets/skill_picker_ui.py')
ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)

class SkillPickerSourceTest(unittest.TestCase):
    def setUp(self):
        self.source=Path('asset_work')
        if not (self.source/'catalog.sqlite').exists():self.skipTest('Requires original 2016 resources')
        con=sqlite3.connect((self.source/'catalog.sqlite').as_uri()+'?mode=ro',uri=True)
        self.find=lambda name:self.source/con.execute('select raw_path from assets where lower(name)=lower(?)',(name,)).fetchone()[0]
        self.addCleanup(con.close)

    def test_original_icon_layout_has_two_memo_positions_and_rejects_truncated_input(self):
        path=self.find('DLG_UI_Skill_Icon_New2015.lua');layout=ui.extract_layout(path)
        self.assertEqual([p['LEFT_TOP'] for p in layout['pictures'] if p['piece']=='MEMO_OPEN'],[[46,48],[76,48]])
        self.assertTrue(any(p['piece']=='BG_SKILL' and p['LEFT_TOP']==[45,-10] for p in layout['pictures']))
        with tempfile.TemporaryDirectory() as temp:
            broken=Path(temp)/path.name;broken.write_bytes(path.read_bytes()[:60])
            with self.assertRaises(Exception):ui.extract_layout(broken)

    def test_exact_skill_frame_and_memo_pixels_are_original_atlas_crops(self):
        records=ui.read_tet(self.find('DLG_UI_Common_Texture_NewSkill_02.tet').read_bytes())
        with Image.open(self.find('DLG_UI_Common_Texture_NewSkill_02.tga')) as source:
            source=source.convert('RGBA')
            frame,bounds=ui.crop_piece(source,records['BG_SKILL'])
            self.assertEqual(frame.size,(63,60));self.assertEqual(bounds,[3.,110.,66.,170.])
            self.assertEqual(frame.tobytes(),source.crop((3,110,66,170)).tobytes())
            memo,bounds=ui.crop_piece(source,records['MEMO_SELECT'])
            self.assertEqual(memo.size,(31,32));self.assertEqual(bounds,[139.,174.,170.,206.])
            self.assertEqual(memo.tobytes(),source.crop((139,174,170,206)).tobytes())

if __name__=='__main__':unittest.main()
