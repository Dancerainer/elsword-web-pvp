"""Additive merge checks against the frozen nine-profession source baseline.

The actual-resource tests use this task's private increment and the read-only
integrated asset directory; no test writes to either one.
"""
import copy,json,os,shutil,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'tools/assets'))
import build_add_common_buff_increment as tool
from build_common_buff_assets import DEFAULT_PROFESSIONS

INCREMENT=Path(os.environ.get('ADD_COMMON_BUFF_INCREMENT',ROOT/'artifacts/common-buffs-add-v2-final'))
ASSETS=Path(os.environ.get('PROFESSION_ASSET_ROOT',ROOT/'artifacts'))
available=INCREMENT.exists() and (ASSETS/'common-buffs/manifest.json').exists()

class MergeGuards(unittest.TestCase):
    def test_default_includes_each_of_the_twelve_professions_once(self):
        self.assertEqual(DEFAULT_PROFESSIONS,('rf','lk','vc','rs','bm','is','gm','bh','ca','lp','mm','de'))

    def test_conflicting_original_rows_fail(self):
        self.assertEqual(tool.merge_entries({'1':{'raw':{'x':1}}},{'1':{'raw':{'x':1},'extra':'ignored'}},'test'),{'1':{'raw':{'x':1}}})
        with self.assertRaisesRegex(ValueError,'Conflicting original'):
            tool.merge_entries({'1':{'raw':{'x':1}}},{'1':{'raw':{'x':2}}},'test')

    def test_paths_cannot_escape_or_use_windows_absolute_syntax(self):
        for path in ('../x','x/../y','/root','C:/x','x\\y','./x','x//y',''):
            with self.subTest(path=path),self.assertRaises(ValueError):tool.safe_relative(path)
        self.assertEqual(tool.safe_relative('add-fx/files/source.glb').as_posix(),'add-fx/files/source.glb')

    def test_offensive_and_outside_display_roots_fail(self):
        base={'schemaVersion':1,'targetVersion':'2016','buffTemplates':{},'buffFactors':{},'effectSets':{},'effectTemplates':{}}
        for row in ({'states':{'attack':{}}},{'damageEffects':{'damage':{}}},{'skillCatalog':[1]},
                    {'effectSets':{'unowned':{'raw':{}}}},{'targetVersion':'older'}):
            with self.subTest(row=row),self.assertRaises(ValueError):tool.merge_catalog(base,{**base,**row})

    def test_conflicting_atlas_pixels_fail(self):
        base={'schemaVersion':1,'targetVersion':'2016','pieces':{'key':{'rgbaSha256':'a','bounds':[0,0,32,32]}},'buffIcons':{}}
        extra=copy.deepcopy(base);extra['pieces']['key']['rgbaSha256']='b'
        with self.assertRaisesRegex(ValueError,'atlas piece'):tool.merge_icons(base,extra)

