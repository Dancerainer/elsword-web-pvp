"""Seal Prism's actual source attack producer and failed-Loop consumer bounds."""
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
def block(a,n):
 result=span(a,n);decoded=list(Cs(CS_ARCH_X86,CS_MODE_32).disasm(bytes.fromhex(result['hex']),a))
 assert sum(i.size for i in decoded)==n
 result['instructions']=[{'address':hex(i.address),'bytes':i.bytes.hex(),'mnemonic':i.mnemonic,'operands':i.op_str} for i in decoded]
 return result
def reference(file,first,last,meaning):
 path=ROOT/'.cache/native-source-runtime'/file;data=path.read_bytes();fragment=b''.join(data.splitlines(keepends=True)[first-1:last])
 return {'path':file,'fileSha256':sha(data),'firstLine':first,'lastLine':last,'fragmentSha256':sha(fragment),'meaning':meaning,
  'evidenceClass':'Frozen fixed-V5 source-version reference, explicitly not matching2016 C++ or an original-client battle trace'}
profile=json.loads((ROOT/'packages/combat-core/lp-profile.json').read_text('utf8'))
for key in ('add','effect','damage'):
 source=profile['sources'][key]
 assert sha(Path(source['path']).read_bytes())==source['sha256']
mesh=Path('asset_work/raw/data/data147.kom/AN_PARTICLE_PRISM_Dummy01.X')
pose=json.loads((ROOT/'artifacts/lp/fx/meshes/AN_PARTICLE_PRISM_Dummy01.pose.json').read_text('utf8'))
assert [c['name'] for c in pose['clips']]==['Normal']
assert sha(mesh.read_bytes())==pose['observedClock']['sourceSha256']
constants=[]
for name,a,fmt,value in [('cast-time',0x32fe95e0,'f',.1),('degree-radian',0x32ff1c58,'d',.01745329238474369),
 ('phase-offset',0x33060308,'d',1.5700000524520874),('start-offset',0x32ff49d8,'d',50)]:
 actual=struct.unpack_from('<'+fmt,raw,offset(a))[0];assert abs(actual-value)<1e-7
 constants.append({**span(a,struct.calcsize(fmt)),'name':name,'value':actual,'format':'little-endian-'+fmt})
report={'schemaVersion':1,'id':'add-prism-native-v45','targetClientMeasured':False,'targetExecuted':False,
 'source':{'path':str(SOURCE),'sha256':EXPECTED,'bytes':len(raw),'originalClientSha256':'edbb9d63a7a18c92170ddcbe79f0783bbf4f329056eae11d4185c7ee7f96f729',
 'qualification':'Offline exact-byte static decode of prior late static analysis snapshot, whose identity is distinct from the original file.'},
 'native':{'registration':block(0x3277237c,0x39),'frameThunk':block(0x32776200,5),'frameBody':block(0x32757970,0x3de),'constants':constants},
 'attackProducer':{'evidence':'Original state EFFECT_SET_LIST_EX plays damage set at.7; this was already being spawned. It does not depend on an absent NPC attack callback.',
  'state':{'name':'ANSI_SA_AN_PARTICLE_PRISM','raw':profile['states']['ANSI_SA_AN_PARTICLE_PRISM']['raw'],'source':profile['sources']['add'],
   'sourcePc':profile['states']['ANSI_SA_AN_PARTICLE_PRISM']['sourcePc']},
  'sets':{n:profile['effectSets'][n] for n in ('EffectSet_SA_AN_PARTICLE_PRISM','EffectSet_SA_AN_PARTICLE_PRISM_DAMAGE')},
  'damage':{n:row for n,row in profile['damageEffects'].items() if 'Prism' in n},'effectSource':profile['sources']['effect'],'damageSource':profile['sources']['damage']},
 'animationMismatch':{'template':'Mesh_Particle_Prism','requested':'Loop','available':['Normal'],
  'templateDeclarationSha256':profile['effectTemplates']['Mesh_Particle_Prism']['declarationSha256'],
  'meshSource':{'path':str(mesh),'sha256':sha(mesh.read_bytes()),'bytes':mesh.stat().st_size},
  'existingDllLoaderEvidence':pose['observedClock'],
  'consumer':'Failed ChangeAnim(name) retains initial state. Play(LOOP) still runs; initial frame is bind, then native LOOP selects index0 and later frames sample Normal. No permanent-bind or raw Loop→Normal rewrite.'},
 'referenceConsumers':[reference('KTDXLIB/KTDGXSkinAnim.cpp',22,42,'Constructor track/index0 and zero animation clocks'),
  reference('KTDXLIB/KTDGXSkinAnim.cpp',758,785,'Frame copy precedes LOOP end test and index0 selection'),
  reference('KTDXLIB/KTDGXSkinAnim.cpp',1138,1164,'Missing name returnsfalse before mutating current animation'),
  reference('KTDXLIB/KTDGXMeshPlayer.cpp',2923,2945,'AniName event calls Play even after ChangeAnim name fails'),
  reference('X2Lib/X2Game.cpp',14231,14285,'Prism endpoints receive25percent owner HP, original skill duration and field handle stop-on-die')],
 'tests':['tests/combat/add-prism-v45.test.mjs'],
 'limits':['Original endpoint NPCs are not independent destructible targets in this Web field adapter.',
  'The stated mutation range increase has no independently recovered size producer; no invented1.4 multiplier is added.',
  'Native snapshot static evidence and qualified reference controller execution are not an original-client battle measurement.']}
out=ROOT/'contracts/add-prism-native-v45.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8')
old=ROOT/'contracts/add-prism-audit-v45.json';legacy=json.loads(old.read_text('utf8'));legacy.pop('missingConsumer',None)
legacy['resolvedAttackProducer']={'contract':'contracts/add-prism-native-v45.json','stateTime':.7,
 'damageSet':'EffectSet_SA_AN_PARTICLE_PRISM_DAMAGE','cause':'Missing original failed-AniName controller caused an empty attack shape list; the original state producer was present.'}
old.write_text(json.dumps(legacy,ensure_ascii=False,indent=2)+'\n','utf8')
print(json.dumps({'contract':str(out),'frameBytes':report['native']['frameBody']['bytes']}))
