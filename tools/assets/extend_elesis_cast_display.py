"""Extend the existing display inventory with target Elesis state declarations."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from build_cast_display import functions

ROOT=Path(__file__).resolve().parents[2]
EXPECTED='f4f5a74f45688259f052c5b26fa667d9f781a59b3c771fc2f7ec7f24575714dc'
def digest(data):return hashlib.sha256(data).hexdigest()
def write(file,value):file.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')

def build(reference,assets):
    raw=reference.read_bytes()
    if digest(raw)!=EXPECTED:raise ValueError('Fixed X2GUEL reference changed')
    text=raw.decode('latin1');bodies=functions(text)
    if 'CommonHyperModeFrameMove( 0.05f, 0.83f )' not in bodies['HyperModeFrameMove']:
        raise ValueError('Original awakening callback times changed')
    routes={}
    for match in re.finditer(r'MakeTableReference\(\s*"([^"]+)"\s*,\s*(\w+)\.stateID\s*\)',text):
        segment=text[match.end():].split('MakeTableReference(',1)[0]
        callback=re.search(re.escape(match[2])+r'\.OnFrameMove\s*=\s*SET_CB_FUNC\(\s*\w+\s*,\s*(\w+)',segment)
        if callback:routes[match[1]]=callback[1]
    contract=ROOT/'contracts/cast-display-index-v1.json'
    index=json.loads(contract.read_text('utf8'))
    for id in ['GM','BH','CA']:
        file=ROOT/f'packages/combat-core/{id.lower()}-profile.json'
        profile=json.loads(file.read_text('utf8'));rows={}
        for name,state in profile['states'].items():
            original=state.get('sourceState',name);data=state['raw']
            callback=routes.get(original,original+'_FrameMove');body=bodies.get(callback,'')
            awake=original=='ESI_HYPER_MODE' or name=='RSI_HYPER_MODE'
            times=[data['SHOW_SKILL_CUT_IN_TIME']] if isinstance(data.get('SHOW_SKILL_CUT_IN_TIME'),(int,float)) and data['SHOW_SKILL_CUT_IN_TIME']>=0 else []
            dark=data.get('CHANGE_WORLD_COLOR') in (True,1) or 'ChangeWorldColorByHyperMode();' in body or awake
            stops={k:v for k,v in data.items() if k.startswith('STOP_OTHER_UNIT')}
            if not (times or dark or stops):continue
            rows[name]=dict(lightTimes=times,bone='Dummy1_Rhand',dark=dark,awakening=awake,
                lightEvidence='target2016-state-field' if times else 'no-enabled-hand-light',callback=callback if body else None,
                source=state.get('source'),stops=stops)
        index['professions'][id]=dict(profileSha256=digest(file.read_bytes()),states=rows)
    index['references']['X2GUEL.cpp']={'sha256':EXPECTED,'gitBlob':'087da6d5c5c35f2ba3ee82d436e4a464118eee0f',
        'evidenceClass':'fixed-V5-reference-containing-qualified-2026-reconstructions'}
    write(contract,index);write(assets/'cast-display/fx/index.json',index)
    manifest_file=assets/'cast-display/manifest.json';manifest=json.loads(manifest_file.read_text('utf8'))
    for row in manifest['outputs']:
        if row['file']=='fx/index.json':
            value=(assets/'cast-display/fx/index.json').read_bytes();row.update(bytes=len(value),sha256=digest(value))
    write(manifest_file,manifest)
    proof=dict(schemaVersion=1,evidenceClass='target2016-fields-and-qualified-fixed-reference',originalClientRuntimeMeasurements=0,
        reference=index['references']['X2GUEL.cpp'],awakening={'aura':['HyperBoostRight','HyperBoostLeft'],'shockTime':.83,
        'consumer':'HyperModeFrameMove/CommonHyperModeFrameMove and HyperModeBuffEffectStart'},
        professionStates={id:index['professions'][id] for id in ['GM','BH','CA']},
        limitations=['Hand light stays disabled by the existing user display policy.',
            'Original target executable playback unavailable; reference file contains later reconstruction blocks.'])
    write(ROOT/'contracts/elesis-presentation-source-v1.json',proof)
    print(json.dumps({id:len(index['professions'][id]['states']) for id in ['GM','BH','CA']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference',type=Path,required=True)
    parser.add_argument('--assets',type=Path,default=ROOT/'artifacts')
    args=parser.parse_args();build(args.reference,args.assets)
