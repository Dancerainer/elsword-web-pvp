"""Seal exact original sound call sites separately from frozen reference routes."""
from pathlib import Path
import json,hashlib,re,struct,sys
sys.dont_write_bytecode=True
sys.path.insert(0,'asset_sources/analysis/offline-libs')
from capstone import Cs,CS_ARCH_X86,CS_MODE_32
raw=Path('asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='b8be4f12ea3055c4f05abf0afcf1ea4084c0ebb208562bf39c5de27951e284ba'
pe=struct.unpack_from('<I',raw,60)[0];opt=pe+24
base=struct.unpack_from('<I',raw,opt+28)[0]
count,size=struct.unpack_from('<H',raw,pe+6)[0],struct.unpack_from('<H',raw,pe+20)[0]
sections=[struct.unpack_from('<IIII',raw,opt+size+i*40+8) for i in range(count)]
def offset(a):
 for vs,rva,rs,start in sections:
  if base+rva<=a<base+rva+min(vs,rs):return start+a-base-rva
 raise ValueError(hex(a))
dis=Cs(CS_ARCH_X86,CS_MODE_32)
root=Path(__file__).resolve().parents[2]
sha=lambda b:hashlib.sha256(b).hexdigest()
def span(start,end):
 b=raw[offset(start):offset(start)+end-start]
 return {'start':hex(start),'endExclusive':hex(end),'bytes':len(b),'sha256':sha(b),'hex':b.hex(),
  'instructions':[{'address':hex(i.address),'mnemonic':i.mnemonic,'operands':i.op_str} for i in dis.disasm(b,start)]}
source_paths=['X2Lib/X2GameUnit.cpp','X2Lib/X2GameUnit.h','X2Lib/X2GUUser.cpp','X2Lib/X2GURaven.cpp','X2Lib/X2DamageEffect.cpp','KTDXLIB/KTDGXMeshPlayer.cpp']
sources=[{'path':'.cache/native-source-runtime/'+p,'sha256':sha((root/'.cache/native-source-runtime'/p).read_bytes())} for p in source_paths]
routes=[]
def add(key,lines,names,recipient,frozen,spans=(),classification='original-static-call-and-frozen-names'):
 routes.append({'id':key,'indexLines':lines,'names':names,'sourcePosition':recipient,'native3D':True,
  'classification':classification,'frozen':frozen,'originalSpans':[span(a,b) for a,b in spans]})
add('wild-full',[734],['Raven_WildCharge_ChargeFull.ogg'],'actor a GetPos()',{'path':source_paths[3],'lines':[16963,16968]},[(0x328a738c,0x328a73ae)])
add('guild-hero',[1189],['GS_Sacrifice_of_Hero.ogg'],'dying actor a GetPos(), not healed recipients',{'path':source_paths[2],'lines':[30569,30574]},[(0x31f580c8,0x31f580d7)])
add('high-jump',[1790,1893],['HighJump.ogg'],'actor stepping on jump line a GetPos(), not the line origin',{'path':source_paths[2],'lines':[20851,20860,20881,20884]},[(0x31f4663c,0x31f46655),(0x31f466e5,0x31f466fc),(0x31f4692a,0x31f46941),(0x31f46a25,0x31f46a3c)])
add('arc-release',[2111],['Raven_OT_SP2_FlyingImpact3.ogg'],'caster Raven a GetPos(), not released Arc main mesh',{'path':source_paths[3],'lines':[503,531]},[(0x328a8c80,0x328a8c95),(0x328a8d96,0x328a8da7),(0x328a8df4,0x328a8ed4)])
add('damage-hit',[2888],['resolved GetDamageSound name'],'defender b GetPos(), not impact/head point',{'path':source_paths[2],'lines':[8325,8345]},classification='frozen-source-reference; exact original dynamic-name hit consumer unresolved')
add('critical',[2905],['Critical_Hit.wav'],'defender b GetPos(), not damage-number/head point',{'path':source_paths[2],'lines':[9212,9226]},[(0x321f3630,0x321f3639),(0x321f3bd9,0x321f3be9)],classification='frozen-source-reference for immediate critical route; original literal is in queue consumer 321f3630, not proven same producer')
add('nasod-trans-parry',[2961],['Raven_NasodCore_Trans_Parry.ogg'],'defender Raven b GetPos(), not core mesh',{'path':source_paths[3],'lines':[14176,14183]},[(0x328b29c7,0x328b29dd)])
add('nasod-guard',[2966],['Raven_NasodCore_Guard.ogg'],'defender Raven b GetPos(), not core mesh or parry effect custom offset',{'path':source_paths[2],'lines':[9003,9009]},[(0x31fadec0,0x31faded0)])
add('electric-aura-end',[3361],['Raven_ElectricAura_Disappear.ogg'],'Raven a GetPos(), not stopped aura effect position',{'path':source_paths[3],'lines':[21841,21846]},[(0x328b723f,0x328b724f)])
add('nasod-level',[3384],['Raven_NasodCore_Appear.ogg','Raven_NasodCore_Shrink.ogg','Raven_NasodCore_Grow.ogg'],'Raven a GetPos(), not core mesh',{'path':source_paths[3],'lines':[14556,14591]},[(0x328b3147,0x328b316c)])
add('nasod-trans-attack',[3399],['Raven_NasodCore_Trans_Attack.ogg'],'Raven a GetPos(), not core mesh',{'path':source_paths[3],'lines':[14367,14372]},[(0x328b2fc2,0x328b2fd2)])
add('nasod-attack',[3445],['Raven_NasodCore_Attack.ogg'],'Raven a GetPos(), not moving core mesh',{'path':source_paths[3],'lines':[14418,14490]},[(0x328adc28,0x328adc40)])
add('damage-raw-SOUND',[2356],['raw SOUND<number>.FILE_NAME'],'live main mesh pMeshInst->GetPos()',{'path':source_paths[4],'lines':[2534,2579]},classification='frozen-source-reference; exact 2016 DamageEffect SOUND consumer unresolved')
routes[-1]['webMapping']={'shadowMesh':'e.sourceShadowMesh.position is the live mesh position; currentAnchor is synchronized after FollowLine at index2279/2287',
 'ordinaryMesh':'e.currentAnchor.position is live main SetPos, distinct from sourcePosedAnchor cached posed matrix and sourceDamageAnchor pre-FollowLine transform',
 'missingPosition':'explicit unsupported; do not silently substitute caster or damage-number/impact coordinates',
 'scope':'existing Web transform adapters; does not certify all native frame-phase timing or original SOUND consumer'}
add('embedded-mesh-Sound',[],['template mesh Sound event'],'that template mesh instance m_vPos, not actor, origin or arbitrary effect child',{'path':source_paths[5],'lines':[3927,3942]},[(0x31c7b8c2,0x31c7b8de)],classification='original-static-mesh-position-call with frozen class naming; separate from raw DamageEffect SOUND')
profiles=[]
for p in sorted((root/'packages/combat-core').glob('*-profile.json')):
 data=p.read_bytes();j=json.loads(data);items=[];rawsound=[]
 for n,e in j.get('damageEffects',{}).items():
  for k,v in e.get('raw',{}).items():
   if re.fullmatch('SOUND_PLAY[0-9]+',k):items.append({'effect':n,'key':k,'raw':v})
   elif re.fullmatch('SOUND[0-9]+',k):rawsound.append({'effect':n,'key':k})
 profiles.append({'path':str(p.relative_to(root)).replace('\\','/'),'sha256':sha(data),'damageEffectSoundPlay':items,'damageEffectSoundCount':len(rawsound)})
result={'id':'source-sound-routes-native-v45','clientMeasured':False,'originalExecuted':False,
 'originalPe':{'path':'asset_sources/analysis/analysis/derived/x2-late-snapshot3-analysis.exe','sha256':sha(raw)},
 'generalPlaySound':{'consumer':'321e7440..321e75b8','contract':'contracts/source-distance-native-v45.json','frozen':{'path':source_paths[0],'lines':[5055,5080]},'defaultArgs':{'path':source_paths[1],'line':2489,'b3DSound':True,'bLoop':False}},
 'frozenSources':sources,'routes':routes,'damageEffectProfileInventory':profiles,
 'rawSoundPlayCaveat':'Current index2349 calls actor soundEvent on raw damage SOUND_PLAY. Frozen DamageEffect parser handles SOUND only; no corresponding original effect SOUND_PLAY consumer proven. Preserve unknown rather than reclassify by string similarity.',
 'limits':['Immediate critical mapping and dynamic hit sound mapping are frozen-source-reference, not native producer closure.','Original raw DamageEffect SOUND consumer remains unresolved.','Native 321d7b70 is a distinct pooled sound-data consumer with parent/owner fallback; its connection to raw damage SOUND has not been proven.','No original client/audio measurement.']}
out=root/'contracts/source-sound-routes-native-v45.json'
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'output':str(out),'routes':len(routes),'damageEffectSoundPlay':sum(len(p['damageEffectSoundPlay']) for p in profiles),'damageEffectSound':sum(p['damageEffectSoundCount'] for p in profiles)}))
