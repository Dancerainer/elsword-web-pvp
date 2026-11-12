"""Independent read-only target KL and pinned callback audit, not client gold."""
from pathlib import Path
import hashlib
import json
import os
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
sys.path.insert(0,str(ROOT/'tools/native'))
from kl82_static import read_declarations
from prepare_rf_skill_declarations import EnumTable
from run_camera_source import extract

CONTRACT=json.loads((ROOT/'contracts/rf-xx2x-source-v12.json').read_text('utf8'))
PROFILE=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf8'))

class TargetXX2XEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw=Path(os.environ.get('ELSWORD_TARGET_RAW','asset_work/raw/data/data036.kom'))
        if not cls.raw.is_dir():raise unittest.SkipTest('Actual read-only target KL inputs absent')
        enum=EnumTable(read_declarations(cls.raw/'Enum.lua')['globals'])
        cls.raven=read_declarations(cls.raw/'RAVEN_FIGHTER.lua',enum)
        cls.damage=read_declarations(cls.raw/'DamageEffect.lua',enum,capture_calls=True,capture_unresolved=True)
        cls.effects=read_declarations(cls.raw/'EffectSet.lua',enum,capture_calls=True,capture_unresolved=True)

    def test_target_hashes_locations_and_complete_declarations_are_independent(self):
        for key,source in [('raven',self.raven),('damage',self.damage),('effects',self.effects)]:
            self.assertEqual(source['source']['sha256'],CONTRACT['targetSources'][key]['sha256'])
        for rows,source in [(CONTRACT['targetStates'],self.raven),(CONTRACT['targetDamageEffects'],self.damage)]:
            for name,row in rows.items():
                self.assertEqual(json.loads(json.dumps(source['globals'][name])),row['raw'],name)
                self.assertEqual(source['locations'][name],row['sourcePc'])
        name=CONTRACT['targetEffectSet']['name']
        call=next(c for c in self.effects['nativeCalls'] if any(isinstance(a,dict) and a.get('NAME')==name for a in c['args']))
        raw=next(a for a in call['args'] if isinstance(a,dict) and a.get('NAME')==name)
        self.assertEqual(json.loads(json.dumps(raw)),CONTRACT['targetEffectSet']['raw'])
        self.assertEqual({k:call[k] for k in ('prototype','instruction')},CONTRACT['targetEffectSet']['sourcePc'])

    def test_literal_four_up_spines_and_distinct_2_22_not_big_spine_old_values(self):
        parent=self.damage['globals']['DamageEffect_RSI_OVER_TAKER_XX_DOWN_X']
        children=[parent['CREATE_DAMAGE_EFFECT'+str(i)] for i in range(4)]
        self.assertEqual([c['EVENT_TIME'] for c in children],[.01,.11,.21,.31])
        for child in children:
            self.assertEqual(child['DAMAGE_EFFECT_NAME'],'DamageEffect_RSI_OVER_TAKER_UP_SPINE')
            self.assertEqual(child['POSITION_TYPE'],3)
            self.assertEqual(child['APPLY_ROTATE_ORIGIN'],1)
        self.assertNotIn('CREATE_DAMAGE_EFFECT4',parent)
        data=self.damage['globals']['DamageEffect_RSI_OVER_TAKER_UP_SPINE']['DAMAGE_DATA']
        self.assertEqual(data['DAMAGE']['MAGIC'],2.22)
        self.assertEqual(data['FORCE_DOWN'],3.13)
        self.assertEqual(data['HIT_ADD_MP'],4.38)
        self.assertEqual(data['ARRANGED_FLY'],1)

    def test_direct_has_no_resource_parent_but_derived_already_has_animation_0_3_set(self):
        direct=self.raven['globals']['RSI_OVER_TAKER_COMBO_XXdownX']
        derived=self.raven['globals']['RSI_OVER_TAKER_COMBO_XXfrontXXdownX']
        for field in ('EFFECT_SET_LIST','DAMAGE_DATA','ATTACK_TIME0'):self.assertNotIn(field,direct)
        self.assertEqual(direct['ANIM_NAME'],'OT_ComboX3Front_New')
        self.assertEqual(direct['ANIM_SPEED'],1.25)
        self.assertEqual(derived['EFFECT_SET_LIST'][2],.3)
        self.assertEqual(CONTRACT['targetEffectSet']['raw']['EFFECT0']['POSITION_OFFSET_X'],110)

class ReferenceXX2XEvidence(unittest.TestCase):
    def test_pinned_source_bodies_and_registration_preserve_distinct_generation_owners(self):
        raw=(ROOT/'.cache/reference-combat-fixes-v11/X2GURaven.cpp').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),CONTRACT['reference']['sourceSha256'])
        for row in CONTRACT['referenceFunctions']:
            body,start,end=extract(raw,('void CX2GURaven::'+row['name']+'(').encode())
            self.assertEqual((start,end),(row['startLine'],row['endLine']))
            self.assertEqual(hashlib.sha256(body).hexdigest(),row['sha256'])
        text=raw.decode('latin1')
        def registration(state):
            start=text.index('stateData.stateID\t\t\t= '+state+';')
            return text[start:text.index('m_StateList[stateData.stateID] = stateData;',start)]
        direct=registration('RSI_OVER_TAKER_COMBO_XXdownX')
        derived=registration('RSI_OVER_TAKER_COMBO_XXfrontXXdownX')
        self.assertIn('RSI_OVER_TAKER_COMBO_XXdownX_FrameMove',direct)
        self.assertNotIn('OnFrameMove',derived)
        body,_,_=extract(raw,b'void CX2GURaven::RSI_OVER_TAKER_COMBO_XXdownX_FrameMove(')
        self.assertIn(b'EventTimerOneshot( 0.3f )',body)
        self.assertIn(b'EventTimerOneshot( 0.3666f )',body)
        self.assertIn(b'FlushMp( 4.0f )',body)
        self.assertIn(b'L"DamageEffect_RSI_OVER_TAKER_XX_DOWN_X", GetPowerRate(), GetPos()',body)
        self.assertFalse(CONTRACT['targetClientMeasured'])
        self.assertEqual(CONTRACT['targetGoldenTraces'],0)

if __name__=='__main__':unittest.main()
