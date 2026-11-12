"""Build a separate WildShock correction layer from already measured DLL keys."""
import hashlib
import json
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog,build_effect,write_json

NAMES=('SI_SA_EL_WILD_SHOCK_ATTACK','SI_SA_EL_WILD_SHOCK_ATTACK_Sub')
SOURCE='SI_SA_EL_WILD_SHOCK_ATTACKBOX.X'
def read(path):return json.loads(path.read_text('utf8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def build():
    base=ROOT/'artifacts';patch=ROOT/'.cache/elesis-wildshock-v2/runtime';mesh=patch/'gm/fx/meshes'
    mesh.mkdir(parents=True,exist_ok=True)
    catalog=Catalog(Path('asset_work'))
    result=build_effect(catalog,mesh,SOURCE)
    if result['missingExplicitTickRate'] or result['unsupportedPoseTracks']:
        raise ValueError('Measured WildShock conversion remains incomplete')
    clips=result['animations']
    if len(clips)!=1 or clips[0]['name']!='Normal' or clips[0]['ticksPerSecond']!=4800 or clips[0]['nativePlaybackField']!=0:
        raise ValueError('Original WildShock DLL identities changed')
    changes={'animationMissingTickRate':False,'animationRequiresUnconfirmedRate':False,'animationClips':clips}
    profiles={};files=[]
    for job in ('gm','bh','ca'):
        profile_path=ROOT/f'packages/combat-core/{job}-profile.json';profile=read(profile_path)
        old=read(base/job/'manifest.json')['profile']['sha256']
        for name in NAMES:
            profile['effectTemplates'][name].update(changes,missingExplicitTickRate=False)
        write_json(profile_path,profile)
        new=sha(profile_path);profiles[job]={'before':old,'after':new}
        for filename in ('fx/index.json','effect-assets.json','manifest.json','audio/manifest.json'):
            value=read(base/job/filename)
            templates=value.get('templates') or value.get('effectTemplates',{}).get('templates')
            if templates:
                for name in NAMES:templates[name].update(changes)
            value=json.loads(json.dumps(value,ensure_ascii=False).replace(old,new))
            write_json(patch/job/filename,value);files.append(job+'/'+filename)
            if filename=='fx/index.json':write_json(ROOT/f'contracts/{job}-fx-index.json',value)
    common=read(base/'common-buffs/catalog.json')
    for value in profiles.values():common=json.loads(json.dumps(common,ensure_ascii=False).replace(value['before'],value['after']))
    write_json(patch/'common-buffs/catalog.json',common);files.append('common-buffs/catalog.json')
    write_json(ROOT/'contracts/common-buff-catalog.json',common)
    for suffix in ('.glb','.pose.json'):files.append('gm/fx/meshes/SI_SA_EL_WILD_SHOCK_ATTACKBOX'+suffix)
    outputs=[{'file':name,'bytes':(patch/name).stat().st_size,'sha256':sha(patch/name),'priorSha256':sha(base/name)} for name in sorted(files)]
    report={'schemaVersion':1,'id':'elesis-wildshock-clock-correction-v2','clientMeasured':False,
        'patchRoot':str(patch),'baseRoot':str(base),'originalHandoff':'reports/elesis-resource-handoff-v1.json',
        'source':catalog.evidence(catalog.path(SOURCE)),
        'evidence':{'manifest':'reports/elesis-fx-d3dx-keyframes-v1.json',
            'request':'reports/elesis-fx-d3dx-sources-v1.json','requestSha256':sha(ROOT/'reports/elesis-fx-d3dx-sources-v1.json'),
            'kind':'original shipped DLL GetKeys already executed; no second DLL/client execution'},
        'before':{'animationMissingTickRate':True,'unsupportedPoseTracks':'missing tick rate for time-varying source'},
        'after':{'animations':clips,'animationMissingTickRate':False,'unsupportedPoseTracks':[]},
        'profiles':profiles,'files':outputs,'summary':{'files':len(outputs),'bytes':sum(r['bytes'] for r in outputs)},
        'reason':'The final DLL measurement included this newly reachable attack-box after its initial conversion. Refresh its original keys and metadata before layering onto the frozen handoff.',
        'limits':['Original full-client timing/interaction remains unmeasured; this patch consumes only existing source-matched original-DLL keys.']}
    write_json(ROOT/'reports/elesis-wildshock-clock-v2.json',report)
    print(json.dumps(report['summary']))

if __name__=='__main__':build()
