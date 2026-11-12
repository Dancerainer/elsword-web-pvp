"""Execute unchanged fixed-V5 awakening consumers in an isolated explicit host.

Target KL declarations and old4409 seconds are independently read; this probe
does not establish the target2016 binding or replace any published WASM module.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'combat'))
from kl82_static import read_declarations

HASHES = {
    'X2Lib/X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'X2Lib/X2GUUser.cpp': 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
    'X2Lib/X2BuffFactor.cpp': 'dd458eaa4febae9c16bcf48f1809dc1ab632a9dc40906dc5569ea3e2ebddced1',
    'X2Lib/X2BuffBehaviorTemplet.cpp': '6996a32c7c7fa3c4feba22a6732f946cea38ddc080d45bb83d61cfb1c5a84c5d',
    'ClientScript/NewSkillTempletVer2.lua': 'c589908bd72a6be412d64545e5f21ff6b1b6e1889c0c2fb2b99060c01e0de77f',
    'X2Lib/X2GageData.cpp': 'd30c9acb4fa3f3f0e545259cde3d39d63c20dc1b2f3b5d74c5aa02e51f1583e8',
    'X2Lib/X2GageData.h': 'ad9b998352f09864fb770a534d27e6d50c3f8c492a9131486efd7bd70bf7915f',
}
METHODS = {
    'X2Lib/X2GUUser.cpp': ['CX2GUUser::GetHyperModeTime()', 'CX2GUUser::HyperModeStart()'],
    'X2Lib/X2GURaven.cpp': ['CX2GURaven::GetHyperModeTime()', 'CX2GURaven::HyperModeBuffEffectStart()', 'CX2GURaven::HyperModeBuffEffectEnd()'],
    'X2Lib/X2BuffFactor.cpp': ['CX2BuffFactor::SetGameUnitChangeHyperModeBehavior('],
    'X2Lib/X2BuffBehaviorTemplet.cpp': ['CX2BuffChangeHyperModeBehaviorTemplet::SetFactor('],
    'X2Lib/X2GageData.cpp': ['CX2GageData::Gage::Increase('],
}
def sha(data):
    return hashlib.sha256(data).hexdigest()

def method(data, marker):
    marker = marker.encode()
    if data.count(marker) != 1:
        raise ValueError('Missing or ambiguous source method: ' + marker.decode())
    start = data.rfind(b'\n', 0, data.index(marker)) + 1
    brace = data.index(b'{', start)
    end, depth = brace + 1, 1
    while depth and end < len(data):
        depth += (data[end] == 123) - (data[end] == 125)
        end += 1
    if depth:
        raise ValueError('Truncated source method')
    return data[start:end], data[:start].count(b'\n') + 1, data[:end].count(b'\n') + 1

HEADER = r'''
#include <cstdio>
#include <vector>
#include <algorithm>
using std::min; using std::max;
using UINT=unsigned int;
#define HYPER_MODE_FIX
#define SUPERPOSITION_HYPER_MODE_BUG
#define UPGRADE_SKILL_SYSTEM_2013
#define DISPLAY_ERROR(x) false
#define THEMIDA_ENCODE_START
#define THEMIDA_ENCODE_END
struct CX2GageData {struct Gage {float fNow=0,fMax=800000;void Increase(float,float=0.f);};};
struct CKTDGObject {};
struct CX2SkillTree {enum{SI_P_RRF_SPIRITUALIZED_FURY,SA_EFFECTIVE_TIME};
 struct SkillTemplet {int m_eID=4409;float field=10.f;
 float GetSkillAbilityValue(int,int)const{return field;}};};
struct CX2UserSkillTree {CX2SkillTree::SkillTemplet skill;bool present=true;
 const CX2SkillTree::SkillTemplet* GetUserSkillTemplet(int)const{return present?&skill:nullptr;}
 int GetSkillLevel(int,bool)const{return 3;}};
struct Unit {struct Data {CX2UserSkillTree m_UserSkillTree;} data;const Data& GetUnitData()const{return data;}};
struct CX2GameUnit:CKTDGObject {float remaining=0,force=0,base=30;int lastCount=0,count=0;bool full=false;int starts=0;
 CX2GageData::Gage hp,mp;bool own=true;float requestedHp=0,requestedMp=0;
 virtual float GetHyperModeTime()const=0;virtual void HyperModeBuffEffectStart(){starts++;}
 virtual void HyperModeBuffEffectEnd(){}
 float GetRemainHyperModeTime()const{return remaining;}float GetForceHyperModeTime()const{return force;}
 float GetMaxHyperModeTime()const{return base;}int GetLastStateHyperModeCount()const{return lastCount;}
 void SetRemainHyperModeTime(float n){remaining=n;}void SetFullHyperMode(bool b){full=b;}
 bool IsFullHyperMode()const{return full;}};
struct CX2GUUser:CX2GameUnit {struct {float m_fHyperModeTime=0;}m_SocketData;
 struct {struct {int m_HyperModeCount=0;}syncData;}m_FrameDataNow;
 bool m_bHyperModeUsed=false,m_bReserveHyperModeZero=false;int m_iLastStateHyperModeCount=0,m_iHyperModeCountUsed=0;
 float GetHyperModeTime()const override;void HyperModeStart();void CommonStateStart(){}
 int GetLastStateHyperModeCount()const{return m_iLastStateHyperModeCount;}
 bool GetCanChangeHyperModeInHyperModeState()const{return true;}
 void SetHyperModeCount(int n){count=n;lastCount=m_iLastStateHyperModeCount;}};
constexpr int INVALID_PARTICLE_SEQUENCE_HANDLE=-1,INVALID_EFFECTSET_HANDLE=-1;
struct Minor {int next=0;int CreateSequenceHandle(CKTDGObject*,const wchar_t*,int,int,int,int,int){return ++next;}};
struct Effects {int PlayEffectSet(const wchar_t*,CX2GameUnit*,CX2GameUnit*){return 1;}void StopEffectSet(int){}};
struct Game {Minor minor;Effects effects;Minor* GetMinorParticle(){return &minor;}Effects* GetEffectSet(){return &effects;}}game;
Game* g_pX2Game=&game;
struct CX2GURaven:CX2GUUser {Unit unit;float m_fRageGauge=0;
 int m_iNaosdBallLv=0;float m_fParryingTime=0;bool m_bCanParrying=false;
 int m_hHyperBoostRFoot=-1,m_hHyperBoostLFoot=-1,m_hHyperBoostRArm=-1,m_hHyperBoostLArm=-1,m_hHyperAuraEffectset=-1;
 Unit* GetUnit()const{return const_cast<Unit*>(&unit);}
 float GetHyperModeTime()const override;void HyperModeBuffEffectStart()override;void HyperModeBuffEffectEnd()override;
 bool IsMyUnit()const{return own;}float GetNowHp()const{return hp.fNow;}float GetMaxHp()const{return hp.fMax;}
 void UpNowHp(float n){requestedHp=n;hp.Increase(n);}void UpNowMp(float n){requestedMp=n;mp.Increase(n);}
 void PlaySound(const wchar_t*){}void ClearNasodBall(){m_iNaosdBallLv=0;}};
enum {FO_HYPER_MODE_TIME,FO_HYPER_MODE_COUNT};
struct KBuffBehaviorFactor {std::vector<float>m_vecValues;float operator[](int i)const{return m_vecValues.at(i);}};
struct CX2BuffTemplet {};
struct CX2BuffFactor {KBuffBehaviorFactor factor;
 bool GetBehaviorFactor(int,const KBuffBehaviorFactor** out)const{*out=&factor;return true;}
 void SetGameUnitChangeHyperModeBehavior(KBuffBehaviorFactor&,CX2GameUnit*);};
struct CX2GageUI {enum {PGUWO_ORB3=2};};
struct CX2BuffChangeHyperModeBehaviorTemplet {unsigned m_uiHyperModeCount=0;float m_fRemainTime=0;
 int GetType()const{return 1;}bool SetFactor(const CX2BuffFactor&,CX2GameUnit*,const CX2BuffTemplet*);};
'''
MAIN = r'''
int main(){std::puts("[");bool comma=false;
 for(int kind=0;kind<3;kind++)for(int available=1;available<=3;available++){
  CX2GURaven a;a.remaining=kind?10.f:0.f;a.m_FrameDataNow.syncData.m_HyperModeCount=available;
  a.unit.data.m_UserSkillTree.skill.field=kind==1?.7f:10.f;a.HyperModeStart();
  CX2BuffFactor factor;factor.SetGameUnitChangeHyperModeBehavior(factor.factor,&a);
  CX2BuffChangeHyperModeBehaviorTemplet buff;buff.m_fRemainTime=a.remaining;buff.SetFactor(factor,&a,nullptr);
  if(comma)std::puts(",");comma=true;
  std::printf("{\"kind\":%d,\"available\":%d,\"savedCount\":%d,\"left\":%d,\"added\":%.9g,\"remaining\":%.9g,\"coreGauge\":%.9g}",kind,available,a.m_iLastStateHyperModeCount,a.count,factor.factor[0],a.remaining,a.m_fRageGauge);
 }
 for(int gauge=0;gauge<=100;gauge+=20){CX2GURaven a;a.m_fRageGauge=gauge;a.HyperModeBuffEffectStart();
  std::puts(",");std::printf("{\"kind\":3,\"beforeGauge\":%d,\"afterGauge\":%.9g}",gauge,a.m_fRageGauge);}
 for(int gauge: {0,20,40,60,80,100,37})for(int mode=0;mode<4;mode++){
  CX2GURaven a;a.m_fRageGauge=gauge;a.m_iNaosdBallLv=gauge/20;a.hp.fNow=mode==1?799999.f:mode==2?0.f:400000.f;
  a.mp.fNow=mode==1?299.f:100.f;a.mp.fMax=300.f;a.own=mode!=3;const float hpBefore=a.hp.fNow,mpBefore=a.mp.fNow;
  a.HyperModeBuffEffectEnd();std::puts(",");
  std::printf("{\"kind\":4,\"gauge\":%d,\"mode\":%d,\"hpBefore\":%.9g,\"mpBefore\":%.9g,\"requestedHp\":%.9g,\"requestedMp\":%.9g,\"hp\":%.9g,\"mp\":%.9g,\"afterGauge\":%.9g,\"level\":%d}",gauge,mode,hpBefore,mpBefore,a.requestedHp,a.requestedMp,a.hp.fNow,a.mp.fNow,a.m_fRageGauge,a.m_iNaosdBallLv);
 }
 std::puts("\n]");}
'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source-root', type=Path, default=Path('.cache/awakening-v17-source'))
    ap.add_argument('--target-root', type=Path, default=Path('asset_work/raw/data/data036.kom'))
    ap.add_argument('--out', type=Path, default=Path('artifacts/proof-awakening-v17/source'))
    ap.add_argument('--compiler', type=Path, required=True)
    args = ap.parse_args(); args.out.mkdir(parents=True, exist_ok=True)
    blobs = {}
    for file, expected in HASHES.items():
        data = (args.source_root / file).read_bytes()
        if sha(data) != expected: raise ValueError('Pinned source changed: ' + file)
        blobs[file] = data
    fragments, bodies = [], []
    for file, names in METHODS.items():
        for name in names:
            body, first, last = method(blobs[file], name); bodies.append(body)
            fragments.append({'file':file,'symbol':name,'firstLine':first,'lastLine':last,'sha256':sha(body),'bytes':len(body),'bodyUnchanged':True})
    old = blobs['ClientScript/NewSkillTempletVer2.lua']
    start = old.rfind(b'g_pSkillTree:AddSkillTemplet_LUA({',0,old.index(b'm_eID = 4409'))
    end = old.index(b'g_pSkillTree:AddSkillTemplet_LUA({',start+1)
    old = old[start:end]
    values = [int(value) for value in re.search(rb'SA_EFFECTIVE_TIME = \{([^}]+)\}',old).group(1).split(b',') if value.strip()]
    assert values[:3] == [4,7,10] and b'Additional Awakening Time' in old
    enum = read_declarations(args.target_root/'Enum.lua')
    assert enum['source']['sha256']=='e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6'
    target = read_declarations(args.target_root/'NewSkillTempletVer2.lua',enum['globals'],capture_calls=True,capture_unresolved=True)
    assert target['source']['sha256']=='c8047731095475dda3f5bedb54e6e87509bc0438500acdf4005211ce0f5ed266'
    nodes = [(call,arg) for call in target['nativeCalls'] for arg in call.get('args',[]) if isinstance(arg,dict) and arg.get('m_eID')==24405]
    assert len(nodes)==1
    call, raw = nodes[0]; raw=json.loads(json.dumps(raw))
    assert raw['SA_EFFECTIVE_TIME']=={'1':.7,'2':.7,'3':.7}
    assert 'maximum charge' in raw['m_wstrMainDesc'] and '-30%' in raw['m_EffectiveDesc']['3']
    cpp=HEADER.encode()+b'\n'+b'\n\n'.join(bodies)+MAIN.encode()
    source=args.out/'awakening-consumers.cpp';source.write_bytes(cpp);exe=args.out/'awakening-consumers.exe'
    env=dict(os.environ);env['ZIG_GLOBAL_CACHE_DIR']=str((args.out/'zig-global').resolve());env['ZIG_LOCAL_CACHE_DIR']=str((args.out/'zig-local').resolve())
    build=subprocess.run([str(args.compiler),'c++','-std=c++17','-O0',str(source),'-o',str(exe)],env=env,capture_output=True,text=True)
    if build.returncode: raise RuntimeError(build.stdout+build.stderr)
    cases=json.loads(subprocess.check_output([str(exe.resolve())],text=True))
    for case in cases:
        # Nine significant decimal digits round-trip every binary32 value.
        for key,value in case.items():
            if key in ['added','remaining','coreGauge','afterGauge','hpBefore','mpBefore','requestedHp','requestedMp','hp','mp']:
                case[key]=struct.unpack('<f',struct.pack('<f',value))[0]
        if case['kind']==4:
            assert case['afterGauge']==0 and case['level']==0
            if case['mode'] in [2,3]: assert case['requestedHp']==0 and case['requestedMp']==0
            else: assert case['requestedMp']==case['gauge'] and case['hp']<=800000 and case['mp']<=300
            continue
        if case['kind']==3: assert case['afterGauge']==min(case['beforeGauge']+40,100);continue
        count=case['available'];assert case['savedCount']==count and case['left']==(count-1 if case['kind'] else 0)
        assert abs(case['added']-(30*count if not case['kind'] else .7 if case['kind']==1 else 10))<1e-6
        assert case['coreGauge']==40
    result={'schema':'rf-awakening-independent-source-v17','evidenceClass':'compiled-fixed-V5-reference + static-target2016-KL','targetClientMeasured':False,
        'referenceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633','files':{key:{'sha256':sha(data),'bytes':len(data)} for key,data in blobs.items()},'consumers':fragments,
        'old4409':{'nodeSha256':sha(old),'effectiveSeconds':values,'unitEvidence':'EffectiveDesc explicitly Additional Awakening Time: N sec'},
        'target24405':{'source':target['source'],'enumSource':enum['source'],'prototype':call['prototype'],'instruction':call['instruction'],'raw':raw},
        'compilerSha256':sha(args.compiler.read_bytes()),'unitSha256':sha(cpp),'cases':cases,'assertionsPassed':len(cases),
        'definedConsumerBranches':['HYPER_MODE_FIX','SUPERPOSITION_HYPER_MODE_BUG','UPGRADE_SKILL_SYSTEM_2013'],
        'hostBoundary':'Minimal input/count/time/storage; skills fixed level3; socket duration0; base30; effect calls are handle counters. Whole client and target2016 consumer not executed.',
        'versionGap':'Old4409 supplies seconds4/7/10; target24405 supplies ratio .7. Old Raven literal seconds override cannot prove target24405 reawakening time. Old Raven+40 differs from target maximum-charge description.',
        'publishedNativeModulesModified':False}
    (args.out/'result.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    print(json.dumps({'cases':len(cases),'out':str(args.out/'result.json'),'targetClientMeasured':False}))

if __name__=='__main__': main()
