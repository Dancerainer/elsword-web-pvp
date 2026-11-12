"""Independent unchanged fixed-V5 Elsword WOS consumer probe, not client traces."""
import argparse,hashlib,json,os,re,subprocess
from pathlib import Path
COMMIT='a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
HASHES={'X2GUElsword_SwordMan.cpp':'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d',
        'X2DamageManager.cpp':'22bc134e51d9e5543c9b1b6d44de01197418f0d8ee61939e6f4d6408e3db5231'}
def sha(b):return hashlib.sha256(b).hexdigest()
def extract(data,name):
    matches=list(re.finditer(rb'::'+name.encode()+rb'\s*\(',data))
    if len(matches)!=1:raise ValueError('Ambiguous method '+name)
    first=data.rfind(b'\n',0,matches[0].start())+1;brace=data.index(b'{',matches[0].end());last=brace+1;depth=1
    while depth:depth+=(data[last]==123)-(data[last]==125);last+=1
    return data[first:last],data[:first].count(b'\n')+1,data[:last].count(b'\n')+1
def main():
    p=argparse.ArgumentParser();p.add_argument('--sword-source',type=Path,required=True);p.add_argument('--damage-source',type=Path,required=True)
    p.add_argument('--compiler',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
    files={'X2GUElsword_SwordMan.cpp':a.sword_source.read_bytes(),'X2DamageManager.cpp':a.damage_source.read_bytes()}
    for name,data in files.items():
        if sha(data)!=HASHES[name]:raise ValueError('Pinned source mismatch '+name)
    methods=[('X2GUElsword_SwordMan.cpp','GetFinalDamage_WayOfSword'),('X2GUElsword_SwordMan.cpp','DestructionRageFrameMove'),
        ('X2DamageManager.cpp','CalcVigorMpUpOnAttack'),('X2DamageManager.cpp','CalcVigorMpUpOnDamageReact'),('X2DamageManager.cpp','GetDestRageWSPGain')]
    fragments=[];bodies=[]
    for file,name in methods:
        raw,first,last=extract(files[file],name);bodies.append(raw);fragments.append({'file':file,'method':name,'startLine':first,'endLine':last,'sha256':sha(raw),'unchanged':True})
    header=r'''
#include <cstdio>
struct CX2Game{enum {GT_PVP=1};int type=1;int GetGameType(){return type;}} game,*g_pX2Game=&game;
struct CX2DamageManager{enum WAY_OF_SWORD_TYPE{WST_NONE=0,WST_VIGOR_NORMAL=1,WST_VIGOR_ACTIVE=2,WST_VIGOR_SPECIAL=3,WST_DESTRUCTION_NORMAL=4,WST_DESTRUCTION_ACTIVE=5,WST_DESTRUCTION_SPECIAL=6};
 struct {float m_fGameModeConst_PVP_Hit=1.5f,m_fGameModeConst_NPC_Hit=1.f,m_fConst_DestRageWSPGain=1500.f;}m_WayOfSwordConstTable;
 float CalcVigorMpUpOnAttack(WAY_OF_SWORD_TYPE,int);float CalcVigorMpUpOnDamageReact(int);float GetDestRageWSPGain();};
struct CX2GUElsword_SwordMan{int state=0;bool armor=false;float m_fElapsedTime=0,m_fDestructionRageTime=0;
 struct{struct{bool bSuperArmor=false,bSuperArmorNotRed=true;}stateParam;}m_FrameDataNow;
 int GetWayOfSwordState(){return state;}bool IsSuperArmor(){return armor;}
 float GetFinalDamage_WayOfSword(CX2DamageManager::WAY_OF_SWORD_TYPE);void DestructionRageFrameMove();};
'''
    main=r'''
int main(){CX2DamageManager manager;bool comma=false;std::puts("{\"hits\":[");
 for(int state=-2;state<=2;state++)for(int type=0;type<=6;type++){CX2GUElsword_SwordMan actor;actor.state=state;if(comma)std::puts(",");comma=true;
 std::printf("{\"state\":%d,\"type\":%d,\"damage\":%.9g,\"mp\":%.9g,\"receivedMp\":%.9g}",state,type,actor.GetFinalDamage_WayOfSword((CX2DamageManager::WAY_OF_SWORD_TYPE)type),manager.CalcVigorMpUpOnAttack((CX2DamageManager::WAY_OF_SWORD_TYPE)type,state),manager.CalcVigorMpUpOnDamageReact(state));}
 std::puts("],\"rageClock\":[");comma=false;
 for(int i=0;i<4;i++){CX2GUElsword_SwordMan a;a.m_fDestructionRageTime=1;a.m_fElapsedTime=i==0?.5f:i==1?1.f:1.1f;a.armor=i==3;a.DestructionRageFrameMove();if(comma)std::puts(",");comma=true;
 std::printf("{\"case\":%d,\"remaining\":%.9g,\"armor\":%s}",i,a.m_fDestructionRageTime,a.m_FrameDataNow.stateParam.bSuperArmor?"true":"false");}
 float pvp=manager.GetDestRageWSPGain();game.type=0;std::printf("],\"rageCost\":{\"pvp\":%.9g,\"npc\":%.9g}}",pvp,manager.GetDestRageWSPGain());}
'''
    cpp=header.encode()+b'\n'.join(bodies)+main.encode();a.out.mkdir(parents=True,exist_ok=True);source=a.out/'lk-wos-probe.cpp';source.write_bytes(cpp);exe=a.out/'lk-wos-probe.exe'
    env=dict(os.environ);env['ZIG_LOCAL_CACHE_DIR']=str((a.out/'zig-local').resolve());env['ZIG_GLOBAL_CACHE_DIR']=str((a.out/'zig-global').resolve())
    built=subprocess.run([str(a.compiler),'c++','-std=c++17','-O0','-ffp-contract=off','-Wno-invalid-utf8',str(source),'-o',str(exe)],capture_output=True,text=True,env=env)
    if built.returncode:raise RuntimeError(built.stdout+built.stderr)
    cases=json.loads(subprocess.check_output([str(exe.resolve())],text=True))
    for row in cases['hits']:
        state=row['state'];t=row['type'];assert row['damage']==(2 if state==-2 and t==4 else 1.5 if state==-2 and t in [5,6] else 1)
        assert row['mp']==(3 if state==2 and t==1 else 4 if state==2 and t in [2,3] else 1);assert row['receivedMp']==(2 if state==2 else 1)
    assert cases['rageCost']=={'pvp':2250,'npc':1500}
    assert [(c['remaining'],c['armor']) for c in cases['rageClock']]==[(.5,True),(0,True),(0,False),(1,False)]
    report={'schema':'lk-wos-original-source-probe-v2','evidenceClass':'compiled-fixedV5-source-not-target2016','sourceCommit':COMMIT,'targetClientMeasured':False,
        'files':HASHES,'fragments':fragments,'compilerSha256':sha(a.compiler.read_bytes()),'translationUnitSha256':sha(cpp),'cases':cases,
        'assertionsPassed':110,'boundaries':'Unchanged original functions with supplied state, type and target constants; mock GetGameType and IsSuperArmor. No copied gameplay output oracle.'}
    a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps({'assertionsPassed':110,'report':str(a.report)}))
if __name__=='__main__':main()
