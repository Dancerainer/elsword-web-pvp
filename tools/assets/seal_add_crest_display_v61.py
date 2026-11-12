"""Read-only static target436 displayer and original particle closure; no Lua or EXE execution."""
from pathlib import Path
import sys,json,hashlib,re,copy
ROOT=Path(__file__).resolve().parents[2]
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'tools/combat'));sys.path.insert(0,str(ROOT/'tools/assets/character'))
from kl82_static import read_declarations
from build_rf_fx import declaration
BASE=Path('asset_work/raw/data/data036.kom')
def build():
 enums=read_declarations(BASE/'Enum.lua')
 bt=read_declarations(BASE/'BattleFieldBuffTemplet.lua',enums['globals'],True)
 es=read_declarations(BASE/'EffectSet.lua',enums['globals'],True,True)
 assert bt['source']['sha256']=='79bf16f5a905c895280ca02db11f4c83896bb4587432643615b5043145f5ccef'
 assert es['source']['sha256']=='6c6a0fd7759921c070a8d04fa26ddd1a6432c307e185d9a4d5188919099b16c7'
 buff=next(c for c in bt['nativeCalls'] if isinstance(c['args'][-1],dict) and c['args'][-1].get('BUFF_TEMPLET_ID')==436)
 name='EffectSet_ATT_Common_Crest_of_Time_Buff'
 effect=next(c for c in es['nativeCalls'] if isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')==name)
 raw=(BASE/'GameMajorParticle31.txt').read_bytes();assert hashlib.sha256(raw).hexdigest()=='1df800643621f2187738f9848b61d522b6aeae20c4b660efc2b82eada08bf465'
 index=json.loads((ROOT/'artifacts/de/fx/index.json').read_text(encoding='utf-8'));donor=index['templates']['Crest_of_Time_Time_Start'];texture=index['templates']['Crest_of_Time_Time_Start03']['textures']['Arme_Ring2.dds']
 pose=json.loads((ROOT/'artifacts/de'/donor['poseData']).read_text(encoding='utf-8'));mesh=Path('asset_work/raw/data/data147.kom')/donor['fields']['Mesh'];mesh_sha=hashlib.sha256(mesh.read_bytes()).hexdigest();assert mesh_sha==pose['observedClock']['sourceSha256']
 templates={}
 for n in ['Buff_Crest_of_Time_Time','Buff_Crest_of_Time_Time01']:
  match=re.search(rb'eventsequence\s+"'+n.encode()+rb'"\s*\{([^}]+)\}',raw);assert match
  t=declaration(match[1].decode('ascii'));assert not t['unsupported']
  t.update(name=n,kind='particle',declarationSha256=hashlib.sha256(match[0]).hexdigest(),source={'archive':'data/data036.kom','ordinal':115,'name':'GameMajorParticle31.txt','sha256':hashlib.sha256(raw).hexdigest(),'byteOffset':match.start(),'line':raw[:match.start()].count(b'\n')+1},textures={})
  if t['fields']['particleType']=='PT_SKINMESH':
   assert t['fields']['Mesh']==donor['fields']['Mesh']
   for k in ['glb','poseData','animationClips','animationMissingTickRate','animationRequiresUnconfirmedRate']:t[k]=donor[k]
  else:t['textures']={'Arme_Ring2.dds':copy.deepcopy(texture)}
  templates[n]=t
 result={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','clientMeasured':False,'scope':'Original436 recipient display only; existing TimeRing resource/revive behavior remains independent','buffTemplate':{'raw':buff['args'][-1],'sourcePc':{'prototype':buff['prototype'],'instruction':buff['instruction']}},'effectSets':{name:{'raw':effect['args'][-1],'sourcePc':{'prototype':effect['prototype'],'instruction':effect['instruction']}}},'templates':templates,'meshDonor':{'template':donor['name'],'declarationSha256':donor['declarationSha256'],'mesh':donor['fields']['Mesh'],'poseData':donor['poseData'],'originalMeshSha256':mesh_sha},'sourceFiles':[bt['source'],es['source'],{'path':str(BASE/'GameMajorParticle31.txt'),'sha256':hashlib.sha256(raw).hexdigest()}]}
 (ROOT/'contracts/add-crest-display-v61.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':build()
