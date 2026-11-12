"""Read original 2016 loading art and sound identities; write web assets only."""
from pathlib import Path
import sqlite3,json,hashlib,sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets'))
from ui import read_tet,crop_piece
SRC=ROOT / 'asset_work'
con=sqlite3.connect((SRC/'catalog.sqlite').as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
sources={};pieces={}
def source(name):
 row=con.execute('select * from assets where lower(name)=lower(?)',(name,)).fetchone()
 if not row:raise ValueError(name)
 p=SRC/row['raw_path'];blob=p.read_bytes();assert hashlib.sha256(blob).hexdigest()==row['sha256']
 sources[name]={'archive':row['archive'],'sha256':row['sha256'],'rawPath':row['raw_path']};return p
def piece(atlas,key,file):
 table=read_tet(source(atlas+'.tet').read_bytes());image=Image.open(source(atlas+'.tga')).convert('RGBA')
 crop,box=crop_piece(image,table[key.upper()]);out=ROOT/'artifacts/ui/loading'/file;out.parent.mkdir(parents=True,exist_ok=True);crop.save(out)
 pieces[file]={'atlas':atlas,'piece':key,'bounds':box,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()};return crop
def main():
 out=ROOT/'artifacts/ui/loading';out.mkdir(parents=True,exist_ok=True)
 for character in ['Elsword','Raven']:
  # The original dialog's four background tiles form a 1024 x 768 canvas.
  canvas=Image.new('RGBA',(1024,768));
  for atlas,key,xy in [(f'DLG_Loading_{character}01','LOADINGBG1',(0,0)),(f'DLG_Loading_{character}02','LOADINGBG2',(512,0)),(f'DLG_Loading_{character}03','LOADINGBG3',(0,512)),(f'DLG_Loading_{character}03','LOADINGBG4',(512,512))]:
   image=piece(atlas,key,character.lower()+'-'+key.lower()+'.png');canvas.paste(image,xy)
  canvas.save(out/(character.lower()+'.png'))
 piece('DLG_Loading7','Empty','empty.png')
 # These are the character pictures bound by the target loading dialog,
 # including their original transparent outlines (not profession HUD faces).
 piece('DLG_Loading4','Elsword_Color','elsword-avatar.png')
 piece('DLG_Common_New_Texture58','RAVEN_COLOR','raven-avatar.png')
 manifest={'schemaVersion':1,'target':'Steam-NA-2016-V6.0420.5','sourceDialog':'DLG_PVP_Game_Loading_State.lua / DLG_PVP_Game_Loading_State_User.lua','sources':sources,'pieces':pieces,'characterAvatars':{'elsword':{'professions':['LK','IS','RS'],'file':'elsword-avatar.png'},'raven':{'professions':['RF','BM','VC'],'file':'raven-avatar.png'}},'originalEnglishLabelsAcceptedByUser':True,'nativeClientMeasured':False}
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf8')
 (ROOT/'contracts/loading-ui-source-v26.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf8')
 print('Built original 2016 loading background, character avatars and empty silhouette')
if __name__=='__main__':main()
