"""Actual target2016 sample checks plus independent damaged-input cases."""
import hashlib
import gzip
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
sys.path.insert(0,str(ROOT/'tools/combat'))
from build_rf import Catalog
from ksm_convert import parse_ksm
from build_lk_profile import build


class TargetLkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile=json.loads((ROOT/'packages/combat-core/lk-profile.json').read_text('utf8'))

    def test_actual_identity_and_physics_are_elsword(self):
        p=self.profile
        self.assertEqual((p['target']['unitType'],p['target']['unitClass']),(1,100))
        self.assertEqual(p['physics']['RUN_SPEED'],740)
        self.assertEqual(p['physics']['DASH_JUMP_SPEED'],2300)
        self.assertFalse(any('RF_' in k or 'RAVEN' in k for k in p['states']))

    def test_common_roles_point_to_original_declarations(self):
        p=self.profile
        for role,source in p['stateAliases'].items():
            self.assertEqual(p['states'][role]['raw'],p['states'][source]['raw'])
            self.assertEqual(p['states'][role]['sourceState'],source)
            self.assertTrue(source.startswith('ESSI_'))

    def test_tree_trait_and_passive_ownership(self):
        p=self.profile;highest=[s for s in p['skillCatalog'] if s['topTier']]
        self.assertEqual(len(highest),26)
        self.assertEqual(p['defaultPassiveSkillIds'],[21400,21402,21401,21403,21404])
        self.assertTrue(all(s['unitClass']==100 for s in p['skillCatalog']))
        self.assertTrue(all(len(s['branches']) in (0,2) for s in p['skillCatalog']))
        mega=next(s for s in highest if s['skillId']==21026)
        self.assertEqual(mega['executor'],'MegaSlash')
        self.assertTrue(mega['supported'])
        self.assertEqual(mega['states'],['ESSI_SI_A_MEGASLASH_MEMO_READY','ESSI_SI_A_MEGASLASH_MEMO_CHARGE','ESSI_SI_A_MEGASLASH_MEMO_FIRE'])
        self.assertFalse(mega['fidelityVerified'])

    def test_target_pose_weights_and_sword_fields(self):
        p=self.profile
        self.assertEqual([r['weight'] for r in p['presentation']['pvpPoses']['start']],[80,15,5])
        self.assertEqual([r['weight'] for r in p['presentation']['pvpPoses']['win']],[35,35,10,10,5,5])
        self.assertEqual(p['referenceSemantics']['wayOfSword']['targetFields']['Const_VigorStateThreshold'],4800)
        self.assertEqual(p['referenceSemantics']['wayOfSword']['targetFields']['Const_DestStateThreshold'],-4800)
        self.assertEqual(p['enums']['ATTACK_TYPE']['AT_SPECIAL'],1)
        cache=ROOT/'.cache/lk/enum-declarations.json'
        if cache.is_file():
            original=json.loads(cache.read_text('utf8'))
            self.assertEqual(p['enums']['ATTACK_TYPE'],original['globals']['ATTACK_TYPE'])

    def test_actual_target_ksm_and_damaged_input(self):
        source=Path('asset_work')
        if not (source/'catalog.sqlite').is_file():self.skipTest('Read-only target2016 inputs unavailable')
        cat=Catalog(source);path=cat.path('Motion_Elsword_LK.x');raw=path.read_bytes()
        parsed=parse_ksm(path)
        self.assertEqual(len(parsed['frames']),68)
        self.assertEqual(len(parsed['animations']),17)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),cat.evidence(path)['sha256'])
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'Motion_Elsword_LK.x'
            for damaged in (raw[:16],raw[:-1],b'BROKEN'+raw[6:]):
                target.write_bytes(damaged)
                with self.assertRaises((ValueError,IndexError,EOFError)):parse_ksm(target)

    def test_profile_builder_rejects_absent_source_clip(self):
        cache=Path(os.environ.get('RF_LK_DECLARATION_CACHE',ROOT/'.cache/lk'))
        if not cache.is_dir() and 'RF_LK_DECLARATION_CACHE' not in os.environ:
            self.skipTest('Task-specific declaration cache unavailable; set RF_LK_DECLARATION_CACHE to a frozen read-only cache')
        for name,source in self.profile['sources'].items():
            row=json.loads((cache/(name+'-declarations.json')).read_bytes())
            self.assertEqual(row['source']['sha256'],source['sha256'])
        with tempfile.TemporaryDirectory() as tmp:
            assets=Path(tmp);(assets/'clips.json').write_text('[]',encoding='utf8')
            with self.assertRaisesRegex(ValueError,'animation unavailable'):build(cache,assets)

    def test_catalog_rejects_corruption_ambiguity_and_path_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp);(source/'raw').mkdir();data=b'authored-safe-fixture';(source/'raw/test.x').write_bytes(data)
            con=sqlite3.connect(source/'catalog.sqlite')
            catalogs=[]
            def catalog():
                value=Catalog(source);catalogs.append(value);return value
            con.execute('create table assets(name,archive,ordinal,raw_path,sha256,status)')
            sha=hashlib.sha256(data).hexdigest()
            con.execute('insert into assets values(?,?,?,?,?,?)',('test.x','fixture',0,'raw/test.x',sha,'ok'));con.commit()
            self.assertEqual(catalog().path('test.x').read_bytes(),data)
            (source/'raw/test.x').write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError,'SHA256'):catalog().path('test.x')
            con.execute('insert into assets values(?,?,?,?,?,?)',('test.x','fixture2',0,'raw/test.x','a'*64,'ok'));con.commit()
            with self.assertRaisesRegex(ValueError,'Ambiguous'):catalog().path('test.x')
            con.execute('insert into assets values(?,?,?,?,?,?)',('escape.x','fixture',0,'../escape.x',sha,'ok'));con.commit()
            with self.assertRaisesRegex(ValueError,'escapes'):catalog().path('escape.x')
            for value in catalogs:value.connection.close()
            con.close()

    def test_complete_runtime_outputs_and_effect_poses(self):
        output=ROOT/'artifacts/lk'
        if not (output/'outputs.json').is_file():self.skipTest('Task-specific converted assets unavailable')
        records=json.loads((output/'outputs.json').read_text('utf8'))
        for record in records:
            data=(output/record['file']).read_bytes()
            self.assertEqual(len(data),record['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),record['sha256'])
        manifest=json.loads((output/'manifest.json').read_text('utf8'))
        self.assertEqual(manifest['visualEffectIndexes'],['fx/index.json'])
        self.assertEqual(manifest['audioManifest'],'audio/manifest.json')
        full=json.loads(gzip.decompress((output/'pose-tracks.json.gz').read_bytes()))
        compact=json.loads((output/'runtime-pose.json').read_text('utf8'))
        nodes={f['name']:f for f in compact['frames']}
        self.assertIn('Bip01_Head',nodes)
        source_frames={f['name']:f for f in full['frames']}
        for name,node in nodes.items():
            self.assertEqual(node['nativeRowMatrix'],source_frames[name]['nativeRowMatrix'])
        for clip in compact['clips']:
            original=next(c for c in full['clips'] if c['name']==clip['name'])
            for track in clip['tracks']:
                source_track=next(t for t in original['tracks'] if t['frame_name']==track['frame_name'])
                for channel in ('translation','rotation','scale'):
                    values=dict(zip(source_track[channel]['times'],source_track[channel]['values']))
                    self.assertTrue(all(values[t]==v for t,v in zip(track[channel]['times'],track[channel]['values'])))
        fx=json.loads((output/'fx/index.json').read_text('utf8'))
        self.assertEqual(fx['meshFailures'],[])
        for template in fx['templates'].values():
            for key in ('glb','poseData'):
                if template.get(key):self.assertTrue((output/template[key]).is_file(),template[key])
            if template.get('poseData'):
                pose=json.loads((output/template['poseData']).read_text('utf8'))
                if pose.get('unsupportedTracks'):
                    self.assertTrue(template.get('animationRequiresUnconfirmedRate'),template['name'])


if __name__=='__main__':unittest.main()