@unittest.skipUnless(available,'Private Add common buff increment and read-only baseline assets required')
class ActualIncrement(unittest.TestCase):
    def setUp(self):
        self.base=tool.read(ROOT/'contracts/common-buff-catalog.json')
        self.delta=tool.read(INCREMENT/'delta-catalog.json')

    def test_original_nine_profession_union_preserved_exactly(self):
        union=tool.merge_catalog(self.base,self.delta)
        for group in ('buffTemplates','buffFactors','effectSets','effectTemplates'):
            for key,row in self.base[group].items():self.assertEqual(union[group][key],row)
        self.assertEqual([len(union[g]) for g in ('buffTemplates','buffFactors','effectSets','effectTemplates')],[107,120,68,154])
        self.assertEqual(len(union['profiles']),12)
        self.assertNotIn('443',union['buffFactors']);self.assertNotIn('414',union['buffTemplates'])
        self.assertNotIn('EffectSet_SI_HA_AMM_Apocalypse_Always',union['effectSets'])
        self.assertEqual(union['buffFactors']['478']['raw']['BUFF_TEMPLET_ID'],440)
        for factor in ('368','370'):self.assertEqual(union['buffFactors'][factor]['raw']['BUFF_TEMPLET_ID'],344)
        self.assertFalse(union['buffTemplates']['344']['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET'))
        self.assertFalse(union['buffTemplates']['345']['raw'].get('DISPLAYER',{}).get('BDT_EFFECT_SET'))

    def test_all_receipt_resources_and_source_declared_textures_exist(self):
        receipt=tool.read(INCREMENT/'receipt.json')
        for entry in receipt['outputs']:
            data=(INCREMENT/entry['file']).read_bytes()
            self.assertEqual(len(data),entry['bytes']);self.assertEqual(tool.digest(data),entry['sha256'])
        index=tool.read(INCREMENT/'common-buffs/add-fx/index.json')
        self.assertFalse(index['meshFailures']);self.assertFalse(index['missingTemplates'])
        for row in index['templates'].values():
            paths=[row[key] for key in ('glb','poseData') if row.get(key)]
            paths.extend(texture['file'] for texture in row.get('textures',{}).values())
            for path in paths:self.assertTrue((INCREMENT/'common-buffs'/tool.safe_relative(path)).is_file(),path)
        self.assertEqual(index['templates']['StateError_MagicWeapon_Break01']['source']['name'],'GameMajorParticle3.txt')
        self.assertEqual(index['templates']['Emoticon_State_Abnormality_REVERSE_STIGMA']['source']['name'],'GameMajorParticle32.txt')
        self.assertIn('AN_Formation_TRACE.tga',index['templates']['AN_Formation_TRACE']['textures'])
        self.assertIsNone(index['templates']['AN_Formation_TRACE']['glb'],'helper-only source cannot acquire invented mesh geometry')

    def test_existing_ui_union_preserved_and_stigma_drone_use_actual_crops(self):
        base=tool.read(ASSETS/'ui/buffs/manifest.json');extra=tool.read(INCREMENT/'ui/buffs/manifest.json')
        merged=tool.merge_icons(base,extra)
        for group in ('buffIcons','pieces'):
            for key,row in base[group].items():self.assertEqual(merged[group][key],row)
        from PIL import Image
        for key,name in [('440','Debuff_Icon_REVERSE_STIGMA'),('344','Debuff_Icon_Drone_Activator')]:
            row=merged['buffIcons'][key];self.assertEqual(row['piece'].lower(),name.lower())
            with Image.open(INCREMENT/'ui/buffs'/row['file']) as image:
                self.assertEqual(tool.digest(image.convert('RGBA').tobytes()),row['rgbaSha256'])

    def fixture(self,root):
        for file in ('common-buff-catalog.json','common-buff-display-roots.json','common-buff-display-fx-index.json'):
            target=root/'contracts'/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/'contracts'/file,target)
        for file in ('common-buffs/catalog.json','common-buffs/manifest.json','ui/buffs/manifest.json'):
            target=root/'artifacts'/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ASSETS/file,target)
        (root/'artifacts/common-buffs/old-union-sentinel.bin').write_bytes(b'preserve older resource bytes')

    def test_real_merge_is_additive_and_idempotent_with_exact_inventory_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixture(root)
            tool.merge(INCREMENT,root)
            merged=tool.read(root/'contracts/common-buff-catalog.json')
            self.assertEqual(merged,tool.read(INCREMENT/'preview/common-buff-catalog.json'))
            manifest=tool.read(root/'artifacts/common-buffs/manifest.json')
            self.assertIn('fx/index.json',manifest['visualEffectIndexes']);self.assertIn('add-fx/index.json',manifest['visualEffectIndexes'])
            output=next(row for row in manifest['outputs'] if row['file']=='catalog.json')
            self.assertEqual(output['sha256'],tool.digest((root/'artifacts/common-buffs/catalog.json').read_bytes()))
            before={path.relative_to(root).as_posix():tool.digest(path.read_bytes()) for path in root.rglob('*') if path.is_file()}
            tool.merge(INCREMENT,root)
            after={path.relative_to(root).as_posix():tool.digest(path.read_bytes()) for path in root.rglob('*') if path.is_file()}
            self.assertEqual(before,after)
            self.assertEqual((root/'artifacts/common-buffs/old-union-sentinel.bin').read_bytes(),b'preserve older resource bytes')

    def test_corrupt_resource_aborts_before_any_destination_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'destination';self.fixture(root)
            increment=Path(tmp)/'increment';shutil.copytree(INCREMENT,increment)
            receipt=tool.read(increment/'receipt.json');path=increment/receipt['outputs'][0]['file'];path.write_bytes(path.read_bytes()+b'corrupt')
            before={path.relative_to(root).as_posix():tool.digest(path.read_bytes()) for path in root.rglob('*') if path.is_file()}
            with self.assertRaisesRegex(ValueError,'SHA/size'):tool.merge(increment,root)
            self.assertEqual(before,{path.relative_to(root).as_posix():tool.digest(path.read_bytes()) for path in root.rglob('*') if path.is_file()})

if __name__=='__main__':unittest.main()
