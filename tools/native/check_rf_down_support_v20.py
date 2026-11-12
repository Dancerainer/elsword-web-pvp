"""Compile the complete unchanged Raven down callbacks, isolated from host policy."""
import argparse,hashlib,json,os,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def sha(b):return hashlib.sha256(b).hexdigest()
def fragment(data,signature):
    start=data.index(signature);brace=data.index(b'{',start);depth=1;i=brace+1
    while depth:
        depth+=(data[i]==123)-(data[i]==125);i+=1
    return data[start:i],data[:start].count(b'\n')+1,data[:i].count(b'\n')+1
HEADER=r'''
#include <cstdio>
enum {USI_DAMAGE_AIR_FALL=1,USI_DAMAGE_STANDUP_FRONT,USI_DAMAGE_STANDUP_BACK,
RSI_STANDUP_ATTACK_FRONT_NO_DOWN,RSI_STANDUP_ATTACK_FRONT,RSI_STANDUP_ROLLING_FRONT_FRONT,RSI_STANDUP_ROLLING_FRONT_BACK,
RSI_STANDUP_ATTACK_BACK_NO_DOWN,RSI_STANDUP_ATTACK_BACK,RSI_STANDUP_ROLLING_BACK_FRONT,RSI_STANDUP_ROLLING_BACK_BACK};
const float LINE_RADIUS=30.f;
struct Anim {bool ended=false;float time=0;bool IsAnimationEnd(){return ended;}float GetNowAnimationTime(){return time;}};
struct CX2GURaven {
 struct {struct {struct {float y=3800;}position;bool bIsRight=true;}syncData;
 struct {bool bFootOnLine=true;}unitCondition;struct {bool bEventFlagList[5]={};}stateParam;}m_FrameDataFuture;
 struct {int m_iNoDownDamageAtStandUpAttackPercent=0;}m_SkillRelatedData;
 struct {bool oneX=false,oneZ=false,pureRight=false,pureLeft=false;}m_InputData;
 Anim anim;Anim* m_pXSkinAnimFuture=&anim;int requested=0;
 void StateChange(int s){requested=s;}int GetRandomInt(){return 100;}void CommonEventProcess(){}
 bool IsOnSomethingFuture();void RSI_DAMAGE_DOWN_FRONT_EventProcess();void RSI_DAMAGE_DOWN_BACK_EventProcess();
};
'''
MAIN=r'''
int main(){bool first=true;std::puts("[");
 for(int back=0;back<2;++back)for(int foot=0;foot<2;++foot)for(int ended=0;ended<2;++ended)
 for(float y:{0.f,3560.f,3800.f,4000.f}){
 CX2GURaven a;a.m_FrameDataFuture.unitCondition.bFootOnLine=foot;a.m_FrameDataFuture.syncData.position.y=y;
 a.anim.ended=ended;a.anim.time=ended?1.f:0.f;
 if(back)a.RSI_DAMAGE_DOWN_BACK_EventProcess();else a.RSI_DAMAGE_DOWN_FRONT_EventProcess();
 if(!first)std::puts(",");first=false;
 std::printf("{\"back\":%d,\"foot\":%d,\"ended\":%d,\"beforeY\":%.9g,\"afterY\":%.9g,\"requested\":%d}",back,foot,ended,y,a.m_FrameDataFuture.syncData.position.y,a.requested);
 }std::puts("\n]");}
'''
def build(source,out,compiler):
    contract=json.loads((ROOT/'contracts/rf-down-support-source-v20.json').read_text(encoding='utf8'))
    fragments=[];manifest=[]
    for item in contract['fragments']:
        data=(source/item['file']).read_bytes()
        if sha(data)!=contract['files'][item['file']]['sha256']:raise ValueError('Pinned source bytes changed: '+item['file'])
        body,first,last=fragment(data,item['signature'].encode())
        if sha(body)!=item['sha256'] or first!=item['firstLine'] or last!=item['lastLine']:raise ValueError('Pinned source fragment changed')
        if item['method']=='IsOnSomethingFuture':body=body.replace(b'bool IsOnSomethingFuture()',b'bool CX2GURaven::IsOnSomethingFuture()',1)
        fragments.append(body);manifest.append(item)
    out.mkdir(parents=True,exist_ok=True)
    unit=HEADER.encode()+b'\n'.join(fragments)+b'\n#include <initializer_list>\n'+MAIN.encode()
    cpp=out/'down-support.cpp';cpp.write_bytes(unit);exe=out/'down-support.exe'
    env=dict(os.environ,ZIG_GLOBAL_CACHE_DIR=str((out/'zig-global').resolve()),ZIG_LOCAL_CACHE_DIR=str((out/'zig-local').resolve()))
    result=subprocess.run([str(compiler),'c++','-std=c++17','-O0',str(cpp),'-o',str(exe)],env=env,capture_output=True)
    if result.returncode:raise RuntimeError((result.stdout+result.stderr).decode(errors='replace'))
    rows=json.loads(subprocess.check_output([str(exe.resolve())]))
    assert len(rows)==32
    for r in rows:
        if not r['foot']:assert r['requested']==1 and r['afterY']==r['beforeY']-45
        else:assert r['requested']!=1 and r['afterY']==r['beforeY']
    report={'schema':'rf-down-support-independent-v20','sourceCommit':contract['sourceCommit'],'fragments':manifest,
      'cases':rows,'cppSha256':sha(unit),'compilerSha256':sha(compiler.read_bytes()),'client2016Measured':False,
      'boundary':'Two complete original callbacks unchanged; inline IsOnSomethingFuture is extracted unchanged except its outer class qualifier. Explicit no-op CommonEvent, no optional client world; original animation flags retained. Original Now/Future scheduler is not included.'}
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-root',type=Path,default=Path('.cache/native-reference'));p.add_argument('--out',type=Path,default=Path('artifacts/proof-platform-down-v20/source'));p.add_argument('--compiler',type=Path,required=True)
    a=p.parse_args();r=build(a.source_root,a.out,a.compiler);print(json.dumps({'cases':len(r['cases']),'result':str(a.out/'result.json')}))
