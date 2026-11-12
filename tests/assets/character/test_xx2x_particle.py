"""Original target declaration and decoded image checks; no renderer gold."""
from pathlib import Path
import hashlib
import json
import os
import sys
import tempfile
import unittest
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
import build_xx2x_particle as tool
from build_rf import Catalog
sys.path.insert(0,str(ROOT/'tools/combat'))
from build_rf_profile import build as build_profile
INDEX=json.loads((ROOT/'contracts/rf-xx2x-fx-index-v12.json').read_text('utf8'))

class XX2XParticleSource(unittest.TestCase):
    def setUp(self):
        self.source=Path(os.environ.get('ELSWORD_ASSET_WORK','asset_work'))
        if not (self.source/'catalog.sqlite').is_file():self.skipTest('Read-only target catalog absent')
        self.catalog=Catalog(self.source)

    def test_complete_declaration_and_texture_pixels_are_original(self):
        source=self.catalog.path('GameMajorParticle2.txt')
        text=source.read_bytes().decode('latin1');parsed,match=tool.parse(text)
        actual=INDEX['templates'][tool.NAME]
        for key in ('fields','events','repeated','unsupported'):self.assertEqual(parsed[key],actual[key])
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),actual['source']['sha256'])
        self.assertEqual(hashlib.sha256(match[0].encode('latin1')).hexdigest(),actual['declarationSha256'])
        self.assertEqual(text.count('\n',0,match.start())+1,1985)
        self.assertEqual(parsed['fields']['NumParticles'],10)
        self.assertEqual(parsed['fields']['Emitrate'],250)
        self.assertEqual(parsed['fields']['TriggerTime'],.15)
        self.assertEqual(parsed['fields']['Lifetime'],.6)
        self.assertEqual(parsed['fields']['LandPos'],240)
        self.assertEqual(parsed['fields']['Gravity'],[0,-1700,0])
        self.assertEqual(set(actual['textures']),{'ColorBallGray.dds'})
        record=actual['textures']['ColorBallGray.dds'];texture=self.catalog.path('ColorBallGray.dds')
        self.assertEqual(hashlib.sha256(texture.read_bytes()).hexdigest(),record['source']['sha256'])
        original=Image.open(texture).convert('RGBA')
        decoded=Image.open(ROOT/'artifacts/rf'/record['file']).convert('RGBA')
        self.assertEqual(original.size,decoded.size)
        self.assertEqual(original.tobytes(),decoded.tobytes())

    def test_resource_rebuild_is_private_and_reproduces_the_frozen_template(self):
        (ROOT/'runtime').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT/'runtime',prefix='xx2x-particle-test-') as directory:
            rebuilt=tool.build(self.source,Path(directory),None,None)
            self.assertEqual(rebuilt['templates'],INDEX['templates'])
            self.assertEqual(rebuilt['sourceFiles'],INDEX['sourceFiles'])
            self.assertFalse(rebuilt['clientMeasured'])
        profile=build_profile(ROOT/'.cache/declarations-v11',ROOT/'artifacts/rf',ROOT/'.cache/native-skills-source')
        self.assertEqual(profile['effectTemplates'][tool.NAME],INDEX['templates'][tool.NAME])
        self.assertIn(tool.NAME,profile['resourceOnlyTemplates'])

    def test_ambiguous_or_unsupported_source_is_rejected_not_synthesized(self):
        valid='eventsequence "'+tool.NAME+'" { particleType=PT_3D_PLANE\n Lifetime=.6\n }'
        for text in ('',valid+valid,valid.replace('Lifetime=.6','Lifetime=unresolved(7)'),valid.replace('PT_3D_PLANE','PT_SKINMESH')):
            with self.assertRaises(ValueError):tool.parse(text)

if __name__=='__main__':unittest.main()
