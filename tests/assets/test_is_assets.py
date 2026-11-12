"""IS original sample, sharing, exact portrait and frozen-DLL failure checks."""
import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog, load_x
from ksm_convert import parse_ksm
from directx_animation import decode_animations
import native_d3dx_keys as decoder
from runtime_path_case import canonical_runtime_path
from ui import read_tet, crop_piece


def read(path):return json.loads(path.read_text('utf8'))
def sha(raw):return hashlib.sha256(raw).hexdigest()


class IsAssets(unittest.TestCase):
    def test_actual_is_motion_and_damaged_input(self):
        catalog=Catalog(Path('asset_work'))
        source=catalog.path('Motion_Elsword_IS.x');raw=source.read_bytes();parsed=parse_ksm(source)
        self.assertEqual((len(parsed['frames']),len(parsed['animations'])),(68,12))
        self.assertEqual(sha(raw),catalog.evidence(source)['sha256'])
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/source.name
            for broken in (raw[:16],raw[:-1],b'BROKEN'+raw[6:]):
                target.write_bytes(broken)
                with self.assertRaises((ValueError,IndexError,EOFError)):parse_ksm(target)

    def test_shared_motion_keys_match_source_and_lk(self):
        manifest=read(ROOT/'artifacts/is/manifest.json');lk=read(ROOT/'artifacts/lk/manifest.json')
        clips={c['name']:c for c in manifest['clips']};shared={c['name']:c for c in lk['clips']}
        self.assertEqual((manifest['id'],manifest['unitClass']),('is',112))
        self.assertEqual(len(manifest['clips']),165)
        self.assertEqual(len(manifest['sharedCharacterAnimations']['clips']),127)
        for name in manifest['sharedCharacterAnimations']['clips']:
            self.assertEqual(clips[name]['decodedKeysSha256'],shared[name]['decodedKeysSha256'])
            self.assertIn(name,lk['runtimeCharacter']['selection']['included'])
        sources=[row['name'].lower() for row in manifest['sourceEvidence']]
        self.assertIn('mesh_elsword_eis_cash_upbody_sorted.x',sources)
        self.assertNotIn('mesh_elsword_elk_cash_upbody_sorted.x',sources)

    def test_original_is_portraits_use_the_compatible_native_atlas(self):
        catalog=Catalog(Path('asset_work'))
        rows=read(ROOT/'artifacts/is/ui/manifest.json')['pieces']
        self.assertEqual(set(rows),{'party','icon','state'})
        for kind,row in rows.items():
            atlas=catalog.path(row['atlasSource']['name']);tet=catalog.path(row['tetSource']['name'])
            with Image.open(atlas) as img:expected,_=crop_piece(img.convert('RGBA'),read_tet(tet.read_bytes())[row['piece']])
            with Image.open(ROOT/'artifacts/is'/row['file']) as actual:
                self.assertEqual(actual.convert('RGBA').tobytes(),expected.tobytes())
            self.assertEqual(row['piece'],'I_SWORD_FACE' if kind=='state' else 'I_SWORD_'+kind.upper())
            self.assertIn('66',atlas.name)
            if kind=='state':self.assertEqual((row['width'],row['height']),(103,83))

    def test_runtime_outputs_case_closure_and_source_seal(self):
        root=ROOT/'artifacts/is';report=read(ROOT/'reports/is-assets-runtime.json')
        for row in report['outputs']:
            data=(root/row['file']).read_bytes()
            self.assertEqual((len(data),sha(data)),(row['bytes'],row['sha256']))
        fx=read(root/'fx/index.json')
        self.assertEqual(fx['meshFailures'],[])
        self.assertEqual(fx['missingTemplates'],[])
        self.assertEqual(fx['profileSha256'],sha((ROOT/'packages/combat-core/is-profile.json').read_bytes().replace(b'\r\n',b'\n')))
        self.assertIn('HyperBoostRight',fx['templates']);self.assertIn('HyperBoostLeft',fx['templates'])
        for name,t in fx['templates'].items():
            self.assertFalse(t.get('animationRequiresUnconfirmedRate'),name)
            refs=[t[k] for k in ('glb','poseData') if t.get(k)]+[r['file'] for r in t['textures'].values()]
            for ref in refs:self.assertEqual(ref,canonical_runtime_path(root,ref))
        for row in read(root/'audio/manifest.json')['files'].values():
            self.assertEqual(sha((ROOT/'artifacts/audio'/row['file']).read_bytes()),row['sha256'])
            # game.mjs rebases bare profession paths below /assets/is/. Shared
            # root audio must use an explicit relative URL to survive loading.
            runtime_file=row['file'] if row['file'].startswith('../') else '../is/'+row['file']
            self.assertEqual(sha((ROOT/'artifacts/audio'/runtime_file).read_bytes()),row['sha256'])

    def test_native_key_registry_and_damaged_evidence_fail_closed(self):
        raw=(ROOT/decoder.IS_FX_REQUEST).read_bytes();request=json.loads(raw)
        self.assertEqual(sha(raw),decoder.IS_FX_REQUEST_SHA)
        manifest=read(ROOT/decoder.IS_FX_MANIFEST);artifact=(ROOT/manifest['artifact']['path']).read_bytes()
        self.assertEqual(sha(artifact),manifest['artifact']['sha256'])
        row=next(r for r in request['sources'] if 'swordfall' in r['source'].lower())
        path=Path(row['source']);parsed=decode_animations(load_x(path),include_native_matrices=True)
        output=decoder.decode_measured_native_keys(path,parsed)
        self.assertTrue(output);self.assertTrue(all(c['ticks_per_second']>0 for c in output))
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp);req=target/decoder.IS_FX_REQUEST;req.parent.mkdir(parents=True);req.write_bytes(raw)
            (target/decoder.IS_FX_MANIFEST).write_bytes((ROOT/decoder.IS_FX_MANIFEST).read_bytes())
            keys=target/manifest['artifact']['path'];keys.parent.mkdir(parents=True);keys.write_bytes(artifact)
            req.write_bytes(raw+b' ')
            with self.assertRaisesRegex(ValueError,'registry hash mismatch'):decoder.decode_measured_native_keys(path,parsed,target)
            req.write_bytes(raw);broken=target/path.name;broken.write_bytes(path.read_bytes()[:-1])
            with self.assertRaisesRegex(ValueError,'source hash mismatch'):decoder.decode_measured_native_keys(broken,parsed,target)
            keys.write_bytes(artifact[:-1])
            with self.assertRaisesRegex(ValueError,'artifact hash/size mismatch'):decoder.decode_measured_native_keys(path,parsed,target)


if __name__=='__main__':unittest.main()
