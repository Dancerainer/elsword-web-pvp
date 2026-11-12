"""Compile one unchanged pinned V5 stat consumer with an explicit test host.

The host supplies FINAL option percentages, neutral passive/Buff factors, and
plain storage. It does not execute the Lua socket-point curve or the client.
Generated C++/EXE/measurements stay in this task's ignored output directory.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SOURCE_SHA256 = '729f86193d873c0d912c72e3898aed135e80f62ff035d6a0f2450a2b5ebd5f6b'
REFERENCE_COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'


def original_method(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('Pinned X2BuffTemplet.h source hash mismatch')
    start = source.index(b'template<typename Func>\r\nvoid CX2AdditionalStatByBuff::UpdateResultValueWithOptionData(')
    end = source.index(b'/** @function : CheckAndUpdateResultValueWithOptionData', start)
    method = source[start:end].rstrip()
    if not method.endswith(b'}'):
        raise ValueError('Source method boundary invalid')
    return method


HOST = r'''
#include <vector>
#include <algorithm>
#include <cstdio>
#include <cstring>
using std::max;
enum {BCT_SWAP_VALUE, BCT_FIX_VALUE, BCT_RELATION_VALUE, BCT_PERCENT, BCT_END};
class CX2AdditionalStatByBuff {
public:
    float basic=1, option=0, result=0;
    std::vector<int> m_vecStatFactorArray[BCT_END];
    float m_fArrayResultValueByChangeType[BCT_END]={0,0,0,1};
    float GetBasicStatValue() const {return basic;}
    float GetOptionValue() const {return option;}
    float GetPassiveSum() const {return 0;}
    float GetPassiveMultiple() const {return 1;}
    void SetResultValue(float value) {result=value;}
    void SetMustChangeResultValue(bool) {}
    template<typename Func>
    void UpdateResultValueWithOptionData(Func func_ptr,int iUserLevel_,float fModifier_);
};
'''
HARNESS = r'''
float FinalOptionPercent(float alreadyConverted,int) {return alreadyConverted;}
int main() {
    const float options[]={0,.2f,.21f,.3f};
    const float bases[]={1,500,725,1500,2200};
    for(float option:options) for(float base:bases) {
        CX2AdditionalStatByBuff stat;stat.basic=base;stat.option=option;
        stat.UpdateResultValueWithOptionData(&FinalOptionPercent,70,.5f);
        unsigned int bits;std::memcpy(&bits,&stat.result,sizeof(bits));
        std::printf("%.9g %.9g %.9g %u\n",option,base,stat.result,bits);
    }
}
'''


def run(source: Path, zig: Path, output: Path) -> dict:
    data = source.read_bytes()
    method = original_method(data)
    output.mkdir(parents=True, exist_ok=True)
    cpp, exe = output / 'stat-source.cpp', output / 'stat-source.exe'
    # Only comments are transcoded; the pinned method's executable ASCII code
    # and compile branches are unchanged. Store its original byte hash below.
    cpp.write_text(HOST + method.decode('latin1') + HARNESS, encoding='utf-8')
    env={**os.environ,'ZIG_LOCAL_CACHE_DIR':str((output/'zig-local').resolve()),
         'ZIG_GLOBAL_CACHE_DIR':str((output/'zig-global').resolve())}
    result = subprocess.run([str(zig.resolve()), 'c++', '-std=c++17', '-O0',
        '-ffp-contract=off', '-DADJUST_BUFF_CALCULATE', str(cpp), '-o', str(exe)],
        env=env,capture_output=True, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    lines = subprocess.check_output([str(exe.resolve())], text=True).splitlines()
    cases = []
    for line in lines:
        option, base, value, bits = line.split()
        exact=struct.unpack('<f',struct.pack('<I',int(bits)))[0]
        cases.append({'finalOptionPercent':float(option),'basicStat':float(base),
                      'result':exact,'float32Bits':int(bits)})
    if len(cases) != 20:
        raise ValueError('Expected 20 independently executed source cases')
    report = {'referenceCommit':REFERENCE_COMMIT,'evidenceClass':'fixed-V5-original-source-execution-not2016-client',
        'targetClientMeasured':False,'sourceSha256':SOURCE_SHA256,
        'methodOriginalBytesSha256':hashlib.sha256(method).hexdigest(),
        'compiledMethod':'CX2AdditionalStatByBuff::UpdateResultValueWithOptionData',
        'compileBranches':['ADJUST_BUFF_CALCULATE'],
        'hostBoundary':'final-percent identity callback; passiveSum0/passiveMultiple1; Buff percent1 and no swap/fix/relation factors; storage accessors',
        'modifier':.5,'cases':cases}
    (output/'source-execution.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'.cache/native-reference/X2Lib/X2BuffTemplet.h')
    parser.add_argument('--zig',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'artifacts/native/movement-stat-probe')
    args=parser.parse_args()
    result=run(args.source,args.zig,args.output)
    print(json.dumps({'sourceCases':len(result['cases']),'sourceSha256':SOURCE_SHA256,
                      'resultFile':str((args.output/'source-execution.json').resolve())}))


if __name__=='__main__':
    main()
