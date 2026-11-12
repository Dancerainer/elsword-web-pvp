"""Read-only original 2016 square portraits, guild icons and interface audio."""
from pathlib import Path
import hashlib,json,sqlite3,struct,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets'))
from ui import read_tet,crop_piece
def sha(data):return hashlib.sha256(data).hexdigest()
def dump(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def build(source=Path('asset_work'),client=Path('asset_sources/client')):
 source=source.resolve();con=sqlite3.connect((source/'catalog.sqlite').as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
 sources={}
 def find(name):
  rows=con.execute('select * from assets where lower(name)=lower(?)',(name,)).fetchall()
  if not rows or len({r['sha256'] for r in rows})!=1:raise ValueError('Missing/ambiguous source: '+name)
  row=dict(rows[0]);p=source/row['raw_path'];raw=p.read_bytes()
  if sha(raw)!=row['sha256']:raise ValueError('Changed source: '+name)
  sources[name]={'archive':row['archive'],'rawPath':row['raw_path'],'sha256':row['sha256']};return p
 output=ROOT/'artifacts/ui/lobby';output.mkdir(parents=True,exist_ok=True);pieces={}
 def crop(atlas,piece,file):
  table=read_tet(find(atlas+'.tet').read_bytes());image=Image.open(find(atlas+'.tga')).convert('RGBA');value=crop_piece(image,table[piece])
  cropped,box=value if isinstance(value,tuple) else (value,None)
  target=output/file;target.parent.mkdir(parents=True,exist_ok=True);cropped.save(target)
  row={'file':file,'width':cropped.width,'height':cropped.height,'sha256':sha(target.read_bytes()),'atlas':atlas,'piece':piece,'bounds':box}
  pieces[file]=row;return row
 portraits={}
 for id,atlas,piece in [('LK','16','L_KNIGHT'),('RS','16','R_SLAYER'),('IS','66','I_SWORD'),('RF','25','R_FIST'),('VC','25','V_COMMANDER'),('BM','25','B_MASTER')]:
  portraits[id]=crop('DLG_UI_Common_Texture'+atlas+'_NEW',piece+'_SMALL','portraits/'+id.lower()+'.png')
 guild={}
 for row in json.loads((ROOT/'packages/combat-core/guild-catalog.json').read_text(encoding='utf-8'))['skills']:
  icon=row['sourceIcon'];guild[str(row['skillId'])]=crop(icon['atlas'][:-4],icon['piece'],'guild/'+str(row['skillId'])+'.png')
 frame=crop('DLG_UI_Common_Texture10','SKILL_BG_PASSIVE','guild/frame.png')
 manifest={'schemaVersion':1,'portraits':portraits,'guildIcons':guild,'guildFrame':frame,'pieces':pieces,'sources':sources,'originalClientMeasured':False}
 dump(output/'manifest.json',manifest)
 audio=ROOT/'artifacts/audio/lobby';audio.mkdir(parents=True,exist_ok=True);sounds={}
 for key,p in [('lobby',client/'data/music/lobby.ogg'),('click',find('X2_Button_Mouse_Up.ogg')),('queue',find('UI_PopUp_Positive_01.ogg')),('count',find('Count.ogg'))]:
  data=p.read_bytes();ident=data.index(b'\x01vorbis');rate=struct.unpack_from('<I',data,ident+12)[0];last=data.rfind(b'OggS');samples=struct.unpack_from('<Q',data,last+6)[0]
  if rate<8000 or samples==2**64-1:raise ValueError('Invalid original Vorbis stream')
  file=key+'.ogg';(audio/file).write_bytes(data)
  sounds[key]={'file':'lobby/'+file,'bytes':len(data),'sha256':sha(data),'durationSeconds':samples/rate,'source':str(p),'originalName':p.name}
 audio_manifest={'schemaVersion':1,'files':sounds,'cuePolicy':'Original UI positive notification on accepted matching entry; original Count for countdown. Web triggers, not original-client playback evidence.'}
 dump(audio/'manifest.json',audio_manifest)
 dump(ROOT/'contracts/lobby-ui-audio-source-v4.json',{'schemaVersion':1,'client':'Steam-NA-2016-V6.0420.5','originalClientMeasured':False,'visuals':manifest,'audio':audio_manifest})
 print(json.dumps({'portraits':len(portraits),'guildIcons':len(guild),'audioBytes':sum(s['bytes']for s in sounds.values())}))
if __name__=='__main__':build()
