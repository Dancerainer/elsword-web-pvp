"""Consumer spelling fixes preserve original declarations and profile bytes."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from patch_runtime_path_case import prepare,write,read
from apply_prepared_asset_import import execute

class RuntimeCasePatch(unittest.TestCase):
    def fixture(self,directory):
        root=Path(directory);assets=root/'repo/artifacts';output=root/'prepared'
        texture=assets/'lk/fx/Smoke.png';texture.parent.mkdir(parents=True);texture.write_bytes(b'unchanged converted texture')
        template={'declarationSha256':'source-declaration','fields':{'TEXTURE':'SMOKE.TGA'},'textures':{'0':{'file':'fx/smoke.png'}}}
        write(assets/'lk/effect-assets.json',{'templates':{'Smoke':template}})
        write(assets/'lk/fx/index.json',{'templates':{'LaterParticle':{'declarationSha256':'later-source-declaration'}}})
        write(assets/'lk/manifest.json',{'profile':{'profileId':'lk-target2016-v1','sha256':'old'},'effectAssetIndex':'effect-assets.json','effectTemplates':{'templates':{'Smoke':template}}})
        write(assets/'rf/shadow-weapon-fx/index.json',{'templates':{}})
        profile=assets.parent/'packages/combat-core/lk-profile.json'
        write(profile,{'target':{'unitClass':100},'profileId':'lk-target2016-v1','effectTemplates':{'Smoke':{'declarationSha256':'source-declaration'},'LaterParticle':{'declarationSha256':'later-source-declaration'}}})
        profile.write_bytes(profile.read_bytes().replace(b'\n',b'\r\n'))
        return assets,output,profile
    def test_later_visual_declaration_and_lf_profile_seal_preserve_bytes(self):
        with tempfile.TemporaryDirectory()as directory:
            assets,output,profile=self.fixture(directory);before=profile.read_bytes();plan=prepare(assets,output)
            self.assertEqual(execute(plan)['mode'],'verified-only')
            self.assertEqual(execute(plan,True)['copied'],2)
            manifest=read(assets/'lk/manifest.json');self.assertEqual(manifest['profile']['sha256'],hashlib.sha256(before.replace(b'\r\n',b'\n')).hexdigest())
            changed=manifest['effectTemplates']['templates']['Smoke']
            self.assertEqual(changed['textures']['0']['file'],'fx/Smoke.png');self.assertEqual(changed['fields'],{'TEXTURE':'SMOKE.TGA'})
            self.assertEqual(profile.read_bytes(),before);self.assertEqual((assets/'lk/fx/Smoke.png').read_bytes(),b'unchanged converted texture')
            self.assertEqual(execute(plan,True)['alreadyPresent'],2)
    def test_declaration_mismatch_rejects_sealing(self):
        with tempfile.TemporaryDirectory()as directory:
            assets,output,profile=self.fixture(directory)
            write(assets/'lk/fx/index.json',{'templates':{'LaterParticle':{'declarationSha256':'wrong-source'}}})
            with self.assertRaisesRegex(ValueError,'coverage differs'):prepare(assets,output)
            self.assertEqual(read(assets/'lk/manifest.json')['profile']['sha256'],'old')
    def test_changed_profile_or_consumed_index_fails_before_apply(self):
        with tempfile.TemporaryDirectory()as directory:
            assets,output,profile=self.fixture(directory);plan=prepare(assets,output)
            write(assets/'lk/fx/index.json',{'templates':{}})
            with self.assertRaisesRegex(ValueError,'Pinned input changed'):execute(plan,True)
            self.assertEqual(read(assets/'lk/manifest.json')['profile']['sha256'],'old')
if __name__=='__main__':unittest.main()
