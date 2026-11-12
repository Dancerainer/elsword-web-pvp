"""Actual shared costume bytes / RS bone and face evidence, not GPU approval."""
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from prepare_rs_costumes import json_glb,local_matrix


class RsCostumeResourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract=json.loads((ROOT/'contracts/rs-costumes-source-v1.json').read_text('utf-8'))
        cls.manifest=json.loads((ROOT/'artifacts/costumes/manifest.json').read_text('utf-8'))
        cls.rs=json_glb((ROOT/'artifacts/rs/rs-runtime.glb').read_bytes())

    def test_exact_shared_manifest_and_71_resource_snapshot(self):
        contract=self.contract
        self.assertEqual(contract['resourceTotals'],dict(sharedFiles=71,sharedBytes=8056649,manifestFiles=1))
        self.assertEqual(len(contract['files']),72)
        # The earlier six-job public integration superseded 15 converter
        # outputs. Preserve the original RS snapshot; current byte expectations
        # come from an independently audited deployed release, never this test.
        published=json.loads((ROOT/'contracts/rs-costume-runtime-baseline-v2.json').read_text('utf-8'))
        updates={row['file']:row for row in published['updates']}
        self.assertEqual(len(updates),15)
        self.assertFalse(published['originalClientMeasured'])
        for row in contract['files']:
            expected=row
            if row['file'] in updates:
                update=updates[row['file']]
                self.assertEqual(update['sourceSnapshot'],{'sha256':row['sha256'],'bytes':row['bytes']})
                expected=update['deployedRuntime']
            path=(ROOT/'artifacts/costumes'/row['file']).resolve()
            self.assertTrue(path.is_relative_to((ROOT/'artifacts/costumes').resolve()))
            data=path.read_bytes()
            self.assertEqual(len(data),expected['bytes'],row['file'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),expected['sha256'],row['file'])
        self.assertFalse(contract['clientMeasured'])

    def test_four_original_elsword_item_sets_are_distinct(self):
        expected={
            'officer':([130555,130556,130557,130558,130717],130550,[130646,89185]),
            'nasod':([130938,130939,130940,130941,130942],130892,[131010]),
            'royal':([132547,132548,132549,132550,132551],132546,[132763,82154]),
            'solace':([131773,131774,131775,131776,131777],131646,[131835,88402]),
        }
        self.assertEqual(set(self.contract['sets']),set(expected))
        for key,(body,weapon,accessories) in expected.items():
            with self.subTest(set=key):
                self.assertEqual(self.contract['sets'][key]['sourceItems'],dict(body=body,weapon=weapon,accessories=accessories))
                self.assertEqual(self.contract['sets'][key]['meshCount'],6)

    def test_rs_face_and_profession_default_meshes_are_retained_separately(self):
        source=self.contract['presentationBaseline']
        self.assertEqual(self.contract['face']['itemId'],45)
        self.assertEqual(self.contract['face']['models'][0].lower(),'mesh_elsword_ers_basic_face_sorted.x')
        self.assertEqual(source['keepFaceNodes'],['Elsword_Face_render'])
        self.assertEqual(source['meshCount'],7)
        self.assertEqual(set(source['replaceBodyAndWeaponNodes']),{'Object13','Elsword_Foot_render','Elsword_Hair_render',
            'Elsword_Hand_render','Elsword_Lowbody_render','Elsword_Upbody_render'})
        for row in self.contract['sets'].values():
            self.assertFalse(any(name.split('/')[-1]=='Elsword_Face' for name in row['meshNames']))
        self.assertEqual(hashlib.sha256((ROOT/'artifacts/rs/rs-runtime.glb').read_bytes()).hexdigest(),source['sha256'])

    def test_all_source_pose_and_skin_joints_exist_in_actual_rs_with_same_local_bind(self):
        rs_nodes={node['name']:node for node in self.rs['nodes']}
        for key,row in self.manifest['characters']['elsword'].items():
            with self.subTest(set=key):
                body=json_glb((ROOT/'artifacts/costumes/elsword'/key/row['glb']).read_bytes())
                body_nodes={node['name']:node for node in body['nodes']}
                self.assertEqual(len(row['poseFrames']),68)
                for frame in row['poseFrames']:
                    name=frame['name'];self.assertIn(name,rs_nodes)
                    self.assertLessEqual(max(abs(a-b) for a,b in zip(local_matrix(rs_nodes[name]),local_matrix(body_nodes[name]))),1e-5,name)
                for skin in body['skins']:
                    for index in skin['joints']:self.assertIn(body['nodes'][index]['name'],rs_nodes)

    def test_exact_accessory_mounts_and_only_three_hyper_swaps(self):
        expected={130646:('Bip01_Spine1',True),89185:('Bip01_R_UpperArm',False),131010:('Bip01_Spine1',True),
            132763:('Bip01_Head',False),82154:('Bip01_Head',False),131835:('Bip01_Spine1',True),88402:('Bip01_L_Forearm',False)}
        found={}
        for row in self.contract['sets'].values():
            for accessory in row['accessories']:
                self.assertEqual(len(accessory['models']),1)
                model=accessory['models'][0];found[accessory['itemId']]=(model['bone'],'awakened' in model)
                self.assertTrue(model['bonePresentInRs'])
                if 'awakened' in model:
                    self.assertIn('/Hyper_',model['awakened']['glb'])
                    self.assertNotEqual(model['awakened']['glb'],model['normal']['glb'])
                for mode in ('normal','awakened'):
                    if mode not in model:continue
                    for animation in model[mode]['animations']:
                        self.assertEqual(animation['ticksPerSecond'],4800)
                        self.assertGreater(animation['durationSeconds'],0)
                        self.assertEqual(animation['warnings'],[])
        self.assertEqual(found,expected)

    def test_glb_reader_accepts_legal_small_input_and_rejects_corruption(self):
        payload=b'{"asset":{"version":"2.0"}} '
        data=struct.pack('<4sIIII',b'glTF',2,20+len(payload),len(payload),0x4e4f534a)+payload
        self.assertEqual(json_glb(data),{'asset':{'version':'2.0'}})
        for cut in [0,4,12,19,len(data)-1]:
            with self.assertRaises(ValueError):json_glb(data[:cut])
        for offset,value in [(0,0),(4,1),(8,9999),(12,9999),(16,0)]:
            bad=bytearray(data);struct.pack_into('<I',bad,offset,value)
            with self.assertRaises(ValueError):json_glb(bad)

    def test_matrix_and_trs_encoding_equivalence_without_false_resource_drift(self):
        trs={'translation':[2,3,4],'rotation':[0,0,0,1],'scale':[2,3,4]}
        matrix={'matrix':[2,0,0,0,0,3,0,0,0,0,4,0,2,3,4,1]}
        self.assertEqual(local_matrix(trs),local_matrix(matrix))


if __name__=='__main__':unittest.main()
