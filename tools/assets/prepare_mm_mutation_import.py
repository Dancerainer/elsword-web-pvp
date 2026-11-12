"""Prepare only the four source-sealed MM mutation files and one index registration."""
import argparse
import hashlib
import json
import posixpath
from pathlib import Path
from apply_prepared_asset_import import receipt,preflight
from audit_twelve_profession_runtime import glb_external_uris

EXPECTED={
    'mm/mutation-fx/index.json',
    'mm/mutation-fx/meshes/DummyAttackBox_50x50x50.glb',
    'mm/mutation-fx/meshes/DummyAttackBox_50x50x50.pose.json',
    'mm/mutation-fx/textures/AN_Formation_TRACE-c0660e9b4a.png',
}
def read(path):return json.loads(path.read_text('utf8'))
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def prepare(source_repo,target_repo,output):
    source_repo,target_repo,output=source_repo.resolve(),target_repo.resolve(),output.resolve()
    target=target_repo/'artifacts';source=source_repo/'artifacts'
    if output.is_relative_to(target)or output.is_relative_to(source):raise ValueError('Independent staging output required')
    proof_path=source_repo/'reports/mm-mutation-assets-handoff-v1.json';proof=read(proof_path)
    if len(proof['files'])!=4 or {row['file']for row in proof['files']}!=EXPECTED:raise ValueError('Unexpected source handoff inventory')
    operations=[]
    for row in proof['files']:
        path=source/row['file'];expected={key:row[key]for key in ('bytes','sha256')}
        if receipt(path)!=expected:raise ValueError('Source does not match handoff: '+row['file'])
        destination=target/row['file']
        if destination.exists()and receipt(destination)!=expected:raise ValueError('Existing mutation destination differs: '+row['file'])
        operations.append({'file':row['file'],'source':str(path),**expected,'prior':receipt(destination)if destination.exists()else None})
    index=read(source/'mm/mutation-fx/index.json');source_profile=source_repo/'packages/combat-core/mm-profile.json'
    profile=read(source_profile);source_seal=hashlib.sha256(source_profile.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
    if proof['profileSha256']!=index['profileSha256']:raise ValueError('Index profile binding differs from sealed handoff')
    for name,row in index['templates'].items():
        if row['declarationSha256']!=profile['effectTemplates'][name]['declarationSha256']:raise ValueError('Source template identity differs')
        refs=[row[key]for key in ('glb','poseData')if row.get(key)]+[v['file']for v in row.get('textures',{}).values()]
        for ref in refs:
            if ref.startswith('/')or'\\'in ref or':'in ref or'..'in ref.split('/')or'mm/'+ref not in EXPECTED:raise ValueError('Reference outside sealed mutation files: '+ref)
        if row.get('glb'):
            for ref in glb_external_uris(source/'mm'/row['glb']):
                resolved=posixpath.normpath('mm/'+posixpath.dirname(row['glb'])+'/'+ref)
                if resolved not in EXPECTED:raise ValueError('GLB reference outside sealed files: '+resolved)
    manifest_path=target/'mm/manifest.json';manifest=read(manifest_path)
    original_indexes=list(manifest.get('visualEffectIndexes',['fx/index.json']))
    if 'mutation-fx/index.json'not in original_indexes:manifest['visualEffectIndexes']=[*original_indexes,'mutation-fx/index.json']
    baseline_path=target/'mm/fx/index.json';baseline=read(baseline_path)
    if len(baseline['templates'])!=507 or set(baseline['templates'])&set(index['templates']):raise ValueError('Frozen 507-template union changed or extension overlaps')
    staged=output/'metadata/mm/manifest.json';write(staged,manifest)
    operations.append({'file':'mm/manifest.json','source':str(staged),'prior':receipt(manifest_path),**receipt(staged)})
    inputs=[{'path':str(path),**receipt(path)}for path in (proof_path,source_profile,baseline_path)]
    plan={'schemaVersion':1,'targetRoot':str(target),'files':operations,'inputs':inputs,
        'scope':'Four verified new mutation assets and MM visualEffectIndexes only; existing 507-template fx index and all profile seals preserved.',
        'sourceHandoffSha256':receipt(proof_path)['sha256'],'sourceProfileSha256':source_seal,'assetBuildProfileSha256':proof['profileSha256'],
        'profileSealStatus':'matched'if source_seal==proof['profileSha256']else'pending-final-profile-seal; current original template declaration matches',
        'originalVisualEffectIndexes':original_indexes,'newTemplates':list(index['templates'])}
    preflight(plan);write(output/'receipt.json',plan)
    (output/'apply.py').write_bytes(Path(__file__).with_name('apply_prepared_asset_import.py').read_bytes())
    return plan
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-repo',type=Path,required=True);p.add_argument('--target-repo',type=Path,required=True);p.add_argument('--output-root',type=Path,required=True);args=p.parse_args()
    plan=prepare(args.source_repo,args.target_repo,args.output_root)
    print(json.dumps({'files':len(plan['files']),'receiptSha256':receipt(args.output_root/'receipt.json')['sha256'],'scope':plan['scope']}))
