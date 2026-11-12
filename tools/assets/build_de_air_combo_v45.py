"""Convert the exact recovered DE command producer's original visual closure.
Only private task output is written. No source action/timing is invented here.
"""
from pathlib import Path
import json,sys,hashlib,copy,shutil
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character')]
from build_lk_fx import build
from build_rf import write_json,Catalog
from build_rf_fx import read_definitions,select_templates

own=ROOT/'runtime/presentation-v45/de-air-combo';own.mkdir(parents=True,exist_ok=True)
attack=json.loads((ROOT/'contracts/add-de-command-closure-v45.json').read_text('utf8'))
for row in attack['sources'].values():
    if hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()!=row['sha256']:raise ValueError('DE command original source hash changed')
decoded=json.loads((ROOT/'.cache/elesis-v45/declarations/effect-declarations.json').read_text('utf8'))
sets={r['args'][1]['NAME']:r['args'][1] for r in decoded['nativeCalls'] if r['target']=='g_pEffectSet.AddEffectSetTemplet_LUA' and len(r.get('args',[]))>1 and isinstance(r['args'][1],dict) and 'NAME' in r['args'][1]}
damage=json.loads((ROOT/'.cache/elesis-v45/declarations/damage-declarations.json').read_text('utf8'))['globals']
for group,rows in [('effectSets',sets),('damageEffects',damage)]:
    for name,row in attack[group].items():
        if rows.get(name)!=row['raw']:raise ValueError('DE command canonical original declaration mismatch: '+name)
profile={'professionId':'de-command-feedback-v45','effectSets':attack['effectSets'],'damageEffects':attack['damageEffects'],'states':{},'skillCatalog':[]}
frozen=own/'source-profile.json';write_json(frozen,profile)
catalog=Catalog(Path('asset_work'))
selected,missing=select_templates(read_definitions(catalog,('GameMinorParticle.txt',)),profile)
if missing:raise ValueError('Missing DE command source templates: '+str(missing))
old=json.loads((ROOT/'contracts/de-fx-index.json').read_text('utf8'))['templates'];reuse_geometry={}
for name,row in selected.items():
    if name in old:continue
    mesh=row['fields'].get('MeshName') or row['fields'].get('Mesh')
    compatible=next((r for r in old.values() if mesh and mesh.casefold()==(r['fields'].get('MeshName') or r['fields'].get('Mesh') or '').casefold() and r.get('poseData')),None)
    if compatible:
        old[name]={**row,**{key:copy.deepcopy(compatible[key]) for key in ('glb','poseData','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate','textures') if key in compatible}}
        reuse_geometry[name]={'index':'contracts/de-fx-index.json','template':compatible['name'],'originalMesh':catalog.evidence(catalog.path(mesh)),
            'rule':'Identical original MeshName bytes; the independently parsed command declaration retains its own fields.'}
reuse=own/'reuse-index.json';write_json(reuse,{'templates':old})
for name,row in selected.items():
    previous=old.get(name)
    if not previous or previous['declarationSha256']!=row['declarationSha256']:continue
    for file in filter(None,[previous.get(key) for key in ('glb','poseData')]+[value['file'] for value in previous.get('textures',{}).values()]):
        source=(ROOT/'artifacts/de'/file).resolve();target=(own/'assets/de'/file).resolve()
        if not target.is_relative_to((own/'assets').resolve()):raise ValueError('DE command reuse escaped private output')
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
out=own/'assets/de/feedback-command-v45';index=build(out,frozen,index_output=None,additional_particle_scripts=('GameMinorParticle.txt',),shared_indexes=[(reuse,'')])
if index['missingTemplates'] or index['meshFailures']:raise ValueError('DE command original visual closure failed')
for template in index['templates'].values():
    if template.get('sharedResourceEvidence'):
        if template['name'] in reuse_geometry:
            template.pop('sharedResourceEvidence');template['convertedArtifactReuse']=reuse_geometry[template['name']]
        else:template['sharedResourceEvidence']['index']='contracts/de-fx-index.json'
        continue
    for key in ('glb','poseData'):
        if template.get(key):template[key]=template[key].replace('fx/','feedback-command-v45/',1)
    for texture in template.get('textures',{}).values():texture['file']=texture['file'].replace('fx/','feedback-command-v45/',1)
write_json(out/'index.json',index);write_json(ROOT/'contracts/de-air-combo-visual-v45.json',index)
files=[{'file':p.relative_to(own/'assets').as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.rglob('*')) if p.is_file()]
write_json(own/'receipt.json',{'schemaVersion':1,'evidenceClass':'target2016 static declarations and converted source','originalClientMeasured':False,'sourceContract':'contracts/add-de-command-closure-v45.json','outputs':files})
print(json.dumps({'templates':list(index['templates']),'outputs':files}))
