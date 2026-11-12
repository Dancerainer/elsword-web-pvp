"""Independent unchanged V5 free-air consumers; not a target2016 client run."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from check_rf_direction_source_v16 import COMMIT, HASHES, HEADER, digest, method

METHODS = {
    'X2Lib/X2GURaven.cpp': ['RSI_DASH_JUMP_FrameMoveFuture', 'RSI_DASH_JUMP_EventProcess',
        'RSI_JUMP_UP_EventProcess', 'RSI_JUMP_DOWN_EventProcess',
        'RSI_JUMP_COMBO_Z_FrameMoveFuture', 'RSI_JUMP_COMBO_Z_EventProcess'],
    'X2Lib/X2GUUser.cpp': ['JumpFrameMoveFuture'],
}
MAIN = r'''
int main(){
 bool comma=false;std::puts("[");
 for(int facing:{-1,1})for(int c=0;c<10;c++){
  CX2GURaven a;a.m_FrameDataFuture.syncData.bIsRight=facing==1;
  a.m_FrameDataNow.syncData.bIsRight=facing==1;
  a.m_PhysicParam.nowSpeed.y=2000;const char* name="";
  if(c==0){name="jump-future-overlap";a.m_InputData.pureRight=a.m_InputData.pureLeft=true;a.JumpFrameMoveFuture();}
  if(c==1){name="dash-jump-future-overlap";a.m_InputData.pureRight=a.m_InputData.pureLeft=true;a.RSI_DASH_JUMP_FrameMoveFuture();}
  if(c==2||c==3){name=c==2?"dash-jump-event-overlap-up":"dash-jump-event-overlap-down";a.m_InputData.pureRight=a.m_InputData.pureLeft=true;a.m_PhysicParam.nowSpeed.y=c==2?2000:-2000;a.RSI_DASH_JUMP_EventProcess();}
  if(c==4||c==5){name=c==4?"dash-jump-reverse-down":"dash-jump-reverse-down-z";a.m_InputData.pureLeft=facing==1;a.m_InputData.pureRight=facing==-1;a.m_InputData.oneDown=true;a.m_InputData.oneZ=c==5;a.RSI_DASH_JUMP_EventProcess();}
  if(c==6){name="jump-up-floor-z";a.grounded=true;a.m_InputData.oneZ=true;a.RSI_JUMP_UP_EventProcess();}
  if(c==7){name="jump-down-floor-z";a.grounded=true;a.m_InputData.oneZ=true;a.RSI_JUMP_DOWN_EventProcess();}
  if(c==8||c==9){name=c==8?"jump-z-floor":"jump-z-floor-down-flag";a.grounded=true;a.m_FrameDataFuture.stateParam.bEventFlagList[0]=c==9;a.RSI_JUMP_COMBO_Z_EventProcess();}
  if(comma)std::puts(",");comma=true;
  std::printf("{\"case\":\"%s\",\"facing\":%d,\"requested\":%d,\"afterFacing\":%d,\"vy\":%.9g,\"vx\":%.9g,\"forcedDown\":%s,\"cannotJump\":%.9g}",name,facing,a.requested,a.m_FrameDataFuture.syncData.bIsRight?1:-1,a.m_PhysicParam.nowSpeed.y,a.m_PhysicParam.nowSpeed.x,a.m_bDownForce?"true":"false",a.m_fCanNotJumpTime);
 }
 std::puts("\n]");
}
'''

def validate_cases(cases):
    if len(cases) != 20:
        raise ValueError('Expected all twenty independent cases')
    for case in cases:
        name, facing = case['case'], case['facing']
        expected_state = {'jump-future-overlap': 0, 'dash-jump-future-overlap': 0,
            'dash-jump-event-overlap-up': 4 if facing == -1 else 0,
            'dash-jump-event-overlap-down': 5 if facing == -1 else 0,
            'dash-jump-reverse-down': 4, 'dash-jump-reverse-down-z': 17,
            'jump-up-floor-z': 15, 'jump-down-floor-z': 10,
            'jump-z-floor': 10, 'jump-z-floor-down-flag': 10}[name]
        assert case['requested'] == expected_state, case
        assert case['afterFacing'] == (1 if name == 'jump-future-overlap' else facing), case
        if name == 'jump-future-overlap':
            assert case['vx'] == 575, case
        if name == 'dash-jump-future-overlap':
            assert abs(case['vx'] - 1334) < .001, case
        if name in ('dash-jump-reverse-down', 'dash-jump-reverse-down-z'):
            assert case['vy'] == -2000 and case['forcedDown'], case
        assert abs(case['cannotJump'] - (.2 if name == 'jump-z-floor-down-flag' else 0)) < 1e-7, case

def build_source(source_root):
    blobs = {}
    for rel, sha in HASHES.items():
        blobs[rel] = (source_root / rel).read_bytes()
        if digest(blobs[rel]) != sha:
            raise ValueError('Pinned source changed: ' + rel)
    fragments, bodies = [], []
    for rel, methods in METHODS.items():
        for name in methods:
            body, first, last = method(blobs[rel], name)
            bodies.append(body)
            fragments.append({'file': rel, 'method': name, 'firstLine': first, 'lastLine': last,
                'sha256': digest(body), 'bytes': len(body), 'bodyUnchanged': True})
    lines = blobs['X2Lib/X2GUUser.h'].splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(b'#define ELSE_IF_CAN_HYPER_MODE_THEN_STATE_CHANGE'))
    end = start
    while lines[end].endswith(b'\\'):
        end += 1
    header = HEADER.replace('float m_fElapsedTime=1.f/60;', 'float m_fCanNotJumpTime=0;float m_fElapsedTime=1.f/60;')
    header = header.replace('void ProbeBackward(float threshold);', 'void RSI_DASH_JUMP_FrameMoveFuture();void RSI_JUMP_COMBO_Z_FrameMoveFuture();void RSI_JUMP_COMBO_Z_EventProcess();')
    cpp = header.encode() + b'\n' + b'\n'.join(lines[start:end + 1]) + b'\n' + b'\n'.join(bodies) + MAIN.encode()
    return cpp, fragments, {rel: {'sha256': digest(data), 'bytes': len(data)} for rel, data in blobs.items()}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-root', type=Path, default=Path('.cache/native-source-runtime'))
    ap.add_argument('--out', type=Path, default=Path('artifacts/proof-jump-v18/source'))
    ap.add_argument('--compiler', type=Path, required=True)
    args = ap.parse_args()
    cpp, fragments, files = build_source(args.source_root)
    args.out.mkdir(parents=True, exist_ok=True)
    source, exe = args.out / 'jump-consumers.cpp', args.out / 'jump-consumers.exe'
    source.write_bytes(cpp)
    env = dict(os.environ)
    env['ZIG_GLOBAL_CACHE_DIR'] = str((args.out / 'zig-global').resolve())
    env['ZIG_LOCAL_CACHE_DIR'] = str((args.out / 'zig-local').resolve())
    build = subprocess.run([str(args.compiler), 'c++', '-std=c++17', '-O0', str(source), '-o', str(exe)], env=env, capture_output=True)
    if build.returncode:
        raise RuntimeError(build.stdout.decode(errors='replace') + build.stderr.decode(errors='replace'))
    cases = json.loads(subprocess.check_output([str(exe.resolve())], text=True))
    validate_cases(cases)
    result = {'schema': 'rf-jump-consumer-source-v18', 'sourceCommit': COMMIT,
        'evidenceClass': 'unchanged-fixed-V5-consumer-probe-not-target2016',
        'targetClientMeasured': False, 'publishedNativeModulesModified': False,
        'assertionsPassed': len(cases), 'files': files, 'fragments': fragments,
        'unitSha256': digest(cpp), 'compilerSha256': digest(args.compiler.read_bytes()),
        'hostBoundary': 'Explicit input/Now/Future storage and pending StateChange recorder; no original animation controller/physics/Main/device loop. CommonFuture/CommonEvent no-op, line CanDown false, skills/hyper disabled.',
        'cases': cases}
    (args.out / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'out': str(args.out / 'result.json'), 'cases': len(cases), 'targetClientMeasured': False}))

if __name__ == '__main__':
    main()
