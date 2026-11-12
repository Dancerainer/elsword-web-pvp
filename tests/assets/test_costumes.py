import json
import struct
import sys
import unittest
import io
from PIL import Image
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from build_costumes import CostumeKim,SETS,CHARACTERS,Catalog

def sample():
    data=bytearray(256)
    data[:4]=b'KIM '
    struct.pack_into('<III',data,4,0x1201,1,0)
    struct.pack_into('<I',data,16,44);struct.pack_into('<I',data,20,44)
    struct.pack_into('<I',data,20+56,228)
    struct.pack_into('<H',data,228,4);data[230:238]='Face'.encode('utf-16le')
    return data

class Costumes(unittest.TestCase):
    def test_attachment_bounds_count_flags_and_empty_bones(self):
        def attached():
            data=sample()+bytearray(40)
            struct.pack_into('<I',data,20+168,244)
            struct.pack_into('<III',data,244,1,228,228)
            return data
        self.assertEqual(CostumeKim(attached()).visual(44)['attachedMeshes'],[{'name':'Face','bone':'Face','jiggle':False}])
        for offset,value in [(20+168,20),(244,257),(244,0),(248,0),(252,0),(252,291)]:
            data=attached();struct.pack_into('<I',data,offset,value)
            with self.assertRaises(ValueError):CostumeKim(data).visual(44)
        data=attached();struct.pack_into('<I',data,248,0x80000000|228)
        self.assertTrue(CostumeKim(data).visual(44)['attachedMeshes'][0]['jiggle'])
        struct.pack_into('<I',data,20+164,244)
        with self.assertRaisesRegex(ValueError,'flag'):CostumeKim(data).visual(44)

    def test_actual_extra_mesh_and_particle_closure(self):
        c=json.loads((ROOT/'contracts/costumes-2016-source-v1.json').read_bytes())
        meshes=[r for item in c['items'].values() for r in item['attachedMeshes']]
        self.assertEqual(len(meshes),11)
        self.assertEqual(sum('unsupported' in r for r in meshes),2)
        self.assertEqual(len(c['items']['130892']['attachedMeshes']),2)
        self.assertEqual(c['items']['130895']['attachedMeshes'][0]['bone'],'Dummy1_Rhand')
        self.assertEqual(c['items']['88402']['attachedMeshes'][0]['bone'],'Dummy01')
        self.assertEqual([r['bone'] for r in c['items']['82154']['attachedParticles']],['Dummy02','Dummy03'])
        self.assertEqual(sum(len(item['attachedParticles']) for item in c['items'].values()),4)

    def test_exported_texture_pixels_match_original_including_alpha(self):
        cat=Catalog('asset_work');checked=set();transparent=0
        for file in (ROOT/'artifacts/costumes').rglob('*.glb'):
            data=file.read_bytes();length=struct.unpack_from('<I',data,12)[0]
            doc=json.loads(data[20:20+length]);binary=data[28+length:]
            for row in doc.get('images',[]):
                view=doc['bufferViews'][row['bufferView']];start=view.get('byteOffset',0)
                png=binary[start:start+view['byteLength']]
                with Image.open(io.BytesIO(png)) as exported,Image.open(cat.path(row['name'])) as original:
                    self.assertEqual(exported.convert('RGBA').tobytes(),original.convert('RGBA').tobytes(),str(file)+' '+row['name'])
                    if exported.convert('RGBA').getextrema()[3][0]<255:transparent+=1
                checked.add(row['name'])
        self.assertGreater(len(checked),40)
        self.assertGreater(transparent,10)

    def test_length_excludes_terminator(self):
        self.assertEqual(CostumeKim(sample()).visual(44)['name'],'Face')
    def test_damaged_strings_and_pointers(self):
        for field,value in [(76,20),(76,255)]:
            data=sample();struct.pack_into('<I',data,field,value)
            with self.assertRaises(ValueError):CostumeKim(data).visual(44)
        for end in (229,235,239):
            with self.assertRaises(ValueError):CostumeKim(sample()[:end]).visual(44)
        data=sample();data[238]=1
        with self.assertRaises(ValueError):CostumeKim(data).visual(44)
    def test_reject_unsupported_transforms_and_corrupt_index(self):
        data=sample();data[222]=1
        with self.assertRaisesRegex(ValueError,'transforms'):CostumeKim(data).visual(44)
        data=sample();data[16]=45
        with self.assertRaisesRegex(ValueError,'index'):CostumeKim(data)
    @unittest.skipUnless(Path('asset_work/raw/data/data036.kom/item.kim').exists(),'requires read-only target input')
    def test_actual_target_selected_items_and_source_receipt(self):
        k=CostumeKim(Path('asset_work/raw/data/data036.kom/item.kim').read_bytes())
        contract=json.loads((ROOT/'contracts/costumes-2016-source-v1.json').read_bytes())
        self.assertEqual(k.count,94799)
        for key,expected in contract['items'].items():
            row=k.visual(int(key));self.assertEqual(row['recordSha256'],expected['recordSha256'])
            self.assertEqual(row['models'],expected['models']);self.assertEqual(row['name'],expected['name'])
        self.assertEqual(len(contract['items']),62)
        self.assertEqual(k.visual(131599)['models'][0].lower(),'mesh_raven_rrf_cash_left_hand_sorted.x')
        self.assertEqual(k.visual(41330)['models'][0].lower(),'mesh_raven_rvc_cash_left_hand_sorted.x')

        bm=contract['professions']['BM']
        self.assertEqual(bm['faceItem'],k.visual(29))
        self.assertEqual(bm['leftArmItem'],k.visual(131598))
        self.assertEqual(bm['leftArmItem']['models'][0].lower(),'mesh_raven_rbm_cash_left_hand_sorted.x')
        self.assertEqual(len(k.visual(130892)['cosmeticSlashTraceRaw']),4)
    def test_exported_awakening_models_and_no_animation_duplication(self):
        manifest=ROOT/'artifacts/costumes/manifest.json'
        if not manifest.exists():self.skipTest('requires converted task assets')
        m=json.loads(manifest.read_bytes())
        for character in CHARACTERS:
            for id in SETS:
                row=m['characters'][character][id]
                self.assertEqual(row['meshCount'],6)
                data=(manifest.parent/character/id/row['glb']).read_bytes()
                gltf=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
                self.assertFalse(gltf.get('animations'))
                if id!='royal':self.assertIn('awakened',row['accessories'][0]['models'][0])

if __name__=='__main__':unittest.main()
