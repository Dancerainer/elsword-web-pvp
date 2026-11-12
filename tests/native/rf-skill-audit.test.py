"""Compare the26-skill ledger to original bytes and freshly parsed target KL82.

The declarations are original-data evidence. No current battle simulation is
used as the oracle and no original game/native consumer is executed here.
"""
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from kl82_static import read_declarations
AUDIT=json.loads((ROOT/'reports/rf-skills-semantics-v10.json').read_text('utf8'))
TARGET=Path('asset_work/raw/data/data036.kom')
def digest(data):return hashlib.sha256(data).hexdigest()
def source(relative):
    for cache in ['.cache/native-source-runtime','.cache/native-reference','.cache/skill-consumer-v10']:
        path=ROOT/cache/relative
        if not path.exists():path=ROOT/cache/Path(relative).name
        if path.exists():return path.read_bytes()
    raise FileNotFoundError(relative)

class SkillSourceAuditTests(unittest.TestCase):
    def test_all_original_source_file_blobs_and_explicit_sections(self):
        for row in AUDIT['referenceFiles']:
            data=source(row['relativePath'])
            with self.subTest(file=row['relativePath']):
                self.assertEqual(len(data),row['bytes']);self.assertEqual(digest(data),row['sha256'])
                self.assertEqual(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),row['gitBlob'])
        for row in AUDIT['sourceSections']:
            fragment=b''.join(source(row['relativePath']).splitlines(keepends=True)[row['lineStart']-1:row['lineEnd']])
            self.assertEqual(digest(fragment),row['sha256'],row['name'])
        for skill in AUDIT['skills']:
            for row in skill['referenceFunctions']:
                if 'exactLineSliceSha256' not in row:continue
                data=source(row['file'])
                self.assertEqual(digest(data),row['sourceFileSha256'])
                self.assertEqual(digest(b''.join(data.splitlines(keepends=True)[row['lineStart']-1:row['lineEnd']])),row['exactLineSliceSha256'])

    def test_source_says_outline_is_conditional_and_has_no_new_trait_consumer(self):
        user=source('X2Lib/X2GUUser.cpp')
        self.assertIn(b'IsSuperArmor() && m_FrameDataNow.stateParam.bSuperArmorNotRed == false',user)
        note=source('X2Lib/X2SkillNoteManager.cpp')
        self.assertIn(b'GetValue( 1, iMemoItemID )',note)
        self.assertIn(b'GetValue( 2, iSkillID )',note)
        for name in ['X2SkillNoteManager.cpp','X2SkillTree.cpp','X2SkillTree.h','X2UserSkillTree.cpp','X2UserSkillTree.h']:
            data=source('X2Lib/'+name)
            self.assertNotIn(b'AddNewSkillNoteTemplet',data,name)
            self.assertNotIn(b'MI_PERSISTENT',data,name)
        self.assertFalse(AUDIT['newSkillNoteConsumerAvailable'])
        self.assertFalse(AUDIT['traitsExecutionVerified'])

    def test_all_selected_skills_preserve_actual_target_state_protection(self):
        enum=read_declarations(TARGET/'Enum.lua')
        raven=read_declarations(TARGET/'RAVEN_FIGHTER.lua',enum['globals'])
        self.assertEqual(raven['source']['sha256'],AUDIT['targetFiles']['raven']['sha256'])
        self.assertEqual(enum['source']['sha256'],AUDIT['targetFiles']['enum']['sha256'])
        self.assertEqual([AUDIT[x] for x in ['allHighestCount','activeCount','passiveCount','traitCount']],[26,20,6,36])
        self.assertEqual(sorted(s['skillId'] for s in AUDIT['skills'] if s['passive']),list(range(24400,24406)))
        for skill in AUDIT['skills']:
            for name,expected in skill['targetProtection'].items():
                raw=raven['globals'][name]
                actual={k:v for k,v in raw.items() if k.startswith('SUPER_ARMOR') or k=='INVINCIBLE'}
                self.assertEqual(json.loads(json.dumps(actual)),expected,name)
        drill=raven['globals']['RSI_A_RF_MEGADRILL_BREAK']
        self.assertFalse(any(k.startswith('SUPER_ARMOR') for k in drill))
        self.assertNotIn('INVINCIBLE',drill)
        self.assertEqual(drill['DAMAGEDATA_CHANGE_TIME'],1.17)
        self.assertEqual(drill['DAMAGE_DATA_NEXT']['RE_ATTACK'],1)
        self.assertEqual(drill['DAMAGE_DATA_NEXT']['HIT_GAP'],.1)
        self.assertEqual(drill['DAMAGE_DATA_NEXT']['BACK_SPEED_X'],-600)
        self.assertEqual(drill['DAMAGE_DATA_NEXT']['IGNORE_DEFENCE'],1)

    def test_all36_traits_match_original_new_note_arrays_without_old_memo_reinterpretation(self):
        enum=read_declarations(TARGET/'Enum.lua')
        notes=read_declarations(TARGET/'SkillNoteTemplet.lua',enum['globals'],capture_calls=True,capture_unresolved=True)
        self.assertEqual(notes['source']['sha256'],'eadf9ccd9b546500688ef4eaf60e9b6183cbe8c65103ff3f198d7d144ef72816')
        original={}
        for call in notes['nativeCalls']:
            if not call['target'].endswith('.AddNewSkillNoteTemplet'):continue
            table=call['args'][-1]
            if table.get('UNIT_CLASS') not in [4,17,107]:continue
            for raw in table['MEMO_LIST'].values():original[raw[3]]=json.loads(json.dumps(raw))
        audited=[branch for skill in AUDIT['skills'] for branch in skill['branches']]
        self.assertEqual(len(audited),36);self.assertEqual(len({b['memoId'] for b in audited}),36)
        for branch in audited:self.assertEqual(branch['rawPositions'],original[branch['memoId']])
        drill=next(s for s in AUDIT['skills'] if s['skillId']==24203)
        self.assertEqual([(x['memoTypeName'],x['parameters']) for x in drill['branches']],[('MI_ENHANCE',[1.3]),('MI_PERSISTENT',[-3])])
        self.assertTrue(all(not s['targetClientMeasured'] for s in AUDIT['skills']))

if __name__=='__main__':unittest.main()
