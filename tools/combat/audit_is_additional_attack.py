"""Record target bytecode and fixed-reference additional attack consumers.

Reads already acquired task-local sources. No client or Lua code is executed.
"""
import hashlib,json
from pathlib import Path
from kl82_static import parse
ROOT=Path(__file__).resolve().parents[2]
PINNED_SOCKET='a8a0b4956aa24e06988b84a2723d038782b09733442325a1a70695ea57fcbc9e'
SOURCES={
 'X2SocketItem.h':('.cache/is-source/X2SocketItem.h',[(1118,1122)],'5efa5f79b19215c58fb2b65724b2b80f95ee5d59'),
 'X2BuffBehaviorTemplet.cpp':('.cache/is-source/X2BuffBehaviorTemplet.cpp',[(889,998),(1042,1115)],'5237c18c633c95e70145c520a67ce47786504cdd'),
 'X2BuffTemplet.h':('.cache/native-reference/X2Lib/X2BuffTemplet.h',[(892,939)],'cce459ca0f237407dc40538edbb162fbac6e1574'),
 'X2GameUnit.cpp':('.cache/native-reference/X2Lib/X2GameUnit.cpp',[(12073,12086),(14251,14294),(14297,14388)],'c5f44d423d2d57ae67ac5408d53fb533aac9025d'),
 'X2GUUser.cpp':('.cache/native-reference/X2Lib/X2GUUser.cpp',[(9377,9410),(22964,22974)],'f608ea3f556770d5aa5b43d5b00270d6351b6fcd'),
}
def build():
 data=(ROOT/'.cache/is-source/SocketOptionForm.lua').read_bytes()
 if hashlib.sha256(data).hexdigest()!=PINNED_SOCKET:raise ValueError('Target socket SHA mismatch')
 parsed=parse(data)
 rows=[]
 for name,(path,ranges,blob) in SOURCES.items():
  raw=(ROOT/path).read_bytes();actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
  if blob is not None and actual!=blob:raise ValueError('Reference blob mismatch: '+name)
  lines=raw.splitlines(keepends=True)
  rows.append(dict(path='X2Lib/'+name,sha256=hashlib.sha256(raw).hexdigest(),gitBlob=actual,
   ranges=[dict(firstLine=a,lastLine=b,sha256=hashlib.sha256(b''.join(lines[a-1:b])).hexdigest()) for a,b in ranges]))
 return dict(schemaVersion=1,originalClientMeasurements=0,
  target=dict(path='data/data036.kom/SocketOptionForm.lua',sha256=PINNED_SOCKET,
   prototypes={name:parsed['prototypes'][i] for name,i in [('CalculateLinearAdditionalAttackValue',8),('CalculateIntermediateAdditionalAttackValue',41),('CalculateFinalAdditionalAttackValue',74)]}),
  reference=dict(commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',evidenceClass='fixed V5 version reference; not target2016 executable',files=rows),
  rule=dict(buff=20,template=19,skill=21410,maximumStacks=5,maximumLevelFixValue=10,
   fixToSocket='FIX_VALUE * (1.5 * (level - 1) + 9.5); stack linearly',
   intermediate='socketPoints / (level == 1 ? 10 : 1.5 * (level - 1) + 9.5) * .01',
   curve='x=min(intermediate,1.65); if x>.4 then x=x*(-.4*x+1.32)-.064; result=min(x*.375,1)',
   damage='1.5 * pow(motionPower * recordedCastPower,.65) * additionalAttack * totalAttackStat',
   order='after critical and equipment additional defence; excludes level damage and no-damage packets'),
  independentAlgebra=[dict(stacks=n,nominalPoints=n*10,ratio=r) for n,r in [(1,.0375),(2,.075),(3,.1125),(4,.15),(5,.186)]],
  limits=['Only IS nominal Buff FIX points are connected; equipment socket point presets remain independent.',
   'No complete double-attack proc consumer is introduced.',
   'Source version combination remains a simulation candidate, not original2016 measured behavior.'])
if __name__=='__main__':
 out=ROOT/'contracts/is-additional-attack-source-v1.json'
 out.write_text(json.dumps(build(),indent=2)+'\n',encoding='utf-8');print(out)
