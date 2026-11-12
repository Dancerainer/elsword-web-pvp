"""Export original guild-window atlas pieces without changing their pixels."""
from pathlib import Path
import sys,sqlite3,json,hashlib
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets'))
from ui import read_tet,crop_piece
SOURCE=ROOT / 'asset_work'
GROUPS={
 'DLG_UI_Common_Texture03':['HELPER_BG1_TOP','HELPER_BG1_MIDDLE','HELPER_BG1_BOTTOM','HELPER_BG2_TOP','HELPER_BG2_MIDDLE','HELPER_BG2_BOTTOM'],
 'DLG_UI_Common_Texture13':['GUILD_BG_TOP','GUILD_BG_MIDDLE','GUILD_BG_BOTTOM'],
 'DLG_UI_Common_Texture06':['BLACK_BG_TOP','BLACK_BG_MIDDLE','BLACK_BG_BOTTOM'],
 'DLG_UI_Common_Texture10':['SKILL_BG_PASSIVE'],
 'DLG_UI_Common_Texture_NewSkill_01':['BG_SKILLSP_TEXT_BOX'],
 'DLG_UI_Button11':['MASTER_NORMAL'],
 'DLG_UI_BUTTON01':['EXIT_NORMAL','EXIT_OVER'],
 'DLG_UI_Common_Texture02':['FEEL'],
 'DLG_UI_BUTTON14':['BTN_BG_NORMAL'],
}
def sha(blob):return hashlib.sha256(blob).hexdigest()
def build():
 con=sqlite3.connect((SOURCE/'catalog.sqlite').as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
 sources={};pieces={};out=ROOT/'artifacts/ui/guild-window';out.mkdir(parents=True,exist_ok=True)
 def find(name):
  rows=con.execute('select * from assets where lower(name)=lower(?)',(name,)).fetchall()
  if not rows or len({r['sha256'] for r in rows})!=1:raise ValueError('Missing/ambiguous source: '+name)
  row=rows[0];path=SOURCE/row['raw_path']
  if sha(path.read_bytes())!=row['sha256']:raise ValueError('Source changed: '+name)
  sources[name]={'archive':row['archive'],'rawPath':row['raw_path'],'sha256':row['sha256']};return path
 for atlas,names in GROUPS.items():
  table=read_tet(find(atlas+'.tet').read_bytes());image=Image.open(find(atlas+'.tga')).convert('RGBA')
  for name in names:
   crop,box=crop_piece(image,table[name]);file=name.lower()+'.png';crop.save(out/file)
   pieces[file]={'atlas':atlas,'piece':name,'bounds':box,'width':crop.width,'height':crop.height,'sha256':sha((out/file).read_bytes())}
 for name in ['DLG_UI_Guild_Skill_Tree.lua','DLG_Guild_Skill_Icon.lua']:find(name)
 manifest={'schemaVersion':1,'target':'Steam-NA-2016-V6.0420.5','sources':sources,'pieces':pieces,'nativeClientMeasured':False,'webAdaptations':['English headings drawn as text','Existing twelve read-only Lv5 skills; derived used GSP 60','46px icons shared with the profession skill tree; window uses natural atlas width']}
 for path in [out/'manifest.json',ROOT/'contracts/guild-window-source-v26-1.json']:path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n','utf8')
 print(json.dumps({'pieces':len(pieces),'output':str(out)}))
if __name__=='__main__':build()
