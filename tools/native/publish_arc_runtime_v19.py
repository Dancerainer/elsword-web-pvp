"""Publish only reviewed awakened Arc skills; keep the old ten-module release."""
from pathlib import Path
import argparse,copy,json
import seal_v11_runtime as sealing
from build_runtime import retain_rebuild_history
from check_arc_composition_v19 import check as check_composition

ROOT=Path(__file__).resolve().parents[2]

def read(path):return json.loads(path.read_text(encoding='utf8'))
def stamp(root,path):
    data=path.read_bytes()
    return {'path':path.relative_to(root).as_posix(),'bytes':len(data),'sha256':sealing.sha(data)}

def commit_candidate(root,contract_path,contract,result,previous,binary,seal_fn=sealing.seal):
    """Replace the task's paired files, or restore all three on any failure."""
    manifest_path=root/'artifacts/native/manifest.json'
    binary_path=root/'artifacts/native/skills.wasm'
    original_manifest=manifest_path.read_bytes();original_binary=binary_path.read_bytes()
    original_contract=contract_path.read_bytes() if contract_path.exists() else None
    try:
        contract_path.write_text(json.dumps(contract,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        binary_path.write_bytes(binary)
        manifest_path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        result=seal_fn(root)
        result=retain_rebuild_history(previous,result,'skills')
        result['seal']['boundedRebuildHistory'][-1]['reason']='Append unchanged fixed-V5 awakened Arc FrameMove as group70; retain groups1..69, seventy old methods and nine other modules'
        manifest_path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        seal_fn(root,check_only=True)
        return result
    except Exception:
        manifest_path.write_bytes(original_manifest);binary_path.write_bytes(original_binary)
        if original_contract is None:contract_path.unlink(missing_ok=True)
        else:contract_path.write_bytes(original_contract)
        raise

def publish(root=ROOT):
    root=Path(root).resolve()
    manifest_path=root/'artifacts/native/manifest.json'
    previous=read(manifest_path)
    if previous['runtimeVersion']!='original-source-functions-v10':raise ValueError('Requires retained v10 release')
    sealing.seal(root,check_only=True)
    candidate=root/'.cache/native-archenemy-skills-v19'
    independent=root/'.cache/native-archenemy-skills-v19-independent'
    generated=read(candidate/'source-contract.json')
    check_composition(root,candidate)
    check_composition(root,independent)
    binary=(candidate/'skills.wasm').read_bytes()
    if binary!=(independent/'skills.wasm').read_bytes():raise ValueError('Independent WASM rebuild differs')
    if (candidate/'skills.generated.cpp').read_bytes()!=(independent/'skills.generated.cpp').read_bytes():
        raise ValueError('Independent C++ composition differs')
    sealing.matches(candidate/'skills.wasm',generated['wasm'],'Arc compiled module')
    sealing.wasm(binary,'Arc compiled module')
    methods=generated['functions']+generated.get('extraFunctions',[])
    record={**copy.deepcopy(previous['modules']['skills']),'sha256':sealing.sha(binary),'bytes':len(binary),
            'originalFunctions':methods}
    historical=root/'.cache/native-awakened-skills-v17'
    old_contract=read(historical/'source-contract.json')
    if old_contract['wasm']['sha256']!=previous['modules']['skills']['sha256']:
        raise ValueError('Historical skills release is not the retained v10 pairing')
    retained=root/'artifacts/native/superseded'
    retained.mkdir(parents=True,exist_ok=True)
    old_paths=[manifest_path,root/'artifacts/native/skills.wasm',historical/'source-contract.json',historical/'skills.generated.cpp']
    for path in old_paths:
        data=path.read_bytes();destination=retained/(sealing.sha(data)+path.suffix)
        if destination.exists() and destination.read_bytes()!=data:raise ValueError('Superseded identity drift')
        if not destination.exists():destination.write_bytes(data)
    names=['skills.wasm','skills.generated.cpp','source-contract.json',*[p.name for p in sorted(candidate.glob('*.inc'))]]
    if len(names)!=12:raise ValueError('Incomplete compiled source closure')
    for name in names:
        if (candidate/name).read_bytes()!=(independent/name).read_bytes():raise ValueError('Independent compiled input differs: '+name)
    compiled=[stamp(root,candidate/name) for name in names]
    contract={'schemaVersion':1,'referenceCommit':sealing.COMMIT,'targetClientMeasured':False,
              'evidenceClass':'bounded-fixed-V5-callback-extension-not-target2016',
              'previousRuntimeVersion':previous['runtimeVersion'],
              'previousManifestContentSha256':previous['seal']['manifestContentSha256'],
              'previousSkills':previous['modules']['skills'],'runtimeModule':record,
              'unchangedOriginalMethods':70,'newOriginalMethods':1,'callbackGroups':70,
              'generatedSourceContract':(candidate/'source-contract.json').relative_to(root).as_posix(),
              'compiledFiles':compiled,'independentWasmRebuildByteEqual':True,
              'independentCppCompositionByteEqual':True,
              'retainedPairings':{name:row for name,row in previous['modules'].items() if name!='skills'},
              'boundary':'Original method bytes execute with serialized host handles/pose/time; complete target client not executed.'}
    contract_path=root/sealing.SKILL_V11_CONTRACT
    result=copy.deepcopy(previous);result.pop('seal')
    result['runtimeVersion']='original-source-functions-v11'
    result['modules']['skills']=record
    result['boundaries']['skills']=generated['hostBoundary']
    # All candidate validation precedes live deployment. Failure restores this
    # task's retained manifest/module and never touches a running server.
    result=commit_candidate(root,contract_path,contract,result,previous,binary)
    return {'nativeVersion':result['runtimeVersion'],'skillsSha256':record['sha256'],
            'moduleCount':len(result['modules']),'oldMethodsPreserved':70,'independentRebuildEqual':True,
            'manifestContentSha256':result['seal']['manifestContentSha256']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,default=ROOT)
    print(json.dumps(publish(parser.parse_args().root),indent=2))
