"""Actual target2016 static inputs; these checks are not client runtime evidence."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from PIL import Image

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / 'tools/assets'))
spec = importlib.util.spec_from_file_location('pvp_hud_ui', PROJECT / 'tools/assets/build_pvp_hud_ui.py')
ui = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ui)
SOURCE = Path('asset_work')
REFERENCE_BASE = Path('./.cache')
PVP_REFERENCE = REFERENCE_BASE / 'pvp-source'
GAUGE_REFERENCE = REFERENCE_BASE / 'native-source-runtime'


class ActualPvpHudSourceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (SOURCE / 'catalog.sqlite').exists() or not (PVP_REFERENCE / 'X2Lib/X2GUUser.cpp').exists() or not (GAUGE_REFERENCE / 'X2Lib/X2GageUI.cpp').exists():
            raise unittest.SkipTest('Requires read-only local target2016 inputs and pinned source reference cache')
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.project = Path(cls.temp.name) / 'project'
        for name in ['contracts/rf-pvp-rules-source-v1.json', 'contracts/rf-buff-bar-source-v1.json', 'reports/rf-presentation-ui-native-reference.json',
                     'packages/combat-core/rf-profile.json', 'packages/combat-core/lk-profile.json', 'packages/combat-core/vc-profile.json']:
            destination = cls.project / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes((PROJECT / name).read_bytes())
        cls.output = Path(cls.temp.name) / 'hud'
        cls.manifest, cls.contract = ui.build(SOURCE, PVP_REFERENCE, GAUGE_REFERENCE, cls.output, cls.project)

    def path(self, name):
        with closing(sqlite3.connect((SOURCE / 'catalog.sqlite').resolve().as_uri() + '?mode=ro', uri=True)) as con:
            return SOURCE / con.execute('SELECT raw_path FROM assets WHERE lower(name)=lower(?) AND status=?', (name, 'ok')).fetchone()[0]

    def test_actual_score_layout_has_literal_original_positions_and_supported_return(self):
        data = self.path('DLG_PVP_Game_State_TeamDeath_Score_NEW.lua').read_bytes()
        layout = ui.static_layout(data)
        self.assertEqual(layout['instructionPrefixEnd'], 254)
        self.assertEqual(layout['totalInstructions'], 255)
        self.assertEqual(layout['nextOpcode'], 0x47)
        self.assertEqual(layout['conditionalRemainder'], 'none')
        self.assertEqual([(row['piece'], row['LEFT_TOP']) for row in layout['pictures']], [
            ('PVP_SCORE_BG', [383, 75]), ('PVP_RED', [333, 55]), ('PVP_BLUE', [616, 55]), ('VS', [506, 54]),
            ('RED_NUM_1', [403, 49]), ('RED_NUM_0', [437, 48]), ('BLUE_NUM_1', [524, 48]), ('BLUE_NUM_0', [558, 49]),
        ])
        with self.assertRaises(ValueError):
            ui.static_layout(data[:100])
        with self.assertRaises(ValueError):
            ui.static_layout(b'not a KL82 file')

    def test_rank_conditional_remainder_is_preserved_as_unsupported_not_executed(self):
        layout = ui.static_layout(self.path('DLG_PVP_Game_State_RankBox_NEW.lua').read_bytes())
        self.assertEqual(layout['instructionPrefixEnd'], 780)
        self.assertEqual(layout['totalInstructions'], 1527)
        self.assertEqual(layout['nextOpcode'], 0x49)
        self.assertEqual(layout['conditionalRemainder'], 'unsupported-not-executed')
        self.assertEqual(layout['pictures'][0]['piece'], 'PVP_SCORE_TOP')
        self.assertFalse(self.contract['nativeClientMeasured'])
        self.assertEqual(self.contract['originalClientRuntimeTrajectories'], 0)
        self.assertEqual(self.contract['target']['evidenceClass'], 'target2016-static')
        self.assertEqual(self.contract['reference']['evidenceClass'], 'fixedV5-primary-reference')
        self.assertIn('2026', self.contract['reference']['note'])

    def test_generated_score_background_and_digits_match_original_pixels_including_blue_mirroring(self):
        with Image.open(self.path('DLG_UI_Common_Texture65_NEW.tga')) as original:
            pixels = original.convert('RGBA')
        records = ui.read_tet(self.path('DLG_UI_Common_Texture65_NEW.tet').read_bytes())
        for key in ['PVP_SCORE_BG', 'PVP_SCORE_BG_2', 'RED_NUM_4']:
            row = self.manifest['pieces'][key]
            points = records[key]['points']
            bounds = [min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)]
            expected = pixels.crop(bounds)
            if points[0][0] > points[1][0]:
                expected = expected.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if points[0][1] > points[2][1]:
                expected = expected.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            with Image.open(self.output / row['file']) as rendered:
                self.assertEqual(rendered.convert('RGBA').tobytes(), expected.tobytes())
                self.assertEqual(rendered.size, (row['width'], row['height']))
            self.assertEqual(row['pixelMapping'], 'original-integer-rectangle')
        self.assertEqual(len([r for r in self.manifest['pieces'].values() if r['atlas'] != 'DLG_UI_Common_Texture_Buff']), 83)

    def test_native_blue_rank_row_retains_trapezoid_and_explicit_browser_resampling_boundary(self):
        row = self.manifest['pieces']['PVP_SCORE_BLUE']
        records = ui.read_tet(self.path('DLG_UI_Common_Texture64_NEW.tet').read_bytes())
        self.assertEqual(row['originalPoints'], [[224., 163.], [462., 184.], [224., 184.], [461., 163.]])
        self.assertEqual(records['PVP_SCORE_BLUE']['size'], [237., 21.])
        self.assertEqual(row['pixelMapping'], 'original-trapezoid-to-237x21-bilinear-web-candidate')
        with Image.open(self.output / row['file']) as image:
            self.assertEqual(image.size, (237, 21))
        with Image.open(self.path('DLG_UI_Common_Texture64_NEW.tga')) as atlas:
            with self.assertRaisesRegex(ValueError, 'Nonrectangular'):
                ui.crop_piece(atlas, records['PVP_SCORE_BLUE'])

    def test_score01_screenshot_resources_are_exact_original_crops(self):
        records = ui.read_tet(self.path('DLG_UI_PVP_Score_01.tet').read_bytes())
        self.assertEqual(records['BG_PVPSCORE_RED']['size'], [388., 81.])
        self.assertEqual(records['BG_PVP']['size'], [96., 66.])
        with Image.open(self.path('DLG_UI_PVP_Score_01.tga')) as original:
            pixels = original.convert('RGBA')
        for key in ['BG_PVPSCORE_RED', 'BG_PVPSCORE_BLUE', 'BG_PVP', 'LSCORE_0', 'RSCORE_5', 'TIMENUM_2', 'KILLNUM_6', 'TEXT_KILL']:
            points = records[key]['points']
            bounds = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
            expected = pixels.crop(bounds)
            with Image.open(self.output / self.manifest['pieces'][key]['file']) as actual:
                self.assertEqual(actual.convert('RGBA').tobytes(), expected.tobytes())
        self.assertEqual(len([r for r in self.manifest['pieces'].values() if r['atlas'] == 'DLG_UI_PVP_Score_01']), 44)
        self.assertFalse(self.contract['nativeClientMeasured'])
        self.assertEqual(self.contract['redrawPresentation']['killMeaning'], 'current match scoreLimit, not local player kills')

    def test_vc_overheat_uses_original_icon_and_lk_hidden_acceleration_gets_no_invented_icon(self):
        records = ui.read_tet(self.path('DLG_UI_Common_Texture_Buff.tet').read_bytes())
        row = self.manifest['buffIcons']['250']
        self.assertEqual(row['piece'], 'BUFF_ICON_OVERHEAT')
        self.assertNotIn('232', self.manifest['buffIcons'])
        points = records['BUFF_ICON_OVERHEAT']['points']
        bounds = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        with Image.open(self.path('DLG_UI_Common_Texture_Buff.tga')) as original:
            expected = original.convert('RGBA').crop(bounds)
        with Image.open(self.output / row['file']) as actual:
            self.assertEqual(actual.convert('RGBA').tobytes(), expected.tobytes())

    def test_modified_catalog_input_is_rejected_and_builder_cannot_write_inside_read_only_source(self):
        with self.assertRaisesRegex(ValueError, 'overlaps read-only inputs'):
            ui.build(SOURCE, PVP_REFERENCE, GAUGE_REFERENCE, SOURCE / 'must-not-write', self.project)
        with tempfile.TemporaryDirectory() as temp:
            bad_source = Path(temp) / 'source'
            raw = bad_source / 'raw/changed.tet'
            raw.parent.mkdir(parents=True)
            original = self.path('DLG_UI_Common_Texture65_NEW.tet').read_bytes()
            raw.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            with sqlite3.connect(bad_source / 'catalog.sqlite') as con:
                con.execute('CREATE TABLE assets(name TEXT, status TEXT, sha256 TEXT, raw_path TEXT)')
                con.execute('INSERT INTO assets VALUES(?,?,?,?)', ('DLG_UI_Common_Texture65_NEW.tet', 'ok', ui.sha(original), 'raw/changed.tet'))
            con.close()
            with self.assertRaisesRegex(ValueError, 'Original input hash changed'):
                ui.build(bad_source, PVP_REFERENCE, GAUGE_REFERENCE, Path(temp) / 'output', self.project)


if __name__ == '__main__':
    unittest.main()
