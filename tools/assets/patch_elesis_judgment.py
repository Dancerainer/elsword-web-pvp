"""Layer GM's literal source Judgment damage set on the WildShock correction."""
import copy
import hashlib
import json
import shutil
import sys
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/combat')]
from build_rf import Catalog,build_effect,write_json
from build_rf_fx import read_definitions, select_templates
from build_elesis_profiles import compile_job

NAME='SA_SSK_JUDGEMENT_DRIVE_M03'
def read(path):return json.loads(path.read_text('utf8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def build():
    base=ROOT/'artifacts';previous=ROOT/'.cache/elesis-wildshock-v2/runtime';patch=ROOT/'.cache/elesis-judgment-v3/runtime'
    def prior(name):return previous/name if (previous/name).is_file() else base/name
    catalog=Catalog(Path('asset_work'));definitions=read_definitions(catalog)
    index=read(prior('gm/fx/index.json'))
    # First compile exposes the source set without inventing any render entries.
    (patch/'gm/source-proof').mkdir(parents=True,exist_ok=True)
    shutil.copyfile(base/'gm/source-proof/clips.json',patch/'gm/source-proof/clips.json')
    write_json(patch/'gm/fx/index.json',index)
    compile_job('gm',ROOT/'.cache/elesis-target',patch)
    profile=read(ROOT/'packages/combat-core/gm-profile.json')
    selected,missing=select_templates(definitions,profile)
    added={name:copy.deepcopy(record) for name,record in selected.items() if name not in index['templates']}
    if set(added)!={NAME,'SA_SSK_JUDGEMENT_DRIVE_M02','SA_ALH_PEERLESSNESS_SLASH_END_P02','SI_SA_ALH_DESCENT_DRAGON_LED_Eye'}:
        raise ValueError('Judgment source closure changed: '+repr(sorted(added)))
    output=patch/'gm/fx/meshes';output.mkdir(parents=True,exist_ok=True)
    files=[];conversions={}
    for name,record in added.items():
        record['textures']={}
        for texture in sorted({event['value'] for event in record['events'] if 'Texture' in event['property'] and isinstance(event['value'],str)}):
            path=catalog.path(texture);filename='fx/textures/'+Path(texture).stem+'-'+sha(path)[:10]+'.png'
            target=patch/'gm'/filename;target.parent.mkdir(parents=True,exist_ok=True)
            image=Image.open(path).convert('RGBA');image.save(target)
            record['textures'][texture]={'file':filename,'width':image.width,'height':image.height,'source':catalog.evidence(path)}
            files.append('gm/'+filename)
        mesh=record['fields'].get('MeshName') or record['fields'].get('Mesh')
        if mesh:
            converted=build_effect(catalog,output,mesh)
            if converted['missingExplicitTickRate'] or converted['unsupportedPoseTracks']:raise ValueError('Judgment original mesh conversion is incomplete: '+mesh)
            record.update(glb='fx/meshes/'+Path(converted['glb']).name,poseData='fx/meshes/'+Path(converted['poseData']).name,
                animationMissingTickRate=False,animationRequiresUnconfirmedRate=False,animationClips=converted['animations'])
            conversions[name]={'animations':converted['animations'],'source':catalog.evidence(catalog.path(mesh))}
            files.extend('gm/'+record[key] for key in ('glb','poseData'))
        index['templates'][name]=record
    # Minor templates already live in the frozen index; only truly absent
    # original declarations remain missing. Preserve their exact source spelling.
    index['missingTemplates']=sorted(set(index['missingTemplates']) | (set(missing)-set(index['templates'])))
    existing={row['rawPath'] for row in index['sourceFiles']}
    index['sourceFiles'].extend(row for row in catalog.used.values() if row['rawPath'] not in existing)
    write_json(patch/'gm/fx/index.json',index)
    old=read(prior('gm/manifest.json'))['profile']['sha256']
    compile_job('gm',ROOT/'.cache/elesis-target',patch)
    profile=read(ROOT/'packages/combat-core/gm-profile.json');new=sha(ROOT/'packages/combat-core/gm-profile.json')
    if 'EffectSet_SA_SSK_JUDGEMENT_DAMAGE' not in profile['effectSets'] or NAME not in profile['damageEffects']:
        raise ValueError('Judgment source damage closure missing')
    index['profileSha256']=new;write_json(patch/'gm/fx/index.json',index);write_json(ROOT/'contracts/gm-fx-index.json',index)
    write_json(patch/'gm/effect-assets.json',{'schemaVersion':1,'templates':index['templates']})
    manifest=read(prior('gm/manifest.json'));manifest['effectTemplates']={'schemaVersion':1,'templates':index['templates']}
    manifest['effectSourceEvidence']=index['sourceFiles'];manifest['profile']['sha256']=new;write_json(patch/'gm/manifest.json',manifest)
    files+=['gm/fx/index.json','gm/effect-assets.json','gm/manifest.json']
    for name in ('gm/audio/manifest.json','common-buffs/catalog.json'):
        value=json.loads(json.dumps(read(prior(name)),ensure_ascii=False).replace(old,new))
        write_json(patch/name,value);files.append(name)
        if name.startswith('common-buffs'):write_json(ROOT/'contracts/common-buff-catalog.json',value)
    files=sorted(set(files))
    report={'schemaVersion':1,'id':'elesis-judgment-damage-resource-correction-v3','clientMeasured':False,
        'patchRoot':str(patch),'precedingPatch':'reports/elesis-wildshock-clock-v2.json',
        'sourceEffectSet':'EffectSet_SA_SSK_JUDGEMENT_DAMAGE','sourceDamageEffect':NAME,
        'damageRaw':profile['damageEffects'][NAME]['raw'],'effectSetRaw':profile['effectSets']['EffectSet_SA_SSK_JUDGEMENT_DAMAGE']['raw'],
        'profile':{'before':old,'after':new},'conversions':conversions,'addedTemplates':sorted(added),
        'missingOriginalTemplates':sorted(set(missing)-set(index['templates'])),
        'files':[{'file':name,'bytes':(patch/name).stat().st_size,'sha256':sha(patch/name),
            'priorSha256':sha(prior(name)) if prior(name).is_file() else None} for name in sorted(files)],
        'reason':'Original Judgment follow-up damage has no DamageEffect_ prefix and is absent from the animation-state visual root. Register its exact literal source EffectSet and native mesh.',
        'limits':['Skill release/charge timing remains the separately labelled source-description adapter owned by the skill consumer.']}
    write_json(ROOT/'reports/elesis-judgment-resource-v3.json',report);print({'files':len(files),'templates':len(index['templates'])})

if __name__=='__main__':build()
