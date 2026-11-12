"""Real original minor declarations, corrupt input and measured DLL fail-closed."""
import copy, io, json, os, sys, tempfile, unittest
from pathlib import Path
from PIL import Image
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
sys.path.insert(0,str(Path(__file__).parent))
from asset_evidence import native_repo
import build_rf
from build_landing_fx import parse
from build_rf import Catalog, load_x, measured_effect_tick_rate, build_effect, walk
from export_samples import Exporter, named_material_definitions, resolve_mesh_materials, parser
from directx_animation import decode_animations
from native_d3dx_keys import decode_measured_native_keys, LANDING_REQUEST, LANDING_MANIFEST

class LiteralTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(os.environ.get('ELSWORD_ASSET_ROOT','asset_work'))
        if not self.root.is_dir():raise unittest.SkipTest('Read-only target original source missing')
        self.catalog=Catalog(self.root)
        self.proof_repo=native_repo(self,LANDING_REQUEST,LANDING_MANIFEST)
        self.native_patch=patch.object(build_rf,'decode_measured_native_keys',
            side_effect=lambda path,parsed:decode_measured_native_keys(path,parsed,repo_root=self.proof_repo))
        self.native_patch.start();self.addCleanup(self.native_patch.stop)
    def test_actual_target_smoke_and_ground_declarations(self):
        source=self.catalog.path('GameMinorParticle.txt').read_bytes().decode('latin1')
        ground,_=parse(source,'GroundShockWave');smoke,_=parse(source,'DownSmoke');stone,_=parse(source,'AirDownTick')
        self.assertEqual(ground['fields']['Lifetime'],.3);self.assertEqual(ground['fields']['NumParticles'],2)
        self.assertEqual(smoke['fields']['NumParticles'],10);self.assertEqual(smoke['fields']['Lifetime'],1)
        self.assertEqual(stone['fields']['UseLand'],True);self.assertEqual(stone['fields']['Gravity'],[0,-2000,0])
        self.assertEqual([e['value'] for e in smoke['events'] if e['property']=='Texture'],['smoke.dds'])
        self.assertEqual([e['value'] for e in stone['events'] if e['property']=='Texture'],['stone.dds'])
    def test_duplicate_unknown_and_corrupt_declarations_are_rejected(self):
        for text in ['eventsequence "A" { particleType = PT_3D_PLANE }\neventsequence "A" { particleType = PT_3D_PLANE }',
            'eventsequence "A" { unknown nonsense }','eventsequence "A" { particleType = PT_FAKE }',
            'eventsequence "A" { particleType = PT_3D_PLANE\ninitial size= XYZ(1,2) }',
            'eventsequence "A" { particleType = PT_3D_PLANE']:
            with self.subTest(text=text),self.assertRaises(ValueError):parse(text,'A')
    def test_original_dropdown_loader_period_and_keys_are_measured_and_sha_scoped(self):
        path=self.catalog.path('Effect_ElSword_dropdown.X')
        parsed=decode_animations(load_x(path),include_native_matrices=True)
        measured=decode_measured_native_keys(path,parsed,repo_root=self.proof_repo)
        self.assertEqual(len(measured),1);self.assertEqual(measured[0]['name'],'dropdown')
        self.assertEqual(measured[0]['ticks_per_second'],4800)
        self.assertEqual(measured[0]['duration_seconds'],.3333333432674408)
        self.assertTrue(measured[0]['native_d3dx_keys'])
        self.assertEqual(measured_effect_tick_rate(path)['ticksPerSecond'],4800)
        self.assertTrue(all(t['warnings']==[] for t in measured[0]['tracks']))
        with tempfile.TemporaryDirectory() as folder:
            wrong=Path(folder)/path.name;wrong.write_bytes(path.read_bytes()+b'corrupt')
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decode_measured_native_keys(wrong,parsed,repo_root=self.proof_repo)
    def test_tampered_native_key_artifact_fails_closed(self):
        path=self.catalog.path('Effect_ElSword_dropdown.X')
        parsed=decode_animations(load_x(path),include_native_matrices=True)
        with tempfile.TemporaryDirectory() as folder:
            temp=Path(folder)
            request=temp/LANDING_REQUEST;request.parent.mkdir(parents=True);request.write_bytes((ROOT/LANDING_REQUEST).read_bytes())
            manifest=json.loads((ROOT/LANDING_MANIFEST).read_text('utf-8'))
            artifact=temp/manifest['artifact']['path'];artifact.parent.mkdir(parents=True);artifact.write_bytes(b'corrupt')
            (temp/LANDING_MANIFEST).write_text(json.dumps(manifest),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decode_measured_native_keys(path,parsed,repo_root=temp)
    def test_actual_dropdown_global_material_resolves_original_tga_pixels(self):
        source=self.catalog.path('Effect_ElSword_dropdown.X');tree=load_x(source)
        matlist=next(n for n,_ in walk(tree) if n.kind=='MeshMaterialList')
        self.assertEqual([n.kind for n in matlist.children],['REF'])
        self.assertEqual(matlist.children[0].values,[(parser.TOK_WORD,'PDX04_-_Default')])
        material,=resolve_mesh_materials(matlist,named_material_definitions(tree))
        self.assertEqual(material.name,'PDX04_-_Default')
        self.assertEqual(material.nums()[:4],[1,1,1,1])
        self.assertEqual(material.child('TextureFilename').strings(),['DropDown.tga'])
        with tempfile.TemporaryDirectory() as folder:
            exporter=Exporter(source.stem,texture_lookup=self.catalog,asset_root=self.catalog.root)
            exporter.add(source,Path(folder),tree=tree,clips_override=[])
            self.assertEqual(len(exporter.doc['textures']),1)
            output_material,=exporter.doc['materials']
            self.assertEqual(output_material['pbrMetallicRoughness']['baseColorTexture'],{'index':0})
            image=exporter.doc['images'][0];view=exporter.doc['bufferViews'][image['bufferView']]
            blob=exporter.buffer[view['byteOffset']:view['byteOffset']+view['byteLength']]
            pixels=Image.open(io.BytesIO(blob)).convert('RGBA')
            original=Image.open(self.catalog.path('DropDown.tga')).convert('RGBA')
            self.assertEqual(pixels.size,original.size);self.assertEqual(pixels.tobytes(),original.tobytes())
            self.assertEqual(exporter.missing_textures,set())
            self.assertIn('DropDown.tga',[v['name'] for v in self.catalog.used.values()])
            converted=build_effect(self.catalog,Path(folder),'Effect_ElSword_dropdown.X')
            final_material,=converted['asset']['materials']
            self.assertEqual(final_material['alphaMode'],'BLEND');self.assertNotIn('alphaCutoff',final_material)
            self.assertEqual(final_material['pbrMetallicRoughness']['baseColorTexture'],{'index':0})
            self.assertEqual(converted['asset']['triangles'],20)
    def test_rigid_mesh_named_material_does_not_fail_texture_visibility_filter(self):
        tree=load_x(self.catalog.path('Effect_ElSword_dropdown.X'))
        for node,_ in walk(tree):
            node.children=[child for child in node.children if child.kind!='SkinWeights']
        with tempfile.TemporaryDirectory() as folder:
            rigid=Path(folder)/'Mesh_OriginalReference.X'
            exporter=Exporter(rigid.stem,texture_lookup=self.catalog,asset_root=Path(folder))
            exporter.add(rigid,Path(folder),tree=tree,clips_override=[])
            self.assertEqual(len(exporter.doc['meshes']),1);self.assertEqual(len(exporter.doc['textures']),1)
    def test_material_refs_keep_mixed_slots_and_reject_unknown_ambiguous_or_corrupt_refs(self):
        tree=load_x(self.catalog.path('Effect_ElSword_dropdown.X'))
        definitions=named_material_definitions(tree)
        original=next(n for n,_ in walk(tree) if n.kind=='MeshMaterialList')
        inline=parser.XNode('Material','Inline');inline.values=[(parser.TOK_NUM,str(v)) for v in (0,1,0,1)]
        mixed=copy.deepcopy(original);mixed.values[0]=(parser.TOK_NUM,'2');mixed.children.append(inline)
        resolved=resolve_mesh_materials(mixed,definitions)
        self.assertEqual([v.name for v in resolved],['PDX04_-_Default','Inline'])
        for label,change in [('unknown',[(parser.TOK_WORD,'Unknown')]),
                             ('wrong-case',[(parser.TOK_WORD,'pdx04_-_default')]),
                             ('empty',[]),('two-names',[(parser.TOK_WORD,'PDX04_-_Default')]*2)]:
            bad=copy.deepcopy(original);bad.children[0].values=change
            with self.subTest(label=label),self.assertRaises(ValueError):resolve_mesh_materials(bad,definitions)
        duplicate={**definitions,'PDX04_-_Default':definitions['PDX04_-_Default']*2}
        with self.assertRaisesRegex(ValueError,'ambiguous'):resolve_mesh_materials(original,duplicate)
        bad=copy.deepcopy(original);bad.children=[]
        with self.assertRaisesRegex(ValueError,'slot count'):resolve_mesh_materials(bad,definitions)
        bad=copy.deepcopy(original);bad.children[0].kind='Frame'
        with self.assertRaisesRegex(ValueError,'Unsupported'):resolve_mesh_materials(bad,definitions)
    def test_actual_dropdown_missing_referenced_texture_fails_closed(self):
        real=self.catalog
        class MissingTextureCatalog:
            root=real.root
            def path(self,name):return real.path(name)
            def evidence(self,path):return real.evidence(path)
            def get(self,name,default=None):return default if name.casefold()=='dropdown.tga' else real.get(name,default)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'Missing effect textures.*DropDown.tga'):
                build_effect(MissingTextureCatalog(),Path(folder),'Effect_ElSword_dropdown.X')

if __name__=='__main__':unittest.main()
