"""Read-only exact-byte seal of the original DE aerial ZX producer."""
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
def function(a,n=None):
 rows=[]
 for i in Cs(CS_ARCH_X86,CS_MODE_32).disasm(raw[offset(a):offset(a)+(n or 0x2000)],a):
  rows.append({'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str})
  if n is None and i.mnemonic=='ret':break
 assert n is not None or rows[-1]['mnemonic']=='ret'
 return {**span(a,i.address+i.size-a),'instructions':rows}
def string(a,value,encoding='utf-16le'):
 b=value.encode(encoding)+bytes(2 if encoding=='utf-16le' else 1);assert raw[offset(a):offset(a)+len(b)]==b
 return {**span(a,len(b)),'value':value}
def scalar(a,value):
 actual=struct.unpack_from('<f',raw,offset(a))[0];assert actual==value
 return {**span(a,4),'value':actual}
contract={'schemaVersion':1,'id':'add-de-command-native-v45','targetClientMeasured':False,'targetExecuted':False,
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729'},
 'registration':span(0x32770054,0x40),'stateName':string(0x33062cd4,'ANSI_ATT_DASH_JUMP_COMBO_ZX','ascii'),
 'frameThunk':span(0x32776400,5),'functions':{'frame':function(0x32756e00),'resourceGate':function(0x327427d0,0x15c),
  'consumeDpIfEnough':function(0x3273cdb0,0x56),'changeDp':function(0x32744c90,0x7a),'resourceModifier':function(0x327432c0,0xdf),
  'event':function(0x32739530,0x277),'cancelStateGetter':function(0x31fcb840)},
 'stateStartFuture':span(0x327446d0,0x74),'unimplementedPhysicsPreview':span(0x327433a0,0x242),
 'futureOnceDispatcher':span(0x31f64a90,0x327),'physicsXSpeedFriction':span(0x31f6d482,0x69),
 'effectSetName':string(0x33060128,'EffectSet_AAT_DashJumpCombo_ZZX'),
 'constants':[scalar(0x32fe77f0,0.009999999776482582),scalar(0x3305cf14,3.0)],
 'passiveLearnedGate':span(0x32764527,0x4b),'addVtable':{'address':'0x330625bc','resourceGateSlot':span(0x330625bc+0x560,4),'changeDpSlot':span(0x330625bc+0x248,4),
  'cancelZGetter':span(0x330625bc+0x3e0,4),'cancelXGetter':span(0x330625bc+0x3e4,4)},
 'confirmed':{'trigger':'Registered ANSI_ATT_DASH_JUMP_COMBO_ZX frame32756e00 .01 oneshot -> gate3 -> original EffectSet_AAT_DashJumpCombo_ZZX',
  'power':'Default GetPowerRate(-1) at32756f98, retains ordinary command power; no skill scalar invented',
  'resource':'327427d0 uses FlushMP3 unless learned29410 atactor+72f0 and formation; then3273cdb0 checks rawDP>=3 and calls option-aware virtualChangeDP(-3,1)',
  'passiveIdentity':'32764527 lookup learned skill0x72e2=29410 and32764562 storesactor+72f0=1; source skill Nasod Armor Mode - Overlimit',
  'cancellation':'32739530 does not immediately change to dash-jump landing. Animation end: grounded WAIT13, airborne JUMP_DOWN17 withY-=30. At ATTACK_CANCEL_AFTER and grounded, pureZ/pureX invoke Add virtual getters+3e0/+3e4, both31fcb840 returning WAIT13.',
  'futureOnlyOnce':'31f64a90 state-change counters gate registered StateStartFuture327446d0. Helper increments rawnowSpeed.x at+1ac by-500 eight times and invokes fullPhysicProcess31f6c810; not direct displacement. Native CanDown31c53890 uses radius30 flagsfalse,false,true; max(intersectionY,entryY-600).',
  'sourceClosure':'contracts/add-de-command-closure-v45.json retains original .25 projectile creation; zero damage projectile hits/dies -> original1.17MAGIC/.6PvP explosion'},
 'setClockEvidence':{'contract':'contracts/add-awakening-native-v45.json','nativeRange':'321cba0d..321cba3c','meaning':'Ordinary PlayEffectSet compares raw memberSTART_TIME directly with owner absolute animation time; native .01 callback does not shift .25 member threshold.'},
 'limits':['The native future movement helper327433a0 and its boundary/collision algorithm remain unsupported for this command; no guessed displacement is installed.',
  'A dedicated extra668ZXX state/producer was not recovered; only the original source cancellation toWAIT is installed.',
  'Generic option-aware DP modifiers retain the existing qualified Web resource consumer; native modifier internals are sealed independently.',
  'Original-client battle execution was not measured.'],
 'tests':['tests/combat/add-de-command-native-v45.test.mjs']}
out=ROOT/'contracts/add-de-command-native-v45.json';out.write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'contract':str(out),'functions':{k:v['sha256'] for k,v in contract['functions'].items()}}))
