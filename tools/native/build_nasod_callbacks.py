"""Compile unchanged fixed-reference Nasod guard consumers, without client run."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess
from run_camera_source import extract,sha
ROOT=Path(__file__).resolve().parents[2]
PIN={'X2Lib/X2GURaven.cpp':'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
     'X2Lib/X2GUUser.cpp':'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
     'X2Lib/X2GUUser.h':'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc',
     'X2Lib/X2EffectSet.cpp':'395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440',
     'KTDXLIB/Always.h':'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069',
     'KTDXLIB/KTDX.h':'0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf'}
def build(cache,out,zig):
    out=out.resolve();cache=cache.resolve()
    if out.is_relative_to(cache) or not out.is_relative_to(ROOT):raise ValueError('Unsafe source/output overlap')
    out.mkdir(parents=True,exist_ok=True)
    source={}
    for name,digest in PIN.items():
        source[name]=(cache/name).read_bytes()
        if sha(source[name])!=digest:raise ValueError('Source drift: '+name)
    records=[];fragments=[]
    for sig in ['bool CX2GURaven::CanParryingState()', 'void CX2GURaven::DoParrying()',
                'void CX2GURaven::RSI_PARRYING_Start()', 'void CX2GURaven::RSI_PARRYING_StateEnd()']:
        raw,first,last=extract(source['X2Lib/X2GURaven.cpp'],sig.encode());fragments.append(raw)
        records.append({'file':'X2Lib/X2GURaven.cpp','signature':sig,'lines':[first,last],'bytes':len(raw),'sha256':sha(raw)})
    (out/'original_nasod_methods.inc').write_bytes(b'\n\n'.join(fragments))
    for name,file,lo,hi in [('gate','X2Lib/X2GUUser.cpp',8487,8535),('timer','X2Lib/X2GURaven.cpp',14500,14511)]:
        raw=b''.join(source[file].splitlines(keepends=True)[lo-1:hi]);(out/('original_nasod_'+name+'.inc')).write_bytes(raw)
        records.append({'file':file,'lines':[lo,hi],'sha256':sha(raw),'bytes':len(raw),'hostWrapper':'bounded member function'})
    adapter=(ROOT/'tools/native/nasod_source_adapter.cpp').read_bytes();(out/'nasod_source_adapter.cpp').write_bytes(adapter)
    env=dict(os.environ,ZIG_LOCAL_CACHE_DIR=str(out/'zig-local'),ZIG_GLOBAL_CACHE_DIR=str(out/'zig-global'))
    command=[str(zig.resolve()),'c++','-std=c++17','-O2','-fno-fast-math','-ffp-contract=off','-fno-builtin','-target','wasm32-freestanding',
             '-nostdlib','-fno-exceptions','-fno-rtti','nasod_source_adapter.cpp','-Wl,--no-entry','-Wl,--export-memory']
    command += ['-Wl,--export='+name for name in ['ns_abi','ns_input','ns_output','ns_eval']]+['-o','nasod.wasm']
    result=subprocess.run(command,cwd=out,env=env,capture_output=True)
    if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace'))
    binary=(out/'nasod.wasm').read_bytes()
    contract={'schema':1,'abi':1,'referenceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','targetClientMeasured':False,
      'evidenceClass':'reference-V5-not2016','referenceFiles':[{'relativePath':name,'sha256':digest,'bytes':len(source[name])} for name,digest in PIN.items()],
      'extractions':records,'adapterSha256':sha(adapter),'module':{'file':'nasod.wasm','sha256':sha(binary),'bytes':len(binary)},
      'hostBoundary':['Symbolic host state IDs preserve the verified common damage-state interval; no original numeric-ID claim.',
        'GetDirVector is the host authored line +X basis; arbitrary line rotations and unit scale remain unsupported.',
        'CommonStateStart/End, mesh storage, animation/sound dispatch and RestoreNasodBall recreation are captured host boundaries.',
        'GetRandomInt(0) comes from the supplied actor random value; original RNG scheduling remains unverified.',
        'Now foot uses the saved host land cache and strict abs(y-landY)<LINE_RADIUS; full original Now/Future frame buffers remain unported.',
        'RIDING_SYSTEM/UPGRADE_RAVEN are declared by fixed Always.h; X2OPTIMIZE_PARTICLE_AND_ETC_HANDLE by KTDX.h.',
        'SERV_CHUNG_TACTICAL_TROOPER is an explicit compile branch, not proven by these fixed headers; target2016 macro set remains unverified.']}
    (ROOT/'contracts/rf-native-nasod-v11.json').write_bytes((json.dumps(contract,indent=2)+'\n').encode('utf-8'))
    dest=ROOT/'artifacts/native';dest.mkdir(parents=True,exist_ok=True);(dest/'nasod.wasm').write_bytes(binary)
    manifest=json.loads((dest/'manifest.json').read_text('utf-8'));manifest['runtimeVersion']=manifest['runtimeVersion'] if manifest['runtimeVersion']=='original-source-functions-v10' else 'original-source-functions-v9' if 'mana-break' in manifest['modules'] else 'original-source-functions-v8'
    manifest['modules']['nasod']=contract['module'];(dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n','utf-8')
    print(json.dumps(contract['module']))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-cache',type=Path,default=ROOT/'.cache/native-source-runtime')
    p.add_argument('--output-dir',type=Path,default=ROOT/'.cache/native-nasod-generated');p.add_argument('--zig',type=Path,required=True)
    a=p.parse_args();build(a.source_cache,a.output_dir,a.zig)
