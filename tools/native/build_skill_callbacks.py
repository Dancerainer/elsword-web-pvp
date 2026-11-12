"""Compile unchanged pinned RF skill callbacks with a bounded host ABI."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
SOURCE_SHA='e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'
CONSTANTS_SHA='072559b9b5dbfcc8520906e1b775198470fc514635e766d50428ecaa9aa1cbb5'
USER_HEADER_SHA='c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc'
LOCKON_HEADER_SHA='eb9034b22594cb80561bceae3b2d7312637e03aacef3050d4c04caa4f2cf0f60'
COMMIT='a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
ANIMATION_SHA={
    'KTDGXSkinAnim.h':'03ab46e51d622495dd15d800f664440b0c63f3b9875f7d7692f8435cbda206a4',
    'KTDGXSkinAnim.cpp':'4ff5e681c5b63eb828d00e0e6fc848066af93ed39b0750615765da248911c76d',
}
ARC_MACRO_SOURCE_SHA={'KTDX.h':'0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf',
                      'Always.h':'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069'}
FUNCTIONS=[
    'RSI_SA_RRF_WILD_CHARGE_READY_EventProcess',
    'RSI_SA_RRF_WILD_CHARGING_FrameMove',
    'RSI_SA_RRF_WILD_CHARGING_EventProcess',
    'RSI_SA_RRF_WILD_CHARGE_DASH_FrameMove',
    'RSI_SA_RRF_WILD_CHARGE_DASH_EventProcess',
    'RSI_A_RRF_LIMIT_CRUSHER_CHARGE_EventProcess',
    'RSI_A_RWT_FLAME_SWORD_EventProcess',
    'RSI_A_RWT_FLAME_SWORD_GROUND_EventProcess',
    'RSI_A_RWT_FLAME_SWORD_AIR_EventProcess',
    'RSI_SI1_MAXIMUM_CANNON_EventProcess',
    'RSI_SI2_CANNON_BLADE_EventProcess',
    'RSI_SI3_SEVEN_BURST_EventProcess',
    'RSI_SI1_OVER_TAKER_CHARGED_BOLT_EventProcess',
    'RSI_A_RF_MEGADRILL_BREAK_EventProcess',
    'RSI_A_ROT_WEAPON_BREAK_EventProcess',
    'RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE_EventProcess',
    'RSI_A_ROT_NUCLEAR_EventProcess',
    'RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK_EventProcess',
    'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK_EventProcess',
    'RSI_SI2_OVER_TAKER_ARC_ENEMY_EventProcess',
    'SI_SA_RRF_X_CRASH_EventProcess',
    'RSI_HA_RRF_INFERNAL_ARM_EventProcess',
    'RSI_SA_ROT_VALKYRIESJAVELIN_EventProcess',
    'RSI_SA_ROT_VALKYRIESJAVELIN_LANDING_EventProcess',
    'RSI_SI2_POWER_ASSAULT_EventProcess',
    'RSI_SI1_OVER_TAKER_CHARGED_BOLT_FrameMove',
    'RSI_SI2_OVER_TAKER_ARC_ENEMY_FrameMove',
]
ARC_HELPERS=['ClearArcEnemyData','AttackResultPlayEffect']
SHADOW_FUNCTIONS=[
    'RSI_SI_A_RF_SHADOW_STEP_Init','RSI_SI_A_RF_SHADOW_STEP_StartFuture',
    'RSI_SI_A_RF_SHADOW_STEP_Start','RSI_SI_A_RF_SHADOW_STEP_FrameMove',
    'RSI_SI_A_RF_SHADOW_STEP_EventProcess','RSI_SI_A_RF_SHADOW_STEP_End',
    'RSI_SHADOW_STEP_THRUST_Init','RSI_SHADOW_STEP_THRUST_Start','RSI_SHADOW_STEP_THRUST_EventProcess',
    'RVC_SI_P_SHADOW_BACK_SLIDE_StartFuture','RVC_SI_P_SHADOW_BACK_SLIDE_Start',
    'RVC_SI_P_SHADOW_BACK_SLIDE_FrameMove','RVC_SI_P_SHADOW_BACK_SLIDE_EventProcess','RVC_SI_P_SHADOW_BACK_SLIDE_End',
    'RVC_SI_P_SHADOW_BACK_SLIDE_END_FrameMoveFuture','RVC_SI_P_SHADOW_BACK_SLIDE_END_EventProcess',
    'RVC_SI_P_SHADOW_BUSTER_Init','RVC_SI_P_SHADOW_BUSTER_Start','RVC_SI_P_SHADOW_BUSTER_FrameMove','RVC_SI_P_SHADOW_BUSTER_EventProcess',
    'RSI_P_RBM_SHADOW_STEP_THRUST_Init','RSI_P_RBM_SHADOW_STEP_THRUST_Start','RSI_P_RBM_SHADOW_STEP_THRUST_EventProcess',
    'RSI_P_RRF_SHADOW_PUNISHER_Init','RSI_P_RRF_SHADOW_PUNISHER_Start','RSI_P_RRF_SHADOW_PUNISHER_EventProcess',
    'SetShadowStepAttackSkill','InitShadowStep',
]
DRILL_FUNCTIONS=[
    'RSI_A_RF_MEGADRILL_BREAK_FrameMoveFuture',
    'RSI_A_RF_MEGADRILL_BREAK_FrameMove',
    'RSI_A_RF_MEGADRILL_BREAK_End',
]
MOTION_FUNCTIONS=['RSI_SI2_POWER_ASSAULT_FrameMoveFuture','RSI_SI3_SEVEN_BURST_FrameMoveFuture']
XCRASH_FUNCTIONS=['SI_SA_RRF_X_CRASH_FrameMove']
ARC_HYPER_FUNCTIONS=['RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove']
EXTRA_FUNCTIONS=['RSI_SA_ROT_VALKYRIESJAVELIN_StateStart','RSI_SA_ROT_VALKYRIESJAVELIN_FrameMove',
    'RSI_SA_ROT_VALKYRIESJAVELIN_StateEnd','RSI_SA_RRF_WILD_CHARGE_READY_FrameMove',
    'RSI_SA_RRF_WILD_CHARGING_StateStart','RSI_SA_RRF_WILD_CHARGING_StateEnd']
REPAIRED_SOURCE_SHA='b6c8db97bea7d086a430ca069f4c047c9fb0290dc6f659906ba871e685c4e641'
REPAIRED_COMMIT='a1bcdabf39ee1699873b587b40cedefcce61c7f0'
def sha(data):return hashlib.sha256(data).hexdigest()
def extract(source):
    if sha(source)!=SOURCE_SHA:raise ValueError('Pinned Raven source hash mismatch')
    fragments=[];records=[]
    for name in FUNCTIONS+ARC_HELPERS+SHADOW_FUNCTIONS+DRILL_FUNCTIONS+MOTION_FUNCTIONS+XCRASH_FUNCTIONS+ARC_HYPER_FUNCTIONS:
        pattern=rb'void CX2GURaven::'+name.encode()+rb'\s*\([^)]*\)'
        matches=list(re.finditer(pattern,source))
        if len(matches)!=1:raise ValueError('Missing or duplicate original function: '+name)
        start=matches[0].start()
        # Comments may contain unmatched braces and closing preprocessor groups
        # after a method. Mask them without moving byte offsets.
        tail=source[start:]
        masked=re.sub(rb'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"',
                      lambda m:b' '*len(m.group()),tail,flags=re.DOTALL)
        depth=0;end=0
        for offset,char in enumerate(masked[masked.index(b'{'):],masked.index(b'{')):
            if char==123:depth+=1
            if char==125:
                depth-=1
                if not depth:end=start+offset+1;break
        if end<=start:raise ValueError('Malformed original function: '+name)
        fragment=source[start:end]
        fragments.append(fragment)
        records.append({'name':name,'file':'X2Lib/X2GURaven.cpp','startLine':source[:start].count(b'\n')+1,
                        'endLine':source[:end].count(b'\n')+1,'sha256':sha(fragment),
                        'bodySha256':sha(fragment[fragment.index(b'{'):]),'bytes':len(fragment)})
    return b'\n\n'.join(fragments)+b'\n',records
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--zig',type=Path,required=True)
    p.add_argument('--source-cache',type=Path,default=ROOT/'.cache/native-source-runtime')
    p.add_argument('--output-dir',type=Path,default=ROOT/'.cache/native-skills-generated')
    args=p.parse_args();out=args.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
    source=(args.source_cache/'X2Lib/X2GURaven.cpp').read_bytes();code,records=extract(source)
    constants=(args.source_cache/'X2Lib/X2GameUnit.h').read_bytes()
    if sha(constants)!=CONSTANTS_SHA or b'#define LINE_RADIUS 30.0f' not in constants:
        raise ValueError('Original LINE_RADIUS constant drift')
    (out/'original_skill_methods.inc').write_bytes(code)
    # The repository owner's 2026 reconstruction repairs the stale Valkyrie
    # effect name. Keep its own commit/hash: it is not official 2016 source.
    repaired=(ROOT/'.cache/reference-combat-fixes-v11/X2GURaven.cpp').read_bytes()
    if sha(repaired)!=REPAIRED_SOURCE_SHA:raise ValueError('Reconstructed skill source hash mismatch')
    extra_fragments=[];extra_records=[]
    for index,name in enumerate(EXTRA_FUNCTIONS):
        raw=repaired if index<3 else source
        match=re.search(rb'void CX2GURaven::'+name.encode()+rb'\s*\([^)]*\)',raw)
        if not match:raise ValueError('Extra original function missing: '+name)
        start=match.start();tail=raw[start:]
        masked=re.sub(rb'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"',lambda m:b' '*len(m.group()),tail,flags=re.DOTALL)
        depth=0;end=None
        for i,c in enumerate(masked[masked.index(b'{'):],masked.index(b'{')):
            depth+=(c==123)-(c==125)
            if depth==0:end=start+i+1;break
        if end is None:raise ValueError('Malformed extra function: '+name)
        fragment=raw[start:end];extra_fragments.append(fragment)
        extra_records.append({'name':name,'file':'X2Lib/X2GURaven.cpp','startLine':raw[:start].count(b'\n')+1,
            'endLine':raw[:end].count(b'\n')+1,'sha256':sha(fragment),'bodySha256':sha(fragment[fragment.index(b'{'):]),
            'bytes':len(fragment),'sourceCommit':REPAIRED_COMMIT if index<3 else COMMIT,'sourceFileSha256':sha(raw),
            'evidenceClass':'2026-reconstructed-V5-reference-not2016' if index<3 else 'reference-V5-not2016'})
    (out/'original_extra_skill_methods.inc').write_bytes(b'\n\n'.join(extra_fragments)+b'\n')
    lock_source=(args.source_cache/'X2Lib/X2DamageEffect.cpp').read_bytes()
    if sha(lock_source)!='8a76540f2d6e318ce474cf6d63e1822be3d90b880f647bae480f26ea3d6afed8':raise ValueError('VectorLockOn source hash drift')
    start=lock_source.index(b'void CX2DamageEffect::CEffect::VectorLockOn(')
    end=lock_source.index(b'\n}\n',start)+2
    lock_fragment=lock_source[start:end]
    (out/'original_vector_lockon.inc').write_bytes(lock_fragment+b'\n')
    extra_records.append({'name':'CX2DamageEffect::CEffect::VectorLockOn','file':'X2Lib/X2DamageEffect.cpp',
        'startLine':lock_source[:start].count(b'\n')+1,'endLine':lock_source[:end].count(b'\n')+1,
        'sha256':sha(lock_fragment),'bodySha256':sha(lock_fragment[lock_fragment.index(b'{'):]),'bytes':len(lock_fragment),
        'sourceCommit':COMMIT,'sourceFileSha256':sha(lock_source),'evidenceClass':'reference-V5-not2016',
        'compileFlags':'NEW_CHARACTER_CHUNG/FINALITY_SKILL_SYSTEM optional branches disabled; base interpolation preserved'})
    arc_records=[]
    for name,lo,hi in [('original_arc_follow.inc',5351,5428),
                       ('original_arc_cooldown.inc',5478,5481),
                       ('original_arc_lifecycle.inc',17121,17142)]:
        fragment=b''.join(source.splitlines(keepends=True)[lo-1:hi])
        (out/name).write_bytes(fragment)
        arc_records.append({'file':'X2Lib/X2GURaven.cpp','startLine':lo,'endLine':hi,
                            'sourceFileSha256':SOURCE_SHA,'sha256':sha(fragment),'bytes':len(fragment)})
    header=(args.source_cache/'X2Lib/X2GUUser.h').read_bytes()
    if sha(header)!=USER_HEADER_SHA:raise ValueError('Original skip macro header drift')
    lines=header.splitlines(keepends=True)
    macros=b''.join(lines[196:201])+b'\n'+b''.join(lines[205:211])
    (out/'original_skill_macros.inc').write_bytes(macros)
    animation_records=[]
    for file,lo,hi,output_file in [('KTDGXSkinAnim.h',228,231,'original_skill_timer_inline.inc'),
                                  ('KTDGXSkinAnim.cpp',1350,1357,'original_skill_timer_out.inc')]:
        raw=(args.source_cache/'KTDXLIB'/file).read_bytes()
        if sha(raw)!=ANIMATION_SHA[file]:raise ValueError('Original animation timer source drift: '+file)
        fragment=b''.join(raw.splitlines(keepends=True)[lo-1:hi])
        (out/output_file).write_bytes(fragment)
        animation_records.append({'file':'KTDXLIB/'+file,'startLine':lo,'endLine':hi,
            'sourceFileSha256':sha(raw),'sha256':sha(fragment)})
    lockon=(args.source_cache/'X2Lib/X2DamageEffect.h').read_bytes()
    if sha(lockon)!=LOCKON_HEADER_SHA:raise ValueError('Original LockOnData header drift')
    lockon_fragment=b''.join(lockon.splitlines(keepends=True)[521:529])
    if not re.search(rb'm_LockOnUnitUID\s*=\s*-1',lockon_fragment) or not re.search(rb'm_LockOnNPCUID\s*=\s*-1',lockon_fragment):
        raise ValueError('Original LockOnData sentinel declaration drift')
    arc_macro_records=[];shadow_macro_records=[]
    for file,lo,name in [('KTDX.h',328,'X2OPTIMIZE_PARTICLE_AND_ETC_HANDLE'),
                          ('Always.h',3317,'BALANCE_PATCH_20110303')]:
        raw=(args.source_cache/'KTDXLIB'/file).read_bytes()
        if sha(raw)!=ARC_MACRO_SOURCE_SHA[file]:raise ValueError('Original Archenemy macro source drift: '+file)
        fragment=raw.splitlines(keepends=True)[lo-1]
        if not re.match(rb'\s*#define\s+'+name.encode()+rb'(?:\s|$)',fragment):raise ValueError('Original Archenemy macro moved: '+name)
        arc_macro_records.append({'name':name,'file':'KTDXLIB/'+file,'line':lo,'sourceFileSha256':sha(raw),'sha256':sha(fragment)})
    raw=(args.source_cache/'KTDXLIB/Always.h').read_bytes()
    for lo,name in [(1651,'UPGRADE_SKILL_SYSTEM_2013'),(2090,'BALANCE_BLADE_MASTER_20130117')]:
        fragment=raw.splitlines(keepends=True)[lo-1]
        if not re.match(rb'\s*#define\s+'+name.encode()+rb'(?:\s|$)',fragment):raise ValueError('Original Shadow macro moved: '+name)
        shadow_macro_records.append({'name':name,'file':'KTDXLIB/Always.h','line':lo,'sourceFileSha256':sha(raw),'sha256':sha(fragment)})
    adapter=Path(__file__).with_name('skill_source_adapter.cpp');cpp=out/'skills.generated.cpp'
    generated=adapter.read_bytes().replace(b'// @@METHOD_DECLARATIONS@@',
        b'\n'.join(('void '+name+'();').encode() for name in FUNCTIONS[6:]+SHADOW_FUNCTIONS[:-2]+DRILL_FUNCTIONS+MOTION_FUNCTIONS+XCRASH_FUNCTIONS+ARC_HYPER_FUNCTIONS))
    generated=generated.replace(b'// @@METHOD_DISPATCH@@',
        b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(FUNCTIONS[6:],5))+b'\nif(kind==69)r.SI_SA_RRF_X_CRASH_FrameMove();\nif(kind==70)r.RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove();')
    generated=generated.replace(b'// @@SHADOW_DISPATCH@@',
        b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(SHADOW_FUNCTIONS[:-2],28))+
        b'\nif(kind==54)r.SetShadowStepAttackSkill(shadowSnapshot[25].i);\nif(kind==55)r.InitShadowStep();')
    generated=generated.replace(b'// @@DRILL_DISPATCH@@',
        b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(DRILL_FUNCTIONS+MOTION_FUNCTIONS,56)))
    generated=generated.replace(b'// @@EXTRA_DECLARATIONS@@',b'\n'.join(('void '+name+'();').encode() for name in EXTRA_FUNCTIONS))
    generated=generated.replace(b'// @@EXTRA_DISPATCH@@',b'\n'.join(('if(kind=='+str(i)+')r.'+name+'();').encode() for i,name in enumerate(EXTRA_FUNCTIONS,61))+b'\nif(kind==67)r.RSI_SA_RRF_WILD_CHARGING_EventProcess();\nif(kind==68)r.RSI_SA_RRF_WILD_CHARGING_FrameMove();')
    cpp.write_bytes(generated)
    os.environ['ZIG_LOCAL_CACHE_DIR']=str(ROOT/'.cache/native-skills/zig-local')
    os.environ['ZIG_GLOBAL_CACHE_DIR']=str(ROOT/'.cache/native-skills/zig-global')
    binary=out/'skills.wasm'
    flags=['c++',str(cpp),'-target','wasm32-freestanding','-nostdlib','-fno-exceptions','-fno-rtti',
           '-ffp-contract=off','-fno-fast-math','-O2','-g0','-Wno-invalid-utf8','-Wno-extra-tokens',
           '-Wl,--no-entry','-Wl,--export-memory','-Wl,--initial-memory=2097152']
    flags += ['-Wl,--export='+x for x in ('skills_eval','skills_output_ptr','skills_output_count','skills_arc_snapshot_ptr','skills_arc_snapshot_words','skills_oneshot_timer','skills_shadow_snapshot_ptr','skills_shadow_snapshot_words','skills_drill_snapshot_ptr','skills_drill_snapshot_words','skills_motion_snapshot_ptr','skills_motion_snapshot_words','skills_extra_snapshot_ptr','skills_extra_snapshot_words','skills_vector_lockon_ptr','skills_vector_lockon_words','skills_vector_lockon_eval','skills_xcrash_snapshot_ptr','skills_xcrash_snapshot_words','skills_effect_hyper_mask','skills_callback_group_count')]
    result=subprocess.run([str(args.zig.resolve()),*flags,'-o',str(binary)],capture_output=True,text=True,encoding='utf-8',errors='replace')
    if result.returncode:raise RuntimeError(result.stdout+result.stderr)
    contract={'schemaVersion':2,'sourceCommit':COMMIT,'sourceFileSha256':SOURCE_SHA,'functions':records,
              'constants':{'file':'X2Lib/X2GameUnit.h','sha256':CONSTANTS_SHA,'LINE_RADIUS':30},
              'macros':{'file':'X2Lib/X2GUUser.h','sourceFileSha256':USER_HEADER_SHA,'lines':[[197,201],[206,211]],'sha256':sha(macros)},
              'animationFunctions':animation_records,'arcSourceFragments':arc_records,'callbackGroups':70,
              'callbackGroupCount':70,'callbackGroupIds':list(range(1,71)),'vectorLockOnSeparateExport':True,
              'arcHyperGroup':70,'arcHyperTargetBinaryVerified':False,
              'xCrashSnapshotWords':6,'xCrashGroup':69,
              'effectHyperModeExport':'skills_effect_hyper_mask',
              'effectHyperModeEvidence':'PlayEffectSet explicit bool; fixed X2EffectSet.cpp:1866 saved m_bHyper; delayed HYPER_NAME consumer, target executable unmeasured',
              'extraFunctions':extra_records,'extraSourceCommit':REPAIRED_COMMIT,'extraSourceSha256':REPAIRED_SOURCE_SHA,
              'extraSnapshotWords':8,
              'drillSnapshotWords':25,'drillGroups':{name:i for i,name in enumerate(DRILL_FUNCTIONS,56)},
              'motionSnapshotWords':2,'motionGroups':{name:i for i,name in enumerate(MOTION_FUNCTIONS,59)},
              'drillTargetBinaryVerified':False,
              'arcSnapshotWords':304,'arcSnapshotVersion':1,
              'shadowSnapshotWords':48,'shadowSnapshotVersion':1,
              'shadowGroups':{name:i for i,name in enumerate(SHADOW_FUNCTIONS,28)},
              'shadowTargetBindingVerified':False,
              'shadowMacroEvidence':shadow_macro_records,
              'shadowMacros':{'UPGRADE_SKILL_SYSTEM_2013':True,'BALANCE_BLADE_MASTER_20130117':True,
                 'SERV_RAVEN_VETERAN_COMMANDER':{'enabled':True,'evidence':'Explicit fixed-reference branch; target2016 native binding not acquired'}},
              'arcMacroEvidence':arc_macro_records,
              'arcLockOnConstructor':{'file':'X2Lib/X2DamageEffect.h','startLine':522,'endLine':529,
                'sourceFileSha256':LOCKON_HEADER_SHA,'sha256':sha(lockon_fragment),
                'unitUIDOriginal':-1,'unitUIDHost32':4294967295,'npcUID':-1},
              'arcMacros':{'X2OPTIMIZE_PARTICLE_AND_ETC_HANDLE':True,'BALANCE_PATCH_20110303':True,
                           'SERV_SKILL_NOTE':{'enabled':True,'evidence':'explicit reference conditional-branch compile policy; target2016 native binding not verified'}},
              'adapterSha256':sha(adapter.read_bytes()),'wasm':{'file':'skills.wasm','sha256':sha(binary.read_bytes()),'bytes':binary.stat().st_size},
              'targetClientMeasured':False,'evidenceClass':'mixed-fixed-V5-and-2026-reconstructed-reference-not2016',
              'hostBoundary':['Snapshot-provided animation time/end, input and HP/charge data',
                              'Effect/sound command sinks; existing common state executor',
                              'Cancellation macro boundary recorded and handled by common input executor',
                              'Skill-slot swaps disabled by eight-key UI requirement',
                              'ChargedBolt group24 is OnFrameMove using Now track, not FrameMoveFuture',
                              'ChargedBolt damage/particle sinks copy original names, position, rotation, landY, power and execution animationTime',
                              'XCrash group69 compiles the complete fixed-V5 Now callback; six-float snapshot supplies real current Bip01 and previously captured m_vXCrashPos',
                              'XCrash1.166 capture and1.31 normal/HYPER no-damage creation preserve original oneshot, position, rotation and power; target2016 executable binding remains unverified',
                              'XCrash IsHyperState reads an explicitly frozen registered-skill state flag through group69 existing awake ABI slot; remaining awakening seconds cannot change the selected state',
                              'World-color/cut-in/camera calls are counted disabled sinks; unknown HYPER aliases are never added',
                              'Archenemy: groups25 normal FrameMove,70 original HYPER FrameMove,26 unchanged CommonFrameMove follow/cooldown fragments,27 AttackResultPlayEffect',
                              'Original ArcEnemyData constructor/destructor and ClearArcEnemyData run with bounded pointer-vector/handle storage',
                              'Explicit serializable effect/mesh snapshot, 32-bit UID/handle host limit, up to4 owned spears and8 effect records',
                              'Original rand() values are explicit host input, not an invented RNG algorithm',
                              'Windows CRT rand() host range is explicit0..32767; the original rand()%10 expression is unchanged',
                              'Full CX2GUUser::AttackResultPlayEffect and other CommonFrameMove systems remain counted host boundaries',
                              'Archenemy target30s comes from target mesh LifeType/LifeTime, not an invented m_TimerFlyingImpact consumer',
                              'Target761-percent description vs effect raw4.48/APPLIED_SKILL_ID mismatch remains unresolved; no invented damage override',
                              'Special/Hyper exclusions live in an explicitly labeled target-description host adapter, not the unchanged V5 hit callback',
                              'Shadow groups28..55 preserve28 original methods including Init/Start/StartFuture/Frame/End and select/reset helpers',
                              'Shadow48-word snapshot supplies old2013 passive flags, skill getters, MP, frame-stop, render alpha/afterimage/gauge and power fields explicitly',
                              'Shadow symbolic state tags are project ABI labels, not copied native state enum numbers',
                              'Shadow Common callbacks, dash fallback, MP-stat handlers, UI and resource preparation are bounded counted host sinks',
                              'No automatic mapping from target2016 Z/X/upgraded state names to old2013 passive gates; signed duration and additional10MP are preserved',
                              'MegaDrill groups56 Future,57 Now,58 End preserve3 complete original method byte ranges and original else-if priority',
                              'MegaDrill25-word snapshot supplies original dash getter, current local speed, hit-list count, attack box enables, damage-change time and hand bone explicitly',
                              'MegaDrill SimpleInit is a bounded hit-list/reAttack/hitGap/backSpeed reset sink; whole original damage object is not executed',
                              'MegaDrill SetDamageData requests whole target DAMAGE_DATA_NEXT loading; temporary reset fields are not final target damage data',
                              'MegaDrill helper creation/lookup factory results are supplied handle/existence inputs; no invented native IDs or effect lifetimes',
                              'MegaDrill helper names and hand-bone follow requests remain separate from verified renderer lifecycle; original End restores Lhand1/Sword then calls counted CommonStateEnd',
                              'PowerAssault59/SevenBurst60 complete original Future methods write distinct local nowSpeed/passiveSpeed via an explicit2-float snapshot; no guessed time-based position displacement',
                              'Valk61..63 are exact2026-reconstructed-V5 byte ranges; target2016 effect-set spelling independently matches but target native consumer remains unverified',
                              'Wild64..66 preserve fixed-V5 Now/Start/End, including +30/-30 reduction member and charging effect stop',
                              'Wild67 Event and68 Now are separate original phases; native legacy10sec/lost-HP semantics are preserved, not interpolated to target .75/1.5',
                              'VectorLockOn11-float bridge executes complete unchanged fixed-V5 CEffect method with explicit current/target position, manual direction, curve speed and elapsed time',
                              'VectorLockOn mesh/getter and current build feature-macro branches are bounded host adapters, not the whole target effect engine'],
              'compiler':{'name':'Zig','version':subprocess.check_output([str(args.zig.resolve()),'version'],text=True).strip(),'flags':flags[2:]}}
    (out/'source-contract.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'functions':len(records)+len(extra_records),'wasm':contract['wasm']}))
if __name__=='__main__':main()
