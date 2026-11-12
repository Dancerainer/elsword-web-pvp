"""Independent original-icon samples and corrupt/mismatched buff input checks."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from build_common_buff_assets import build
from ui import read_tet,crop_piece

class CommonBuffAssetTests(unittest.TestCase):
    def setUp(self):
        self.catalog=json.loads((ROOT/'contracts/common-buff-catalog.json').read_text('utf8'))

    def test_original_cross_profession_identities_and_no_attacks(self):
        expected={31:'Debuff_Icon_Wound',38:'Debuff_Icon_Blind',48:'Debuff_Icon_Weapon_Break',78:'Debuff_Icon_Amor_Break',99:'Debuff_Icon_Bleeding'}
        for key,piece in expected.items():self.assertEqual(self.catalog['buffTemplates'][str(key)]['raw']['BUFF_ICON_TEXTURE_KEY'],piece)
        self.assertEqual(self.catalog['damageEffects'],{})
        self.assertNotIn('states',self.catalog);self.assertNotIn('skillCatalog',self.catalog)
        self.assertTrue(any('DISPLAYER' in row['raw'] for row in self.catalog['buffTemplates'].values()))
        for name in self.catalog['effectSets']:
            self.assertTrue(any(name in row['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET',{}).values() for row in self.catalog['buffTemplates'].values()))
        self.assertEqual(set(self.catalog['buffTemplates']['99']['raw']['DISPLAYER']['BDT_EFFECT_SET'].values()),
                         {f'EffectSet_DEBUFF_BLEEDING_0{i}' for i in range(1,4)})
        for name in ('rf','lk','vc','rs','bm','is'):
            profile=json.loads((ROOT/f'packages/combat-core/{name}-profile.json').read_text('utf8'))
            self.assertIn(profile['profileId'],{row['profileId'] for row in self.catalog['profiles']})
            for key,row in profile['buffTemplates'].items():self.assertEqual(self.catalog['buffTemplates'][key]['raw'],row['raw'])

    def test_actual_armor_blind_wound_weapon_pixels(self):
        directory=ROOT/'artifacts/ui/buffs';manifest=directory/'manifest.json'
        if not manifest.is_file():self.skipTest('Task output not available')
        ui=json.loads(manifest.read_text('utf8'));source=Path('asset_work')
        for key in ('31','38','48','78','99'):
            row=ui['buffIcons'][key]
            ap=source/row['atlasSource']['rawPath'];tp=source/row['tetSource']['rawPath']
            self.assertEqual(hashlib.sha256(ap.read_bytes()).hexdigest(),row['atlasSource']['sha256'])
            self.assertEqual(hashlib.sha256(tp.read_bytes()).hexdigest(),row['tetSource']['sha256'])
            with Image.open(ap) as image: original=image.convert('RGBA')
            crop,bounds=crop_piece(original,read_tet(tp.read_bytes())[row['piece']])
            self.assertEqual(bounds,row['bounds'])
            with Image.open(directory/row['file']) as image: self.assertEqual(crop.tobytes(),image.convert('RGBA').tobytes())

    def test_display_closure_has_no_missing_or_offensive_entries(self):
        fx=json.loads((ROOT/'contracts/common-buff-display-fx-index.json').read_text('utf8'))
        report=json.loads((ROOT/'reports/common-buff-assets.json').read_text('utf8'))
        self.assertEqual(fx['meshFailures'],[]);self.assertEqual(fx['missingTemplates'],[])
        # The original RS Sword Fire display declares a DamageEffect route.
        # Retain that source entry as unsupported; a recipient's display-only
        # catalog must never acquire the attack because another job uses it.
        entries=report['unsupportedDisplayEntries']
        expected={('EffectSet_SA_ERS_SwordFire_Buff','EFFECT0'),
                  ('EffectSet_P_SBH_FIRE_BLOSSOMS','EFFECT0')}
        expected.update(('EffectSet_DEBUFF_ANCIENT_FIRE','EFFECT'+str(i)) for i in range(5))
        expected.update(('EffectSet_P_SBH_STIGMA_OF_FIRE_'+str(level),'EFFECT'+str(i))
                        for level in range(1,5) for i in range(level))
        self.assertEqual({(row['effectSet'],row['property']) for row in entries},expected)
        original=self.catalog['effectSets']['EffectSet_SA_ERS_SwordFire_Buff']['raw']['EFFECT0']
        rs_entry=next(row for row in entries if row['effectSet']=='EffectSet_SA_ERS_SwordFire_Buff')
        self.assertEqual(rs_entry['raw'],original)
        self.assertEqual(original['EFFECT_TYPE'],1)
        self.assertEqual(original['NAME'],'DamageEffect_EMK_SwordFire_Buff_FX')
        self.assertEqual(self.catalog['damageEffects'],{})
        self.assertNotIn(original['NAME'],fx['templates'])
        self.assertEqual(fx['templates']['SwordFireTip']['sourceFamily'],'game-minor')
        output=ROOT/'artifacts/common-buffs'
        if output.is_dir():
            for record in report['outputs']:
                data=(output/record['file']).read_bytes()
                self.assertEqual(len(data),record['bytes'])
                self.assertEqual(hashlib.sha256(data).hexdigest(),record['sha256'])

    def test_mismatched_source_owned_template_is_rejected(self):
        source=Path('asset_work')
        if not (source/'catalog.sqlite').is_file():self.skipTest('Read-only target unavailable')
        p=json.loads((ROOT/'packages/combat-core/lk-profile.json').read_text('utf8'))
        p['buffTemplates']['78']['raw']['REGIST_TYPE']=99
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp);profile=path/'profile.json';profile.write_text(json.dumps(p),encoding='utf8')
            with self.assertRaisesRegex(ValueError,'differs from original target: 78'):
                build(source,path/'output',path/'ui',[profile])
            self.assertFalse((path/'output').exists())

    def test_output_overlap_rejected_before_read_or_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)
            with self.assertRaisesRegex(ValueError,'read-only'):
                build(source,source/'output',source/'ui',[])
            self.assertFalse((source/'output').exists())

if __name__=='__main__':unittest.main()
