"""Original ADD sample, malformed inputs, exact sharing and source closure checks."""
import copy,hashlib,json,re,struct,sys,tempfile,unittest
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets'),str(ROOT/'tools/localization')]
from build_rf import Catalog,load_x,walk,validate_weapon_mounts,to_tree
from build_add import spec
from ksm_convert import parse_ksm
from directx_animation import decode_animations
import native_d3dx_keys as decoder
from build_add_ui import crop_rotated
from ui import read_tet
from runtime_path_case import canonical_runtime_path
from build_rf_fx import declaration
read=lambda p:json.loads(p.read_text('utf8'))
sha=lambda b:hashlib.sha256(b).hexdigest()
def glb(path):
    raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];return json.loads(raw[20:20+n])

class AddAssets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.catalog=Catalog(Path('asset_work'))
    def test_actual_mounts_and_rejected_broken_definitions(self):
        c=self.catalog;frames={n.name:n for n,_ in walk(to_tree(parse_ksm(c.path('Motion_ADD.x')))) if n.kind=='Frame'}
        self.assertNotIn('Dummy1_Rhand',frames)
        for job in ('lp','mm','de'):
            s=spec(job);tree=load_x(c.path(s['weapon']));mounts=s['weaponMounts']
            actual=validate_weapon_mounts(tree,frames,mounts)
            self.assertEqual([n.name for n in actual],['Weapon01']*6)
            for bad in ([],[{}],[dict(mounts[0]),dict(mounts[0])],[{**mounts[0],'target':'NoSuchBone'}],[{**mounts[0],'source':'NoSuchFrame'}],[{**mounts[0],'name':'Weapon01'}]):
                with self.assertRaises(ValueError):validate_weapon_mounts(tree,frames,bad)
            broken=copy.deepcopy(tree)
            for n,_ in walk(broken):
                if n.kind=='Frame' and n.name=='Weapon01':n.children=[v for v in n.children if v.kind!='FrameTransformMatrix']
            with self.assertRaisesRegex(ValueError,'transform missing'):validate_weapon_mounts(broken,frames,mounts)
    def test_original_add_ksm_and_truncated_input(self):
        p=self.catalog.path('Motion_ADD.x');raw=p.read_bytes();parsed=parse_ksm(p)
        self.assertTrue(parsed['animations']);self.assertEqual(sha(raw),self.catalog.evidence(p)['sha256'])
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/p.name
            for bad in (raw[:16],raw[:-1],b'BROKEN'+raw[6:]):
                target.write_bytes(bad)
                with self.assertRaises((ValueError,EOFError,IndexError)):parse_ksm(target)
    def test_models_six_mounts_original_transforms_and_exact_shared_clips(self):
        shared=read(ROOT/'artifacts/lp/manifest.json');gold={v['name']:v for v in shared['clips']}
        for job,count in (('lp',192),('mm',217),('de',225)):
            root=ROOT/'artifacts'/job;m=read(root/'manifest.json');doc=glb(root/m['runtimeGlb']);names={n['name']:n for n in doc['nodes']}
            self.assertEqual(len(m['clips']),count);self.assertIn('Add_Base_Face_render',names)
            self.assertEqual(len([a for a in m['attachments'] if a['type']=='rigid']),6)
            for mount in spec(job)['weaponMounts']:
                self.assertIn(mount['name'],names);self.assertIn(doc['nodes'].index(names[mount['name']]),names[mount['target']]['children'])
            for name in m.get('sharedCharacterAnimations',{}).get('clips',[]):
                own=next(v for v in m['clips'] if v['name']==name);self.assertEqual(own['decodedKeysSha256'],gold[name]['decodedKeysSha256'])
            self.assertEqual(m['runtimeCharacter']['profileCoverage']['unresolvedEffectOwnerBones'],['Dummy1_Rhand'] if job=='lp' else [])
    def test_original_rotated_hud_crop_and_malformed_tet(self):
        c=self.catalog;raw=c.path('DLG_UI_Common_Texture80_NEW.tet').read_bytes();pieces=read_tet(raw)
        img=Image.open(c.path('DLG_UI_Common_Texture80_NEW.tga')).convert('RGBA')
        piece=pieces['BG_ADDGAUGE_GLOW'];expected,_,orientation=crop_rotated(img,piece)
        self.assertEqual(expected.size,(191,8));self.assertIn('90 degree',orientation)
        actual=Image.open(ROOT/'artifacts/ui/add/bg_addgauge_glow.png').convert('RGBA')
        self.assertEqual(actual.tobytes(),expected.tobytes())
        with self.assertRaises((ValueError,IndexError,struct.error)):read_tet(raw[:-1])
        broken=copy.deepcopy(piece);broken['points'][0][0]=-100
        with self.assertRaises(ValueError):crop_rotated(img,broken)
    def test_runtime_payload_hashes_and_closed_paths(self):
        for job,templates in (('lp',593),('mm',485),('de',674)):
            root=ROOT/'artifacts'/job;report=read(ROOT/f'reports/{job}-assets-runtime.json')
            for row in report['outputs']+report['dependencies']:
                path=root/row['file'];self.assertEqual(sha(path.read_bytes()),row['sha256'],str(path))
            fx=read(root/'fx/index.json');self.assertEqual(len(fx['templates']),templates);self.assertEqual(fx['meshFailures'],[])
            self.assertIn('ADD_STR_ToKang',fx['templates'])
            for name,t in fx['templates'].items():
                self.assertFalse(t.get('animationRequiresUnconfirmedRate'),name);self.assertFalse(t.get('unsupported'),name)
                refs=[t[k] for k in ('glb','poseData') if t.get(k)]+[r['file'] for r in t['textures'].values()]
                for ref in refs:self.assertEqual(ref,canonical_runtime_path(root,ref))
            for row in read(root/'audio/manifest.json')['files'].values():self.assertEqual(sha((ROOT/'artifacts/audio'/row['file']).read_bytes()),row['sha256'])
    def test_all_1072_original_declarations_keep_every_field_and_curve(self):
        seen=set();sources={}
        for job in ('lp','mm','de'):
            for name,t in read(ROOT/f'artifacts/{job}/fx/index.json')['templates'].items():
                key=(t['source']['rawPath'],t['declarationSha256'])
                if key in seen:continue
                seen.add(key)
                if key[0] not in sources:sources[key[0]]=(Path('asset_work')/key[0]).read_bytes().decode('latin1')
                match=re.match(r'(?:TEMPLET|eventsequence)\s+"([^"\r\n]+)"\s*\{([^{}]*)\}',sources[key[0]][t['source']['byteOffset']:])
                self.assertIsNotNone(match,name);self.assertEqual(sha(match[0].encode('latin1')),key[1],name)
                original=declaration(match[2],casefold_tokens='Minor' in key[0])
                self.assertEqual(t['fields'],original['fields'],name);self.assertEqual(t['events'],original['events'],name)
        self.assertEqual(len(seen),1072)
    def test_219_actual_native_sources_and_damaged_evidence(self):
        request_raw=(ROOT/decoder.ADD_FX_REQUEST).read_bytes();req=json.loads(request_raw);self.assertEqual(len(req['sources']),219)
        self.assertEqual(sha(request_raw),decoder.ADD_FX_REQUEST_SHA)
        manifest=read(ROOT/decoder.ADD_FX_MANIFEST);artifact=(ROOT/manifest['artifact']['path']).read_bytes()
        self.assertEqual(sha(artifact),manifest['artifact']['sha256']);self.assertEqual(sha(Path(manifest['dll']['path']).read_bytes()),decoder.DLL_SHA)
        for row in req['sources']:self.assertEqual(sha(Path(row['source']).read_bytes()),row['sourceSha256'])
        row=next(v for v in req['sources'] if 'formation' in v['source'].lower());p=Path(row['source']);parsed=decode_animations(load_x(p),include_native_matrices=True)
        decoded=decoder.decode_measured_native_keys(p,parsed);self.assertTrue(decoded);self.assertTrue(all(c['ticks_per_second']>0 for c in decoded))
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);request=base/decoder.ADD_FX_REQUEST;request.parent.mkdir(parents=True);request.write_bytes(request_raw)
            (base/decoder.ADD_FX_MANIFEST).write_bytes((ROOT/decoder.ADD_FX_MANIFEST).read_bytes());keys=base/manifest['artifact']['path'];keys.parent.mkdir(parents=True);keys.write_bytes(artifact)
            request.write_bytes(request_raw+b' ')
            with self.assertRaisesRegex(ValueError,'registry hash mismatch'):decoder.decode_measured_native_keys(p,parsed,base)
            request.write_bytes(request_raw);broken=base/p.name;broken.write_bytes(p.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decoder.decode_measured_native_keys(broken,parsed,base)
            keys.write_bytes(artifact[:-1])
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decoder.decode_measured_native_keys(p,parsed,base)
    def test_add_skill_display_uses_original_name_and_values(self):
        display=read(ROOT/'packages/localization/skill-text.json')
        ids=set()
        for job in ('lp','mm','de'):
            rows=read(ROOT/f'packages/combat-core/{job}-profile.json')['skillCatalog']
            self.assertEqual(len(rows),37)
            for row in rows:
                sid=str(row['skillId']);ids.add(sid)
                self.assertEqual(display[sid]['name'],row['raw']['m_wstrName'])
                self.assertEqual(display[sid].get('effect'),row['raw'].get('m_EffectiveDesc',{}).get(str(row['maxLevel'])))
        self.assertEqual(len(ids),79)
    def test_costume_manifest_preserves_six_rigid_weapons(self):
        sets=read(ROOT/'artifacts/costumes/manifest.json')['characters']['add'];self.assertEqual(set(sets),{'officer','nasod','royal','solace'})
        for name,entry in sets.items():
            self.assertEqual(entry['weaponNodes'],[f'Costume_Dynamo{i:02}' for i in range(1,7)])
            doc=glb(ROOT/f'artifacts/costumes/add/{name}/body.glb');names={n['name'] for n in doc['nodes']}
            self.assertTrue(set(entry['weaponNodes'])<=names);self.assertFalse(any(a.get('bone')=='Costume_SwordMount' for a in entry['attachments']))
if __name__=='__main__':unittest.main()
