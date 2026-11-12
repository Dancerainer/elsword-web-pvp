"""Three actual target display declarations and independent resource snapshot."""
import copy
import hashlib
import json
from pathlib import Path
import re
import sys
import unittest

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
sys.path.insert(0,str(Path(__file__).parent))
from asset_evidence import evidence_path
from build_rf_fx import declaration,select_templates

INDEX=json.loads((ROOT/'contracts/rf-buff-display-fx-index.json').read_text('utf-8'))
ROOTS=json.loads((ROOT/'contracts/rf-buff-display-roots.json').read_text('utf-8'))
SOURCE=Path('asset_work/raw/data/data036.kom/GameMinorParticle.txt')

class BuffDisplayAssetTests(unittest.TestCase):
    def test_actual_minor_source_lowercase_tokens_and_texture_are_not_silently_dropped(self):
        data=SOURCE.read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),'c94f61653d3aeb22f72252e2e5b596c55064f4963ff1a599197c5efcb7e83370')
        body=re.search(r'eventsequence\s+"SwordFireTip"\s*\{([^{}]*)\}',data.decode('latin1'))[1]
        parsed=declaration(body,casefold_tokens=True)
        self.assertEqual(parsed['unsupported'],[])
        self.assertEqual(parsed['fields']['NumParticles'],80)
        self.assertEqual(parsed['fields']['Lifetime'],.4)
        self.assertEqual(parsed['fields']['Emitrate'],{'random':[20.,40.]})
        self.assertEqual(parsed['fields']['Gravity'],[0.,{'random':[0.,1000.]},0.])
        self.assertEqual(parsed['events'][0],{'property':'Texture','start':0.,'end':0.,'fade':False,'value':'smoke02.dds'})
        colors=[e for e in parsed['events'] if e['property']=='Color']
        self.assertEqual(colors[0]['value'],[1.,.6,.4,1.])
        self.assertEqual((colors[1]['start'],colors[1]['end'],colors[1]['fade']),(.4,.5,True))
        self.assertIn('smoke02.dds',INDEX['templates']['SwordFireTip']['textures'])
        self.assertEqual(INDEX['templates']['SwordFireTip']['sourceFamily'],'game-minor')

    def test_three_original_resource_bindings_exist_and_output_hashes_match(self):
        expected={'EffectSet_DEBUFF_FIRE':(9,'SwordFireTip'),'EffectSet_DEBUFF_WOUND':(8,'Emoticon_State_Abnormality_Bleeding'),'EffectSet_DEBUFF_STUN':(8,'UnitStunB')}
        for name,(kind,resource) in expected.items():
            self.assertEqual(ROOTS['effectSets'][name]['raw']['EFFECT0']['EFFECT_TYPE'],kind)
            self.assertEqual(ROOTS['effectSets'][name]['raw']['EFFECT0']['NAME'],resource)
            template=INDEX['templates'][resource]
            self.assertEqual(template['kind'],'particle');self.assertEqual(template['unsupported'],[])
            self.assertNotIn('glb',template)
            self.assertTrue(template['textures'])
            for texture in template['textures'].values():
                self.assertTrue(evidence_path('artifacts/rf-buff-display/'+texture['file']).is_file())
        self.assertEqual(INDEX['missingTemplates'],[])
        self.assertEqual(INDEX['meshFailures'],[])
        report=json.loads((ROOT/'reports/rf-buff-display-assets.json').read_text('utf-8'))
        for record in report['outputInventory']:
            data=evidence_path(record['path']).read_bytes()
            self.assertEqual(len(data),record['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),record['sha256'])

    def test_missing_effectset_name_or_ambiguous_major_minor_resource_is_explicit(self):
        definitions=copy.deepcopy(INDEX['templates']);del definitions['SwordFireTip']
        _,missing=select_templates(definitions,ROOTS)
        self.assertEqual(missing,['SwordFireTip'])
        definitions=copy.deepcopy(INDEX['templates']);definitions['SwordFireTip']['ambiguousSourceFamilies']=[{},{}]
        with self.assertRaisesRegex(ValueError,'explicit namespace'):
            select_templates(definitions,ROOTS)

    def test_corrupt_minor_event_is_retained_and_old_full_skill_snapshot_unchanged(self):
        parsed=declaration('initial size = XYZ(1,2)\nfade so from .5 to .4 color = rgba(1,1,1,1)',casefold_tokens=True)
        self.assertEqual(len(parsed['unsupported']),2)
        data=(ROOT/'reports/rf-full-skill-assets.json').read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),'74cccac35c5fd444b6d4b5b2821fec16326c001d01b8012b28d6b10f989d7b53')
        self.assertEqual(json.loads(data)['counts']['effectTemplates'],311)

if __name__=='__main__':unittest.main()
