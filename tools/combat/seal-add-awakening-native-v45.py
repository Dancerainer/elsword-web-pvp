"""Seal the original Add awakening route and EffectSet clock; execute no target."""
from pathlib import Path
import hashlib,json,struct,sys,gzip
sys.dont_write_bytecode=True
sys.path[:0]=['asset_sources/analysis/offline-libs',str(Path(__file__).parent)]
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
from kl82_static import read_declarations
ROOT=Path(__file__).resolve().parents[2]
SOURCE=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe')
EXPECTED='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
sha=lambda b:hashlib.sha256(b).hexdigest()
image=SOURCE.read_bytes();assert sha(image)==EXPECTED
pe=struct.unpack_from('<I',image,60)[0];opt=pe+24;base=struct.unpack_from('<I',image,opt+28)[0]
count,size=struct.unpack_from('<H',image,pe+6)[0],struct.unpack_from('<H',image,pe+20)[0]
sections=[struct.unpack_from('<IIII',image,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
def block(name,a,n,meaning,code=True):
 b=image[offset(a):offset(a)+n]
 r={'id':name,'address':hex(a),'bytes':n,'fileOffset':offset(a),'sha256':sha(b),'hex':b.hex(),'meaning':meaning}
 if code:
  instructions=list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(b,a));assert sum(i.size for i in instructions)==n,name
  r['instructions']=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in instructions]
 return r
spec=[
 ('registration',0x3276a119,0x54,'Original ANSI_HYPER_MODE state23 registration, future/start/frame/event/end callback slots'),
 ('frame-thunk',0x327ffd30,5,'Registered frame thunk dispatches327c23a0'),
 ('frame-virtual',0x327c23a0,8,'Callback dispatches actual class vtable+49c'),
 ('add-frame-vtable',0x330625bc+0x49c,4,'RTTI-bound Add vtable+49c points3275e700',False),
 ('add-frame',0x3275e700,0x1e,'Original float .05/.46 forwarded to shared native frame callback'),
 ('common-frame',0x3275c240,0x430,'Original awake visual/particle/camera/formation-buff route, with final CommonFrameMove call'),
 ('formation-buff',0x3273c0f0,0x52,'Add vtable+bc applies BF315 and optional BF669, plus equipment awaken options'),
 ('display-vtable',0x330a5168,0x18,'RTTI-bound BDT_EFFECT_SET vtable, including create32ae37d0 and finish32ae3a80',False),
 ('normal-play-effect-set',0x321cf3c0,0x29d,'Complete normal PlayEffectSet body: creates through321cf1c0; does not overwrite constructor animation-clock flag'),
 ('effect-set-factory',0x321cf1c0,0x1f7,'Complete instance factory: calls constructor321ceb20 and records the instance handle'),
 ('effect-set-constructor',0x321ceb20,0x490,'Complete instance constructor, including original default animation-clock flag and zero elapsed times'),
 ('default-animation-clock',0x321cec87,0x1f,'EffectSet ctor zeroes prev/current elapsed and writes useAnimationTiming+bc=1'),
 ('clock-selection',0x321cb6bc,0x1c,'Original selected timer; flagfalse changes ANIM0 toCUSTOM1'),
 ('animation-clock-consumer',0x321cba0d,0x32,'Read current owner XSkin animation+e0, compare absolute member START_TIME+delay; no creation-time subtraction'),
 ('custom-clock-consumer',0x321cba3f,0x17,'CUSTOM instead compares instance elapsed+b8'),
 ('display-finish',0x32ae3a80,0x37,'Original BDT_EFFECT_SET finish stops stored effect-set handles'),
]
blocks=[block(*s) for s in spec]
assert struct.unpack('<I',bytes.fromhex(blocks[3]['hex']))[0]==0x3275e700
constants=[]
for name,a,value in [('change',0x3305cf90,.05),('shock',0x33011438,.46)]:
 r=block(name,a,4,'Original event timer argument',False);r['value']=struct.unpack('<f',bytes.fromhex(r['hex']))[0]
 assert abs(r['value']-value)<1e-7;constants.append(r)
catalog=json.loads(gzip.decompress(Path('asset_sources/upstream/reports/analysis/full-native/method-bodies.json.gz').read_bytes()))
bdt=next(m for m in catalog['methods'] if m['entry']=='0x32ae37d0')
assert bdt['directFlowComplete'] and bdt['sourceSpanBytes']==676
assert sha(image[offset(0x32ae37d0):offset(0x32ae37d0)+676])==bdt['sourceSpanSha256']
display={'entry':bdt['entry'],'spanBytes':bdt['sourceSpanBytes'],'spanSha256':bdt['sourceSpanSha256'],
 'qualification':'Prior bounded Capstone direct-flow traversal; not new Ghidra decompilation or original execution.',
 'instructions':bdt['instructions'],'meaning':'BDT_EFFECT_SET creates via321cf3c0 and stores handles; no write to useAnimationTiming or custom-clock setter in this exact body.'}
