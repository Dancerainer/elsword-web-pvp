"""Independent fixed-V5 VC flow probe with actual CommonEvent and physics slices.

This is a bounded source execution, not a compiled client. It deliberately uses
the target declaration cache rather than reading the product profile. Original
C++ bytes stay ignored; committed results retain only source hashes and values.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
from check_lk_command_sources_v2 import method, macro
from check_vc_air_commands_v3 import STATES

ROOT = Path(__file__).resolve().parents[2]
FILES = {
    'X2Lib/X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'X2Lib/X2GUUser.cpp': 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
    'X2Lib/X2GUUser.h': 'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc',
    'X2Lib/X2GameUnit.h': '072559b9b5dbfcc8520906e1b775198470fc514635e766d50428ecaa9aa1cbb5',
    'KTDXLIB/KTDGXSkinAnim.cpp': '4ff5e681c5b63eb828d00e0e6fc848066af93ed39b0750615765da248911c76d',
}
def sha(data): return hashlib.sha256(data).hexdigest()

HEADER = r'''
#include <cstdio>
#include <vector>
#include <algorithm>
#define SERV_RAVEN_VETERAN_COMMANDER
#define X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE
#define ARA_CHANGE_CLASS_FIRST
#define WALL_JUMP_TEST
#define REMOVE_LAND_CONNECT_CONSTRAINTS
#define KTDXPROFILE()
using UINT=unsigned;
enum {USI_JUMP_LANDING=1,RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX,
 RVC_DASH_JUMP_COMBO_XX_START,RVC_DASH_JUMP_COMBO_XX_LOOP,RVC_DASH_JUMP_COMBO_XX_FINISH,
 SKILL_REQUEST,USI_PEPPER_RUN_JUMP_UP,USI_DIE_FRONT,USI_DIE_BACK};
namespace _CONST_RAVEN_ {const int MAX_DASH_JUMP_COMBO_XX_LOOP_COUNT=9;}
struct CX2SkillTree {enum{ASUT_AIR,ASUT_ANYTIME};};
struct V2{float x=0,y=0;}; struct V3{float x=0,y=0,z=0;};
struct Anim{float time=0,before=0,period=1;double clock=0,speed=1;bool ended=false;
 float GetNowAnimationTime(){return time;}bool IsAnimationEnd(){return ended;}
 bool EventTimerOneshot(float t){return before<t&&time>=t;}
 void advance(double dt){before=time;if(!ended){clock+=dt*speed;time=(float)clock;ended=time>period-std::max(period/10,.03f);}}
};
struct Input{bool oneX=false,oneZ=false,oneA=false,oneSpace=false,pureA=false,pureS=false,pureD=false,pureC=false,
 pureQ=false,pureW=false,pureE=false,pureR=false,pureRight=false,pureLeft=false,pureDown=false,
 pureUp=false,pureDoubleRight=false,pureDoubleLeft=false;};
struct Frame{struct{bool bEventFlagList[1]={false};bool bLandConnect=false;}stateParam;
 struct{bool bIsRight=true;float fNowHP=100;V3 position;}syncData;struct{bool bAttackerFront=true;}unitCondition;};
struct Physics{V2 nowSpeed,passiveSpeed{-1,-1};float fGAccel=4000,fReloadAccel=4000,fMaxGSpeed=-3000,fDownAccel=0,fWalkSpeed=575;
 float GetWalkSpeed(){return fWalkSpeed;}};
struct Tree{bool GetEnabledSkillSlotB(){return false;}};
struct UnitData{Tree m_UserSkillTree;};struct Unit{UnitData data;UnitData& GetUnitData(){return data;}};
struct Secret{template<class T>int GetTriggerSecretSkillState(T*){return 0;}};
struct CX2GUUser{Anim anim;Anim* m_pXSkinAnimFuture=&anim;Input m_InputData;Frame m_FrameDataFuture,m_FrameDataNow;
 Physics m_PhysicParam;bool grounded=false,m_bDisableGravity=false,m_bDisableGravityInScript=false,m_bRidingMachine=false;
 int requested=0,commonEvents=0;float m_fElapsedTime=1.f/60,m_fPepperRunTime=0;static constexpr float LINE_RADIUS=30;
 bool m_bSteppedJumpLinemap=false;V3 m_vAddJumpSpeed;Secret m_ComboAndSkillChainSystem;Unit unit;
 struct TIME_SPEED{V3 vSpeed;int iFlag;};std::vector<TIME_SPEED>m_vecSpeedFactor;
 float x=0,y=0;bool IsOnSomethingFuture(){return grounded;}void StateChange(int s){requested=s;}
 Unit* GetUnit(){return &unit;}void ToggleSkillSlotAB(){}void DetonationEventProcess(){}
 bool SpecialAttackEventProcess(int condition){if(condition!=CX2SkillTree::ASUT_AIR||!m_InputData.oneA)return false;requested=SKILL_REQUEST;return true;}
 void CommonEventProcess();void CommonFrameMoveFuture();void PhysicProcess();
};
struct CX2GURaven:CX2GUUser{bool canOverheat=true;int m_iRVCComboLoopCount=1;
 float m_fSkillCancelAfterFly=9999,m_fReAttackZ1Time=0,m_fReDashJumpXTime=0;
 bool _CanOverheat(){return canOverheat;}void CommonStateStart(){}void CommonStateEnd(){}
 void CommonEventProcess();void CommonFrameMoveFuture();
'''

MAIN = r'''
void future(CX2GURaven&a,int state){switch(state){FUTURE_CALLS default:a.CommonFrameMoveFuture();}}
void event(CX2GURaven&a,int state){switch(state){EVENT_CALLS}}
int main(){bool comma=false;puts("[");
for(int state=0;state<6;state++)for(int input=0;input<8;input++){
 CX2GURaven a;TARGET_PHYSICS_SETUP TARGET_SETUP
 a.m_PhysicParam.nowSpeed.x=750;a.m_PhysicParam.nowSpeed.y=-100;
 if(state==0)a.m_bDisableGravity=true;
 if(state==2){a.m_PhysicParam.nowSpeed.x=725;a.m_PhysicParam.nowSpeed.y=175;}
 if(state==3){a.m_PhysicParam.nowSpeed.x=0;a.m_PhysicParam.nowSpeed.y=200;}
 if(state==4){a.m_PhysicParam.nowSpeed.x=0;a.m_PhysicParam.nowSpeed.y=450;}
 if(state==5){a.m_PhysicParam.nowSpeed.x=0;a.m_PhysicParam.nowSpeed.y=300;}
 for(int frame=0;frame<90;frame++){
  a.requested=0;a.m_InputData={};
  a.m_InputData.pureRight=input==1||input==4;
  a.m_InputData.pureLeft=input==2;
  a.m_InputData.pureDown=input==3||input==4;
  a.m_InputData.pureDoubleRight=input==5;
  a.m_InputData.oneZ=input==6;
  a.m_InputData.oneA=a.m_InputData.pureA=input==7;
  future(a,state);event(a,state);
  if(comma)puts(",");comma=true;
  printf("{\"state\":%d,\"input\":%d,\"frame\":%d,\"time\":%.9g,\"ended\":%s,\"requested\":%d,\"flags\":%d,\"gravityDisabled\":%s,\"vx\":%.9g,\"vy\":%.9g,\"x\":%.9g,\"y\":%.9g}",
   state,input,frame,a.anim.time,a.anim.ended?"true":"false",a.requested,a.m_FrameDataFuture.stateParam.bEventFlagList[0]?1:0,
   a.m_bDisableGravity?"true":"false",a.m_PhysicParam.nowSpeed.x,a.m_PhysicParam.nowSpeed.y,a.x,a.y);
 }
}puts("\n]");}
'''

def main():
    p=argparse.ArgumentParser();p.add_argument('--compiler',type=Path,required=True)
    p.add_argument('--out',type=Path,default=ROOT/'runtime/vc-air-flow-v4');a=p.parse_args()
    data={name:(ROOT/'.cache/native-source-runtime'/name).read_bytes() for name in FILES}
    for name,expected in FILES.items():
        if sha(data[name])!=expected:raise ValueError('Pinned source changed: '+name)
    fragments=[]
    def take(file,name,compiled=True):
        content=data[file];class_name=Path(file).stem.replace('X2','CX2',1)
        match=re.search(rb'(?m)^(?:/\*virtual\*/\s*)?(?:void|bool) '+class_name.encode()+rb'::'+name.encode()+rb'\(\)',content)
        if not match:raise ValueError('Missing explicit method '+file+'/'+name)
        begin=match.start();end=content.index(b'{',begin)+1;depth=1
        # Ignore braces inside source comments; large Common methods contain
        # historical commented-out blocks with unbalanced braces.
        body_end=re.search(rb'(?m)^(?:/\*virtual\*/\s*)?(?:void|bool|float|int) '+class_name.encode()+rb'::',content[end:])
        if name in ('CommonStateStartFuture','DoFrameMoveFuture','DoStateEndStartFuture','DoStateEndStart') and body_end:
            end+=body_end.start()
        else:
            while depth:
                depth+=(content[end]==123)-(content[end]==125);end+=1
        body=content[begin:end];first=content[:begin].count(b'\n')+1;last=content[:end].count(b'\n')+1
        fragments.append({'file':file,'method':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True,'compiled':compiled})
        return body
    def lines(file,first,last,purpose,compiled=True):
        body=b''.join(data[file].splitlines(keepends=True)[first-1:last])
        fragments.append({'file':file,'firstLine':first,'lastLine':last,'purpose':purpose,'sha256':sha(body),'unchanged':True,'compiled':compiled})
        return body
    methods=[n+'_EventProcess' for n in STATES]+[STATES[i]+'_FrameMoveFuture' for i in (2,3,4,5)]
    bodies=[take('X2Lib/X2GURaven.cpp',n) for n in methods]
    # Whole CommonEvent, rather than the v3 no-op. Empty host boundaries below
    # are explicit for no secret chain, jump platform, death, grapple or slot B.
    common=take('X2Lib/X2GUUser.cpp','CommonEventProcess')
    raven_event=take('X2Lib/X2GURaven.cpp','CommonEventProcess')
    raven_future=take('X2Lib/X2GURaven.cpp','CommonFrameMoveFuture')
    speed=lines('X2Lib/X2GUUser.cpp',14892,14924,'CommonFuture target SPEED_TIME consumer')
    friction=lines('X2Lib/X2GUUser.cpp',19964,19980,'PhysicProcess active horizontal friction')
    gravity=lines('X2Lib/X2GUUser.cpp',20064,20106,'PhysicProcess gravity and independent down acceleration')
    passive=lines('X2Lib/X2GUUser.cpp',15180,15183,'CommonFuture passive velocity restoration after physics')
    for file,name in [('X2Lib/X2GUUser.cpp','CommonStateStartFuture'),('X2Lib/X2GUUser.cpp','DoFrameMoveFuture'),
                      ('X2Lib/X2GUUser.cpp','DoStateEndStartFuture'),('X2Lib/X2GUUser.cpp','DoStateEndStart')]:
        take(file,name,False) # Static full-method evidence; not all dependencies are compiled.
    for name in ['RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX_StateStart','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZX_StateEnd',
                 'RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX_StateStart','RSI_WEAPON_TAKER_DASH_JUMP_COMBO_ZXX_StateEnd']:
        take('X2Lib/X2GURaven.cpp',name,False)
    lines('X2Lib/X2GameUnit.h',1105,1127,'PhysicParam raw walk getter, unlike unit getter',False)
    lines('KTDXLIB/KTDGXSkinAnim.cpp',766,813,'Controller end/hold state; adapter advances time without D3DX',False)
    macros=[]
    for name in ['ELSE_IF_ASDC_PRESSED_AFTER','SKILL_CANCEL_AFTER_FLY']:
        body,first,last=macro(data['X2Lib/X2GUUser.h'],name);macros.append(body)
        fragments.append({'file':'X2Lib/X2GUUser.h','macro':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'unchanged':True})
    target_path=ROOT/'.cache/vc/raven-declarations.json';target=json.loads(target_path.read_text('utf8'))
    clips_path=ROOT/'contracts/vc-assets-motion-index.json';clips=json.loads(clips_path.read_text('utf8'))
    by_name={c['name']:c for c in clips['clips']};setup=[];targets=[]
    for i,n in enumerate(STATES):
        raw=target['globals'][n];clip=by_name[raw['ANIM_NAME']]
        skill=raw.get('SKILL_CANCEL_AFTER_FLY',raw.get('SKILL_CANCEL_AFTER',9999) if i==2 else 9999)
        code=f'if(state=={i}){{a.anim.period={clip["durationSeconds"]:.12f}f;a.anim.speed={(1.4 if raw.get("APPLY_ANIM_SPEED_BY_ITEM_ABILITY",1) else 1)*raw.get("ANIM_SPEED",1):.9f};a.m_fSkillCancelAfterFly={skill:.9f}f;'
        for k,v in raw.items():
            if k.startswith('SPEED_TIME'):
                code+=f'a.m_vecSpeedFactor.push_back({{{{{v["1"]:.9f}f,{v["2"]:.9f}f,{v["3"]:.9f}f}},{v["4"]}}});'
        setup.append(code+'}')
        targets.append({'state':n,'sourcePc':target['locations'][n],'raw':raw,'durationSeconds':clip['durationSeconds'],
                        'decodedKeysSha256':clip['decodedKeysSha256']})
    common_future=b'void CX2GUUser::CommonFrameMoveFuture(){float fNowAnimTime=anim.time;\n'+speed+b'\nanim.advance(1./60);PhysicProcess();\n'+passive+b'\n}\n'
    physics=b'void CX2GUUser::PhysicProcess(){\n'+friction+b'\nfloat fBuoyancy=1.f;\n'+gravity+b'\nx+=m_PhysicParam.nowSpeed.x*m_fElapsedTime;y+=m_PhysicParam.nowSpeed.y*m_fElapsedTime;\n}\n'
    source=HEADER.encode()+b'\n'.join(macros)+b'\n'+''.join('void '+n+'();\n' for n in methods).encode()+b'};\n'
    source+=common+raven_event+raven_future+common_future+physics+b'\n'.join(bodies)
    p=target['globals']['INIT_PHYSIC']
    physics_setup=''.join(f'a.m_PhysicParam.{field}={p[key]:.9f}f;' for field,key in [('fWalkSpeed','WALK_SPEED'),('fGAccel','G_ACCEL'),('fReloadAccel','RELOAD_ACCEL'),('fMaxGSpeed','MAX_G_SPEED')])
    source+=MAIN.replace('TARGET_PHYSICS_SETUP',physics_setup).replace('TARGET_SETUP',''.join(setup)).replace('FUTURE_CALLS',''.join(f'case {i}:a.{STATES[i]}_FrameMoveFuture();break;'for i in (2,3,4,5))).replace('EVENT_CALLS',''.join(f'case {i}:a.{n}_EventProcess();break;'for i,n in enumerate(STATES))).encode()
    a.out.mkdir(parents=True,exist_ok=True);unit=a.out/'vc-air-flow.cpp';unit.write_bytes(source);exe=a.out/'vc-air-flow.exe'
    env=dict(os.environ);env['ZIG_LOCAL_CACHE_DIR']=str(a.out/'zig-local');env['ZIG_GLOBAL_CACHE_DIR']=str(a.out/'zig-global')
    r=subprocess.run([str(a.compiler),'c++','-std=c++17','-O0','-ffp-contract=off','-Wno-invalid-utf8','-Wno-extra-tokens',str(unit),'-o',str(exe)],capture_output=True,text=True,env=env)
    if r.returncode:raise RuntimeError(r.stdout+r.stderr)
    cases=json.loads(subprocess.check_output([str(exe)],text=True))
    result={'schema':'vc-air-flow-source-v4','sourceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
            'targetClientMeasured':False,'evidenceClass':'bounded-fixedV5-callback-and-common-source-execution',
            'files':FILES,'fragments':fragments,'unitSha256':sha(source),'targetDeclarationSha256':sha(target_path.read_bytes()),
            'targetSource':target['source'],'targets':targets,'states':STATES,
            'inputs':['none','forward','backward','down','forward+down','double-forward','Z','air-skill'],
            'physics':{**p,'dt':1/60},
            'boundaries':['Whole original six EventProcess, four Future, Raven CommonFuture/CommonEvent and User CommonEvent run unchanged.',
              'CommonFuture speed and passive blocks and PhysicProcess friction/gravity blocks run unchanged in a bounded host.',
              'Actor start velocities are explicit target declarations; ZX DisableGravity comes from its original Start/End.',
              'Controller advance is an explicit double scalar clock cast to float getters, with target periods, speed 1.4 or declared item-speed exemption, and fixed default transition; D3DX and actual native clock rounding are not validated.',
              'No root translation, collision, live state transition, secret-skill chain, grapple, jumping platform, dead actor or slot-B toggle is simulated in this oracle.',
              'Each phase is kept running after requests to characterize every reachable input/time window; product integration tests separately follow transitions.',
              'X .433 remains a qualified target SKILL_CANCEL_AFTER to older FLY callback binding, not proven target native code.'],
            'cases':cases}
    output=ROOT/'contracts/vc-air-flow-source-v4.json';output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n','utf8')
    print(json.dumps({'cases':len(cases),'output':str(output)}))

if __name__=='__main__':main()
