"""Independent unchanged fixed-source conditions; no production WASM mutation."""
import argparse, hashlib, json, os, subprocess
from pathlib import Path
from check_rf_direction_source_v16 import HEADER, HASHES, method, digest, COMMIT

METHODS = {
    'X2Lib/X2GUUser.cpp': ['WalkFrameMoveFuture', 'StateChangeDashIfPossible'],
    'X2Lib/X2GURaven.cpp': ['RSI_DASH_END_EventProcess'],
}
MAIN = r'''
int main(){bool comma=false;std::puts("[");
 for(int facing:{-1,1})for(int c=0;c<5;c++){
  CX2GURaven a;a.grounded=true;a.m_FrameDataFuture.syncData.bIsRight=facing==1;
  a.m_FrameDataNow.syncData.bIsRight=facing==1;a.m_bReAttackZ1Right=facing==1;
  const char* name="";
  if(c==0){name="walk-both-pure";a.m_InputData.pureLeft=a.m_InputData.pureRight=true;a.WalkFrameMoveFuture();}
  if(c==1){name="dash-end-both-fresh-facing";a.m_InputData.pureLeft=a.m_InputData.pureRight=true;
   a.m_InputData.oneRight=facing==1;a.m_InputData.oneLeft=facing==-1;a.RSI_DASH_END_EventProcess();}
  if(c==2){name="dash-end-both-held-no-fresh";a.m_InputData.pureLeft=a.m_InputData.pureRight=true;a.RSI_DASH_END_EventProcess();}
  if(c==3){name="dash-request-opposite-held";a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.StateChangeDashIfPossible();}
  if(c==4){name="dash-end-fresh-facing-and-z";a.m_InputData.pureLeft=a.m_InputData.pureRight=true;
   a.m_InputData.oneRight=facing==1;a.m_InputData.oneLeft=facing==-1;a.m_InputData.oneZ=true;a.RSI_DASH_END_EventProcess();}
  if(comma)std::puts(",");comma=true;
  std::printf("{\"case\":\"%s\",\"facing\":%d,\"requested\":%d,\"afterFacing\":%d,\"vx\":%.9g}",
   name,facing,a.requested,a.m_FrameDataFuture.syncData.bIsRight?1:-1,a.m_PhysicParam.nowSpeed.x);
 }std::puts("\n]");}
'''

def build(source_root, out, compiler):
    out.mkdir(parents=True, exist_ok=True)
    blobs={rel:(source_root/rel).read_bytes() for rel in HASHES}
    for rel, data in blobs.items():
        if digest(data)!=HASHES[rel]: raise ValueError('Pinned source changed: '+rel)
    bodies=[];fragments=[]
    for rel,names in METHODS.items():
        for name in names:
            body,first,last=method(blobs[rel],name);bodies.append(body)
            fragments.append({'file':rel,'method':name,'firstLine':first,'lastLine':last,
                              'sha256':digest(body),'bytes':len(body),'bodyUnchanged':True})
    lines=blobs['X2Lib/X2GUUser.h'].splitlines()
    start=next(i for i,line in enumerate(lines) if line.startswith(b'#define ELSE_IF_CAN_HYPER_MODE_THEN_STATE_CHANGE'))
    end=start
    while lines[end].endswith(b'\\'):end+=1
    hyper=b'\n'.join(lines[start:end+1])
    header=HEADER.replace('void StateChangeDashIfPossible(){requested=USI_DASH;}',
                          'void StateChangeDashIfPossible();void WalkFrameMoveFuture();')
    cpp=header.encode()+b'\n'+hyper+b'\n'+b'\n'.join(bodies)+MAIN.encode()
    unit=out/'double-cancel-consumers.cpp';unit.write_bytes(cpp)
    exe=out/'double-cancel-consumers.exe'
    env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str((out/'zig-global').resolve()),ZIG_LOCAL_CACHE_DIR=str((out/'zig-local').resolve()))
    result=subprocess.run([str(compiler),'c++','-std=c++17','-O0',str(unit),'-o',str(exe)],env=env,capture_output=True)
    if result.returncode:raise RuntimeError(result.stdout.decode(errors='replace')+result.stderr.decode(errors='replace'))
    cases=json.loads(subprocess.check_output([str(exe.resolve())]))
    expected=[0,1,2,1,13]
    for i,c in enumerate(cases):
        assert c['requested']==expected[i%5],c
        assert c['afterFacing']==(1 if i%5==0 else c['facing']),c
        if i%5==0:assert c['vx']==575,c
    result={'schema':'rf-double-cancel-consumers-source-v18','sourceCommit':COMMIT,
            'evidenceClass':'compiled-fixed-V5-reference-not2016','targetClientMeasured':False,
            'productionNativeModulesModified':False,'files':{r:{'sha256':digest(d),'bytes':len(d)} for r,d in blobs.items()},
            'fragments':fragments,'cases':cases,'assertionsPassed':len(cases),
            'compilerSha256':digest(compiler.read_bytes()),'unitSha256':digest(cpp),
            'hostBoundary':'Pinned unchanged method bodies; explicit input/frame/physics storage, StateChange records request; fixed speeds, line/skill/hyper disabled; whole original Now/Future scheduling not executed.'}
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,default=Path('.cache/native-source-runtime'))
    p.add_argument('--out',type=Path,default=Path('artifacts/proof-double-cancel-v18/source'));p.add_argument('--compiler',type=Path,required=True)
    a=p.parse_args();r=build(a.source_root,a.out,a.compiler);print(json.dumps({'out':str(a.out/'result.json'),'cases':r['assertionsPassed']}))
