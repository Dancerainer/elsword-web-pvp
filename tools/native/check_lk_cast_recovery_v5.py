"""Verify original target declarations separately from qualified V5 consumers."""
import argparse,hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(data):return hashlib.sha256(data).hexdigest()
def build(cache,sword,native):
 profile=json.loads((ROOT/'packages/combat-core/lk-profile.json').read_bytes())
 declarations=json.loads((cache/'elsword-declarations.json').read_bytes())
 effects=json.loads((cache/'effect-declarations.json').read_bytes())
 for doc in [declarations,effects]:
  if sha(Path(doc['source']['path']).read_bytes())!=doc['source']['sha256']:raise ValueError('Target source changed')
 states={}
 for name in ['ESSI_SI3_ES_ARMAGEDDON_BLADE','ESSI_SA_ELK_SONIC_BLADE']:
  if declarations['globals'][name]!=profile['states'][name]['raw']:raise ValueError('Target state differs')
  states[name]={'raw':declarations['globals'][name],'clip':profile['states'][name]['clip'],'location':declarations['locations'][name]}
 raw=profile['effectSets']['EffectSet_SA_ELK_ArmagedonBlade']['raw']
 calls=[c for c in effects['nativeCalls'] if isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')==raw['NAME']]
 if len(calls)!=1 or calls[0]['args'][-1]!=raw:raise ValueError('Target EffectSet differs')
 refs=[]
 for file,ranges in [(sword,[(12519,12583,'Armageddon callback and end'),(14930,14952,'Sonic normal skip'),(14978,15000,'Sonic hyper skip')]),
  (native/'X2Lib/X2GUUser.h',[(197,201,'pure direction/Z/X/eight-skill-key macro')]),
  (native/'KTDXLIB/KTDGXSkinAnim.cpp',[(1233,1233,'animation period'),(1256,1283,'transition default and XET override')]),
  (native/'X2Lib/X2EffectSet.cpp',[(139,184,'animation versus custom start clocks')])]:
  data=file.read_bytes();lines=data.splitlines(keepends=True)
  for first,last,purpose in ranges:refs.append({'file':file.name,'sha256':sha(data),'startLine':first,'endLine':last,'fragmentSha256':sha(b''.join(lines[first-1:last])),
   'purpose':purpose,'evidenceClass':'fixed-V5-version-reference','commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'})
 result={'schemaVersion':1,'originalClientMeasured':False,'sources':profile['sources'],'references':refs,'targetStates':states,'targetEffectSet':raw,
  'implementationBoundary':['Armageddon cast display catches up its declared timer at the 1.68 animation buff event so the first damage packet uses the original giant sword helpers; explicit target-timeline adapter, matching V6 callback unavailable.',
   'Armageddon has no acquired early-key exit. Preserve source period-transition end and original STOP_TIME_ATT 0.5. No guessed shortened recovery.',
   'Sonic uses strict animation >1.0 and the V5 pure-key domain. Matching V6 callback and original executable trajectory remain unverified.',
   'Unknown XET transition overrides are not supplied. Current original-animation period and default end are a source-qualified simulation.']}
 target=ROOT/'contracts/lk-cast-recovery-source-v5.json';target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 print(json.dumps({'states':len(states),'references':len(refs),'sourceChecked':True}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,required=True);p.add_argument('--sword',type=Path,required=True);p.add_argument('--native',type=Path,required=True);a=p.parse_args();build(a.cache,a.sword,a.native)
