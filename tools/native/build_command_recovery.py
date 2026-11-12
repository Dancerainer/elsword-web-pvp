"""Compile the separately pinned 2026 reconstruction of 2015 RF callbacks.

This is a newer source reference, never a claim that 2016 code was recovered.
Baseline a843 callbacks remain in their original module and independent tests.

Reproducibility rule: pinned source bodies are inserted byte-for-byte (their
upstream CRLF is recorded in the contract as evidence), and the composed unit is
then canonicalized to LF-only before it is written, hashed and compiled. Without
that canonicalization generatedCppSha256 depended on this checkout's git eol
handling rather than on the pinned sources.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess

from run_camera_source import extract, sha, git_blob

ROOT = Path(__file__).resolve().parents[2]
COMMIT = 'a1bcdabf39ee1699873b587b40cedefcce61c7f0'
SOURCE_SHA = 'b6c8db97bea7d086a430ca069f4c047c9fb0290dc6f659906ba871e685c4e641'
SOURCE_PATH = 'JP_TW_EU_CN_US/Trunk/X2Lib/X2GURaven.cpp'
METHODS = ['RSI_COMBO_XX_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontX_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontXX_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontXX2_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontXX3_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontXX4_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXfrontXXdownX_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXdownX_EventProcess',
           'RSI_OVER_TAKER_COMBO_XXdownX_FrameMove',
           'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX_FrameMove',
           'RSI_COMBO_XXX_FrameMove']


def generate(source_cache, recovery_source):
    spec = importlib.util.spec_from_file_location('baseline_commands', Path(__file__).with_name('commands-build.py'))
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    cpp, base_contract = baseline.extract(source_cache, Path(__file__).with_name('commands-compat.hpp'))
    def adapt(before, after):
        nonlocal cpp
        if cpp.count(before) != 1:
            raise ValueError('Missing or ambiguous command host boundary: ' + repr(before[:100]))
        cpp = cpp.replace(before, after)
    raw = recovery_source.read_bytes()
    if sha(raw) != SOURCE_SHA:
        raise ValueError('Recovery source drift')
    methods, records = [], []
    source_bodies = {}
    for name in METHODS:
        body, first, last = extract(raw, ('void CX2GURaven::' + name + '(').encode())
        source_bodies[name] = body
        records.append({'name':name,'file':SOURCE_PATH,'startLine':first,'endLine':last,
                        'sha256':sha(body),'bodySha256':sha(body[body.index(b'{'):body.rindex(b'}')+1]),'bytes':len(body)})
        if name == METHODS[0]:
            old, _, _ = extract(cpp, ('void CX2GURaven::' + name + '(').encode())
            adapt(old, body)
        else:
            methods.append(body)
    # These edits are explicit host storage/dispatch adapters, not source-body edits.
    adapt(b'    void RSI_COMBO_XX_EventProcess();', b'    void RSI_COMBO_XX_EventProcess();\n' +
                      b'\n'.join(('    void '+n+'();').encode() for n in METHODS[1:]))
    adapt(b'static CX2GURaven actor;', b'\n'.join(methods)+b'\nstatic CX2GURaven actor;')
    adapt(b'AWAKEN_REQUEST=38,UNSUPPORTED_ZZZX=39,',
                      b'AWAKEN_REQUEST=38,UNSUPPORTED_ZZZX=39,RSI_OVER_TAKER_COMBO_XXfrontXX=40,RSI_OVER_TAKER_COMBO_XXfrontXX2=41,RSI_OVER_TAKER_COMBO_XXfrontXX3=42,RSI_OVER_TAKER_COMBO_XXfrontXX4=43,RSI_OVER_TAKER_COMBO_XXfrontXXdownX=44,')
    adapt(b'    bool grounded;', b'    struct EventWindow {float keyInputStart,keyInputEnd,stateChange;} m_fEventTime[2];\n    D3DXVECTOR3 sourcePosition,sourceDirection;\n    D3DXVECTOR3 GetPos(){return sourcePosition;}\n    D3DXVECTOR3 GetDirVector(){return sourceDirection;}\n    float GetPowerRate(){return 1.0f;}\n    bool grounded;')
    adapt(b'class CX2GameUnit {};', b'''class CX2GameUnit {};
typedef CX2GameUnit CKTDGObject; // host particle attachment boundary
static int sourceDamageCount,sourceDamageKind,sourceParticleCount;
static float sourceDamagePosition[3],sourceParticlePosition[3];
static bool sourceNameEquals(const wchar_t* a,const wchar_t* b){while(*a&&*a==*b){++a;++b;}return *a==*b;}
struct HostDamageEffect { void CreateInstance(CX2GameUnit*,const wchar_t* name,float,D3DXVECTOR3 p,D3DXVECTOR3,D3DXVECTOR3){
    sourceDamageKind=sourceNameEquals(name,L"DamageEffect_RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX")?1:
        sourceNameEquals(name,L"DamageEffect_RSI_OVER_TAKER_XX_DOWN_X")?2:-1;
    ++sourceDamageCount;sourceDamagePosition[0]=p.x;sourceDamagePosition[1]=p.y;sourceDamagePosition[2]=p.z;} };''')
    adapt(b'struct HostParticles { CKTDGParticleSystem::CParticleEventSequence seq;', b'''struct HostParticles { CKTDGParticleSystem::CParticleEventSequence seq;
    CKTDGParticleSystem::CParticleEventSequence* CreateSequence(CKTDGObject*,const wchar_t* name,D3DXVECTOR3 p){
        if(!sourceNameEquals(name,L"Raven_attackX3Front_Particle01"))return NULL;
        ++sourceParticleCount;sourceParticlePosition[0]=p.x;sourceParticlePosition[1]=p.y;sourceParticlePosition[2]=p.z;return &seq;}''')
    # XXX's complete pinned body runs unchanged. Its manual collision call is an
    # explicit unsupported boundary: target2016 supplies no personal damage
    # data for this state, so no guessed 18-hit resource-only set is substituted.
    adapt(b'namespace std {template<class T> struct vector {void push_back(T){} };}',
          b'namespace std {template<class T> struct vector {void push_back(T){} void resize(int){} };}')
    adapt(b'class CX2GameUnit {};',b'''struct D3DXMATRIX {float _41=0,_42=0,_43=0;};
static void D3DXMatrixIdentity(D3DXMATRIX* m){*m={};}
namespace CKTDXCollision {struct CollisionData {float m_fRadius;D3DXMATRIX* m_pCombineMatrix;};}
struct SourceManualDamage {int attackerType;bool bCanRevenge;CKTDXCollision::CollisionData* pCollisionData;
    struct HitList {void resize(int){}} hitUnitList;};
static int sourceManualDamageCalls,sourceXxxParticleMask;
struct CX2DamageManager {enum {AT_MANUAL_COLLISION_DATA=1};
    bool DamageCheck(SourceManualDamage*){++sourceManualDamageCalls;return false;}};
struct HostData {CX2DamageManager damage;CX2DamageManager* GetDamageManager(){return &damage;}};
static HostData hostData;static HostData* g_pData=&hostData;
class CX2GameUnit {};''')
    adapt(b'    bool grounded;',b'    SourceManualDamage m_DamageData;\n    bool grounded;')
    adapt(b'    SourceManualDamage m_DamageData;',b'    D3DXVECTOR3 sourceHandPosition;\n    SourceManualDamage m_DamageData;')
    adapt(b'actor.anim={before,now,oneshot,ended!=0,period,{0,y,0}};',
          b'actor.anim={before,now,oneshot,ended!=0,period,state==CX2GURaven::RSI_COMBO_XXX?actor.sourceHandPosition:D3DXVECTOR3{0,y,0}};')
    adapt(b'actor.m_FrameDataNow.unitCondition.dirVector={1,0,0};',
          b'actor.m_FrameDataNow.unitCondition.dirVector=state==CX2GURaven::RSI_COMBO_XXX?actor.sourceDirection:D3DXVECTOR3{1,0,0};')
    adapt(b'bool bAttackerFront;D3DXVECTOR3 dirVector;',b'bool bAttackerFront;D3DXVECTOR3 dirVector;bool bHit;')
    adapt(b'        if(!sourceNameEquals(name,L"Raven_attackX3Front_Particle01"))return NULL;',b'''        const int xxxTag=sourceNameEquals(name,L"Smoke_Raven_ComboX03")?1:
            sourceNameEquals(name,L"Smoke_Raven_ComboX01")?2:sourceNameEquals(name,L"Flare_Raven_ComboX02")?4:0;
        if(xxxTag)sourceXxxParticleMask|=xxxTag;
        if(!xxxTag&&!sourceNameEquals(name,L"Raven_attackX3Front_Particle01"))return NULL;''')
    adapt(b'struct HostGame {HostWorld world;', b'struct HostGame {HostDamageEffect damage;HostDamageEffect* GetDamageEffect(){return &damage;} HostWorld world;')
    adapt(b'    effectSetCalls=effectStopCalls=magicFailCalls=cameraCalls=0;', b'    effectSetCalls=effectStopCalls=magicFailCalls=cameraCalls=0;sourceDamageCount=sourceDamageKind=sourceParticleCount=0;')
    adapt(b'sourceDamageCount=sourceDamageKind=sourceParticleCount=0;',b'sourceDamageCount=sourceDamageKind=sourceParticleCount=sourceManualDamageCalls=sourceXxxParticleMask=0;')
    extra = b'\n'.join(('        case CX2GURaven::'+n.removesuffix('_EventProcess')+':actor.'+n+'();handled=true;break;').encode() for n in METHODS[1:] if n.endswith('_EventProcess'))
    # The dispatch shim is project-owned; the whole unit is canonicalized to LF
    # after composition, so either checkout line ending is accepted here.
    markers=[b'    }else if(phase==1){'+newline+b'        switch(state){' for newline in (b'\n',b'\r\n')]
    matches=[marker for marker in markers if cpp.count(marker)==1]
    if len(matches)!=1:raise ValueError('Missing or ambiguous owned command dispatch')
    adapt(matches[0],matches[0]+b'\n'+extra+b'\n')
    adapt(b'    }else if(phase==3&&state==CX2GURaven::RRF_DASH_JUMP_COMBO_X){',
                      b'    }else if(phase==3&&state==CX2GURaven::RSI_COMBO_XXX){actor.RSI_COMBO_XXX_FrameMove();handled=true;\n    }else if(phase==3&&state==CX2GURaven::RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX){actor.RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX_FrameMove();handled=true;\n    }else if(phase==3&&state==CX2GURaven::RSI_OVER_TAKER_COMBO_XXdownX){actor.RSI_OVER_TAKER_COMBO_XXdownX_FrameMove();handled=true;\n    }else if(phase==3&&state==CX2GURaven::RRF_DASH_JUMP_COMBO_X){')
    cpp += b'''\nextern "C" {
void set_recovery_windows(float a,float b,float c,float d,float e,float f){actor.m_fEventTime[0]={a,b,c};actor.m_fEventTime[1]={d,e,f};}
void set_recovery_position(float x,float y,float z,float dx,float dy,float dz){actor.sourcePosition={x,y,z};actor.sourceDirection={dx,dy,dz};}
void set_recovery_hand_position(float x,float y,float z){actor.sourceHandPosition={x,y,z};}
int recovery_damage_count(){return sourceDamageCount;}
int recovery_damage_kind(){return sourceDamageKind;}
unsigned int recovery_damage_position(){return (unsigned int)(__UINTPTR_TYPE__)&sourceDamagePosition;}
int recovery_particle_count(){return sourceParticleCount;}
unsigned int recovery_particle_position(){return (unsigned int)(__UINTPTR_TYPE__)&sourceParticlePosition;}
int recovery_source_marker(){return 11;}
int recovery_xxx_particle_mask(){return sourceXxxParticleMask;}
int recovery_manual_damage_calls(){return sourceManualDamageCalls;}
}
'''
    # Raw source/body hashes retain their upstream CRLF as byte evidence. The
    # generated translation unit has a separate canonical identity; its template comes
    # from this checkout and may be LF or CRLF depending on git eol settings.
    # The composed unit is therefore canonicalized to LF-only, so both the
    # compiled translation unit and generatedCppSha256 are reproducible on any
    # checkout. sourceBodyCrlfCounts records the discarded layout.
    crlf_in_bodies = sum(source_bodies[name].count(b'\r\n') for name in METHODS)
    raw_cpp = cpp
    cpp = cpp.replace(b'\r\n', b'\n')
    composition = {'compositionReproducible': True,
        'compositionInputs': {'sourceCache': '.cache/native-source-runtime',
            'hostCompat': 'tools/native/commands-compat.hpp',
            'recoverySource': '.cache/reference-combat-fixes-v11/X2GURaven.cpp'}}
    return cpp, {'schemaVersion':1,'sourceCommit':COMMIT,'sourcePath':SOURCE_PATH,'sourceSha256':SOURCE_SHA,
        'lineEndingRule':('LF-only canonical unit: pinned source bodies inserted verbatim (upstream CRLF recorded in '
            'this contract), then every CRLF in the composed unit replaced with LF before writing, hashing and '
            'compiling, so neither the unit nor its hash depends on checkout eol settings'),
        'sourceBodyCrlfCounts':[{'name':name,'crlf':source_bodies[name].count(b'\r\n')} for name in METHODS],
        'sourceBodyCrlfTotal':crlf_in_bodies,
        'crlfRemovedBeforeHashing':raw_cpp.count(b'\r\n'),
        'sourceGitBlob':git_blob(raw),'sourceBytes':len(raw),'functions':records,
        **composition,
        'baselineReferenceCommit':baseline.COMMIT,'generatedCppSha256':sha(cpp),
        'baselineSourceFunctionsReused':49,'evidenceClass':'2026-source-reconstruction-of-reference-2015; not-target-2016',
        'boundaries':['Target EVENT_PROCESS_TIME0/1 values supplied as binary32; baseline absent defaults {0,9999,9999}',
            'GetPos/GetDirVector/power and CommonFrameMove are explicit host boundaries',
            'Damage names are captured as bounded host enum tags; unknown tags are rejected by the JS boundary',
            'XXdownX .3 particle CreateSequence is captured, not emulated; missing original visual assets remain unsupported',
            'XXX .16 / FlushMp7 / three smoke-flare sequences use the whole pinned source body; target2016 callback remains unavailable',
            'XXX manual DamageCheck is captured as unsupported and returns false: no target2016 personal damage data is available, no resource-only damage owner is guessed',
            'The source comment claims official2015 disassembly; that independent disassembly has not been acquired',
            '2016 callback equivalence remains unmeasured; target tables supply damage/timing/motion, not the new source'],
        'numericMode':'binary32, no fast-math or FP contraction'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-cache',type=Path,default=ROOT/'.cache/native-source-runtime')
    p.add_argument('--recovery-source',type=Path,default=ROOT/'.cache/reference-combat-fixes-v11/X2GURaven.cpp')
    p.add_argument('--out-dir',type=Path,default=ROOT/'artifacts/native/commands-recovery')
    p.add_argument('--zig',type=Path,help='task-local compiler; omit with --extract-only to regenerate only the pinned translation unit and contract')
    p.add_argument('--extract-only',action='store_true',help='write a separate extracted translation unit and extraction contract without changing any published compiled artifact')
    args=p.parse_args()
    if not args.extract_only and not args.zig:
        p.error('--zig is required unless --extract-only is given')
    cpp,contract=generate(args.source_cache,args.recovery_source)
    args.out_dir.mkdir(parents=True,exist_ok=True)
    if args.extract_only:
        # Extraction is not compilation. Never attach an older module/compiler
        # record to newly composed source, or overwrite the unit named by that
        # published record. A later real compiler invocation publishes its own
        # matching generated unit, compiler metadata and module hash together.
        cpp_path=args.out_dir/'commands-recovery.extracted.cpp'
        cpp_path.write_bytes(cpp)
        contract['compilationStatus']='not-compiled'
        contract['extractedCppFile']=cpp_path.name
        (args.out_dir/'extraction-contract.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf8')
        print(json.dumps({'output':str(args.out_dir),'functions':len(contract['functions']),'extractOnly':True,
            'generatedCppSha256':contract['generatedCppSha256'],'compilationStatus':'not-compiled'}))
        return
    cpp_path=args.out_dir/'commands-recovery.generated.cpp';cpp_path.write_bytes(cpp)
    wasm=args.out_dir/'commands-recovery.wasm'
    env=os.environ.copy();env['ZIG_LOCAL_CACHE_DIR']=str(ROOT/'.cache/commands-recovery/zig-local');env['ZIG_GLOBAL_CACHE_DIR']=str(ROOT/'.cache/commands-recovery/zig-global')
    exports=['run_callback','result_ptr','result_count','command_abi_version','set_recovery_windows','set_recovery_position','set_recovery_hand_position','recovery_damage_count','recovery_damage_kind','recovery_damage_position','recovery_particle_count','recovery_particle_position','recovery_source_marker','recovery_xxx_particle_mask','recovery_manual_damage_calls']
    flags=['c++',str(cpp_path),'-target','wasm32-freestanding','-nostdlib','-fno-exceptions','-fno-rtti','-ffp-contract=off','-fno-fast-math','-O2','-Wno-invalid-utf8','-Wno-extra-tokens','-Wl,--no-entry','-Wl,--export-memory']+[ '-Wl,--export='+n for n in exports]
    run=subprocess.run([str(args.zig),*flags,'-o',str(wasm)],capture_output=True,encoding='utf8',errors='replace',env=env)
    if run.returncode:raise RuntimeError(run.stdout+run.stderr)
    contract['compiler']={'version':subprocess.check_output([str(args.zig),'version'],text=True).strip(),'exeSha256':sha(args.zig.read_bytes()),'flags':flags[2:]}
    contract['wasm']={'bytes':wasm.stat().st_size,'sha256':sha(wasm.read_bytes())}
    contract['compilationStatus']='compiled'
    contract['compilation']={'generatedCppSha256':sha(cpp_path.read_bytes()),
        'moduleSha256':contract['wasm']['sha256'],'compilerExeSha256':contract['compiler']['exeSha256']}
    (args.out_dir/'source-contract.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'output':str(args.out_dir),'functions':len(contract['functions']),'wasm':contract['wasm']}))


if __name__=='__main__':main()
