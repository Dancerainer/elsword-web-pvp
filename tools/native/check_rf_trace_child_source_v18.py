"""Execute the pinned Trace creation callsite, with recording API stubs.

Only the unchanged source loop and axis initializer are compiled. This is not
the complete native particle consumer, and not a target-2016 client experiment.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess

PIN = '43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050'
COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'


def original_fragments(path):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != PIN:
        raise ValueError('Pinned ParticleSystem source SHA256 mismatch')
    lines = raw.decode('cp949').splitlines()
    axis = lines[2695]
    block = '\n'.join(lines[5243:5263])
    if 'INIT_VECTOR3( m_AxisAngleDegree, 0.0f, 0.0f, 0.0f )' not in axis:
        raise ValueError('Original axis initializer range changed')
    if not block.startswith('\tfor( int i = 0; i < (int)m_TraceSeqNameList.size(); i++ )'):
        raise ValueError('Original Trace callsite range changed')
    return axis, block


HARNESS = r'''
#include <iostream>
#include <string>
#include <vector>
struct V { float x=0,y=0,z=0; };
#define INIT_VECTOR3(v,a,b,c) v=V{a,b,c}
class CKTDGParticleSystem {
public:
 struct CParticleEventSequence {
  V m_AxisAngleDegree{999,999,999}, scale{1,1,1}; int id;
  CParticleEventSequence(int n):id(n) { AXIS_INITIALIZER }
  int GetHandle(){return id;}
  void SetScaleByUnit(V v){scale=v;}
 };
 struct Call { std::wstring name; bool nullUnit; V position;
  float minRate,maxRate; int draw,count; float time; bool cull;
  float latency; bool nextFrame; CParticleEventSequence* child; };
 std::vector<Call> calls;
 CParticleEventSequence* CreateSequence(void* unit,const wchar_t* name,V pos,
   float minRate,float maxRate,int draw,int count,float time,bool cull,
   float latency,bool nextFrame){
  auto* child=new CParticleEventSequence((int)calls.size()+1);
  calls.push_back({name,unit==NULL,pos,minRate,maxRate,draw,count,time,cull,latency,nextFrame,child});
  return child;
 }
 ~CKTDGParticleSystem(){for(auto& c:calls)delete c.child;}
};
struct ParentParticle { V m_vPos{1,2,3}; std::vector<int> m_TraceSeqList; };
struct ParentSequence {
 CKTDGParticleSystem* m_pParticleSystem;
 std::vector<std::wstring> m_TraceSeqNameList{L"RavenHandFireP01",L"RavenHandFireP02",L"RavenHandFireP03"};
 bool m_bApplyUnitScale; V GetScaleByUnit(){return {4,5,6};}
 void spawn(ParentParticle* pPart){ TRACE_BLOCK }
};
int main(){
 std::cout << "[";
 int last=0;
#ifdef PARTICLE_NOTAPPLY_UNITSCALE
 last=1;
#endif
 for(int apply=0;apply<=last;++apply){
  CKTDGParticleSystem system; ParentSequence seq{&system,{},apply!=0};
  seq.m_TraceSeqNameList={L"RavenHandFireP01",L"RavenHandFireP02",L"RavenHandFireP03"};
  ParentParticle particle;seq.spawn(&particle);
  if(apply)std::cout << ",";
  std::cout << "{\"applyUnitScale\":" << apply << ",\"handles\":[";
  for(size_t i=0;i<particle.m_TraceSeqList.size();++i){if(i)std::cout<<",";std::cout<<particle.m_TraceSeqList[i];}
  std::cout << "],\"calls\":[";
  for(size_t i=0;i<system.calls.size();++i){
   auto& c=system.calls[i];if(i)std::cout<<",";
   std::cout<<"{\"name\":\""<<std::string(c.name.begin(),c.name.end())<<"\",\"nullUnit\":"<<(c.nullUnit?"true":"false")
    <<",\"position\":["<<c.position.x<<","<<c.position.y<<","<<c.position.z<<"]"
    <<",\"minRate\":"<<c.minRate<<",\"maxRate\":"<<c.maxRate<<",\"drawCount\":"<<c.draw
    <<",\"triggerCount\":"<<c.count<<",\"triggerTime\":"<<c.time<<",\"cull\":"<<(c.cull?"true":"false")
    <<",\"latency\":"<<c.latency<<",\"nextFrame\":"<<(c.nextFrame?"true":"false")
    <<",\"axis\":["<<c.child->m_AxisAngleDegree.x<<","<<c.child->m_AxisAngleDegree.y<<","<<c.child->m_AxisAngleDegree.z<<"]"
    <<",\"scaleByUnit\":["<<c.child->scale.x<<","<<c.child->scale.y<<","<<c.child->scale.z<<"]}";
  }
  std::cout << "]}";
 }
 std::cout << "]\n";
}
'''


def run(source, zig, output):
    axis, block = original_fragments(source)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cpp = output / 'trace-callsite.cpp'
    cpp.write_text(HARNESS.replace('AXIS_INITIALIZER', axis).replace('TRACE_BLOCK', block), encoding='utf-8')
    variants = [([], 'plain'), (['GIANT_UNIT_GIANT_EFFECT_TEST'], 'giant'),
                (['GIANT_UNIT_GIANT_EFFECT_TEST', 'PARTICLE_NOTAPPLY_UNITSCALE'], 'conditional-unit-scale')]
    cases = []
    environment = dict(os.environ)
    environment['ZIG_GLOBAL_CACHE_DIR'] = str(output / 'global-cache')
    environment['ZIG_LOCAL_CACHE_DIR'] = str(output / 'local-cache')
    for defines, name in variants:
        exe = output / (name + '.exe')
        subprocess.run([str(Path(zig).resolve()), 'c++', '-std=c++17',
                        *['-D' + d for d in defines], str(cpp), '-o', str(exe)], check=True,
                       cwd=output, capture_output=True, env=environment)
        observed = json.loads(subprocess.check_output([str(exe)], cwd=output, text=True))
        for case in observed:
            case['variant'] = name
            assert case['handles'] == [1, 2, 3]
            for index, call in enumerate(case['calls'], 1):
                assert call['name'] == f'RavenHandFireP0{index}'
                assert call['nullUnit'] and call['position'] == [1, 2, 3]
                assert [call[k] for k in ['minRate', 'maxRate', 'drawCount', 'triggerCount', 'triggerTime']] == [-1]*5
                assert call['nextFrame'] and call['cull'] and call['latency'] == 0
                assert call['axis'] == [0, 0, 0]
                expected_scale = [4, 5, 6] if name == 'giant' or name == 'conditional-unit-scale' and case['applyUnitScale'] else [1, 1, 1]
                assert call['scaleByUnit'] == expected_scale
            cases.append(case)
    return {'schemaVersion': 1, 'evidenceClass': 'fixed-V5-callsite-with-recording-stubs',
            'targetClientMeasured': False, 'fullNativeConsumerExecuted': False,
            'sourceCommit': COMMIT, 'sourceSha256': PIN,
            'sourceRanges': {'axisInitializer': [2696, 2696], 'traceCreation': [5244, 5263]},
            'fragmentsSha256': hashlib.sha256((axis + '\n' + block).encode()).hexdigest(),
            'cases': cases}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default='.cache/native-reference/KTDXLIB/KTDGParticleSystem.cpp')
    parser.add_argument('--zig', required=True)
    parser.add_argument('--output', default='.cache/trace-child-source-v18')
    parser.add_argument('--report', default='reports/rf-trace-child-source-v18.json')
    args = parser.parse_args()
    report = run(args.source, args.zig, args.output)
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'cases': len(report['cases']), 'recordedCreations': sum(len(c['calls']) for c in report['cases']),
                      'sourceSha256': PIN, 'targetClientMeasured': False}))
