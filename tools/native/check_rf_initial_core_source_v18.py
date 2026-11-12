"""Compile original V5 awakening methods and its exact Nasod level block.

The target2016 bead-to-stage consumer is unavailable. This is independently
compiled reference evidence, never an expectation exported from the JS core.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

from check_rf_awakening_source_v17 import HASHES, METHODS, HEADER, method, sha


def block(data, marker):
    needle = marker.encode()
    if data.count(needle) != 1:
        raise ValueError('Missing or ambiguous source block: ' + marker)
    start = data.rfind(b'\n', 0, data.index(needle)) + 1
    brace = data.index(b'{', start)
    end, depth = brace + 1, 1
    while depth and end < len(data):
        depth += (data[end] == 123) - (data[end] == 125)
        end += 1
    if depth:
        raise ValueError('Truncated source block')
    return data[start:end]


MAIN = r'''
int main(){std::puts("[");bool comma=false;
 for(int available=1;available<=3;available++)for(int initial: {0,20,37,40,60,80,100}){
  CX2GURaven a;a.m_fRageGauge=initial;a.m_FrameDataNow.syncData.m_HyperModeCount=available;
  a.HyperModeStart();CX2BuffFactor factor;factor.SetGameUnitChangeHyperModeBehavior(factor.factor,&a);
  CX2BuffChangeHyperModeBehaviorTemplet buff;buff.SetFactor(factor,&a,nullptr);a.ProbeLevel();
  if(comma)std::puts(",");comma=true;
  std::printf("{\"available\":%d,\"initialGauge\":%d,\"savedCount\":%d,\"beadsLeft\":%d,\"full\":%s,\"gauge\":%.9g,\"level\":%d,\"meshUpdates\":%d}",available,initial,a.m_iLastStateHyperModeCount,a.count,a.full?"true":"false",a.m_fRageGauge,a.m_iNaosdBallLv,a.meshUpdates);
 }
 std::puts("\n]");}
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-root', type=Path, default=Path('.cache/awakening-v17-source'))
    ap.add_argument('--out', type=Path, default=Path('artifacts/proof-awakening-core-v18/source'))
    ap.add_argument('--compiler', type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    blobs = {}
    for file, expected in HASHES.items():
        data = (args.source_root / file).read_bytes()
        if sha(data) != expected:
            raise ValueError('Pinned source changed: ' + file)
        blobs[file] = data
    bodies, consumers = [], []
    for file, names in METHODS.items():
        for name in names:
            body, first, last = method(blobs[file], name)
            bodies.append(body)
            consumers.append({'file': file, 'symbol': name, 'firstLine': first, 'lastLine': last,
                              'sha256': sha(body), 'bytes': len(body), 'compiled': True, 'bodyUnchanged': True})
    raven = blobs['X2Lib/X2GURaven.cpp']
    frames, first, last = method(raven, 'CX2GURaven::DoFrameMoveNasodBall()')
    levels = block(frames, 'if( GetParrying() == false )')
    assert b'(int)(m_fRageGauge / 20.f)' in levels and b'm_iNaosdBallLv > 5' in levels
    assert not any(word in levels for word in [b'HyperModeCount', b'FullHyper', b'LastState'])
    consumers.append({'file': 'X2Lib/X2GURaven.cpp', 'symbol': 'DoFrameMoveNasodBall/GetParrying-level-block',
                      'firstLine': first + frames[:frames.index(levels)].count(b'\n'),
                      'sha256': sha(levels), 'bytes': len(levels), 'compiled': True, 'bodyUnchanged': True,
                      'boundary': 'Exact conditional block only; unrelated whole-method mesh/physics dependencies not executed'})
    for name in ['CX2GURaven::CreateNasodBall()', 'CX2GURaven::DoHyper(', 'CX2GURaven::ApplyHyperModeBuff()']:
        body, first, last = method(raven, name)
        consumers.append({'file': 'X2Lib/X2GURaven.cpp', 'symbol': name, 'firstLine': first, 'lastLine': last,
                          'sha256': sha(body), 'bytes': len(body), 'compiled': False, 'bodyUnchanged': True})
        assert not re.search(rb'm_fRageGauge\s*(?:[+*/-]?=|\+\+|--)', body)
        if 'DoHyper' in name:
            assert re.search(rb'\{\s*\}', body), 'Acquired DoHyper must be empty'
    user_start, first, last = method(blobs['X2Lib/X2GUUser.cpp'], 'CX2GUUser::HyperModeBuffEffectStart()')
    assert b'RageGauge' not in user_start and b'Nasod' not in user_start
    consumers.append({'file': 'X2Lib/X2GUUser.cpp', 'symbol': 'CX2GUUser::HyperModeBuffEffectStart()',
                      'firstLine': first, 'lastLine': last, 'sha256': sha(user_start), 'bytes': len(user_start),
                      'compiled': False, 'bodyUnchanged': True})
    flame = block(raven, 'if( GetHyperModeCount() == 3 )')
    assert b'RageGauge' not in flame and b'NasodBall' not in flame and b'raven_powrUp_UI_01' in flame
    consumers.append({'file': 'X2Lib/X2GURaven.cpp', 'symbol': 'FrameMove/third-bead-UI-flame-block',
                      'firstLine': raven[:raven.index(flame)].count(b'\n') + 1, 'sha256': sha(flame),
                      'bytes': len(flame), 'compiled': False, 'bodyUnchanged': True})
    header = HEADER.replace('m_HyperModeCount=0;', 'm_HyperModeCount=0;int m_CannonBallCount=0;')
    header = header.replace('void PlaySound(const wchar_t*){}void ClearNasodBall()',
        'int meshUpdates=0;bool GetParrying()const{return false;}bool IsAttackNasodBall()const{return false;}\n'
        'void CreateNasodBall(){meshUpdates++;}void ChangePowerRateNasodBall(){}void ProbeLevel();\n'
        'void PlaySound(const wchar_t*){}void ClearNasodBall()')
    assert 'void ProbeLevel();' in header
    cpp = header.encode() + b'\n' + b'\n\n'.join(bodies) + b'\nvoid CX2GURaven::ProbeLevel() {\n' + levels + b'\n}\n' + MAIN.encode()
    source = args.out / 'initial-core-consumers.cpp'
    source.write_bytes(cpp)
    exe = args.out / 'initial-core-consumers.exe'
    env = dict(os.environ)
    env['ZIG_GLOBAL_CACHE_DIR'] = str((args.out / 'zig-global').resolve())
    env['ZIG_LOCAL_CACHE_DIR'] = str((args.out / 'zig-local').resolve())
    build = subprocess.run([str(args.compiler), 'c++', '-std=c++17', '-O0', str(source), '-o', str(exe)],
                           env=env, capture_output=True, text=True)
    if build.returncode:
        raise RuntimeError(build.stdout + build.stderr)
    cases = json.loads(subprocess.check_output([str(exe.resolve())], text=True))
    for row in cases:
        assert row['savedCount'] == row['available'] and row['beadsLeft'] == 0
        assert row['full'] == (row['available'] == 3)
        assert row['gauge'] == min(row['initialGauge'] + 40, 100)
        assert row['level'] == min(int(row['gauge'] / 20), 5) and row['meshUpdates'] == 1
    writes = []
    for number, line in enumerate(raven.splitlines(), 1):
        if re.search(rb'm_fRageGauge\s*(?:[+*/-]?=|\+\+|--)', line):
            writes.append({'line': number, 'text': line.decode('cp949', errors='replace'), 'sha256': sha(line)})
    result = {'schema': 'rf-initial-core-independent-source-v18', 'targetClientMeasured': False,
              'matching2016ConsumerVerified': False, 'referenceCommit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
              'evidenceClass': 'compiled-fixed-V5-unchanged-methods-and-exact-level-block',
              'files': {file: {'sha256': sha(data), 'bytes': len(data)} for file, data in blobs.items()},
              'consumers': consumers, 'compilerSha256': sha(args.compiler.read_bytes()), 'unitSha256': sha(cpp),
              'cases': cases, 'assertionsPassed': len(cases), 'allRavenGaugeWrites': writes,
              'emptyCoreInitialLevelsByBeadCount': [2, 2, 2], 'emptyCoreInitialFullModeByBeadCount': [False, False, True],
              'fullModeAudit': 'Buff SetFactor only sets full flag, Raven ApplyHyperModeBuff plays aura sound, Raven BuffStart creates electric aura then unconditionally adds40; CreateNasodBall reads current level and does not write gauge; DoHyper(bool) is empty; third-bead FrameMove branch only controls UI flame.',
              'hostBoundary': 'Original input, time, factor, BuffStart and exact local-owner nonparry level block execute. Equipment callbacks, effects, sounds and mesh rebuilds are counters; no target2016 client or entire reference client runs.',
              'conclusion': 'Acquired reference gives2/2/2 stages from zero gauge. No3-bead->5-stage branch occurs in this consumer chain. Target2016 initial stage semantics remain unverified.',
              'publishedNativeModulesModified': False}
    (args.out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'out': str(args.out / 'result.json'), 'cases': len(cases), 'initialLevels': [2, 2, 2], 'targetClientMeasured': False}))


if __name__ == '__main__':
    main()
