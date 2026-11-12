"""Original StateChange/DoStateEndStartFuture/DoFrameMoveFuture scheduler probe."""
import argparse,json,os,subprocess
from pathlib import Path
from check_rf_keyboard_source_v19 import sha,fragment
PIN='ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38'
HEADER=r'''
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <functional>
#include <algorithm>
#define KTDXPROFILE()
using DWORD=unsigned long;
struct Lua {bool BeginTableByReference(int){return true;}void EndTable(){}};
struct Gauge {void SetEnable(bool){}};
struct Sync {int stateChangeNum=0,nowState=0,nowSubState=0,m_RandSeed=0,m_RandSeed2=0;bool bDirectChange=false;DWORD dwFrameMoveCount=0;};
struct Frame {Sync syncData;struct {int stateChangeNum=0,nextState=0,nextSubState=0;}unitCondition;};
struct StateData {int stateID=0;std::function<void()> StateEndFuture,StateStartFuture,OnFrameMoveFuture,OnEventProcess;};
struct CX2GUUser {
 using SyncData=Sync;
 Frame m_FrameDataFuture,m_FrameDataNow;Lua m_LuaManager;StateData m_FutureStateData;StateData m_StateList[64];
 struct {struct {float m_fTime=0;} m_EnchantShock,m_Frozen;} m_ExtraDamagePack;
 std::vector<Sync> m_ReceiveSyncDataList,m_SendSyncDataList,m_LastSendSyncDataList;
 DWORD m_adwInitFrameMoveCount[2]={};int m_iNowSpecialAttack=0;Gauge gauge;float animationTime=0;int starts=0,ends=0,moves=0,events=0;
 bool IsLocalUnit(){return true;}float GetNowHp(){return 1;}Gauge* GetGageData(){return &gauge;}
 void CommonStateEndFuture(){++ends;}void CommonStateStartFuture(){++starts;animationTime=0;}
 void CommonFrameMoveFuture(){++moves;animationTime+=1.f/60.f;}
 bool StateChange(int,bool=false);void DoStateEndStartFuture();void DoFrameMoveFuture();
};
'''
MAIN=r'''
int main(){CX2GUUser a;
 for(int i=0;i<64;i++){a.m_StateList[i].stateID=i;a.m_StateList[i].OnEventProcess=[&](){++a.events;};}
 a.m_FutureStateData=a.m_StateList[0];
 std::puts("[");
 for(int i=0;i<5;i++){
  a.DoStateEndStartFuture();a.DoFrameMoveFuture();
  // Source callbacks separately audited in v18 choose these requests from
  // sampled66 -> both directions -> pure6/no-one6 -> Z. This host selection
  // is explicit; the scheduling consumers below remain original unchanged.
  if(i<4)a.StateChange(i+1,false);
  std::printf("{\"packet\":%d,\"now\":%d,\"pending\":%d,\"syncChange\":%d,\"requestChange\":%d,\"starts\":%d,\"ends\":%d,\"moves\":%d,\"events\":%d,\"time\":%.9g}%s\n",
   i,a.m_FrameDataFuture.syncData.nowState,a.m_FrameDataFuture.unitCondition.nextState,
   a.m_FrameDataFuture.syncData.stateChangeNum,a.m_FrameDataFuture.unitCondition.stateChangeNum,
   a.starts,a.ends,a.moves,a.events,a.animationTime,i==4?"":",");
 }std::puts("]");}
'''
def build(root,out,compiler):
 data=(root/'X2Lib/X2GUUser.cpp').read_bytes()
 if sha(data)!=PIN:raise ValueError('Pinned User source changed')
 bodies=[];manifest=[]
 for name,pattern in [('StateChange',rb'bool CX2GUUser::StateChange\( int state, bool bDirectChange \)'),
  ('DoStateEndStartFuture',rb'void CX2GUUser::DoStateEndStartFuture\(\)'),('DoFrameMoveFuture',rb'void CX2GUUser::DoFrameMoveFuture\(\)')]:
  body,first,last=fragment(data,pattern);bodies.append(body);manifest.append({'method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'bodyUnchanged':True})
 out.mkdir(parents=True,exist_ok=True);unit=HEADER.encode()+b'\n'.join(bodies)+MAIN.encode();cpp=out/'state-schedule.cpp';cpp.write_bytes(unit);exe=out/'state-schedule.exe'
 env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str((out/'zig-global').resolve()),ZIG_LOCAL_CACHE_DIR=str((out/'zig-local').resolve()))
 r=subprocess.run([str(compiler),'c++','-std=c++17','-O0',str(cpp),'-o',str(exe)],env=env,capture_output=True)
 if r.returncode:raise RuntimeError((r.stdout+r.stderr).decode(errors='replace'))
 rows=json.loads(subprocess.check_output([str(exe.resolve())]));assert [r['now'] for r in rows]==[0,1,2,3,4]
 assert [r['pending'] for r in rows]==[1,2,3,4,4]
 assert all(r['moves']==r['packet']+1 and r['events']==r['packet']+1 and r['starts']==r['packet'] for r in rows)
 result={'schema':'rf-state-schedule-independent-source-v19','evidenceClass':'compiled-fixed-reference-scheduler-not2016','targetClientMeasured':False,
  'sourceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','file':{'path':'X2Lib/X2GUUser.cpp','sha256':sha(data),'bytes':len(data)},
  'fragments':manifest,'cases':rows,'unitSha256':sha(unit),'compilerSha256':sha(compiler.read_bytes()),
  'boundary':'Three entire original methods unchanged; explicit local/live/unfrozen unit, inactive optional macros and no-op Gauge/Lua storage; State callbacks select explicit requests. Network Push/Pop, real animation/physics and direct-change backlog not reproduced.'}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8',newline='\n');return result
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,default=Path('.cache/native-source-runtime'));p.add_argument('--out',type=Path,default=Path('artifacts/proof-double-cancel-v19/schedule-source'));p.add_argument('--compiler',type=Path,required=True)
 a=p.parse_args();r=build(a.source_root,a.out,a.compiler);print(json.dumps({'cases':len(r['cases']),'out':str(a.out/'result.json')}))
