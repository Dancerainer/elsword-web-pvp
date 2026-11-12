"""Compile unchanged pinned Raven airborne callbacks outside the implementation.

Original C++ stays in the task's ignored output. The small JSON oracle records
explicit input/end/ground snapshots, not a target2016 client runtime trace.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from check_lk_command_sources_v2 import method, macro

ROOT = Path(__file__).resolve().parents[2]
HASHES = {'X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
          'X2GUUser.h': 'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc'}
STATES = ['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX', 'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX',
          'RVC_DASH_JUMP_COMBO_X', 'RVC_DASH_JUMP_COMBO_XX_START',
          'RVC_DASH_JUMP_COMBO_XX_LOOP', 'RVC_DASH_JUMP_COMBO_XX_FINISH']
FUTURES = [STATES[i]+'_FrameMoveFuture' for i in (2, 3, 5)]
METHODS = [n+'_EventProcess' for n in STATES]+FUTURES
HEADER = r'''
#include <cstdio>
#include <initializer_list>
#define SERV_RAVEN_VETERAN_COMMANDER
#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE
enum {USI_JUMP_LANDING=1,RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX,
 RVC_DASH_JUMP_COMBO_XX_START,RVC_DASH_JUMP_COMBO_XX_LOOP,RVC_DASH_JUMP_COMBO_XX_FINISH,SKILL_REQUEST};
namespace _CONST_RAVEN_ {const int MAX_DASH_JUMP_COMBO_XX_LOOP_COUNT=9;}
struct CX2SkillTree {enum{ASUT_AIR};};
struct Anim {float time=0,before=0;bool ended=false;
 float GetNowAnimationTime(){return time;}bool IsAnimationEnd(){return ended;}
 bool EventTimerOneshot(float t){return before<t&&time>=t;}};
struct Input {bool oneX=false,oneA=false,pureA=false,pureS=false,pureD=false,pureC=false,
 pureQ=false,pureW=false,pureE=false,pureR=false,pureRight=false,pureLeft=false,pureDown=false;};
struct Frame {struct{bool bEventFlagList[1]={false};}stateParam;struct{bool bIsRight=true;}syncData;};
struct Physics {struct{float x=0,y=0;}nowSpeed;float fGAccel=4000;
 float GetWalkSpeed(){return 575;}};
struct CX2GURaven {Anim anim;Anim* m_pXSkinAnimFuture=&anim;Input m_InputData;
 Frame m_FrameDataFuture;Physics m_PhysicParam;bool grounded=false,canOverheat=true,m_bDisableGravity=true;
 int m_iRVCComboLoopCount=1,requested=0;float m_fSkillCancelAfterFly=9999,m_fElapsedTime=1.f/60;
 bool IsOnSomethingFuture(){return grounded;}void StateChange(int s){requested=s;}
 bool _CanOverheat(){return canOverheat;}
 bool SpecialAttackEventProcess(int){if(!m_InputData.oneA)return false;requested=SKILL_REQUEST;return true;}
 void CommonEventProcess(){}void CommonFrameMoveFuture(){}
'''
MAIN = r'''
void show(const char* phase,int state,int mask,CX2GURaven&a){
 std::printf("{\"phase\":\"%s\",\"state\":%d,\"mask\":%d,\"time\":%.9g,\"ended\":%s,\"requested\":%d,\"flags\":%d,\"gravityDisabled\":%s,\"vx\":%.9g,\"vy\":%.9g}",
 phase,state,mask,a.anim.time,a.anim.ended?"true":"false",a.requested,a.m_FrameDataFuture.stateParam.bEventFlagList[0]?1:0,a.m_bDisableGravity?"true":"false",a.m_PhysicParam.nowSpeed.x,a.m_PhysicParam.nowSpeed.y);
}
int main(){bool comma=false;std::puts("[");
 for(int state=0;state<6;state++)for(float time:{.001f,.001001f,.240f,.240001f,.3f,.300001f,.420f,.420001f,.433f,.433001f,.635f,.635001f})for(int mask=0;mask<16;mask++){
  CX2GURaven a;a.anim.time=time;a.anim.ended=mask&8;a.grounded=mask&4;
  a.m_InputData.oneX=mask&2;a.m_InputData.oneA=a.m_InputData.pureA=true;
  a.m_FrameDataFuture.stateParam.bEventFlagList[0]=mask&1;
  a.m_fSkillCancelAfterFly=state==2?.433f:state==4?.001f:state==5?.3f:9999.f;
  switch(state){EVENT_CALLS}
  if(comma)std::puts(",");comma=true;show("event",state,mask,a);
 }
 for(int state:{2,3,5})for(float time:{.03f,.21f,.210001f,.26f,.29f,.7f})for(int mask=0;mask<8;mask++){
  CX2GURaven a;a.anim.time=time;a.anim.before=time-.001f;a.anim.ended=mask&4;
  a.m_InputData.pureDown=mask&2;a.m_InputData.pureRight=mask&1;
  a.m_PhysicParam.nowSpeed.x=-100;a.m_PhysicParam.nowSpeed.y=-100;
  switch(state){FUTURE_CALLS}
  if(comma)std::puts(",");comma=true;show("future",state,mask,a);
 }
 std::puts("\n]");}
'''

def sha(data): return hashlib.sha256(data).hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('--compiler',type=Path,required=True)
    p.add_argument('--out',type=Path,default=ROOT/'runtime/vc-air-command-source-v3')
    a=p.parse_args();data={name:(ROOT/'.cache/native-source-runtime/X2Lib'/name).read_bytes() for name in HASHES}
    for name,expected in HASHES.items():
        if sha(data[name])!=expected:raise ValueError('Pinned source changed: '+name)
    fragments=[];bodies=[];macros=[]
    for name in METHODS:
        body,first,last=method(data['X2GURaven.cpp'],name);bodies.append(body)
        fragments.append({'file':'X2GURaven.cpp','method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True})
    for name in ['ELSE_IF_ASDC_PRESSED_AFTER','SKILL_CANCEL_AFTER_FLY']:
        body,first,last=macro(data['X2GUUser.h'],name);macros.append(body)
        fragments.append({'file':'X2GUUser.h','macro':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True})
    calls=''.join(f'case {i}:a.{n}_EventProcess();break;' for i,n in enumerate(STATES))
    futures=''.join(f'case {i}:a.{STATES[i]}_FrameMoveFuture();break;' for i in (2,3,5))
    cpp=b'\n'.join(macros)+HEADER.encode()+''.join(f'void {n}();\n' for n in METHODS).encode()+b'};\n'+b'\n'.join(bodies)+MAIN.replace('EVENT_CALLS',calls).replace('FUTURE_CALLS',futures).encode()
    a.out.mkdir(parents=True,exist_ok=True);unit=a.out/'vc-air-callbacks.cpp';unit.write_bytes(cpp);exe=a.out/'vc-air-callbacks.exe'
    env=dict(os.environ);env['ZIG_LOCAL_CACHE_DIR']=str(a.out/'zig-local');env['ZIG_GLOBAL_CACHE_DIR']=str(a.out/'zig-global')
    build=subprocess.run([str(a.compiler),'c++','-std=c++17','-O0','-ffp-contract=off','-Wno-invalid-utf8','-Wno-extra-tokens',str(unit),'-o',str(exe)],capture_output=True,text=True,env=env)
    if build.returncode:raise RuntimeError(build.stdout+build.stderr)
    cases=json.loads(subprocess.check_output([str(exe)],text=True))
    # Keep boundary cases for each independent branch; no simulation code is imported.
    result={'schema':'vc-air-command-source-v3','sourceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
      'targetClientMeasured':False,'evidenceClass':'unchanged-fixedV5-source-probe','files':HASHES,'fragments':fragments,
      'unitSha256':sha(cpp),'compilerSha256':sha(a.compiler.read_bytes()),'states':STATES,
      'requestStates':[None,'RSI_JUMP_LANDING','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX','RVC_DASH_JUMP_COMBO_XX_START','RVC_DASH_JUMP_COMBO_XX_LOOP','RVC_DASH_JUMP_COMBO_XX_FINISH','SKILL_REQUEST'],
      'boundaries':['Animation time/end, grounding and input are supplied snapshots; common callbacks are explicit no-ops.',
        'Skill dispatcher records an available airborne slot-A request; resource/skill conditions are verified separately in product tests.',
        'X .433 uses target2016 SKILL_CANCEL_AFTER as an explicitly qualified binding to the older FLY callback.',
        'No target2016 animation controller, physics, device schedule or original-client execution.'], 'cases':cases}
    output=ROOT/'contracts/vc-air-command-source-v3.json';output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf8')
    print(json.dumps({'cases':len(cases),'report':str(output)}))

if __name__=='__main__':main()
