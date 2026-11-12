"""Convert two failed cosmetic meshes without rebuilding Add resource closure.

Exact original-DLL receipts remain mandatory. The scoped decoder deliberately
chooses the smaller already-measured BM/RF receipts for these two source hashes;
it does not change the global registry or whitelist any other source.
"""
from pathlib import Path
import copy, hashlib, json, shutil, sys
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'tools/assets/character')]
import build_rf
import native_d3dx_keys as measured

def sha(value):return hashlib.sha256(value).hexdigest()
def read(path):return json.loads(path.read_bytes())
def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf8')
def bounded(path):
    if not path.resolve().is_relative_to(ROOT):raise ValueError('Output outside task workspace')
    return path

def main():
    cache=bounded(ROOT/'.cache/client-skills-ui-v32/native-input')
    jobs=[
      ('ADD_Star_Fall_Explode_002','aisha_active_energySpurt_circle.X',
       'd3cd43ed9ed0afcae6df2ea454434cbaf06885d03d0906c454f71e206036ebff',
       'reports/rf-full-skill-d3dx-keyframes.json',Path('.')),
      ('ADD_Star_Fall_Explode_001','Lire_SI_SA_Gungnir_Mesh05.X',
       'ac9c6bd85e85a6adca1f00182f46cffc6a1aa69fbb25f1a776f4f608b5b0b905',
       'reports/bm-fx-d3dx-keyframes-v1.json',Path('.'))]
    copies=[]
    for _,_,_,receipt,source_root in jobs:
        entry=read(ROOT/receipt)['artifact'];source=source_root/entry['path'];data=source.read_bytes()
        if sha(data)!=entry['sha256'] or len(data)!=entry['bytes']:raise ValueError('Measured input source hash/size mismatch')
        destination=bounded(cache/entry['path']);destination.parent.mkdir(parents=True,exist_ok=True)
        if not destination.exists():shutil.copy2(source,destination)
        if sha(destination.read_bytes())!=entry['sha256']:raise ValueError('Copied measured input hash mismatch')
        copies.append({'receipt':receipt,'source':str(source),'taskInput':str(destination.relative_to(ROOT)),**entry})
    allowed={job[2]:job for job in jobs}
    def decode(path,clips):
        source_sha=sha(Path(path).read_bytes());job=allowed.get(source_sha)
        if not job or Path(path).name.casefold()!=job[1].casefold():raise ValueError('Scoped optional converter received another source')
        if job[0].endswith('_002'):return measured._decode_full_skill_keys(Path(path),clips,cache)
        return measured._decode_registered_keys(Path(path),clips,cache,measured.BM_FX_REQUEST,
            measured.BM_FX_MANIFEST,measured.BM_FX_REQUEST_SHA,'BM optional cosmetic-v32')
    build_rf.decode_measured_native_keys=decode
    catalog=build_rf.Catalog(Path('asset_work'))
    output=bounded(ROOT/'artifacts/mm/v32/fx/meshes');output.mkdir(parents=True,exist_ok=True)
    converted={}
    for name,mesh,source_sha,_,_ in jobs:
        source=catalog.path(mesh)
        if sha(source.read_bytes())!=source_sha:raise ValueError('Original cosmetic source hash mismatch')
        result=build_rf.build_effect(catalog,output,mesh)
        if not result.get('glb') or not result.get('poseData') or result.get('missingExplicitTickRate'):
            raise ValueError('Optional source geometry/key conversion incomplete')
        converted[name]={'result':result,'source':catalog.evidence(source),'sourceSha256':source_sha}
    # Capture all input bytes before any mutation. A parallel writer causes a
    # fail-closed abort, instead of erasing another task's new skill branches.
    paths=[ROOT/'artifacts/mm/v32/fx/index.json',ROOT/'contracts/add-skill-resources-v32.json']
    for role in ['mm','de']:paths.extend([ROOT/f'packages/combat-core/{role}-profile.json',ROOT/f'artifacts/{role}/fx/index.json'])
    initial={path:path.read_bytes() for path in paths};updates={path:json.loads(data) for path,data in initial.items()}
    receipts=[]
    for path,value in updates.items():
        if path.name=='add-skill-resources-v32.json':continue
        role='de' if 'de-profile' in path.name or '/de/' in path.as_posix() else 'mm'
        target=value['effectTemplates'] if 'effectTemplates' in value else value['templates']
        before=copy.deepcopy(value)
        prefix='fx/meshes/' if path==ROOT/'artifacts/mm/v32/fx/index.json' else ('../mm/' if role=='de' else '')+'v32/fx/meshes/'
        for name,row in converted.items():
            record=target[name];result=row['result']
            record['glb']=prefix+Path(result['glb']).name
            record['poseData']=prefix+Path(result['poseData']).name
            record['animationMissingTickRate']=result['missingExplicitTickRate']
            record['animationClips']=result['animations']
            record['animationRequiresUnconfirmedRate']=False
            record['unsupported']=[v for v in record['unsupported'] if v!='Measured native key artifact missing']
            # No declaration, capability, damage, or material/texture change.
            old=(before['effectTemplates'] if 'effectTemplates' in before else before['templates'])[name]
            for key in ['glb','poseData','animationMissingTickRate','animationClips','animationRequiresUnconfirmedRate','unsupported']:
                old[key]=copy.deepcopy(record[key])
        if 'meshFailures' in value:
            value['meshFailures']=[v for v in value['meshFailures'] if v['mesh'].casefold() not in {job[1].casefold() for job in jobs}]
            before['meshFailures']=copy.deepcopy(value['meshFailures'])
        if before!=value:raise ValueError('Unrelated profile/index fields changed')
        receipts.append({'path':str(path.relative_to(ROOT)),'beforeSha256':sha(initial[path]),'changedTemplates':list(converted)})
    for path,data in initial.items():
        if path.read_bytes()!=data:raise ValueError('Parallel writer changed input before cosmetic patch')
    for role in ['mm','de']:
        profile_path=ROOT/f'packages/combat-core/{role}-profile.json';write(profile_path,updates[profile_path])
        fx_path=ROOT/f'artifacts/{role}/fx/index.json';updates[fx_path]['profileSha256']=sha(profile_path.read_bytes());write(fx_path,updates[fx_path])
    fx_local=ROOT/'artifacts/mm/v32/fx/index.json';write(fx_local,updates[fx_local])
    contract_path=ROOT/'contracts/add-skill-resources-v32.json';contract=updates[contract_path]
    contract['optionalMeshFailures']=[v for v in contract['optionalMeshFailures'] if v['mesh'].casefold() not in {job[1].casefold() for job in jobs}]
    for role in ['mm','de']:contract['profiles'][role]={'profileSha256':sha((ROOT/f'packages/combat-core/{role}-profile.json').read_bytes()),
        'fxIndexSha256':sha((ROOT/f'artifacts/{role}/fx/index.json').read_bytes())}
    write(contract_path,contract)
    for row in receipts:row['afterSha256']=sha((ROOT/row['path']).read_bytes())
    proof={'schemaVersion':1,'originalClientExecuted':False,'originalDllReceiptReuse':True,'measuredInputs':copies,
        'converted':{name:{'source':r['source'],'sourceSha256':r['sourceSha256'],'animations':r['result']['animations'],
            'files':[{ 'path':str((output/Path(r['result'][key]).name).relative_to(ROOT)),
                'sha256':sha((output/Path(r['result'][key]).name).read_bytes())} for key in ['glb','poseData']]} for name,r in converted.items()},
        'patchReceipts':receipts,'preservedFields':'all fields except the six conversion-status fields of the exact two original templates; role fxIndex.profileSha256 and failure lists refreshed',
        'optionalMeshFailuresRemaining':contract['optionalMeshFailures']}
    write(ROOT/'contracts/add-optional-resources-v32.json',proof)
    report=bounded(ROOT/'runtime/maximum-orbit-v32/optional-mesh-closure.json');report.parent.mkdir(parents=True,exist_ok=True);write(report,proof)
    print(json.dumps({'converted':list(converted),'optionalMeshFailuresRemaining':contract['optionalMeshFailures']}))

if __name__=='__main__':main()
