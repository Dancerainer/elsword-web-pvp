"""Export skill icons and original NA names from the target profiles."""
import argparse
import json
import re
import sys
from pathlib import Path
from PIL import Image
from ui import read_tet, crop_piece
sys.path.insert(0,str(Path(__file__).resolve().parent/'character'))
from build_rf import Catalog, digest, write_json

ROOT=Path(__file__).resolve().parents[2]


def display_name(row, by_id):
    """Validate the source upgrade chain and retain this skill’s original name."""
    family=[];cursor=row['skillId']
    while True:
        if cursor in family:raise ValueError('Cyclic target skill replacement chain: '+str(cursor))
        if cursor not in by_id:raise ValueError('Missing target replacement ancestor: '+str(cursor))
        current=by_id[cursor];family.append(cursor);parent=current.get('replacesSkillId')
        if current['raw'].get('m_DeleteSkillIDByUpgrade')!=parent:
            raise ValueError('Replacement chain differs from target raw declaration: '+str(cursor))
        if parent is None:break
        cursor=parent
    return {'name': re.sub(r'#C[0-9a-fA-F]{6}|#CX', '', row['raw']['m_wstrName']).strip(),
            'sourceSkillId': row['skillId'], 'replacementChain': family}



def build(source, output, profile_path, portrait_output, *, profession_id='lk', unit_class=100, portrait_atlas='DLG_UI_Common_Texture16_NEW', portrait_prefix='L_KNIGHT', portrait_atlases=None, portrait_pieces=None):
    source, output, portrait_output = [Path(p).resolve() for p in (source,output,portrait_output)]
    if output.is_relative_to(source) or portrait_output.is_relative_to(source):
        raise ValueError('Output cannot modify source inputs')
    cat=Catalog(source);profile=json.loads(profile_path.read_text('utf8'))
    output.mkdir(parents=True,exist_ok=True);(output/'icons').mkdir(exist_ok=True)
    portraits={};portrait_output.mkdir(parents=True,exist_ok=True)
    atlas=cat.path(portrait_atlas+'.tga');tet=cat.path(portrait_atlas+'.TET')
    rects=read_tet(tet.read_bytes())
    with Image.open(atlas) as original: pixels=original.convert('RGBA')
    for kind in ('PARTY','ICON','STATE'):
        kind_atlas=(portrait_atlases or {}).get(kind,portrait_atlas)
        kind_image,kind_rects,kind_source,kind_tet=pixels,rects,atlas,tet
        if kind_atlas!=portrait_atlas:
            kind_source=cat.path(kind_atlas+'.tga');kind_tet=cat.path(kind_atlas+'.TET')
            kind_rects=read_tet(kind_tet.read_bytes())
            with Image.open(kind_source) as original:kind_image=original.convert('RGBA')
        piece=(portrait_pieces or {}).get(kind,portrait_prefix+'_'+kind);crop,bounds=crop_piece(kind_image,kind_rects[piece]);filename='portrait-'+kind.lower()+'.png'
        crop.save(portrait_output/filename)
        portraits[kind.lower()]={'file':'ui/'+filename,'width':crop.width,'height':crop.height,
            'piece':piece,'bounds':bounds,'atlasSource':cat.evidence(kind_source),'tetSource':cat.evidence(kind_tet),
            'rgbaSha256':digest(crop.tobytes()),'sha256':digest((portrait_output/filename).read_bytes())}
    atlases={};skills=[];overlay={};by_id={r['skillId']:r for r in profile['skillCatalog']}
    for row in profile['skillCatalog']:
        sid,t=row['skillId'],row['raw'];name,piece=t['m_wstrIconTextureName'],t['m_wstrIconTexturePieceName']
        if name not in atlases:
            ap,tp=cat.path(name),cat.path(Path(name).with_suffix('.tet').name)
            with Image.open(ap) as image:rgba=image.convert('RGBA')
            atlases[name]=(rgba,read_tet(tp.read_bytes()),cat.evidence(ap),cat.evidence(tp))
        pixels,rects,atlas_source,tet_source=atlases[name]
        keys=[k for k in rects if k.casefold()==piece.casefold()]
        if len(keys)!=1:raise ValueError('Missing or ambiguous target skill icon piece: '+piece)
        crop,bounds=crop_piece(pixels,rects[keys[0]]);filename='icons/'+str(sid)+'.png';crop.save(output/filename)
        choice=display_name(row,by_id)
        overlay[str(sid)]={'skillId':sid,**choice,'displayOnly':True}
        skills.append({'id':sid,'name':choice['name'],'originalName':t['m_wstrName'],'type':row['type'],'classId':unit_class,
            'treeNode':row['treeNode'],'maxLevel':row['maxLevel'],'maxLevelEvidence':row['maxLevelEvidence'],
            'maxUpgradeId':sid if row['topTier'] else next(c['skillId'] for c in profile['skillCatalog'] if c.get('replacesSkillId')==sid),
            'replacedAtMax':not row['topTier'],'template':t,'icon':profession_id+'/'+filename,
            'branches':row['branches'],'branchEvidence':row['branchStatus'],
            'iconEvidence':{'atlas':atlas_source,'tet':tet_source,'piece':piece,'bounds':bounds,'rgbaSha256':digest(crop.tobytes())}})
    result={'schemaVersion':1,'classId':unit_class,'evidence':'static-target2016-declarations','nativeClientMeasured':False,
        'source':profile['sources']['skill'],'skills':skills,'limits':['Names come from the original target skill declarations.',
            'Original target English descriptions and numerical definitions retained; native trait consumers unavailable.']}
    write_json(output/'catalog.json',result)
    write_json(portrait_output/'manifest.json',{'schemaVersion':1,'professionId':profession_id,'pieces':portraits,'clientMeasured':False})
    write_json(ROOT/('contracts/'+profession_id+'-skill-ui-source.json'),{'schemaVersion':1,'classId':unit_class,
        'sourceEvidence':list(cat.used.values()),'skillNameSource':profile['sources']['skill'],
        'skills':overlay,'portraits':portraits})
    print(json.dumps({'skills':len(skills),'portraits':len(portraits),'sources':len(cat.used)}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'artifacts/ui/skills/lk');p.add_argument('--portraits',type=Path,default=ROOT/'artifacts/lk/ui')
    p.add_argument('--profile',type=Path,default=ROOT/'packages/combat-core/lk-profile.json')
    a=p.parse_args();build(a.source,a.output,a.profile,a.portraits)
