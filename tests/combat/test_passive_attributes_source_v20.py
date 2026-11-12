"""Read original target KL and pinned source bytes; never use simulation goldens."""
from pathlib import Path
import hashlib,json,sys,unittest
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/combat'))
from kl82_static import read_declarations
CONTRACT=json.loads((ROOT/'contracts/rf-passive-attributes-v20.json').read_text(encoding='utf-8'))
normalize=lambda value:json.loads(json.dumps(value))
digest=lambda data:hashlib.sha256(data).hexdigest()

def reference_path(entry):
 path=Path(entry['path'])
 if path.is_file():return path
 # The frozen receipt predates task worktrees. Resolve its relative cache
 # location locally; the original file and range hashes remain mandatory.
 marker='/.cache/'
 return ROOT/'.cache'/entry['path'].replace('\\','/').split(marker,1)[1]

class PassiveAttributeActualSource(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.raw=Path(CONTRACT['targetSources'][0]['path']).parent
  enum=read_declarations(cls.raw/'Enum.lua')['globals']
  cls.skills=read_declarations(cls.raw/'NewSkillTempletVer2.lua',enum,capture_calls=True,capture_unresolved=True)
  cls.factors=read_declarations(cls.raw/'BattleFieldBuffFactor.lua',enum,capture_calls=True,capture_unresolved=True)
  cls.templates=read_declarations(cls.raw/'BattleFieldBuffTemplet.lua',enum,capture_calls=True,capture_unresolved=True)
 @staticmethod
 def row(data,key,value):
  rows=[(c,a) for c in data['nativeCalls'] for a in c.get('args',[]) if isinstance(a,dict) and a.get(key)==value]
  if len(rows)!=1:raise AssertionError((key,value,len(rows)))
  return rows[0]
 def test_target_hashes_and_actual_six_passive_fields(self):
  for entry in CONTRACT['targetSources']:
   data=Path(entry['path']).read_bytes();self.assertEqual(digest(data),entry['sha256']);self.assertEqual(len(data),entry['bytes'])
  for entry in CONTRACT['targetPassives']:
   call,raw=self.row(self.skills,'m_eID',entry['id'])
   self.assertEqual(call['prototype'],entry['prototype']);self.assertEqual(call['instruction'],entry['instruction'])
   fields={k:v for k,v in raw.items() if k.startswith('SA_') or k in ['m_Stat','BUFF_FACTOR','m_wstrMainDesc','m_EffectiveDesc']}
   self.assertEqual(normalize(fields),entry['fields'])
 def test_original_factor_and_template_define_six_seconds_seven_hits_and_swap100(self):
  _,outer=self.row(self.factors,'BUFF_FACTOR_ID',437);raw=normalize(outer['BUFF_FACTOR'])
  self.assertEqual(raw,CONTRACT['factor437']['raw']);self.assertEqual(raw['BUFF_TEMPLET_ID'],408)
  self.assertEqual(raw['BEHAVIOR']['BBT_CHANGE_CRITICAL_RATE']['SWAP_VALUE']['3'],100)
  self.assertEqual(raw['BEHAVIOR']['BBT_CHANGE_CRITICAL_ATTACK']['PERCENT']['3'],1.1)
  self.assertEqual(raw['FINALIZER']['BFT_TIME']['NORMAL_TIME']['3'],6)
  self.assertEqual(raw['FINALIZER']['BFT_HIT_COUNT']['COUNT']['3'],7)
  _,template=self.row(self.templates,'BUFF_TEMPLET_ID',408);self.assertEqual(normalize(template),CONTRACT['template408']['raw'])
 def test_fixed_reference_range_hashes_and_original_pvp_base_guard_swap_consumers(self):
  for entry in CONTRACT['referenceConsumers']:
   data=reference_path(entry).read_bytes();self.assertEqual(digest(data),entry['sha256']);lines=data.decode('latin1').splitlines(keepends=True)
   for part in entry['ranges']:
    body=''.join(lines[part['start']-1:part['end']]).encode('latin1');self.assertEqual(digest(body),part['rawRangeSha256'])
  user=reference_path(CONTRACT['referenceConsumers'][0]).read_text(encoding='latin1')
  self.assertIn('SetBasicStatValueChargeMpHitted( (3.0f + (2.0f * teamAdv)) * fIncreaseMpRate );',user)
  self.assertIn('if( m_bUpMPThisFrame == false )',user);self.assertIn('m_bUpMPThisFrame = true;',user)
  self.assertIn('CX2DamageManager::RT_DUMMY_DAMAGE != m_DamageData.reActResult',user)
  behavior=reference_path(CONTRACT['referenceConsumers'][1]).read_text(encoding='latin1')
  self.assertIn('case BCT_SWAP_VALUE:',behavior);self.assertIn('return fValue;',behavior)
 def test_adaptation_and_unequal_team_boundaries_are_explicit(self):
  self.assertFalse(CONTRACT['targetClientMeasured']);self.assertEqual(CONTRACT['targetGoldenTraces'],0)
  self.assertIn('consumer',CONTRACT['implementedCandidates']['24405Magic'])
  self.assertIn('user-confirmed',CONTRACT['implementedCandidates']['24402CriticalSelfBuff'])
  self.assertIn('unequal-team/adaptive party advantage',CONTRACT['notChanged'])
  self.assertFalse(CONTRACT['checks']['nativeRecompiled'])

if __name__=='__main__':unittest.main()
