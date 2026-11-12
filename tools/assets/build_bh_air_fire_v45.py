"""Add exact 2016 BH air-fire declarations using identical existing mesh bytes."""
from pathlib import Path
import json,sys,copy
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character')]
from build_rf import Catalog,write_json
from build_rf_fx import read_definitions,select_templates

catalog=Catalog(Path('asset_work'))
profile=json.loads((ROOT/'contracts/elesis-attack-closure-v45.json').read_text('utf8'))['bh']
selected,missing=select_templates(read_definitions(catalog),profile)
if missing:raise ValueError('Unclosed BH original visual declarations: '+str(missing))
baseline=json.loads((ROOT/'contracts/bh-fx-index.json').read_text('utf8'))
templates={}
for name,row in selected.items():
    if name in baseline['templates']:
        if baseline['templates'][name]['declarationSha256']!=row['declarationSha256']:raise ValueError('Existing BH declaration mismatch')
        continue
    mesh=row['fields'].get('MeshName') or row['fields'].get('Mesh')
    compatible=next((r for r in baseline['templates'].values() if mesh and mesh.casefold()==(r['fields'].get('MeshName') or r['fields'].get('Mesh') or '').casefold() and r.get('poseData')),None)
    if not compatible:raise ValueError('Missing verified BH conversion: '+name)
    result=copy.deepcopy(row)
    for key in ('glb','poseData','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate','textures'):
        if key in compatible:result[key]=copy.deepcopy(compatible[key])
    result['convertedArtifactReuse']={'index':'contracts/bh-fx-index.json','template':compatible['name'],
        'originalMesh':catalog.evidence(catalog.path(mesh)),
        'rule':'Identical original MeshName bytes; declaration/lifetime/velocity remain this newly parsed template.'}
    templates[name]=result
write_json(ROOT/'contracts/bh-air-fire-visual-v45.json',{'schemaVersion':1,'referenceVersion':baseline['referenceVersion'],
 'clientMeasured':False,'templates':templates,'sourceFiles':list(catalog.used.values()),'missingTemplates':[], 'meshFailures':[]})
print(json.dumps({'templates':list(templates),'newAssetFiles':0}))
