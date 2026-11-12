"""Exact original ADD HUD/lobby/loading crops; no source-image alteration."""
from pathlib import Path
import sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog,write_json,digest
from ui import read_tet,crop_piece

def crop_rotated(image,piece):
    p=piece['points'];x0,y0,x1,y1=min(v[0] for v in p),min(v[1] for v in p),max(v[0] for v in p),max(v[1] for v in p)
    if p==[[x0,y1],[x1,y0],[x1,y1],[x0,y0]] and piece['size']==[y1-y0,x1-x0]:
        direct={**piece,'points':[[x0,y0],[x1,y1],[x0,y1],[x1,y0]],'size':[x1-x0,y1-y0]}
        image,box=crop_piece(image,direct);return image.transpose(Image.Transpose.ROTATE_270),box,'original TET 90 degree UV orientation'
    image,box=crop_piece(image,piece);return image,box,'original TET orientation'

def build(source=Path('asset_work')):
    c=Catalog(source);out=ROOT/'artifacts/ui';pieces={};hud={}
    def crop(atlas,key,file):
        a,t=c.path(atlas+'.tga'),c.path(atlas+'.tet');im,box,orientation=crop_rotated(Image.open(a).convert('RGBA'),read_tet(t.read_bytes())[key]);f=out/file;f.parent.mkdir(parents=True,exist_ok=True);im.save(f)
        row={'file':file,'atlasSource':c.evidence(a),'tetSource':c.evidence(t),'piece':key,'bounds':box,'orientation':orientation,'width':im.width,'height':im.height,'sha256':digest(f.read_bytes())};pieces[file]=row;return row
    for job in ('lp','mm','de'):crop('DLG_UI_Common_Texture_GUI_CHARACTER_01','LIST_ADD_A'+job.upper(),'lobby/portraits/'+job+'.png')
    crop('DLG_UI_Common_Texture80_NEW','ADD_COLOR','loading/add-avatar.png')
    for key in read_tet(c.path('DLG_UI_Common_Texture80_NEW.tet').read_bytes()):
        if key.startswith(('BG_DP','BG_MSYSTEM','BG_ADDGAUGE')):
            row=crop('DLG_UI_Common_Texture80_NEW',key,'add/'+key.lower()+'.png');hud[key]={**row,'file':Path(row['file']).name}
    for key in ('BUFF_ICON_CREST_OF_TIME','DEBUFF_ICON_CREST_OF_TIME','BUFF_ICON_HYPER'):
        row=crop('DLG_UI_Common_Texture_Buff',key,'add/'+key.lower()+'.png');hud[key]={**row,'file':Path(row['file']).name}
    result={'schemaVersion':1,'clientMeasured':False,'pieces':hud,'sourceDialog':c.evidence(c.path('DLG_Add_DP_And_Mutation.lua'))}
    write_json(out/'add/index.json',result);write_json(ROOT/'contracts/add-ui-source-v1.json',{'schemaVersion':1,'clientMeasured':False,'pieces':pieces,'sourceDialog':result['sourceDialog']})
    print({k:(v['width'],v['height'])for k,v in hud.items()})
if __name__=='__main__':build()
