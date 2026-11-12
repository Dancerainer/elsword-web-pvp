"""Convert the exact missing 2016 Moonlight buff display, into task output."""
from pathlib import Path
import json,sys,hashlib,copy,shutil
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character')]
from build_lk_fx import build
from build_rf import write_json,Catalog
from build_rf_fx import read_definitions,select_templates

own=ROOT/'runtime/presentation-v45/de-moonlight';own.mkdir(parents=True,exist_ok=True)
source=json.loads((ROOT/'.cache/elesis-v45/declarations/effect-declarations.json').read_text('utf8'))
name='EffectSet_Moonlight_Rhapsody_Buff_Display'
names=[name]+['EffectSet_MOONLIGHT_RHAPSODY_Debuff_Explosion_Accumulation_'+str(i) for i in range(1,4)]
sets={r['args'][1]['NAME']:{'raw':r['args'][1]} for r in source['nativeCalls'] if r['target']=='g_pEffectSet.AddEffectSetTemplet_LUA' and len(r.get('args',[]))>1 and r['args'][1].get('NAME') in names}
if set(sets)!=set(names):raise ValueError('Missing exact original Moonlight EffectSet')
damages=json.loads((ROOT/'.cache/elesis-v45/declarations/damage-declarations.json').read_text('utf8'))
damage_names={value['NAME'] for row in sets.values() for value in row['raw'].values() if isinstance(value,dict) and value.get('EFFECT_TYPE')==1}
profile={'professionId':'de-moonlight-v45','effectSets':sets,'damageEffects':{n:{'raw':damages['globals'][n]} for n in damage_names},'states':{},'skillCatalog':[]}
# The attack owner seals the canonical closure independently. The converter
# consumes only those exact raw declarations; it must reject a stale decode.
attack=json.loads((ROOT/'contracts/add-moonlight-explosions-v45.json').read_text('utf8'))
for group in ('effectSets','damageEffects'):
    for key,row in attack[group].items():
        if profile[group].get(key,{}).get('raw')!=row['raw']:raise ValueError('Canonical Moonlight attack closure mismatch: '+key)
frozen=own/'source-profile.json';write_json(frozen,profile)
catalog=Catalog(Path('asset_work'))
selected,missing=select_templates(read_definitions(catalog,('GameMinorParticle.txt',)),profile)
if missing:raise ValueError('Missing Moonlight source templates: '+str(missing))
old=json.loads((ROOT/'contracts/de-fx-index.json').read_text('utf8'))['templates'];reuse_geometry={}
for name,row in selected.items():
    if name in old:continue
    mesh=row['fields'].get('MeshName') or row['fields'].get('Mesh')
    compatible=next((r for r in old.values() if mesh and mesh.casefold()==(r['fields'].get('MeshName') or r['fields'].get('Mesh') or '').casefold() and r.get('poseData')),None)
    if compatible:
        old[name]={**row,**{key:copy.deepcopy(compatible[key]) for key in ('glb','poseData','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate','textures') if key in compatible}}
        reuse_geometry[name]={'index':'contracts/de-fx-index.json','template':compatible['name'],'originalMesh':catalog.evidence(catalog.path(mesh)),
            'rule':'Identical original MeshName bytes; newly parsed declaration retains its own lifetime,scale and geometry parameters.'}
reuse=own/'reuse-index.json';write_json(reuse,{'templates':old})
for name,row in selected.items():
    previous=old.get(name)
    if not previous or previous['declarationSha256']!=row['declarationSha256']:continue
    files=[previous.get(key) for key in ('glb','poseData')]+[value['file'] for value in previous.get('textures',{}).values()]
    for file in filter(None,files):
        source_path=(ROOT/'artifacts/de'/file).resolve();target_path=(own/'assets/de'/file).resolve()
        if not target_path.is_relative_to((own/'assets').resolve()):raise ValueError('Reuse path escaped task output')
        target_path.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source_path,target_path)
out=own/'assets/de/feedback-v45';index=build(out,frozen,index_output=None,additional_particle_scripts=('GameMinorParticle.txt',),shared_indexes=[(reuse,'')])
if index['missingTemplates'] or index['meshFailures']:raise ValueError('Unclosed original Moonlight display')
for template in index['templates'].values():
    if template.get('sharedResourceEvidence'):
        if template['name'] in reuse_geometry:
            template.pop('sharedResourceEvidence');template['convertedArtifactReuse']=reuse_geometry[template['name']]
        else:template['sharedResourceEvidence']['index']='contracts/de-fx-index.json'
        continue
    for key in ('glb','poseData'):
        if template.get(key):template[key]=template[key].replace('fx/','feedback-v45/',1)
    for texture in template.get('textures',{}).values():texture['file']=texture['file'].replace('fx/','feedback-v45/',1)
write_json(out/'index.json',index);write_json(ROOT/'contracts/de-moonlight-visual-v45.json',index)
inventory=[{'file':p.relative_to(own/'assets').as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.rglob('*')) if p.is_file()]
write_json(own/'receipt.json',{'schemaVersion':1,'evidenceClass':'target2016-static-declaration-and-converted-source','originalClientMeasured':False,
    'setSource':source['source'],'damageSource':damages['source'],'sets':names,'outputs':inventory})
print(json.dumps({'templates':list(index['templates']),'files':inventory}))
