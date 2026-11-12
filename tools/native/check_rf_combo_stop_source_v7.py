"""Execute unchanged pinned callbacks and the exact fixed-V5 stop guard.

This is an independent source boundary probe, not a 2016 client recording.
No published WASM is rebuilt. All generated C++, executable and cache output
must be below the explicitly supplied task-owned runtime directory.
"""
import argparse,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.dont_write_bytecode=True
MAIN=r'''
#include <cstdio>
int eventCalls=0;
void probe(int state,float time,int key,int grounded,int flags=0){
  run_callback(1,state,0,time,time,0,0,0,-1,-1,0,0,600,flags,key,1,grounded,0,0,0,0,0,1,2,0,0,0,300,0,0,0,0);
}
struct StopHost {
  struct Frame {struct Conditions {float fStopTime=.1f,fStop2Time=0;} unitCondition;
    struct Sync {bool bFrameStop=false;} syncData;} m_FrameDataFuture;
  void DoStateEndStartFuture(){}
  void DoFrameMoveFuture(){++eventCalls;probe(28,.392f,0,1);}
  void Move(float fElapsedTime){
// @@STOP_GUARD@@
  }
};
int main(){std::puts("{\"cases\":[");
  const int states[]={23,24,27,28,29,31};
  const float cutoffs[]={.3f,.39f,.6f,.53f,.55f,.39f};
  const int keys[]={1,2,2,2,2,2};
  bool first=true;
  for(int i=0;i<6;i++)for(int late=0;late<2;late++){
    float time=cutoffs[i]+(late?.0001f:0);probe(states[i],time,keys[i],i==5?0:1);
    std::printf("%s{\"state\":%d,\"late\":%d,\"time\":%.9g,\"flags\":%d,\"requested\":%d}",
      first?"":",",states[i],late,time,(int)result[4],(int)result[5]);first=false;
  }
  StopHost host;probe(28,.392f,2,1);int accepted=(int)result[4];
  for(int i=0;i<8;i++)host.Move(1.f/60.f);
  std::printf("],\"stop\":{\"acceptedIfConsumed\":%d,\"eventCalls\":%d,\"flagsWithoutReplay\":%d}}\n",
    accepted,eventCalls,(int)result[4]);
}
'''
def sha(data):return hashlib.sha256(data).hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root',type=Path,required=True)
    p.add_argument('--compiler',type=Path,required=True)
    p.add_argument('--out',type=Path,default=ROOT/'runtime/combo-stop-v7/source')
    a=p.parse_args()
    out=a.out.resolve()
    if not out.is_relative_to((ROOT/'runtime').resolve()):raise ValueError('Output must stay within this worktree runtime')
    spec=importlib.util.spec_from_file_location('commands_source',Path(__file__).with_name('commands-build.py'))
    baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
    cpp,contract=baseline.extract(a.source_root,Path(__file__).with_name('commands-compat.hpp'))
    raw=(a.source_root/'X2Lib/X2GUUser.cpp').read_bytes()
    if sha(raw)!=baseline.HASHES['X2Lib/X2GUUser.cpp']:raise ValueError('User source hash mismatch')
    guard=b''.join(raw.splitlines(keepends=True)[6766:6785])
    if b'DoFrameMoveFuture();' not in guard or b'fStopTime -=' not in guard:raise ValueError('Stop guard range drift')
    unit=cpp+b'\n'+MAIN.encode().replace(b'// @@STOP_GUARD@@',guard)
    out.mkdir(parents=True,exist_ok=True);source=out/'combo-stop-source.cpp';source.write_bytes(unit)
    exe=out/'combo-stop-source.exe';env=dict(os.environ)
    env['ZIG_LOCAL_CACHE_DIR']=str(out/'zig-local');env['ZIG_GLOBAL_CACHE_DIR']=str(out/'zig-global')
    flags=['c++','-std=c++17','-O0','-ffp-contract=off','-fno-fast-math','-Wno-invalid-utf8','-Wno-extra-tokens',str(source),'-o',str(exe)]
    built=subprocess.run([str(a.compiler),*flags],env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if built.returncode:raise RuntimeError(built.stdout+built.stderr)
    result=json.loads(subprocess.check_output([str(exe)],text=True))
    expected=[1,2,1,1,1,1]
    for i,row in enumerate(result['cases']):
        assert row['flags']==(0 if row['late'] else expected[i//2]),row
        assert row['requested']==0,row
    assert result['stop']=={'acceptedIfConsumed':1,'eventCalls':1,'flagsWithoutReplay':0},result['stop']
    evidence={'schema':'rf-combo-stop-source-v7','sourceCommit':baseline.COMMIT,'evidenceClass':'compiled-fixed-V5-reference-not2016',
      'targetClientMeasured':False,'publishedNativeModulesModified':False,'sourceFiles':contract['sourceFileSha256'],
      'fragments':[f for f in contract['functions'] if f['name'] in ['RSI_COMBO_Z_EventProcess','RSI_COMBO_ZZ_EventProcess',
        'RSI_COMBO_ZZX_EventProcess','RSI_COMBO_X_EventProcess','RSI_COMBO_XX_EventProcess','RRF_DASH_JUMP_COMBO_X_EventProcess']],
      'stopGuard':{'file':'X2Lib/X2GUUser.cpp','firstLine':6767,'lastLine':6785,'sha256':sha(guard),'bodyUnchanged':True},
      'sourceInputOverwrite':{'file':'X2Lib/X2GUUser.cpp','lines':[28954,28955],'wholeFileSha256':sha(raw)},
      'hostBoundary':'Unchanged callbacks inside existing commands-compat host. Only exact 19-line original stop guard is additionally executed; input, animation time, storage and callback counters are fixtures. No whole client, physics or target2016 runtime.',
      'compilerSha256':sha(a.compiler.read_bytes()),'unitSha256':sha(unit),'assertionsPassed':len(result['cases'])+1,**result}
    (out/'result.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'out':str(out/'result.json'),'assertionsPassed':evidence['assertionsPassed']}))
if __name__=='__main__':main()
