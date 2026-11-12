"""Bounded original-source ZX -> ZXX scheduler, separate from product code.

Compile original StateChange / Future / Now dispatch and the two Raven events.
Target2016 declarations supply the three speed factors. No client execution,
network backlog, collision, D3DX controller or model rendering is claimed.
"""
import argparse
import json
import os
import subprocess
from pathlib import Path
from check_rf_state_schedule_v19 import HEADER as SCHEDULE_HEADER, PIN
from check_rf_keyboard_source_v19 import sha, fragment
from check_lk_command_sources_v2 import method, macro

ROOT = Path(__file__).resolve().parents[2]
STATES = ['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX', 'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX']
RAVEN_PIN = 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'
USER_HEADER_PIN = 'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc'

PRELUDE = r'''
#define SERV_RAVEN_VETERAN_COMMANDER
#define ARA_CHANGE_CLASS_FIRST
#define WALL_JUMP_TEST
#define REMOVE_LAND_CONNECT_CONSTRAINTS
using UINT=unsigned;
enum {RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX=0,RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX=1,USI_JUMP_LANDING=2};
struct CX2SkillTree {enum {ASUT_AIR};};
struct Anim {double clock=0,speed=1.4;float time=0,period=1;
 float GetNowAnimationTime(){return time;}bool IsAnimationEnd(){return time>period-std::max(period/10,.03f);}
 void advance(){if(!IsAnimationEnd()){clock+=speed/60;time=(float)clock;}}};
struct V2 {float x=0,y=0;};struct V3 {float x=0,y=0,z=0;};
struct Physics {V2 nowSpeed{750,-100},passiveSpeed{-1,-1};float fReloadAccel=0,fGAccel=0,fMaxGSpeed=0,fDownAccel=0;};
struct Input {bool oneX=false,pureA=false,pureS=false,pureD=false,pureC=false,pureQ=false,pureW=false,pureE=false,pureR=false;};
'''

EXTRA_FIELDS = r'''
 Anim anim;Anim* m_pXSkinAnimFuture=&anim;Input m_InputData;Physics m_PhysicParam;
 struct TIME_SPEED {V3 vSpeed;int iFlag;};std::vector<TIME_SPEED>m_vecSpeedFactor;
 bool m_bDisableGravity=true,m_bDisableGravityInScript=false,m_bRidingMachine=false;
 float x=0,y=0,m_fElapsedTime=1.f/60;
 bool IsOnSomethingFuture(){return false;}bool SpecialAttackEventProcess(int){return false;}
 void CommonStateStart(){}void CommonStateEnd(){}void CommonEventProcess(){}
 void CommonStateStartFuture();void CommonFrameMoveFuture();void PhysicProcess();void DoStateEndStart();
'''

MAIN = r'''
int main(){puts("[");bool comma=false;
for(int immediate=0;immediate<2;immediate++)for(int facing:{-1,1}){
 CX2GURaven a;TARGET_PHYSICS
 for(int i=0;i<2;i++){a.m_StateList[i].stateID=i;}
 a.m_StateList[0].StateStart=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX_StateStart();};
 a.m_StateList[0].StateEnd=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX_StateEnd();};
 a.m_StateList[0].OnEventProcess=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX_EventProcess();};
 a.m_StateList[1].StateStart=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX_StateStart();};
 a.m_StateList[1].StateEnd=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX_StateEnd();};
 a.m_StateList[1].OnEventProcess=[&](){a.RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX_EventProcess();};
 a.m_FutureStateData=a.m_NowStateData=a.m_StateList[0];a.CommonStateStartFuture();
 for(int frame=0;frame<60;frame++){
  a.m_InputData.oneX=frame==4;
  a.DoStateEndStartFuture();a.DoFrameMoveFuture();
  int physicsState=a.m_FrameDataFuture.syncData.nowState;float physicsTime=a.anim.time;
  if(immediate)a.DoStateEndStartFuture();
  // Explicit empty-backlog local Push/Pop adapter. DoStateEndStart itself is original.
  a.m_FrameDataNow.syncData=a.m_FrameDataFuture.syncData;a.DoStateEndStart();
  if(comma)puts(",");comma=true;
  printf("{\"mode\":%d,\"facing\":%d,\"frame\":%d,\"state\":%d,\"pending\":%d,\"physicsState\":%d,\"physicsTime\":%.9g,\"time\":%.9g,\"gravityDisabled\":%s,\"x\":%.9g,\"y\":%.9g,\"vx\":%.9g,\"vy\":%.9g}",
   immediate,facing,frame,a.m_FrameDataFuture.syncData.nowState,a.m_FrameDataFuture.unitCondition.nextState,
   physicsState,physicsTime,a.anim.time,a.m_bDisableGravity?"true":"false",a.x*facing,a.y,a.m_PhysicParam.nowSpeed.x*facing,a.m_PhysicParam.nowSpeed.y);
 }
}puts("\n]");}
'''

