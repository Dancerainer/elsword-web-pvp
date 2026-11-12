"""Original charge-complete particles and cue audio, with source receipts."""
from pathlib import Path
import sys,json,hashlib,struct
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/combat')]
from build_rf import Catalog,write_json,digest
def build():
 cat=Catalog(Path('asset_work'))
 profile=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf8'))
 narrow={'effectSets':{'EffectSet_WILD_CHARGE_MAX':profile['effectSets']['EffectSet_WILD_CHARGE_MAX']}}
 existing=json.loads((ROOT/'artifacts/rf/fx/index.json').read_text('utf8'))
 names=[row['NAME'] for key,row in narrow['effectSets']['EffectSet_WILD_CHARGE_MAX']['raw'].items() if key.startswith('EFFECT')]
 selected={name:existing['templates'][name] for name in names}
 for record in selected.values():
  if record['kind']!='particle':raise ValueError('Unexpected charge mesh')
  for value in record['textures'].values():
   if not (ROOT/'artifacts/rf'/value['file']).is_file():raise ValueError('Original charge texture missing')
 index={'schemaVersion':1,'referenceVersion':'Steam-NA-2016-V6.0420.5','templates':selected,'effectSets':narrow['effectSets'],'sourceFiles':list(cat.used.values()),'clientMeasured':False}
 write_json(ROOT/'contracts/rf-charge-display-v26.json',index)
 manifest_path=ROOT/'artifacts/rf/manifest.json';manifest=json.loads(manifest_path.read_text('utf8'))
 defaults=[name+'/index.json' for name in ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx']]
 paths=list(dict.fromkeys(defaults+[file for file in manifest.get('visualEffectIndexes',[]) if file!='charge-v26/fx/index.json' and (ROOT/'artifacts/rf'/file).is_file()]))
 manifest['visualEffectIndexes']=paths;write_json(manifest_path,manifest)
 audio=ROOT/'artifacts/audio/feedback-v26';audio.mkdir(parents=True,exist_ok=True);files={}
 for name in ['Battle_Atena_Start.ogg','Battle_Atena_Success.ogg','Skill_Equip.ogg','Skill_UnEquip.ogg','Raven_WildCharge_ChargeFull.ogg','GS_Sacrifice_of_Hero.ogg']:
  path=cat.path(name);blob=path.read_bytes();(audio/name).write_bytes(blob)
  pos=blob.index(b'\x01vorbis');rate=struct.unpack_from('<I',blob,pos+12)[0];samples=struct.unpack_from('<Q',blob,blob.rfind(b'OggS')+6)[0]
  files[name]={'file':'feedback-v26/'+name,'sha256':digest(blob),'durationSeconds':samples/rate,'source':cat.evidence(path)}
 write_json(audio/'manifest.json',{'schemaVersion':1,'files':files})
 write_json(ROOT/'contracts/feedback-audio-source-v26.json',{'files':files,'cuePolicy':'Original Battle_Atena Start/Success assets at accepted queue/match events. Original charge/guild sound names at effect trigger. Web event bindings; full native-client playback not measured.'})
 print(json.dumps({'chargeTemplates':len(selected),'audioFiles':len(files)}))
if __name__=='__main__':build()
