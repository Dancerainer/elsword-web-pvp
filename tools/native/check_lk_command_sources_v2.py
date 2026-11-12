"""Compile hash-pinned, unchanged SwordMan methods independently of the product.

The executable is a source probe, not the 2016 client and not a game runtime.
All original third-party method bytes and compiler output remain ignored.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
HASHES = {'X2GUElsword_SwordMan.cpp':'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d',
          'X2GUUser.h':'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc'}
METHODS = ['ComboZ1EventProcess','ComboZ2EventProcess','ComboZ3EventProcess','ComboX1EventProcess','ComboX2EventProcess',
           'ESSI_KNIGHT_DASH_COMBO_Z2_EventProcess','ESSI_KNIGHT_DASH_JUMP_COMBO_X2_EventProcess',
           'JumpAttackZEventProcess','JumpAttackXEventProcess','DashComboZ1EventProcess']
MACROS = ['CANCEL_COMBO_ON_DIRECTION_CHANGE','ELSE_IF_STATE_CHANGE_ON_','ELSE_IF_STATE_CHANGE_ON_EX_',
          'ELSE_IF_KEY_PRESSED_AT_SKIP_POINT_C','SKILL_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER']
def sha(data): return hashlib.sha256(data).hexdigest()
def method(data,name):
    marker=('::'+name+'()').encode()
    if data.count(marker)!=1: raise ValueError('Ambiguous source method '+name)
    first=data.rfind(b'\n',0,data.index(marker))+1
    brace=data.index(b'{',first);last=brace+1;depth=1
    while depth:
        depth+=(data[last]==123)-(data[last]==125);last+=1
    return data[first:last],data[:first].count(b'\n')+1,data[:last].count(b'\n')+1
def macro(data,name):
    lines=data.splitlines(keepends=True)
    first=next(i for i,line in enumerate(lines) if re.match(rb'\s*#define\s+'+name.encode()+rb'\b',line))
    last=first
    while lines[last].rstrip().endswith(b'\\'):last+=1
    return b''.join(lines[first:last+1]),first+1,last+1

HEADER=r'''
#include <cstdio>
#define ELSWORD_SECOND_CLASS_CHANGE
#define ELSWORD_SHEATH_KNIGHT
#define SERV_ELSWORD_INFINITY_SWORD
#define SKILL_CANCEL_BY_HYPER_MODE
#define BALANCE_RUNE_SLAYER_20130214
#define LINE_RADIUS 30.f
struct Anim {float time=0,period=1;bool ended=false;float GetNowAnimationTime(){return time;}bool IsAnimationEnd(){return ended;}float GetMaxAnimationTime(){return period;}};
struct Frame {struct {bool bEventFlagList[3]={false,false,false};}stateParam;struct {bool bIsRight=true;struct{float y=0;}position;int m_HyperModeCount=0;}syncData;};
struct Input {bool pureLeft=false,pureRight=false,pureUp=false,pureDown=false,pureDoubleLeft=false,pureDoubleRight=false,
 oneZ=false,oneX=false,pureZ=false,pureX=false,pureA=false,pureS=false,pureD=false,pureC=false,pureQ=false,pureW=false,pureE=false,pureR=false,oneLCtr=false;};
'''
CLASS=r'''
class CX2GUElsword_SwordMan {public:
 Frame m_FrameDataFuture;Input m_InputData;Anim anim;Anim* m_pXSkinAnimFuture=&anim;CX2Unit unit;
 struct Window {float keyInputStart=0,keyInputEnd=100,stateChange=.33f;}m_fEventTime[3];
 bool grounded=true,m_bReAttackZ1Right=true;float m_fCanNotAttackTime=0,m_fReAttackZ1Time=0,m_fCanNotJumpTime=0;int requested=0;
 bool IsOnSomethingFuture(){return grounded;}void StateChange(int id){requested=id;}void StateChangeDashIfPossible(){requested=DASH_REQUEST;}
 void CommonEventProcess(){}bool SpecialAttackEventProcess(){return false;}bool IsThereEffectiveBlackHoleDamageEffect(){return false;}
 float GetRemainHyperModeTime(){return 0;}bool GetCanChangeHyperModeInHyperModeState(){return false;}int GetHypetMpdeStateID(){return AWAKEN_REQUEST;}
 CX2Unit* GetUnit(){return &unit;}
 void ProbeWindow(){if(false){} ELSE_IF_STATE_CHANGE_ON_EX_(0,m_fEventTime[0].keyInputStart,m_fEventTime[0].keyInputEnd,m_fEventTime[0].stateChange,m_InputData.oneZ,ESSI_COMBO_Z4)}
 void ProbeBackward(){if(false){} BWALK_CANCEL_AFTER(.288f)}
'''

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--sword-source',type=Path,required=True)
    parser.add_argument('--user-header',type=Path,required=True);parser.add_argument('--compiler',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True);parser.add_argument('--report',type=Path,required=True);a=parser.parse_args()
    source=a.sword_source.read_bytes();header=a.user_header.read_bytes()
    for name,data in [('X2GUElsword_SwordMan.cpp',source),('X2GUUser.h',header)]:
        if sha(data)!=HASHES[name]:raise ValueError('Pinned source hash mismatch '+name)
    fragments=[];bodies=[];macros=[]
    for name in METHODS:
        raw,first,last=method(source,name);bodies.append(raw)
        fragments.append({'file':'X2GUElsword_SwordMan.cpp','name':name,'startLine':first,'endLine':last,'sha256':sha(raw),'unchanged':True})
    for name in MACROS:
        raw,first,last=macro(header,name);macros.append(raw)
        fragments.append({'file':'X2GUUser.h','name':name,'startLine':first,'endLine':last,'sha256':sha(raw),'unchanged':True})
    ids=sorted(set(re.findall(rb'\b(?:ESSI|USI)_[A-Za-z0-9_]+\b',b'\n'.join(bodies+macros))))
    ids=[v.decode() for v in ids]+['DASH_REQUEST','AWAKEN_REQUEST'];idmap={v:i+1 for i,v in enumerate(ids)}
    classes=sorted(set(re.findall(rb'CX2Unit::(UC_[A-Z_]+)',b'\n'.join(bodies))))
    enum='enum{'+','.join(f'{name}={i}' for name,i in idmap.items())+'};\n'
    unit='struct CX2Unit {enum {'+','.join(f'{name.decode()}={100 if name==b"UC_ELSWORD_LORD_KNIGHT" else -i-1}' for i,name in enumerate(classes))+'};int GetClass(){return 100;}};\n'
    main=r'''
void show(const char* name,CX2GUElsword_SwordMan&a){std::printf("{\"name\":\"%s\",\"time\":%.9g,\"requested\":%d,\"flags\":%d,\"attackLock\":%.9g,\"jumpLock\":%.9g}",name,a.anim.time,a.requested,
 (a.m_FrameDataFuture.stateParam.bEventFlagList[0]?1:0)+(a.m_FrameDataFuture.stateParam.bEventFlagList[1]?2:0)+(a.m_FrameDataFuture.stateParam.bEventFlagList[2]?4:0),a.m_fCanNotAttackTime,a.m_fCanNotJumpTime);}
int main(){std::puts("[");bool comma=false;for(int c=0;c<20;c++){
 CX2GUElsword_SwordMan a;const char* name="";
 if(c==0){name="z1-before";a.anim.time=.2f;a.m_InputData.oneZ=true;a.ComboZ1EventProcess();}
 if(c==1){name="z1-change-equal";a.anim.time=.27f;a.m_FrameDataFuture.stateParam.bEventFlagList[0]=true;a.ComboZ1EventProcess();}
 if(c==2){name="z1-change-after";a.anim.time=.270001f;a.m_FrameDataFuture.stateParam.bEventFlagList[0]=true;a.ComboZ1EventProcess();}
 if(c==3){name="z1-late-press";a.anim.time=.35f;a.m_InputData.oneZ=true;a.ComboZ1EventProcess();}
 if(c==4){name="z1-after-window";a.anim.time=.41f;a.m_InputData.oneZ=true;a.ComboZ1EventProcess();}
 if(c==5){name="z2-buffer";a.anim.time=.3f;a.m_InputData.oneZ=true;a.ComboZ2EventProcess();}
 if(c==6){name="z2-change";a.anim.time=.367f;a.m_FrameDataFuture.stateParam.bEventFlagList[0]=true;a.ComboZ2EventProcess();}
 if(c==7){name="zzz-forward";a.anim.time=.25f;a.m_InputData.oneZ=a.m_InputData.pureRight=true;a.ComboZ3EventProcess();a.anim.time=.334f;a.m_InputData.oneZ=false;a.ComboZ3EventProcess();}
 if(c==8){name="xx-lk-xxx";a.anim.time=.55f;a.m_fEventTime[2]={.2f,.8f,.5f};a.m_InputData.oneX=true;a.ComboX2EventProcess();a.m_InputData.oneX=false;a.ComboX2EventProcess();}
 if(c==9){name="xx-z";a.anim.time=.55f;a.m_fEventTime[1]={.2f,.8f,.5f};a.m_InputData.oneZ=true;a.ComboX2EventProcess();a.m_InputData.oneZ=false;a.ComboX2EventProcess();}
 if(c>=10&&c<=13){name=c==10?"macro-before":c==11?"macro-end-exclusive":c==12?"macro-change-equal":"macro-change-after";a.m_fEventTime[0]={.2f,.5f,.33f};a.anim.time=c==10?.1999f:c==11?.5f:c==12?.33f:.330001f;a.m_InputData.oneZ=c<12;a.m_FrameDataFuture.stateParam.bEventFlagList[0]=c>=12;a.ProbeWindow();}
 if(c==14||c==15){name=c==14?"backward-equal":"backward-after";a.anim.time=c==14?.288f:.288001f;a.m_InputData.pureLeft=true;a.ProbeBackward();}
 if(c==16||c==17){name=c==16?"air-xx-to-x":"air-xx-to-z";a.grounded=true;a.m_InputData.oneX=c==16;a.m_InputData.oneZ=c==17;a.ESSI_KNIGHT_DASH_JUMP_COMBO_X2_EventProcess();}
 if(c==18||c==19){name=c==18?"dash-z-skip-equal":"dash-z-skip-after";a.anim.time=c==18?.9f:.900001f;a.m_InputData.pureRight=true;a.DashComboZ1EventProcess();}
 if(comma)std::puts(",");comma=true;show(name,a);
 }std::puts("\n]");}
'''
    cpp=HEADER.encode()+enum.encode()+unit.encode()+b'\n'.join(macros)+CLASS.encode()+''.join(f'void {name}();\n' for name in METHODS).encode()+b'};\n'+b'\n'.join(bodies)+main.encode()
    a.out.mkdir(parents=True,exist_ok=True);cpp_path=a.out/'lk-original-command-probe.cpp';cpp_path.write_bytes(cpp)
    executable=a.out/'lk-original-command-probe.exe';env=dict(os.environ)
    env['ZIG_LOCAL_CACHE_DIR']=str((a.out/'zig-local').resolve());env['ZIG_GLOBAL_CACHE_DIR']=str((a.out/'zig-global').resolve())
    command=[str(a.compiler),'c++','-std=c++17','-O0','-ffp-contract=off','-Wno-invalid-utf8','-Wno-extra-tokens',str(cpp_path),'-o',str(executable)]
    built=subprocess.run(command,capture_output=True,text=True,env=env)
    if built.returncode:raise RuntimeError(built.stdout+built.stderr)
    cases=json.loads(subprocess.check_output([str(executable.resolve())],text=True))
    expect=[(None,1),(None,1),('ESSI_COMBO_Z2',0),('ESSI_COMBO_Z2',0),(None,0),(None,1),('ESSI_COMBO_Z3',0),
      ('ESSI_ELK_ZZZfrontZ',0),('ESSI_ELK_XXX',0),('ESSI_COMBO_X3a',0),(None,0),(None,0),(None,1),('ESSI_COMBO_Z4',0),
      (None,0),('USI_WAIT',0),('ESSI_DASH_JUMP_COMBO_X3',1),('ESSI_COMBO_Z1',2),(None,0),('USI_WAIT',0)]
    for case,(state,flags) in zip(cases,expect):
        assert case['requested']==(idmap[state] if state else 0),case
        assert case['flags']==flags,case
        case['requestedState']=state
    assert cases[-2]['attackLock']==0 and abs(cases[-1]['attackLock']-.1)<1e-7
    record={'schema':'lk-command-source-probe-v2','evidenceClass':'compiled-fixedV5-source-not-target2016','sourceCommit':COMMIT,
      'targetClientMeasured':False,'files':HASHES,'fragments':fragments,'compilerSha256':sha(a.compiler.read_bytes()),
      'unitSha256':sha(cpp),'cases':cases,'assertionsPassed':len(cases),'publishedNativeModulesModified':False,
      'boundaries':'Original methods/macros unchanged; input, frame state, animation time/end and LK100 class supplied. StateChange records request. Common callback and unavailable skill dispatcher are explicit no-op boundaries. This is an independent source oracle, not a 2016 client trace.'}
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'sourceProbeCases':len(cases),'report':str(a.report)}))
if __name__=='__main__':main()
