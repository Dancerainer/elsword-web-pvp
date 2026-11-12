"""Actual original NPC and corrupt receipt tests; expectations are source-backed."""
import copy,json,re,struct,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog,load_x,walk,digest,uniquify_effect_frames
from build_rf_fx import declaration
from directx_animation import decode_animations
import native_d3dx_keys as decoder
read=lambda p:json.loads(p.read_text('utf8'))
OUT=ROOT/'artifacts/mm/summons/apocalypse'
class ApocalypseAssets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.catalog=Catalog(Path('asset_work'))
    def test_original_npc_geometry_and_named_motion_binding(self):
        m=read(OUT/'manifest.json');p=self.catalog.path('Motion_AMM_APOCALYPSE.x');tree=load_x(p)
        self.assertEqual(digest(p.read_bytes()),'b6aa14c0918c8498951f45f1c68fa858f872a93e97600236b3cb610f5ad6a8bd')
        self.assertEqual(sum(n.kind=='Mesh' for n,_ in walk(tree)),38)
        self.assertEqual(sum(n.kind=='SkinWeights' for n,_ in walk(tree)),0)
        original=decode_animations(tree,include_native_matrices=True);named={t['frame_name']for c in original for t in c['tracks']}
        self.assertTrue(named);self.assertNotIn('',named)
        uniquify_effect_frames(tree);frames={n.name for n,_ in walk(tree)if n.kind=='Frame'}
        self.assertTrue(named<=frames);self.assertEqual(len(frames),117);self.assertNotIn('Bip01',frames)
        self.assertEqual(m['body']['asset']['meshes'],37);self.assertEqual(m['body']['asset']['skins'],0)
        self.assertEqual(m['unitScale'],1.33);self.assertEqual(m['npcId'],1604)
        self.assertEqual({c['name'] for c in m['clips']},{'Start','Wait','Attack_A','Attack_B','Attack_C','Attack_F'})
        self.assertEqual(len(m['stateBindings']),9);self.assertEqual(m['stateBindings']['APOCALYPSE_ATTACK_C']['rawAnimationSpeed'],1.3)
        self.assertGreater(len(m['effectOwnerBoneAudit']['bindings']),40);self.assertEqual(m['effectOwnerBoneAudit']['missing'],[])
        self.assertNotIn('EffectSet_SI_HA_AMM_Apocalypse',m['effectOwnerBoneAudit']['sourceEffectSets'])
    def test_actual_dll_identity_and_malformed_provenance_fail_closed(self):
        request=(ROOT/decoder.APOCALYPSE_REQUEST).read_bytes();rows=json.loads(request)['sources']
        self.assertEqual(len(rows),9);self.assertEqual(digest(request),decoder.APOCALYPSE_REQUEST_SHA)
        manifest=read(ROOT/decoder.APOCALYPSE_MANIFEST);artifact=(ROOT/manifest['artifact']['path']).read_bytes()
        self.assertEqual(digest(artifact),manifest['artifact']['sha256']);self.assertEqual(digest(Path(manifest['dll']['path']).read_bytes()),decoder.DLL_SHA)
        for row in rows:
            path=Path(row['source']);self.assertEqual(digest(path.read_bytes()),row['sourceSha256'])
            parsed=decode_animations(load_x(path),include_native_matrices=True)
            decoded=decoder.decode_measured_native_keys(path,parsed)
            self.assertEqual(len(decoded or []),len(row['nativeAnimations']))
            native={c['name']:c for c in row['nativeAnimations']}
            for c in decoded or []:
                self.assertEqual(c['duration_seconds'],native[c['name']]['period']);self.assertEqual(c['ticks_per_second'],4800)
        p=self.catalog.path('Motion_AMM_APOCALYPSE.x');parsed=decode_animations(load_x(p),include_native_matrices=True)
        with tempfile.TemporaryDirectory()as tmp:
            base=Path(tmp);req=base/decoder.APOCALYPSE_REQUEST;req.parent.mkdir(parents=True)
            req.write_bytes(request);(base/decoder.APOCALYPSE_MANIFEST).write_bytes((ROOT/decoder.APOCALYPSE_MANIFEST).read_bytes())
            keys=base/manifest['artifact']['path'];keys.parent.mkdir(parents=True);keys.write_bytes(artifact)
            req.write_bytes(request+b' ')
            with self.assertRaisesRegex(ValueError,'registry hash mismatch'):decoder.decode_measured_native_keys(p,parsed,base)
            req.write_bytes(request);broken=base/p.name;broken.write_bytes(p.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decoder.decode_measured_native_keys(broken,parsed,base)
            keys.write_bytes(artifact[:-1])
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decoder.decode_measured_native_keys(p,parsed,base)
    def test_source_curves_remain_complete_and_runtime_paths_closed(self):
        index=read(OUT/'fx/index.json');self.assertEqual(len(index['templates']),22)
        self.assertEqual(index['meshFailures'],[]);self.assertEqual(index['missingTemplates'],[])
        files={}
        for name,t in index['templates'].items():
            self.assertFalse(t['unsupported'],name);self.assertFalse(t.get('animationRequiresUnconfirmedRate'),name)
            source=self.catalog.root/t['source']['rawPath'];text=files.setdefault(source,source.read_bytes().decode('latin1'))
            match=re.search(r'(?:eventsequence|templet)\s+"'+re.escape(name)+r'"\s*\{([^{}]*)\}',text,re.I)
            self.assertIsNotNone(match,name);raw=declaration(match[1]);self.assertEqual(t['fields'],raw['fields'],name);self.assertEqual(t['events'],raw['events'],name)
            for ref in [t[k]for k in ('glb','poseData')if t.get(k)]+[v['file']for v in t['textures'].values()]:self.assertTrue((OUT/ref).is_file(),ref)
        report=read(ROOT/'reports/mm-apocalypse-assets-handoff-v1.json')
        for row in report['files']:
            p=ROOT/'artifacts'/row['file'];self.assertEqual(digest(p.read_bytes()),row['sha256']);self.assertEqual(p.stat().st_size,row['bytes'])
        for ref,row in report['existingDependencies'].items():self.assertEqual(digest((ROOT/'artifacts'/ref).read_bytes()),row['sha256'])
    def test_audio_matches_original_bytes_and_container_validation(self):
        m=read(OUT/'audio/manifest.json');self.assertEqual(m['unsupported'],[]);self.assertEqual(len(m['files']),5)
        for name,row in m['files'].items():
            self.assertTrue(row['crcValidated']);p=ROOT/'artifacts/audio'/row['file'];self.assertEqual(digest(p.read_bytes()),digest(self.catalog.path(name).read_bytes()))
if __name__=='__main__':unittest.main()
