"""Seal the original factory mode-switch visual+attack producer, offline."""
from pathlib import Path
import hashlib,json,struct,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
raw=SOURCE.read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(raw)==EXPECTED
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24;base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def span(a,n):
 b=raw[offset(a):offset(a)+n]
 return {'address':hex(a),'fileOffset':offset(a),'bytes':n,'sha256':sha(b),'hex':b.hex()}
def function(a):
 rows=[]
 for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(raw[offset(a):offset(a)+0x2000],a):
  rows.append({'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str})
  if i.mnemonic=='ret':break
 assert rows[-1]['mnemonic']=='ret'
 return {**span(a,i.address+i.size-a),'instructions':rows}
def string(a,expected):
 b=expected.encode('utf-16le')+b'\0\0';assert raw[offset(a):offset(a)+len(b)]==b
 return {**span(a,len(b)),'value':expected}
profile=json.loads((ROOT/'packages/combat-core/mm-profile.json').read_text('utf8'))
sets=['EffectSet_SI_SA_AAT_Installation_Drone_Change_'+str(i) for i in (1,2,3)]+['EffectSet_A_APT_Pylon_Dynamo_Start','EffectSet_A_APT_Pylon_Dynamo_Impact']
damage='DamageEffect_A_APT_Pylon_Dynamo_Impact'
report={'schemaVersion':1,'id':'add-factory-switch-native-v45','targetExecuted':False,'targetClientMeasured':False,
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'bytes':len(raw),'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 'qualification':'Offline exact-byte static decode of a prior late static analysis snapshot; snapshot and original file identities remain distinct.'},
 'functions':{'changeMarkedSkill':function(0x32771560),'modeChangeEffects':function(0x3275cec0)},
 'strings':[string(0x33061158,sets[0]),string(0x330610f8,sets[1]),string(0x33061098,sets[2]),string(0x33061050,sets[3]),string(0x33061008,sets[4])],
 'confirmed':{'differentSkillGuard':'3277158d compares actor+71ec with incoming skill; equal returns without switch effects',
  'existingModeGuard':'327715d8 tests old marked skill !=0; then327715e7 invokes3275cec0(newSkill)',
  'effects':'3275cec0 selects originalChange1/2/3 then unconditionally plays Pylon Start and Pylon Impact',
  'power':'Literal float1 in both native PlayEffectSet argument blocks, not current skill GetPowerRate',
  'state':'No cast-state change is introduced by this effect helper'},
 'declarations':{'sourceEffect':profile['sources']['effect'],'sourceDamage':profile['sources']['damage'],
  'effectSets':{n:profile['effectSets'][n] for n in sets},'damageEffect':{damage:profile['damageEffects'][damage]}},
 'tests':['tests/combat/add-factory-switch-v45.test.mjs'],
 'limits':['Original native dynamic instruction paths are statically decoded, not executed as a client battle.',
  'Generic Web native geometry/damage execution retains its existing evidence qualifications.']}
out=ROOT/'contracts/add-factory-switch-native-v45.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'contract':str(out),'functionBytes':{k:r['bytes'] for k,r in report['functions'].items()}}))