def main():
    p=argparse.ArgumentParser();p.add_argument('--compiler',type=Path,required=True)
    p.add_argument('--out',type=Path,default=ROOT/'runtime/vc-zxx-schedule-v5');a=p.parse_args()
    root=ROOT/'.cache/native-source-runtime'
    user=(root/'X2Lib/X2GUUser.cpp').read_bytes();raven=(root/'X2Lib/X2GURaven.cpp').read_bytes();userh=(root/'X2Lib/X2GUUser.h').read_bytes()
    for content,expected in [(user,PIN),(raven,RAVEN_PIN),(userh,USER_HEADER_PIN)]:
        if sha(content)!=expected:raise ValueError('Pinned source changed')
    fragments=[];bodies=[]
    for name,pattern in [('StateChange',rb'bool CX2GUUser::StateChange\( int state, bool bDirectChange \)'),
                         ('DoStateEndStartFuture',rb'void CX2GUUser::DoStateEndStartFuture\(\)'),
                         ('DoStateEndStart',rb'void CX2GUUser::DoStateEndStart\(\)'),
                         ('DoFrameMoveFuture',rb'void CX2GUUser::DoFrameMoveFuture\(\)')]:
        body,first,last=fragment(user,pattern);bodies.append(body)
        fragments.append({'file':'X2Lib/X2GUUser.cpp','method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True})
    names=[n+'_'+phase for n in STATES for phase in ['StateStart','StateEnd','EventProcess']]
    for name in names:
        body,first,last=method(raven,name);bodies.append(body)
        fragments.append({'file':'X2Lib/X2GURaven.cpp','method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True})
    def lines(first,last,purpose):
        body=b''.join(user.splitlines(keepends=True)[first-1:last]);fragments.append({'file':'X2Lib/X2GUUser.cpp','firstLine':first,'lastLine':last,'purpose':purpose,'sha256':sha(body),'unchanged':True});return body
    speed=lines(14892,14924,'CommonFuture pre-advance SPEED_TIME');friction=lines(19964,19980,'Physic active horizontal friction')
    gravity=lines(20064,20106,'Physic gravity');passive=lines(15180,15183,'CommonFuture post-physics passive restoration')
    macro_body,first,last=macro(userh,'ELSE_IF_ASDC_PRESSED_AFTER')
    fragments.append({'file':'X2Lib/X2GUUser.h','macro':'ELSE_IF_ASDC_PRESSED_AFTER','firstLine':first,'lastLine':last,'sha256':sha(macro_body),'unchanged':True})
    header=SCHEDULE_HEADER.replace('using DWORD=unsigned long;',PRELUDE+'\nusing DWORD=unsigned long;')
    header=header.replace('struct Frame {Sync syncData;', 'struct Frame {struct{bool bEventFlagList[1]={false};bool bLandConnect=false;}stateParam;Sync syncData;')
    header=header.replace('StateEndFuture,StateStartFuture,OnFrameMoveFuture,OnEventProcess;', 'StateEndFuture,StateStartFuture,OnFrameMoveFuture,OnEventProcess,StateStart,StateEnd;')
    header=header.replace('StateData m_FutureStateData;', 'StateData m_FutureStateData,m_NowStateData;')
    header=header.replace(' void CommonStateEndFuture(){++ends;}void CommonStateStartFuture(){++starts;animationTime=0;}\n void CommonFrameMoveFuture(){++moves;animationTime+=1.f/60.f;}', ' void CommonStateEndFuture(){++ends;}\n'+EXTRA_FIELDS)
    subclass='struct CX2GURaven:CX2GUUser{'+''.join('void '+n+'();' for n in names)+'};\n'
    target_path=ROOT/'.cache/vc/raven-declarations.json';target=json.loads(target_path.read_text('utf8'))
    clips_path=ROOT/'contracts/vc-assets-motion-index.json';clips=json.loads(clips_path.read_text('utf8'));by_name={c['name']:c for c in clips['clips']}
    setup=[];targets=[]
    for i,n in enumerate(STATES):
        raw=target['globals'][n];duration=by_name[raw['ANIM_NAME']]['durationSeconds']
        code=f'if(m_FrameDataFuture.syncData.nowState=={i}){{anim.period={duration:.12f}f;'
        for k,v in raw.items():
            if k.startswith('SPEED_TIME'):code+=f'm_vecSpeedFactor.push_back({{{{{v["1"]:.9f}f,{v["2"]:.9f}f,{v["3"]:.9f}f}},{v["4"]}}});'
        setup.append(code+'}');targets.append({'state':n,'raw':raw,'durationSeconds':duration})
    start='void CX2GUUser::CommonStateStartFuture(){++starts;anim.clock=anim.time=0;m_FrameDataFuture.stateParam.bEventFlagList[0]=false;m_vecSpeedFactor.clear();'+''.join(setup)+'}\n'
    future=b'void CX2GUUser::CommonFrameMoveFuture(){float fNowAnimTime=anim.time;\n'+speed+b'\nanim.advance();PhysicProcess();\n'+passive+b'\n}\n'
    physics=b'void CX2GUUser::PhysicProcess(){\n'+friction+b'\nfloat fBuoyancy=1.f;\n'+gravity+b'\nx+=m_PhysicParam.nowSpeed.x*m_fElapsedTime;y+=m_PhysicParam.nowSpeed.y*m_fElapsedTime;\n}\n'
    p=target['globals']['INIT_PHYSIC'];physics_setup=''.join(f'a.m_PhysicParam.{field}={p[key]:.9f}f;' for field,key in [('fGAccel','G_ACCEL'),('fReloadAccel','RELOAD_ACCEL'),('fMaxGSpeed','MAX_G_SPEED')])
    source=header.encode()+macro_body+subclass.encode()+start.encode()+future+physics+b'\n'.join(bodies)+MAIN.replace('TARGET_PHYSICS',physics_setup).encode()
    a.out.mkdir(parents=True,exist_ok=True);unit=a.out/'vc-zxx-schedule.cpp';unit.write_bytes(source);exe=a.out/'vc-zxx-schedule.exe'
    env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str((a.out/'zig-global').resolve()),ZIG_LOCAL_CACHE_DIR=str((a.out/'zig-local').resolve()))
    r=subprocess.run([str(a.compiler),'c++','-std=c++17','-O0','-ffp-contract=off','-Wno-invalid-utf8','-Wno-extra-tokens',str(unit),'-o',str(exe)],env=env,capture_output=True)
    if r.returncode:raise RuntimeError((r.stdout+r.stderr).decode(errors='replace'))
    rows=json.loads(subprocess.check_output([str(exe.resolve())]));native=[r for r in rows if r['mode']==0 and r['facing']==1];immediate=[r for r in rows if r['mode']==1 and r['facing']==1]
    summary={'maxHorizontalDifference':max(abs(n['x']-h['x']) for n,h in zip(native,immediate)),
             'maxVerticalDifference':max(abs(n['y']-h['y']) for n,h in zip(native,immediate)),
             'firstNativeZxxFrame':next(r['frame'] for r in native if r['state']==1),
             'firstImmediateZxxFrame':next(r['frame'] for r in immediate if r['state']==1)}
    result={'schema':'vc-zxx-schedule-source-v5','evidenceClass':'bounded-original-dispatch-and-physics-execution','targetClientMeasured':False,
        'sourceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','files':{'X2Lib/X2GUUser.cpp':sha(user),'X2Lib/X2GURaven.cpp':sha(raven),'X2Lib/X2GUUser.h':sha(userh)},
        'fragments':fragments,'targetDeclarationSha256':sha(target_path.read_bytes()),'targets':targets,'unitSha256':sha(source),'compilerSha256':sha(a.compiler.read_bytes()),
        'modes':['source-deferred-request-empty-backlog-Now','immediate-event-boundary-start-analogue'],
        'boundaries':['Starts in settled airborne ZX with vx=750, vy=-100 and gravity disabled; fresh X on frame 4.',
          'Whole original four dispatch methods, six Raven methods and original speed/friction/gravity/passive slices compile unchanged.',
          'CommonStartFuture is target-only table adapter, CommonStart/CommonEnd/CommonEvent are no-op boundaries; no other gameplay input.',
          'Empty-backlog local Push/Pop and a double scalar controller at 1.4 speed / 60 Hz are explicit adapters; no original client, D3DX, network queue, collision, root pose or rendering.',
          'Immediate mode uses the same compiled functions but applies the request after Event in that packet; it characterizes phase difference and is not product-generated expected output.'],
        'summary':summary,'cases':rows}
    output=ROOT/'contracts/vc-zxx-schedule-source-v5.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'cases':len(rows),'summary':summary,'output':str(output)}))

if __name__=='__main__':main()