reference=ROOT/'.cache/native-source-runtime/X2Lib/X2EffectSet.cpp'
reference_bytes=reference.read_bytes()
assert sha(reference_bytes)=='395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440'
qualified_reference={'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
 'gitBlob':'b561ce3408224a5d15a3cab8be54cfb91bcf76c9','relativePath':'JP_TW_EU_CN_US/Trunk/X2Lib/X2EffectSet.cpp',
 'sha256':sha(reference_bytes),'bytes':len(reference_bytes),
 'qualification':'Fixed V5 source reference, not original2016 source or client execution. Native2016 byte blocks above independently confirm the selected normal-clock route.',
 'observations':[{'lines':[125,179],'meaning':'Default ESTT_ANIM compares current owner animation directly; disabling animation timing switches to custom elapsed.'},
  {'lines':[1748,1853],'meaning':'Factory and normal PlayEffectSet retain constructor defaults.'},
  {'lines':[2636,2660],'meaning':'EffectSetInstance initializes elapsed0 and useAnimationTiming true.'}]}
add=read_declarations(Path('asset_work/raw/data/data036.kom/Add_NasodRuler.lua'),capture_calls=True,capture_unresolved=True)
cache=ROOT/'.cache/elesis-v45/declarations'
effect=json.loads((cache/'effect-declarations.json').read_text('utf8'))
buff=json.loads((cache/'battle-buff-declarations.json').read_text('utf8'))
factor=json.loads((cache/'buff-factor-declarations.json').read_text('utf8'))
def effect_set(name,d=effect):return next(c for c in d['nativeCalls'] if any(isinstance(a,dict) and a.get('NAME')==name for a in c['args']))
formation=effect_set('EffectSet_AN_Formation_Start');marker=effect_set('Effect_Marker_Hyper_Posion01')
bt=next(c for c in buff['nativeCalls'] if any(isinstance(a,dict) and a.get('BUFF_TEMPLET_ID')==320 for a in c['args']))
bf=next(c for c in factor['nativeCalls'] if c['instruction']==19925 and c['prototype']==0)
assert bf['args'][-1]['BUFF_FACTOR_ID']==315 and bf['args'][-1]['BUFF_FACTOR']['BUFF_TEMPLET_ID']==320
assert bf['args'][-1]['BUFF_FACTOR']['BEHAVIOR']['BBT_EFFECT_SET_WITH_DAMAGE']['NOT_USE']==1
state=add['globals']['ANSI_HYPER_MODE'];assert not any(k.startswith('ATTACK_TIME') or k=='DAMAGE_DATA' for k in state)
members=[v for k,v in formation['args'][-1].items() if k.startswith('EFFECT')]
assert len(members)==37 and {v['EFFECT_TYPE'] for v in members}=={4,8}
intl=read_declarations(Path('asset_work/raw/data/datai015.kom/EffectSet_INT.lua'),capture_calls=True,capture_unresolved=True)
dragon=effect_set('EffectSet_DarkDragon_HyperMode_Pvp',intl)
result={'schemaVersion':1,'id':'add-awakening-native-v45','targetExecuted':False,'targetClientMeasured':False,
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729','qualification':'Existing late snapshot can be non-atomic; derived and original client identities remain distinct.'},
 'blocks':blocks,'constants':constants,'buffDisplayConsumer':display,'qualifiedReference':qualified_reference,
 'originalDeclarations':{
  'addState':{'source':add['source'],'location':add['locations']['ANSI_HYPER_MODE'],'raw':state},
  'formationSet':{'source':effect['source'],'call':formation},'formationBuffFactor':{'source':factor['source'],'call':bf},
  'formationBuffTemplate':{'source':buff['source'],'call':bt},'markerSet':{'source':effect['source'],'call':marker},
  'equipmentOnlyPvpSet':{'source':intl['source'],'call':dragon}},
 'confirmedClock':{'setName':'EffectSet_AN_Formation_Start','unitType':9,'clock':'animation','setStartAnimation':0,
  'meaning':'The original BDT display owns a default animation-clock set. At native apply.46, members.3/.4 already satisfy owner absolute animation time; member.5 becomes due at.5, not.96.'},
 'attackProducerStatus':'unresolved-no-source-bound-hard-stagger-producer',
 'attackLimits':['IS_ATTACK_STATE alone supplies no attack window or damage/reaction table.','The 37-member formation set contains no ET_DAMAGE_EFFECT member.','BT320 marker behavior names a two-particle set, and BF315 explicitly disables it with NOT_USE1; neither supplies an attacking set.','The extra native DarkDragon equipment routine has a separate INT dungeon damage branch; its PvP set contains particles/camera only and cannot supply a universal Add attack.','Native general state initialization, inherited collision/default data and other callbacks are not proven absent merely because this exact route contains no explicit damage creation.','No attack radius, damage coefficient, hard-stagger duration or reaction is guessed.'],
 'lifecycleLimits':['The BDT callback stores set handles and its Finish stops them; this does not establish emitter event semantics or every player-motion suppression rule.','Persistent layer classification is an existing Web adapter; the clock correction does not prove that all25 restored layers exactly match original runtime.','Static byte decoding and current Web trajectories do not establish original-client dynamic equivalence.']}
out=ROOT/'contracts/add-awakening-native-v45.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'path':str(out),'sha256':sha(out.read_bytes()),'blocks':len(blocks),'formationLayers':len(members),'attackProducer':result['attackProducerStatus']}))
