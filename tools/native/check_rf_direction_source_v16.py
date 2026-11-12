"""Compile selected unchanged fixed-V5 direction consumers as an isolated probe.

This does not replace a published module or establish target2016 equivalence.
Original method bytes stay in the task's ignored output; only their hashes are
checked in. All state/line/skill storage below is an explicit probe boundary.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
HASHES = {
    'X2Lib/X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'X2Lib/X2GUUser.cpp': 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
    'X2Lib/X2GUUser.h': 'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc',
}
METHODS = {
    'X2Lib/X2GURaven.cpp': ['RSI_DASH_EventProcess', 'RSI_DASH_END_EventProcess',
        'RSI_DASH_JUMP_EventProcess', 'RSI_JUMP_UP_EventProcess', 'RSI_JUMP_DOWN_EventProcess'],
    'X2Lib/X2GUUser.cpp': ['JumpFrameMoveFuture', 'DashFrameMoveFuture'],
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def method(data, name):
    marker = ('::' + name + '()').encode()
    if data.count(marker) != 1:
        raise ValueError('Missing or ambiguous pinned method: ' + name)
    start = data.index(marker)
    start = data.rfind(b'\n', 0, start) + 1
    brace = data.index(b'{', start)
    depth = 1
    end = brace + 1
    while depth and end < len(data):
        depth += (data[end] == 123) - (data[end] == 125)
        end += 1
    if depth:
        raise ValueError('Truncated pinned method: ' + name)
    return data[start:end], data[:start].count(b'\n') + 1, data[:end].count(b'\n') + 1

HEADER = r'''
#include <cstdio>
#include <initializer_list>
#define NEW_SKILL_TREE
#define LINE_RADIUS 30.f
enum {USI_DASH=1,USI_WALK,USI_WAIT,USI_JUMP_UP,USI_JUMP_DOWN,USI_DASH_END,
 USI_JUMP_READY,USI_DASH_JUMP,USI_DASH_JUMP_LANDING,USI_JUMP_LANDING,
 RSI_COMBO_Z,RSI_COMBO_X,RSI_DASH_COMBO_Z,RSI_DASH_COMBO_X,
 RSI_JUMP_COMBO_Z,RSI_JUMP_COMBO_X,RSI_DASH_JUMP_COMBO_Z,RSI_DASH_JUMP_COMBO_X,
 RSI_DASH_JUMP_POWER_LANDING,USI_HYPER_MODE};
struct CX2SkillTree {enum{ASUT_AIR};};
struct Vec {float x=0,y=0,z=0;};
struct Input {bool pureLeft=false,pureRight=false,pureUp=false,pureDown=false,
 pureDoubleRight=false,pureDoubleLeft=false,oneLeft=false,oneRight=false,
 oneUp=false,oneDown=false,oneX=false,oneZ=false,oneLCtr=false;};
struct Frame {struct {bool bIsRight=true;Vec position;int m_HyperModeCount=0,lastTouchLineIndex=0;} syncData;
 struct {Vec landPosition;int lastTouchLineIndex=0;} unitCondition;
 struct {bool bEventFlagList[1]={false};} stateParam;};
struct Physics {Vec nowSpeed;float fGAccel=4000,fMaxGSpeed=-2000;};
struct Anim {float time=0,period=1;bool end=false;
 bool IsAnimationEnd(){return end;}float GetNowAnimationTime(){return time;}
 float GetMaxAnimationTime(){return period;}};
struct Map {bool CanDown(Vec,float,Vec*,int*){return false;}};
struct World {Map map;Map* GetLineMap(){return &map;}};
struct Game {World world;World* GetWorld(){return &world;}} game;
Game* g_pX2Game=&game;
struct CX2GUUser {
 Input m_InputData,m_BeforeInputData;Frame m_FrameDataNow,m_FrameDataFuture;
 Physics m_PhysicParam;Anim anim;Anim* m_pXSkinAnimFuture=&anim;
 float m_fElapsedTime=1.f/60;bool grounded=false;int requested=0;
 bool IsOnSomethingFuture(){return grounded;}bool GetEnableDash(){return true;}
 float GetWalkSpeed(){return 575.f;}float GetDashSpeed(){return 833.75f;}
 float GetJumpSpeed(){return 1657.5f;}float GetDashJumpSpeed(){return 2431.f;}
 bool SpecialAttackEventProcess(int=0){return false;}
 bool IsThereEffectiveBlackHoleDamageEffect(){return false;}
 float GetRemainHyperModeTime(){return 0;}
 bool GetCanChangeHyperModeInHyperModeState(){return false;}
 void StateChange(int state){requested=state;}
 void StateChangeDashIfPossible(){requested=USI_DASH;}
 void CommonFrameMoveFuture(){}void CommonEventProcess(){}
 void JumpFrameMoveFuture();void DashFrameMoveFuture();
};
struct CX2GURaven:CX2GUUser {
 bool m_bReAttackZ1Right=true,m_bDownForce=false;
 float m_fReAttackZ1Time=0,m_fReDashJumpXTime=0;
 void RSI_DASH_EventProcess();void RSI_DASH_END_EventProcess();
 void RSI_DASH_JUMP_EventProcess();void RSI_JUMP_UP_EventProcess();
 void RSI_JUMP_DOWN_EventProcess();
 void ProbeBackward(float threshold);
};
'''
MAIN = r'''
void show(const char* name,int facing,CX2GURaven& a){
 std::printf("{\"case\":\"%s\",\"facing\":%d,\"requested\":%d,\"afterFacing\":%d,\"vy\":%.9g,\"vx\":%.9g,\"forcedDown\":%s}",
 name,facing,a.requested,a.m_FrameDataFuture.syncData.bIsRight?1:-1,
 a.m_PhysicParam.nowSpeed.y,a.m_PhysicParam.nowSpeed.x,a.m_bDownForce?"true":"false");
}
int main(){
 bool comma=false;std::puts("[");
 for(int facing:{-1,1})for(int c=0;c<12;c++){
  CX2GURaven a;a.m_FrameDataFuture.syncData.bIsRight=facing==1;
  a.m_FrameDataNow.syncData.bIsRight=facing==1;
  a.m_bReAttackZ1Right=facing==1;const char* name="";
  if(c==0){name="dash-opposite";a.grounded=true;a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.RSI_DASH_EventProcess();}
  if(c==1){name="dash-end-fresh-original-direction";a.grounded=true;a.m_InputData.pureLeft=facing==-1;a.m_InputData.pureRight=facing==1;a.m_InputData.oneLeft=facing==-1;a.m_InputData.oneRight=facing==1;a.RSI_DASH_END_EventProcess();}
  if(c==2){name="dash-end-opposite";a.grounded=true;a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.RSI_DASH_END_EventProcess();}
  if(c==3){name="jump-up-touched-floor-z";a.grounded=true;a.m_InputData.oneZ=true;a.RSI_JUMP_UP_EventProcess();}
  if(c==4){name="jump-down-touched-floor-z";a.grounded=true;a.m_InputData.oneZ=true;a.RSI_JUMP_DOWN_EventProcess();}
  if(c==5){name="dash-jump-opposite-and-down";a.m_PhysicParam.nowSpeed.y=2000;a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.m_InputData.oneDown=true;a.RSI_DASH_JUMP_EventProcess();}
  if(c==6){name="dash-jump-opposite-down-and-z";a.m_PhysicParam.nowSpeed.y=2000;a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.m_InputData.oneDown=a.m_InputData.oneZ=true;a.RSI_DASH_JUMP_EventProcess();}
  if(c==7){name="jump-future-opposite";a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.JumpFrameMoveFuture();}
  if(c==8){name="dash-jump-touched-floor-z";a.grounded=a.m_bDownForce=true;a.m_InputData.oneZ=true;a.RSI_DASH_JUMP_EventProcess();}
  if(c>=9){name=c==9?"backward-before":c==10?"backward-equal":"backward-after";a.anim.time=c==9?.349f:c==10?.35f:.350001f;a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.ProbeBackward(.35f);}
  if(comma)std::puts(",");comma=true;show(name,facing,a);
 }
 std::puts("\n]");
}
'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-root', type=Path, default=Path('.cache/native-source-runtime'))
    ap.add_argument('--out', type=Path, default=Path('artifacts/proof-input-v16/source'))
    ap.add_argument('--compiler', type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    files = {}
    blobs = {}
    for rel, expected in HASHES.items():
        data = (args.source_root / rel).read_bytes()
        if digest(data) != expected:
            raise ValueError('Pinned source changed: ' + rel)
        blobs[rel] = data
        files[rel] = {'sha256': digest(data), 'bytes': len(data)}
    fragments = []
    bodies = []
    for rel, names in METHODS.items():
        for name in names:
            body, first, last = method(blobs[rel], name)
            bodies.append(body)
            fragments.append({'file': rel, 'method': name, 'firstLine': first, 'lastLine': last,
                'sha256': digest(body), 'bytes': len(body), 'bodyUnchanged': True})
    # Preserve the enabled source's original hyper macro, including its guards.
    header_lines = blobs['X2Lib/X2GUUser.h'].splitlines()
    macro_start = next(i for i, line in enumerate(header_lines) if line.startswith(b'#define ELSE_IF_CAN_HYPER_MODE_THEN_STATE_CHANGE'))
    macro_end = macro_start
    while header_lines[macro_end].endswith(b'\\'):
        macro_end += 1
    hyper = b'\n'.join(header_lines[macro_start:macro_end + 1])
    macro_start = next(i for i, line in enumerate(header_lines) if line.startswith(b'#define BWALK_CANCEL_AFTER('))
    macro_end = macro_start
    while header_lines[macro_end].endswith(b'\\'):
        macro_end += 1
    backward = b'\n'.join(header_lines[macro_start:macro_end + 1])
    fragments.append({'file': 'X2Lib/X2GUUser.h', 'method': 'BWALK_CANCEL_AFTER',
        'firstLine': macro_start + 1, 'lastLine': macro_end + 1, 'sha256': digest(backward),
        'bytes': len(backward), 'bodyUnchanged': True, 'lineEnding': 'splitlines joined with LF'})
    probe = b'\nvoid CX2GURaven::ProbeBackward(float threshold){if(false){} BWALK_CANCEL_AFTER(threshold)}\n'
    cpp = HEADER.encode() + b'\n' + hyper + b'\n' + backward + b'\n' + b'\n'.join(bodies) + probe + MAIN.encode()
    source = args.out / 'direction-consumers.cpp'
    source.write_bytes(cpp)
    exe = args.out / 'direction-consumers.exe'
    env = dict(os.environ)
    env['ZIG_GLOBAL_CACHE_DIR'] = str((args.out / 'zig-global').resolve())
    env['ZIG_LOCAL_CACHE_DIR'] = str((args.out / 'zig-local').resolve())
    cmd = [str(args.compiler), 'c++', '-std=c++17', '-O0', str(source), '-o', str(exe)]
    build = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if build.returncode:
        raise RuntimeError(build.stdout + build.stderr)
    cases = json.loads(subprocess.check_output([str(exe.resolve())], text=True))
    expected = {0: (6, None), 1: (1, None), 2: (2, None), 3: (15, None),
        4: (10, None), 5: (4, -2000), 6: (17, -2000), 7: (0, None), 8: (19, None),
        9: (0, None), 10: (0, None), 11: (3, None)}
    for i, case in enumerate(cases):
        state, vy = expected[i % 12]
        assert case['requested'] == state, case
        assert case['afterFacing'] == (-case['facing'] if i % 12 == 7 else case['facing']), case
        if vy is not None:
            assert case['vy'] == vy, case
    result = {'schema': 'rf-direction-consumer-source-probe-v16', 'sourceCommit': COMMIT,
        'evidenceClass': 'compiled-fixed-V5-reference-not2016', 'targetClientMeasured': False,
        'publishedNativeModulesModified': False, 'files': files, 'fragments': fragments,
        'compilerSha256': digest(args.compiler.read_bytes()), 'unitSha256': digest(cpp),
        'hostBoundary': 'Explicit input/frame/physics storage; StateChange records pending state; fixed test speeds; line CanDown=false; skill/hyper disabled; Common callbacks are counters/no-ops. Whole Main/Future/Now and target2016 client are not executed.',
        'macroSelection': {'NEW_SKILL_TREE': True, 'RIDING_SYSTEM': False, 'WALL_JUMP_TEST': False,
            'SERV_RAVEN_VETERAN_COMMANDER': False}, 'cases': cases, 'assertionsPassed': len(cases)}
    (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'out': str(args.out / 'result.json'), 'cases': len(cases), 'targetClientMeasured': False}))

if __name__ == '__main__':
    main()
