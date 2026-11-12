"""Freeze RS source fields and independent stat arithmetic, never JS outputs.

Read-only target declarations and fixed V5 hashes are checked first. The item
oracle executes the two narrow original Lua bytecode prototypes; enhancement,
PvP and passive channel expectations below independently follow the recorded
server statements. 21405 remains an explicit target-description adapter.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct

from extract_equipment_2016 import extract
from equipment_formula_evidence import source_cases
from kl82_static import read_declarations

ROOT=Path(__file__).resolve().parents[2]
IDS=[21405,21406,21407,21408,21409]
F=lambda value:struct.unpack('<f',struct.pack('<f',value))[0]
SHA=lambda data:hashlib.sha256(data).hexdigest()


def audit(raw_root,reference_dir,sword_source):
    equipment=extract(raw_root)
    frozen=json.loads((ROOT/'contracts/equipment-2016-source-v1.json').read_text('utf-8'))
    if equipment!=frozen: raise ValueError('Target equipment contract drift')
    refs=json.loads((ROOT/'contracts/equipment-2016-reference-v1.json').read_text('utf-8'))
    files={Path(row['path']).name:row for row in refs['files']}
    records=[]
    for name,start,end in [('GSUserFunction.cpp',12447,12470),('GSUserFunction.cpp',12533,12545),('XSLSkillTree.cpp',1065,1070),('StatTable.lua',1,1)]:
        data=(reference_dir/name).read_bytes()
        if SHA(data)!=files[name]['sha256']: raise ValueError('Fixed reference hash drift: '+name)
        rows=data.splitlines(keepends=True)
        records.append(dict(file=name,sha256=SHA(data),gitBlob=files[name]['gitBlob'],startLine=start,endLine=end,
                            fragmentSha256=SHA(b''.join(rows[start-1:end]))))
    sword=sword_source.read_bytes()
    if SHA(sword)!='ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d': raise ValueError('SwordMan source hash drift')
    for start,end in [(2694,2739),(2884,2915)]:
        records.append(dict(file='X2GUElsword_SwordMan.cpp',sha256=SHA(sword),startLine=start,endLine=end,
                            fragmentSha256=SHA(b''.join(sword.splitlines(keepends=True)[start-1:end]))))
    enum=read_declarations(raw_root/'Enum.lua')['globals']
    skill=read_declarations(raw_root/'NewSkillTempletVer2.lua',enum,capture_calls=True,capture_unresolved=True)
    templates={c['args'][-1]['m_eID']:c['args'][-1] for c in skill['nativeCalls'] if c['target'].endswith('AddSkillTemplet_LUA')}
    nodes={c['args'][-1]['m_iSkillID']:c['args'][-1] for c in skill['nativeCalls']
        if c['target'].endswith('AddSkillTreeTemplet_LUA') and c['args'][-1].get('m_eUnitClass')==101}
    passives={str(sid):dict(level=nodes[sid]['m_iMasterLevel'],treeNode=nodes[sid],raw=templates[sid]) for sid in IDS}
    if [passives[str(sid)]['level'] for sid in IDS]!=[4,3,3,3,3]:raise ValueError('RS passive level drift')
    B=equipment['character']['UT_ELSWORD'];A=equipment['career']['UC_ELSWORD_RUNE_SLAYER']
    anchor={key:math.floor(A[key]*(1 if key=='hpMax' else .8)+.5) for key in B}
    naked={key:math.floor(B[key]*(1+.15*84 if key=='hpMax' else .8+.0225*84)+.5) for key in B}
    source_items={row['itemId']:row['expected'] for row in source_cases(equipment)['cases'] if row['profession']=='RS'}
    items=[dict(itemId=sid,enhancement=9,base=source_items[sid],enhanced={key:int(F(value*F(1.75))) for key,value in source_items[sid].items()})
        for sid in [30388,153795,153796,153797,153798]]
    sums={key:sum(row['enhanced'][key] for row in items) for key in B}
    base={key:anchor[key]+int(F(F(naked[key]-anchor[key])*F(.1)))+int(F(sums[key]*F(.1))) for key in B}
    base['hpMax']=int(F(anchor['hpMax']*F(2.7)))+int(F(F(naked['hpMax']+sums['hpMax']-anchor['hpMax'])*F(.6)))
    # The independent target item oracle and explicit arithmetic above may
    # establish a formula candidate; these are not original-client recordings.
    rows=re.findall(r'StatTable:SetUnitStat\(\s*101,\s*(\d+),\s*\{([^}]+)\}',(reference_dir/'StatTable.lua').read_text('utf-8',errors='replace'))
    fields={'AtkPhysic':'physicalAttack','AtkMagic':'magicAttack','DefPhysic':'physicalDefence','DefMagic':'magicDefence','HP':'hpMax'}
    differences=[]
    for level,body in rows:
        level=int(level);values=dict(re.findall(r'(\w+)\s*=\s*([\d.]+)',body))
        for key,field in fields.items():
            expected=(A[field] if field=='hpMax' else math.floor(A[field]*.8+.5)) if level==1 else (B[field]*(1+.15*(level-1)) if field=='hpMax' else math.floor(B[field]*(.8+.0225*(level-1))+.5))
            if abs(float(values[key])-expected)>1e-7:differences.append(dict(level=level,field=field,reference=float(values[key]),inferred=expected))
    if len(rows)!=80:raise ValueError('Expected exactly RS levels1..80')
    contract=dict(schemaVersion=1,version='rs-attributes-source-v1',originalClientRuntimeMeasurements=0,
        sources={name:dict(path='data/data036.kom/'+name,sha256=SHA((raw_root/name).read_bytes()))
            for name in ['CharacterStatTable.lua','Enum.lua','NewSkillTempletVer2.lua','item.kim']},
        career=dict(unitType=1,unitClass=101,key='UC_ELSWORD_RUNE_SLAYER',raw=A),passives=passives,
        references=dict(evidenceClass='fixed-V5-reference-not-target2016',commit=refs['commit'],files=records),
        growthCrossCheck=dict(career=101,levels=[1,80],statValuesChecked=400,matches=400-len(differences),differences=differences,level85Present=False),
        qualifications=['Level85 naked stats use the same user-accepted target growth inference as LK.',
            '21405 target description specifies physical attack15% added as magic; fixedV5 lacks that passive. Independent final-stat channels and integer truncation are an explicitly qualified adapter, not verified target order.',
            '21409 numeric magic defence ratio1.1 conflicts with target level3 description12%; runtime uses raw1.1.',
            '21407 useCondition1 coexists with passive type8 and automatic proc descriptor; no manual zero-cost skill is invented.',
            'RS V5 levels2..80 contain truncation differences from the current LK rounding inference. These differences are retained, not silently substituted for the user-requested LK formula policy.',
            'Equipment presets and option percentages match LK. This does not copy LK class coefficients or LK passives.'])
    evidence=dict(schemaVersion=1,evidenceClass='target-bytecode-items + independently-transcribed-fixed-V5-arithmetic',
        originalClientRuntimeMeasurements=0,sourceContract='contracts/rs-attributes-source-v1.json',
        items=items,character=dict(levelOne=anchor,naked=naked),equipment=sums,basePvp=base,
        passiveFormula='magic + trunc(float32(magic * float32(float32(1.06)-1))) + trunc(float32(physical * float32(float32(1.15)-1))); magicDefence=trunc(float32(magicDefence*float32(1.1)))',
        isolatedPassiveCase=dict(input=dict(physicalAttack=1769,magicAttack=1561,magicDefence=293),
            expected=dict(physicalAttack=1769,magicAttack=1919,magicDefence=322)),
        sourceCases=[row for row in source_cases(equipment)['cases'] if row['profession']=='RS'])
    return contract,evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-root',type=Path,required=True)
    parser.add_argument('--reference-dir',type=Path,required=True)
    parser.add_argument('--sword-source',type=Path,required=True)
    args=parser.parse_args()
    contract,evidence=audit(args.raw_root,args.reference_dir,args.sword_source)
    for path,value in [('contracts/rs-attributes-source-v1.json',contract),('reports/rs-equipment-evidence-v1.json',evidence)]:
        (ROOT/path).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(json.dumps(dict(base=evidence['basePvp'],passives=IDS,growthValuesChecked=400)))
