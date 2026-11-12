"""Seal bounded original Firewall NPC declaration/functions and attack pose."""
from pathlib import Path
import json,sys,hashlib,copy,struct
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import load_x,helpers_from_tree,walk
from directx_animation import decode_animations
sha=lambda b:hashlib.sha256(b).hexdigest()
p=Path('asset_work/raw/data/data116.kom/EM_Stone_Wall_Effect.x')
assert sha(p.read_bytes())=='0daacdcccb015bf7eca85f633509f64b40a73d71b6e90d9c3b27d8e21cfe5811'
t=load_x(p);wanted={'Scene_Root','Dummy01','ATTACK_SPHERE0','ATTACK_SPHERE1','ATTACK_SPHERE2'}
frames=[(n,a) for n,a in walk(t) if n.kind=='Frame' and n.name in wanted];ids={n.name:i for i,(n,_) in enumerate(frames)}
clip=next(c for c in decode_animations(t,include_native_matrices=True) if c['name']=='EM_Stone_Wall_Wait')
assert clip['ticks_per_second']==4800
pose={'schemaVersion':1,'frames':[{'name':n.name,'parent':ids[a[-2].name] if len(a)>1 else None,'nativeRowMatrix':n.child('FrameTransformMatrix').nums()} for n,a in frames],
'helpers':[h for h in helpers_from_tree(t,'raw/data/data116.kom/EM_Stone_Wall_Effect.x') if h['name'].startswith('ATTACK_')],
'clips':[{'name':clip['name'],'ticks_per_second':clip['ticks_per_second'],'durationSeconds':clip['duration_seconds'],'tracks':[x for x in clip['tracks'] if x['frame_name'] in wanted]}]}
npc=json.loads((ROOT/'runtime/player-feedback-v45/firewall-npc-declarations.json').read_text('utf8'))
proto=json.loads((ROOT/'runtime/player-feedback-v45/firewall-npc-prototypes.json').read_text('utf8'))
effects=json.loads((ROOT/'.cache/elesis-v45/declarations/effect-declarations.json').read_text('utf8'))
sets={}
for c in effects['nativeCalls']:
 for a in c['args']:
  if isinstance(a,dict) and a.get('NAME') in ('EffectSet_Wall_of_Prominence_Attack','EffectSet_SA_SBH_WALL_OF_PROMINENCE_ROAD'):
   name=a['NAME'];raw={k:v for k,v in a.items() if k!='NAME'};sets[name]={'raw':raw,'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']},'source':effects['source'],'declarationSha256':sha(json.dumps(raw,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode())}
report={'schemaVersion':1,'id':'elesis-firewall-npc-v45','npcId':1635,'targetClientMeasured':False,'evidenceClass':'static original2016 NPC declaration and registered script bytecode + source attack helpers; Web map/NPC host adapter',
'source':npc['source'],'meshSource':{'path':str(p),'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size},
'raw':npc['globals'],'prototypes':proto,'pose':pose,'effectSets':sets,'projectionSha256':sha(json.dumps(pose,sort_keys=True,separators=(',',':')).encode()),
'limits':['Original NPC full generic physics, network replication and absorb-magic component are not imported.','X helper radius uses the existing source-vertex sphere candidate, not a newly measured native constructor.','WALK road particles remain unsupported until their original effect asset closure is available.']}
native=json.loads((ROOT/'contracts/elesis-player-feedback-native-v45.json').read_text('utf8'))
image=Path(native['source']['path']).read_bytes();assert sha(image)==native['source']['sha256']
pe=struct.unpack_from('<I',image,60)[0];opt=pe+24;base=struct.unpack_from('<I',image,opt+28)[0]
count,size=struct.unpack_from('<H',image,pe+6)[0],struct.unpack_from('<H',image,pe+20)[0]
sections=[struct.unpack_from('<IIII',image,opt+size+i*40+8) for i in range(count)]
def body_range(first,last):
 for vs,rva,rs,start in sections:
  if base+rva<=first<=last<base+rva+min(vs,rs):
   b=image[start+first-base-rva:start+last-base-rva+1]
   return {'start':hex(first),'end':hex(last),'bytes':len(b),'sha256':sha(b)}
 raise ValueError(hex(first))
region=json.loads((ROOT/'runtime/elesis-v45/npc-consumer-region.json').read_text('utf8'))
assert region['sourceSha256']==native['source']['sha256']
assert region['outputSha256']=='3dbe072d67bbf29dd0fa5a0e5a9a5e131c0ce18bb73c38d63b3456e2259690fb'
report['nativeConsumer']={'source':native['source'],'analysisInput':region,
 'provider':{'id':'ghidra','version':'12.1.4','analyzerPreset':'ghidra-default','analysisProfileDigest':'b9d116ea480a02cc8773b19372074a3caf77785cbc080b1ac7133b5110e40b17'},
 'functions':[
  {'entry':'0x320b35c0','role':'NPC request packet builder','evidenceId':'ev_1df2dc34a18426c2c423d051718af2f9ea1e4e81b8fded858ac385aaeb9878e3','body':[body_range(0x320b35c0,0x320b3891)]},
  {'entry':'0x3252da30','role':'NPC animation/Now dispatcher','evidenceId':'ev_4002259674d7dd228b43407e7500c58dbd794426b0bb25bc619b13eb333c6e2f','body':[body_range(0x3252da30,0x3252e658)]},
  {'entry':'0x32530e00','role':'NPC physics vtable+364','evidenceId':'ev_62680912e6bdae684a29016927baf90d704cdc688863ded4ad5d67faf9b1cc68','body':[body_range(0x32530e00,0x32531cd9),body_range(0x32531ce0,0x32532c85),body_range(0x32532c90,0x32534394)]},
  {'entry':'0x325352b0','role':'NPC Now vtable+374, physics then passive speed copying','evidenceId':'ev_794ca157bed3d64b3239cc3d5605c994ca084f56f742a9e3d84776b78cf367cb','body':[body_range(0x325352b0,0x3253ae2c),body_range(0x3253ae30,0x3253c347)]}],
 'boundedInstructionBlocks':[x['id'] for x in native['blocks'] if x['id'].startswith('native-v45-firewall-')],
 'fieldProjection':{'currentX':'0x1ac','currentY':'0x1b0','passiveX':'0x1b4','passiveY':'0x1b8','reloadAcceleration':'0x1c0','perFrameElapsed':'0x6dc8'},
 'projection':['The original request uses caster GetNowPos(0); no victim position is passed at the native callback.','Original WALK and ATTACK_SUCCESS Start prototypes both write passive speed3000/0; SUCCESS does not stop movement.','NPC Now invokes physics at3253ab17, then copies passive X/Y at3253ad57..7e unless sentinel-1.','The positive current X branch subtracts reloadAcceleration*frameElapsed before multiplying displacement by frameElapsed.','The bounded Web host starts current X/Y at zero and applies that ordering; general native collision/buff speed multipliers are not imported.'],
 'limits':['Full Ghidra dossiers are retained in task-local ignored runtime/elesis-v45/npc-consumer-analysis-bundle.json; only bounded exact instructions and function-body hashes are committed.','The analysis input maps selected original bytes only. Omitted memory/calls remain unknown; no original target was executed.','The LuaTinker method registration for the direct passive setter is not independently resolved.','No Firewall-specific arbitrary-platform victim lookup was found in these exact callbacks/scripts/consumers; this is a bounded negative observation, not proof of absence in all native code.']}
out=ROOT/'contracts/elesis-firewall-npc-v45.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n');print(json.dumps({'path':str(out),'bytes':out.stat().st_size,'sha256':sha(out.read_bytes())}))
