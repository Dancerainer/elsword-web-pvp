import importlib.util
from pathlib import Path
import unittest
from PIL import Image
import sqlite3
import tempfile
spec=importlib.util.spec_from_file_location('ui',Path(__file__).resolve().parents[2]/'tools/assets/ui.py');ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)

class TETTest(unittest.TestCase):
    def test_actual_2016_mana_break_green_piece_matches_raw_atlas_pixels(self):
        source=Path('asset_work')
        if not (source/'catalog.sqlite').exists():self.skipTest('Requires local 2016 source')
        with sqlite3.connect((source/'catalog.sqlite').resolve().as_uri()+'?mode=ro',uri=True) as con:
            def path(name):return source/con.execute('select raw_path from assets where lower(name)=lower(?)',(name,)).fetchone()[0]
            records=ui.read_tet(path('DLG_UI_Common_Texture63_NEW.tet').read_bytes())
            with Image.open(path('DLG_UI_Common_Texture63_NEW.tga')) as image:
                image=image.convert('RGBA');piece,bounds=ui.crop_piece(image,records['MP_ACTIVE'])
                self.assertEqual(bounds,[256.,32.,480.,46.]);self.assertEqual(piece.size,(224,14))
                self.assertEqual(piece.tobytes(),image.crop((256,32,480,46)).tobytes())
            with tempfile.TemporaryDirectory() as temp:
                manifest=ui.build(source,Path(temp));self.assertEqual(manifest['pieces']['MP_ACTIVE']['width'],224)
                with Image.open(Path(temp)/'mp_active.png') as rendered:self.assertEqual(rendered.tobytes(),piece.tobytes())
    def test_actual_2016_hp_piece_and_exact_pixels(self):
        source=Path('asset_work/raw/data/data068.kom')
        if not source.exists(): self.skipTest('Requires local 2016 source')
        data=(source/'DLG_PVP_State_Info0.tet').read_bytes();records=ui.read_tet(data)
        self.assertEqual(records['MYHP']['size'],[319.0,18.0])
        with Image.open(source/'DLG_PVP_State_Info0.tga') as image:
            image=image.convert('RGBA');piece,bounds=ui.crop_piece(image,records['MYHP'])
            self.assertEqual(bounds,[7.,63.,326.,81.]);self.assertEqual(piece.tobytes(),image.crop((7,63,326,81)).tobytes())
        with self.assertRaises(ValueError):ui.read_tet(data[:40])
    def test_outside_atlas_rejected(self):
        with self.assertRaises(ValueError):ui.crop_piece(Image.new('RGBA',(4,4)),{'points':[[0,0],[5,0],[0,2],[5,2]],'size':[5,2]})
    def test_actual_enemy_hud_layout_and_party_portrait_pixels(self):
        source=Path('asset_work')
        if not (source/'catalog.sqlite').exists():self.skipTest('Requires local 2016 source')
        con=sqlite3.connect((source/'catalog.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
        def path(name):return source/con.execute('select raw_path from assets where lower(name)=lower(?)',(name,)).fetchone()[0]
        layout=ui.extract_other_hud_layout(path('DLG_PVP_Game_Other_State_NEW.lua'))
        self.assertEqual(layout['dialogSize'],[140,35]);self.assertFalse(layout['nativeClientMeasured'])
        controls=layout['controls']
        self.assertEqual(controls['OtherPlayerHP']['LEFT_TOP'],[48,17]);self.assertEqual(controls['OtherPlayerHP']['piece'],'PARTY_HP')
        self.assertEqual(controls['OtherPlayerMP']['LEFT_TOP'],[46,27]);self.assertFalse(controls['OtherPlayerMP']['initialShow'])
        self.assertEqual(controls['StaticPVPStateFace']['LEFT_TOP'],[2,0])
        records=ui.read_tet(path('DLG_UI_Common_Texture25_NEW.tet').read_bytes())
        with Image.open(path('DLG_UI_Common_Texture25_NEW.tga')) as image:
            image=image.convert('RGBA');portrait,bounds=ui.crop_piece(image,records['R_FIST_PARTY'])
            self.assertEqual(bounds,[376.,301.,428.,338.]);self.assertEqual(portrait.size,(52,37))
            self.assertEqual(portrait.tobytes(),image.crop((376,301,428,338)).tobytes())
        raw=path('DLG_PVP_Game_Other_State_NEW.lua').read_bytes()
        with tempfile.TemporaryDirectory() as temp:
            broken=Path(temp)/'broken.lua';broken.write_bytes(raw[:100])
            with self.assertRaises(ValueError):ui.extract_other_hud_layout(broken)
if __name__=='__main__':unittest.main()
