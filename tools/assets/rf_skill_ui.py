"""Extract RF's actual 2016 skill tree ownership, upgrade chain and original icon pixels."""
import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from PIL import Image
from ui import read_tet, crop_piece

def build(source, output, combat_tools):
    sys.path.insert(0,str(combat_tools));from kl82_static import read_declarations
    raw=source/'raw/data/data036.kom';enum=read_declarations(raw/'Enum.lua')['globals']
    declarations=read_declarations(raw/'NewSkillTempletVer2.lua',enum,True)
    definitions={};nodes={}
    for c in declarations['nativeCalls']:
        for value in c.get('args',[]):
            if not isinstance(value,dict):continue
            if 'm_eID' in value:definitions[value['m_eID']]=value
            if value.get('m_eUnitClass')==107 and 'm_iSkillID' in value:nodes[value['m_iSkillID']]=value
    ids=set(nodes)
    upgrades={v['m_DeleteSkillIDByUpgrade']:i for i,v in definitions.items() if i in ids and 'm_DeleteSkillIDByUpgrade' in v}
    def top(i):
        seen=set()
        while i in upgrades:
            if i in seen:raise ValueError('Cyclic upgrade chain')
            seen.add(i);i=upgrades[i]
        return i
    con=sqlite3.connect((source/'catalog.sqlite').resolve().as_uri()+'?mode=ro',uri=True);con.row_factory=sqlite3.Row
    def find(name):
        rows=con.execute('select * from assets where lower(name)=lower(?)',(name,)).fetchall()
        if not rows or len({r['sha256'] for r in rows})!=1:raise ValueError('Missing or ambiguous UI resource: '+name)
        row=dict(rows[0]);p=source/row['raw_path']
        if hashlib.sha256(p.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Source hash mismatch: '+name)
        return row,p
    output.mkdir(parents=True,exist_ok=True);(output/'icons').mkdir(exist_ok=True)
    skills=[];atlases={}
    for i,node in nodes.items():
        d=definitions[i];name=d['m_wstrIconTextureName'];piece=d['m_wstrIconTexturePieceName']
        if name not in atlases:
            ir,ip=find(name);tr,tp=find(Path(name).with_suffix('.tet').name)
            with Image.open(ip) as image:rgba=image.convert('RGBA')
            atlases[name]=(rgba,read_tet(tp.read_bytes()),ir,tr)
        image,rects,ir,tr=atlases[name]
        candidates=[key for key in rects if key.casefold()==piece.casefold()]
        if len(candidates)!=1:raise ValueError('Missing or ambiguous piece: '+piece)
        crop,box=crop_piece(image,rects[candidates[0]]);filename=f'icons/{i}.png';crop.save(output/filename)
        skills.append({'id':i,'name':d['m_wstrName'],'type':d['m_eType'],'classId':107,'treeNode':node,
            'maxLevel':node['m_iMasterLevel'],'maxLevelEvidence':'2016 RF tree node m_iMasterLevel',
            'maxUpgradeId':top(i),'replacedAtMax':i!=top(i),'template':d,'icon':filename,
            'iconEvidence':{'atlas':ir,'tet':tr,'piece':piece,'bounds':box,'rgbaSha256':hashlib.sha256(crop.tobytes()).hexdigest()},
            'branches':[],'branchEvidence':'no confirmed 2016 trait dataset yet; do not invent traits'})
    p=raw/'NewSkillTempletVer2.lua';catalog={'schemaVersion':1,'classId':107,'source':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),
        'evidence':'static-2016-declarations','nativeClientMeasured':False,'skills':skills,
        'limits':['Master level 1 is this version node cap, not an assumed modern level20','Enhanced replacements are distinct target IDs, not skill trait choices','Skill trait branching remains unresolved; UI must not claim simulated modifiers are original']}
    (output/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'classId':107,'skills':len(skills),'maxUpgradeCandidates':sum(not x['replacedAtMax'] for x in skills)}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,default=Path('asset_work'));p.add_argument('--output',type=Path,default=Path('artifacts/ui/skills'));p.add_argument('--combat-tools',type=Path,default=Path(__file__).resolve().parents[1]/'combat');a=p.parse_args();build(a.source,a.output,a.combat_tools)
