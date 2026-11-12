"""Small exact-byte Moonlight RTTI/consumer closure from the prior static analysis snapshot."""
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
pe=struct.unpack_from('<I',raw,60)[0];optional=pe+24
base=struct.unpack_from('<I',raw,optional+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,optional+size+i*40+8) for i in range(count)]
def offset(address):
 for virtual_size,rva,raw_size,start in sections:
  if base+rva<=address<base+rva+min(virtual_size,raw_size):return start+address-base-rva
 raise ValueError(hex(address))
def span(address,length):
 data=raw[offset(address):offset(address)+length]
 return {'address':hex(address),'bytes':length,'fileOffset':offset(address),'sha256':sha(data),'hex':data.hex()}
def function(address):
 instructions=[]
 for ins in Cs(CS_ARCH_X86,CS_MODE_32).disasm(raw[offset(address):offset(address)+0x1000],address):
  instructions.append({'address':hex(ins.address),'bytes':ins.bytes.hex(),'mnemonic':ins.mnemonic,'operands':ins.op_str})
  if ins.mnemonic=='ret':break
 assert instructions[-1]['mnemonic']=='ret'
 end=ins.address+ins.size
 return {**span(address,end-address),'instructions':instructions}
def string(address):
 data=raw[offset(address):offset(address)+512]
 if data[1]==0:
  end=next(i for i in range(0,len(data),2) if data[i:i+2]==b'\0\0')
  value=data[:end].decode('utf-16le');length=end+2
 else:
  end=data.index(b'\0');value=data[:end].decode('ascii');length=end+1
 return {**span(address,length),'value':value}
result={'schemaVersion':1,'id':'add-moonlight-native-v45','targetClientMeasured':False,'targetExecuted':False,
 'evidenceClass':'offline exact-byte static decode from existing static analysis snapshot; original runtime not executed',
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'bytes':len(raw),
 'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 'qualification':'Prior late snapshot may be non-atomic; derived PE and original client identities remain distinct.'},
 'rtti':{'typeDescriptor':span(0x33261cb0,8+len('.?AVCX2CustomFunctionByBuffMoonlightRhapsody@@')+1),
  'completeObjectLocator':span(0x33174f88,20),'vtable':span(0x3302507c,20),'callbackSlot':4,'callbackThunk':span(0x3229a7c0,5)},
 'functions':{'acceptedHitCallback':function(0x3229a330),'attackTriggerMembership':function(0x324db1c0),
  'attackerSkillScalar':function(0x31fa8f10),'attackerAwakeningScalar':function(0x31fb4670)},
 'strings':[string(a) for a in [0x3302b2e0,0x3302b360,0x3302b3e0]],
 'independentGuardConsumers':{
  'ravenDamageReactGuard':{**span(0x31facb79,0x93),
   'typedReference':{'path':'.cache/native-source-runtime/X2Lib/X2GUUser.cpp','lines':[8501,8515],
    'fileSha256':sha((ROOT/'.cache/native-source-runtime/X2Lib/X2GUUser.cpp').read_bytes()),
    'qualification':'Frozen reconstructed reference supplies names; original exact-byte guard order independently aligns unit type4, extraDamage false, NoDamage false, HpPercentUp<=0, IncreaseMP<=0, result!=7/10, hitType!=26, hold/grap false.'},
   'confirmedFields':{'DamageData+0x46c':'m_bNoDamage','DamageData+0x490':'m_fHpPercentUp','DamageData+0x4f8':'m_fIncreaseMP'}},
  'hpPercentRecovery':{**span(0x31fad7a7,0x2dc),
   'typedReference':{'path':'.cache/native-source-runtime/X2Lib/X2GUUser.cpp','lines':[8862,8881],
    'qualification':'Independent original consumer multiplies+490 by maxHP and adds nowHP before setter; all three literal references exactly match the typed HP-percent recovery block.'},
   'literals':[string(a) for a in [0x33013a48,0x33014a38,0x33014a0c]],
   'getMaxHp':function(0x31e059f0),'getNowHp':function(0x31e059b0)}},
 'confirmedConsumer':{'recipientTemplateId':439,'stackCounts':[1,2,3],'effectOwner':'current accepted-hit attacker from DamageData+0xC',
  'birthPosition':'accepted contact DamageData+0x3f0','rotation':[0,0,0],'consumesTemplateAfterSpawnAttempt':439,
  'guards':{'DamageData+0x24':'not 0 or 11','DamageData+0x28':'not 7 or 10','DamageData+0x20':'not 26',
  'DamageData+0x4bc/0x4c4-vector':'ATTACK_TRIGGER_TYPE scalar/vector not member7','DamageData+0x46c':'NO_DAMAGE must be false; independently aligned Raven guard consumer',
  'DamageData+0x490':'HP_PERCENT_UP must not be positive; independent original HP+ / Heal / Nasod_Healer consumer'},
  'power':'custom function scalar+0x10; user type0 multiplies (1+native skill-specific scalar29024); scalar identity pending confirmation'},
 'unsupportedUntilConfirmed':['attacker skill-specific scalar mapping/aggregation; base BF477 callback scalar1 is implemented separately'],
 'simulationBoundary':'Ordinary accepted-hit reactions retain their declared result. A transformed result can be supplied explicitly; RT11/12 return before this shared hook. Peer receipts must also prove owner-local eligible original damage declarations.'}
out=ROOT/'contracts/add-moonlight-native-v45.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'contract':str(out),'bodyBytes':result['functions']['acceptedHitCallback']['bytes'],'strings':[r['value'] for r in result['strings']]}))
