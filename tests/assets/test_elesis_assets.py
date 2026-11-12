"""Elesis actual source geometry, independent pixel and resource-closure checks."""
import gzip
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path(os.environ.get('ELESIS_RUNTIME_ROOT', ROOT/'artifacts'))
sys.path[:0] = [str(ROOT/'tools/assets/character'), str(ROOT/'tools/assets')]
from build_rf import Catalog, load_x, helpers_from_tree, walk
from ksm_convert import parse_ksm
from ui import read_tet, crop_piece
from runtime_path_case import canonical_runtime_path

def read(path): return json.loads(path.read_text('utf8'))
def sha(data): return hashlib.sha256(data).hexdigest()


class ElesisAssets(unittest.TestCase):
    def test_body_helpers_preserve_original_geometry_instead_of_empty_motion_dummies(self):
        catalog = Catalog(Path('asset_work'))
        native = parse_ksm(catalog.path('Motion_EL.x'))
        spheres = {f['name']: f for f in native['frames'] if 'SPHERE' in f['name']}
        self.assertEqual(len(spheres), 5)
        for job in ('gm','bh','ca'):
            pose = read(ASSETS/job/'runtime-pose.json')
            actual = {h['name']:h for h in pose['helpers'] if h['name'] in spheres}
            self.assertEqual(set(actual), set(spheres))
            for name, helper in actual.items():
                source = catalog.root/helper['source']
                original = next(h for h in helpers_from_tree(load_x(source),helper['source']) if h['name']==name)
                self.assertEqual(helper['nativeVertices'], original['nativeVertices'])
                self.assertEqual(helper['nativeTriangles'], original['nativeTriangles'])
                self.assertEqual(helper['nativeLocalBounds'], original['nativeLocalBounds'])
                self.assertEqual(len(helper['nativeVertices']), 24)
                self.assertNotIn('nativeStoredBoundingRadius', helper)
                self.assertGreater(helper['geometryBoundingSphereCandidate']['radius'], 0)
                self.assertEqual(helper['namedFrameRegistration']['motionSource'], catalog.evidence(catalog.path('Motion_EL.x'))['rawPath'])

    def test_actual_ca_motion_rejects_truncation_and_wrong_magic(self):
        catalog = Catalog(Path('asset_work'))
        path = catalog.path('Motion_EL_CA.x'); raw = path.read_bytes()
        self.assertGreater(len(parse_ksm(path)['animations']), 0)
        with tempfile.TemporaryDirectory() as directory:
            damaged = Path(directory)/'damaged.x'
            for value in (raw[:16],raw[:-1],b'FAIL'+raw[4:]):
                damaged.write_bytes(value)
                with self.assertRaises((ValueError,IndexError,EOFError)):parse_ksm(damaged)

    def test_infernal_x_and_y_do_not_overwrite_original_helpers(self):
        fx = read(ASSETS/'bh/fx/index.json')
        paths = {}
        for template in fx['templates'].values():
            mesh = template['fields'].get('MeshName') or template['fields'].get('Mesh') or ''
            if mesh.casefold() in ('spk_infernalblade_weaponm01.x','spk_infernalblade_weaponm01.y'):
                paths[Path(mesh).suffix.lower()] = template['poseData']
        self.assertEqual(set(paths), {'.x','.y'})
        self.assertNotEqual(paths['.x'],paths['.y'])
        x = read(ASSETS/'bh'/paths['.x']); y = read(ASSETS/'bh'/paths['.y'])
        self.assertTrue({'INFERNAL_BLADE_Dummy04','INFERNAL_BLADE_Dummy05','ATTACK_LINE_START0'} <= {f['name'] for f in x['frames']})
        self.assertEqual({f['name'] for f in y['frames']},{'Scene_Root','Object02'})

    def test_shared_clips_are_exact_source_keys_and_runtime_closure_is_case_exact(self):
        gm = read(ASSETS/'gm/manifest.json'); gm_clips = {c['name']:c for c in gm['clips']}
        for job in ('gm','bh','ca'):
            folder = ASSETS/job; manifest = read(folder/'manifest.json')
            clips = {c['name']:c for c in manifest['clips']}
            for name in manifest.get('sharedCharacterAnimations',{}).get('clips',[]):
                self.assertEqual(clips[name]['decodedKeysSha256'],gm_clips[name]['decodedKeysSha256'])
            pose = read(folder/'runtime-pose.json')
            if job != 'gm':
                self.assertEqual(pose['sharedPose'],'../gm/runtime-pose.json')
                self.assertIn('Wait',pose['sharedClips'])
            fx = read(folder/'fx/index.json')
            self.assertEqual(fx['meshFailures'],[])
            for template in fx['templates'].values():
                refs = [template[k] for k in ('glb','poseData') if template.get(k)]
                refs.extend(r['file'] for r in template.get('textures',{}).values())
                for name in refs:self.assertEqual(canonical_runtime_path(folder,name),name)
            report = read(ROOT/f'reports/{job}-assets-runtime.json')
            expected = {row['file']:row for row in report['outputs']}
            # Frozen corrections extend the v1 inventory with their reviewed
            # receipts. Expected hashes never come from the current assets.
            for patch in ('elesis-wildshock-clock-v2.json','elesis-judgment-resource-v3.json','elesis-buff-resource-v4.json'):
                correction = ROOT/'reports'/patch
                if correction.is_file():
                    for row in read(correction)['files']:
                        if row['file'].startswith(job+'/'):
                            name=row['file'][len(job)+1:];expected[name]={**row,'file':name}
            for row in expected.values():
                data = (folder/row['file']).read_bytes()
                self.assertEqual((len(data),sha(data)),(row['bytes'],row['sha256']))
            self.assertEqual(manifest['profile']['sha256'],sha((ROOT/f'packages/combat-core/{job}-profile.json').read_bytes().replace(b'\r\n',b'\n')))

    def test_sword_ui_has_original_red_charge_layer_and_tinted_pixels(self):
        catalog = Catalog(Path('asset_work'))
        folder = ASSETS/'ui/elesis-way-of-sword'; index = read(folder/'index.json')
        self.assertEqual(index['groups']['g_pStatic_EL_RED'][2]['piece'],'EL_RED_2')
        for rows in index['groups'].values():
            self.assertEqual(len(rows),6)
            for row in rows:
                with Image.open(catalog.path(row['atlas']+'.tga')) as image:
                    original,_ = crop_piece(image.convert('RGBA'),read_tet(catalog.path(row['atlas']+'.tet').read_bytes())[row['piece']])
                expected = Image.merge('RGBA',tuple(channel.point([int(v*factor+.5) for v in range(256)]) for channel,factor in zip(original.split(),row['color'])))
                with Image.open(folder/row['file']) as image:self.assertEqual(image.convert('RGBA').tobytes(),expected.tobytes())


if __name__ == '__main__': unittest.main()
