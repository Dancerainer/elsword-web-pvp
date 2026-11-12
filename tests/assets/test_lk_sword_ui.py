import sys
import os
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from build_lk_sword_ui import build,inspect_layout,Catalog,read_flicker_sources
SOURCE=Path('asset_work')
NATIVE=Path(os.environ.get('LK_SWORD_NATIVE_ROOT',ROOT/'.cache/native-reference'))
EVIDENCE=Path(os.environ.get('RF_SWORD_UI_EVIDENCE_ROOT',ROOT/'.cache/sword-ui-v2/KTDXLIB'))


class SwordHudSourceTest(unittest.TestCase):
    def test_actual_lua_all_original_pictures_and_colors(self):
        catalog=Catalog(SOURCE)
        data=catalog.path('DLG_Elsword_WayOfSword.lua').read_bytes()
        groups=inspect_layout(data)
        blue=groups['g_pStatic_EL_BLUE'];red=groups['g_pStatic_EL_RED']
        self.assertEqual([r['position'] for r in blue],[[99,66],[100,71],[100,71],[305,63],[305,63],[305,63]])
        self.assertEqual(blue[2]['color'],[.8,.9,1,1]);self.assertEqual(red[2]['color'],[1,.8,.8,1])
        for broken in (data[:100],b'not Lua'):
            with self.assertRaises((ValueError,IndexError)):inspect_layout(broken)

    def test_real_atlas_pieces_and_read_only_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            result=build(SOURCE,NATIVE,root/'pixels',root,evidence_root=EVIDENCE)
            self.assertEqual(result['groups']['g_pStatic_EL_BLUE'][0]['size'],[227,16])
            self.assertEqual(len(list((root/'pixels').glob('*.png'))),10)
            self.assertFalse(result['nativeClientMeasured'])
        with self.assertRaises(ValueError):build(SOURCE,NATIVE,SOURCE/'must-not-write',ROOT)

    def test_explicit_evidence_still_rejects_changed_and_missing_pinned_bytes_before_output(self):
        frozen=read_flicker_sources(EVIDENCE)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);evidence=root/'evidence';evidence.mkdir()
            for name,(data,_) in frozen.items():(evidence/name).write_bytes(data)
            (evidence/'KTDGUIControl.cpp').write_bytes(frozen['KTDGUIControl.cpp'][0]+b'changed')
            with self.assertRaisesRegex(ValueError,'Pinned UI flicker source differs'):
                build(SOURCE,NATIVE,root/'pixels',root,evidence_root=evidence)
            self.assertFalse((root/'pixels').exists())
            (evidence/'KTDGUIControl.cpp').unlink()
            with self.assertRaises(FileNotFoundError):read_flicker_sources(evidence)


if __name__=='__main__':unittest.main()
