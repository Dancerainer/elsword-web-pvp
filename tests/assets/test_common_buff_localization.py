"""Local storage contracts use original bytes and preserve GLB-relative images."""
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from localize_common_buff_assets import localize,receipt

class CommonBuffLocalization(unittest.TestCase):
    def fixture(self,base):
        target=base/'target';source=base/'source';stage=base/'stage'
        (target/'common-buffs/fx/textures').mkdir(parents=True)
        (target/'common-buffs/fx/textures/existing.png').write_bytes(b'identical original texture')
        folder=source/'lp/fx/meshes';(folder/'textures').mkdir(parents=True)
        doc=json.dumps({'asset':{'version':'2.0'},'images':[{'uri':'textures/original.png'}]}).encode();doc+=b' '*(-len(doc)%4)
        (folder/'mesh.glb').write_bytes(struct.pack('<4sIIII',b'glTF',2,20+len(doc),len(doc),0x4e4f534a)+doc)
        (folder/'mesh.pose.json').write_bytes(b'{"frames":[]}')
        (folder/'textures/original.png').write_bytes(b'original mesh image')
        (source/'lp/fx/texture.png').write_bytes(b'identical original texture')
        index={'templates':{'mesh':{'glb':'../lp/fx/meshes/mesh.glb','poseData':'../lp/fx/meshes/mesh.pose.json','textures':{}},
            'particle':{'textures':{'native':{'file':'../lp/fx/texture.png'}}}}}
        return target,source,stage,index,{'effectTemplates':{}}
    def test_existing_texture_deduplicates_and_glb_images_keep_original_bytes(self):
        with tempfile.TemporaryDirectory()as directory:
            target,source,stage,index,catalog=self.fixture(Path(directory));outputs,inputs,changes=localize(index,catalog,target,stage,source)
            self.assertEqual(index['templates']['particle']['textures']['native']['file'],'fx/textures/existing.png')
            self.assertEqual(len(outputs),3);self.assertEqual(len(changes),3)
            for name in ('mesh.glb','mesh.pose.json','textures/original.png'):
                self.assertEqual(receipt(stage/'common-buffs/fx/meshes'/name),receipt(source/'lp/fx/meshes'/name))
            self.assertEqual(index['templates'],catalog['effectTemplates'])
    def test_conflicting_original_filename_is_isolated_without_overwrite(self):
        with tempfile.TemporaryDirectory()as directory:
            target,source,stage,index,catalog=self.fixture(Path(directory));old=target/'common-buffs/fx/meshes/mesh.glb';old.parent.mkdir();old.write_bytes(b'older original mesh')
            localize(index,catalog,target,stage,source)
            self.assertIn('/import-',index['templates']['mesh']['glb']);self.assertEqual(old.read_bytes(),b'older original mesh')
    def test_corrupt_glb_is_rejected_instead_of_losing_embedded_image_dependencies(self):
        with tempfile.TemporaryDirectory()as directory:
            target,source,stage,index,catalog=self.fixture(Path(directory));(source/'lp/fx/meshes/mesh.glb').write_bytes(b'broken')
            with self.assertRaisesRegex(ValueError,'Invalid GLB'):localize(index,catalog,target,stage,source)
if __name__=='__main__':unittest.main()
