"""Compile unchanged, hash-pinned RF command callbacks (reference V5, not 2016)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
HASHES = {
    'X2Lib/X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'X2Lib/X2GUUser.h': 'c0f49d892b2639281d0196f90ff650d52421887bbad43189e6d6b9d841937adc',
    'X2Lib/X2GUUser.cpp': 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
    'X2Lib/X2GameUnit.h': '072559b9b5dbfcc8520906e1b775198470fc514635e766d50428ecaa9aa1cbb5',
    'KTDXLIB/KTDGXSkinAnim.h': '03ab46e51d622495dd15d800f664440b0c63f3b9875f7d7692f8435cbda206a4',
    'KTDXLIB/KTDGXSkinAnim.cpp': '4ff5e681c5b63eb828d00e0e6fc848066af93ed39b0750615765da248911c76d',
    'KTDXLIB/Always.h': 'a891fefd95c54a4c7382e6a23a80617360d8e343088145c58cba780545f65069',
    'KTDXLIB/KTDX.h': '0097cffed97c4446e45fd586cc873290e6770a93e03b3bc7873383fb85d297cf',
}
RAVEN = 'X2Lib/X2GURaven.cpp'
FRAGMENTS = {
    'MACROS': [('X2Lib/X2GameUnit.h',6,6,'LINE_RADIUS'),
               ('X2Lib/X2GUUser.h',40,45,'ELSE_IF_ARROW_ZXASDC_PRESSED_AFTER'),
               ('X2Lib/X2GUUser.h',100,109,'SKILL_CANCEL_AFTER'),
               ('X2Lib/X2GUUser.h',111,119,'IF_SKILL_CANCEL_AFTER'),
               ('X2Lib/X2GUUser.h',189,193,'ELSE_IF_KEY_PRESSED_AT_SKIP_POINT_C'),
               ('X2Lib/X2GUUser.h',197,201,'ELSE_IF_KEY_PRESSED_AT_SKIP_POINT_ZXC'),
               ('X2Lib/X2GUUser.h',224,228,'ELSE_IF_STATE_CHANGE_ON_')],
    'CLOCK_INLINE': [('KTDXLIB/KTDGXSkinAnim.h',228,231,'EventTimerOneshot'),
                     ('KTDXLIB/KTDGXSkinAnim.h',249,253,'UpdateBeforeAnimationTime')],
    'CLOCK_OUT': [('KTDXLIB/KTDGXSkinAnim.cpp',1350,1357,'EventTimer')],
    'CALLBACKS': [
        ('X2Lib/X2GUUser.cpp',25842,25855,'DamageAirSmallStartFuture'),
        ('X2Lib/X2GUUser.cpp',25860,25868,'DamageAirSmallEventProcess'),
        (RAVEN,6926,6944,'RSI_DAMAGE_SMALL_FRONT_EventProcess'),
        (RAVEN,6959,6977,'RSI_DAMAGE_SMALL_BACK_EventProcess'),
        (RAVEN,6989,7016,'RSI_DAMAGE_BIG_FRONT_EventProcess'),
        (RAVEN,7031,7049,'RSI_DAMAGE_BIG_BACK_EventProcess'),
        (RAVEN,8372,8384,'RSI_COMBO_ZZXX_FrameMoveFuture'),
        (RAVEN,8386,8406,'RSI_COMBO_ZZXX_EventProcess'),
        (RAVEN,8742,8800,'RSI_DASH_JUMP_COMBO_Z_EventProcess'),
        (RAVEN,8815,8826,'RSI_DASH_JUMP_COMBO_ZZ_FrameMoveFuture'),
        (RAVEN,8828,8836,'RSI_DASH_JUMP_COMBO_ZZ_EventProcess'),
        (RAVEN,8972,8990,'RSI_JUMP_COMBO_Z_FrameMoveFuture'),
        (RAVEN,8992,9004,'RSI_JUMP_COMBO_Z_EventProcess'),
        (RAVEN,9022,9040,'RSI_JUMP_COMBO_X_FrameMoveFuture'),
        (RAVEN,9044,9056,'RSI_JUMP_COMBO_X_EventProcess'),
        (RAVEN,11603,11616,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_FrameMoveFuture'),
        (RAVEN,11623,11631,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_EventProcess'),
        (RAVEN,11638,11644,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_StartFuture'),
        (RAVEN,11655,11699,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING_EventProcess'),
        (RAVEN,11707,11720,'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX_EventProcess'),
        (RAVEN,7774,7820,'RSI_COMBO_Z_EventProcess'),
        (RAVEN,7823,7877,'RSI_COMBO_ZZ_EventProcess'),
        (RAVEN,7879,8000,'RSI_COMBO_ZZZ_EventProcess'),
        (RAVEN,8003,8015,'RSI_COMBO_ZZZZ_FrameMoveFuture'),
        (RAVEN,8017,8037,'RSI_COMBO_ZZZZ_EventProcess'),
        (RAVEN,8311,8369,'RSI_COMBO_ZZX_EventProcess'),
        (RAVEN,8409,8449,'RSI_COMBO_X_EventProcess'),
        (RAVEN,8452,8539,'RSI_COMBO_XX_EventProcess'),
        (RAVEN,8840,8845,'RSI_DASH_JUMP_COMBO_ZZ_Landing_StartFuture'),
        (RAVEN,8847,8892,'RSI_DASH_JUMP_COMBO_ZZ_Landing_EventProcess'),
        (RAVEN,15752,15768,'RRF_DASH_JUMP_COMBO_X_FrameMoveFuture'),
        (RAVEN,15770,15818,'RRF_DASH_JUMP_COMBO_X_FrameMove'),
        (RAVEN,15820,15848,'RRF_DASH_JUMP_COMBO_X_EventProcess'),
        (RAVEN,15856,15864,'RRF_DASH_JUMP_COMBO_XX_FrameMoveFuture'),
        (RAVEN,15872,15880,'RRF_DASH_JUMP_COMBO_XX_EventProcess'),
        (RAVEN,15892,15921,'RRF_DASH_JUMP_COMBO_XX_LANDING_EventProcess'),
        (RAVEN,15928,15941,'RRF_COMBO_ZZXFRONTX_FrameMoveFuture'),
        (RAVEN,15948,15984,'RRF_COMBO_ZZXFRONTX_EventProcess'),
        (RAVEN,15985,15991,'RRF_COMBO_ZZXFRONTX_End'),
        (RAVEN,15999,16013,'RRF_COMBO_ZZXFRONTXX_EventProcess'),
    ],
}
MACROS = [('KTDXLIB/KTDX.h','X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE'),
          ('KTDXLIB/Always.h','RAVEN_SECOND_CLASS_CHANGE'),
          ('KTDXLIB/Always.h','RAVEN_WEAPON_TAKER'),
          ('KTDXLIB/Always.h','SKILL_CANCEL_BY_HYPER_MODE'),
          ('KTDXLIB/Always.h','BALANCE_PATCH_20120329')]
def sha(data): return hashlib.sha256(data).hexdigest()

def extract(cache, compat):
    files = {name:(cache/name).read_bytes() for name in HASHES}
    for name, data in files.items():
        if sha(data)!=HASHES[name]: raise ValueError('Pinned source hash mismatch: '+name)
    macros=[]
    for file, name in MACROS:
        matches=[(i+1,line) for i,line in enumerate(files[file].splitlines())
                 if line.strip().startswith(b'#define '+name.encode())]
        if len(matches)!=1: raise ValueError('Macro provenance mismatch: '+name)
        macros.append({'file':file,'name':name,'line':matches[0][0]})
    output=compat.read_bytes(); functions=[]
    for marker,entries in FRAGMENTS.items():
        tag=('// @@'+marker+'@@').encode()
        if output.count(tag)!=1: raise ValueError('Compatibility marker: '+marker)
        parts=[]
        for file,start,end,name in entries:
            raw=b''.join(files[file].splitlines(keepends=True)[start-1:end])
            if name.encode() not in raw: raise ValueError('Function identity: '+name)
            functions.append({'name':name,'file':file,'startLine':start,'endLine':end,
                'sha256':sha(raw),'bodySha256':sha(raw[raw.find(b'{'):raw.rfind(b'}')+1]) if b'{' in raw else None,'bytes':len(raw)})
            parts.append(raw)
        output=output.replace(tag,b'\r\n'.join(parts))
    return output,{'schemaVersion':1,'abiVersion':3,'referenceCommit':COMMIT,'sourceFileSha256':HASHES,
        'functions':functions,'selectedMacros':macros,'compatSha256':sha(compat.read_bytes()),
        'generatedCppSha256':sha(output),'evidenceClass':'reference-V5-not2016',
        'numericMode':'binary32, no fast-math or FP contraction',
        'boundaries':['RF107 class and symbolic state IDs supplied by the host',
            'CommonFrameMoveFuture/CommonEventProcess/CommonStateStartFuture are counted host boundaries',
            'Input, grounded/end queries, preset speeds, state-change requests and optional CanDown result supplied by the host',
            'Animation advancement, physics, collision and state start occur in the host between Future and Event',
            '2016 ZX_LANDING {0,.45,.25} uses a separate unverified binding; V5 hardcoded .1..3 is exposed only for probes'],
        'unverified':['2016 binary callback equivalence and macro choices',
            'Black-spear EffectSet dispatch absent from these original callbacks; no guessed time',
            'Common orchestration, original controller, skill-cancel consumer and particle renderer are explicit host boundaries',
            'XXX 2016 changed to EffectSet_A_RF_XXX; the incompatible old manual sphere is not executed',
            'ZZZX maps only to unmatched RSI_COMBO_ZZZX and is rejected, never substituted',
            '2026-edited XX extension bodies are excluded; only the unchanged XX branch is executable']}

def main():
    root=Path(__file__).resolve().parents[2];p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-cache',type=Path,default=root/'.cache/native-reference')
    p.add_argument('--out-dir',type=Path,default=root/'artifacts/native/commands')
    p.add_argument('--zig',type=Path);p.add_argument('--extract-only',action='store_true');args=p.parse_args()
    generated,contract=extract(args.source_cache,Path(__file__).with_name('commands-compat.hpp'))
    args.out_dir.mkdir(parents=True,exist_ok=True)
    cpp=args.out_dir/'commands.generated.cpp';cpp.write_bytes(generated)
    if not args.extract_only:
        if not args.zig or not args.zig.is_file():p.error('--zig must name an existing task-local compiler')
        env=os.environ.copy();env['ZIG_LOCAL_CACHE_DIR']=str(root/'.cache/native-commands/zig-local');env['ZIG_GLOBAL_CACHE_DIR']=str(root/'.cache/native-commands/zig-global')
        wasm=args.out_dir/'commands.wasm'
        flags=['c++',str(cpp),'-target','wasm32-freestanding','-nostdlib','-fno-exceptions','-fno-rtti',
            '-ffp-contract=off','-fno-fast-math','-O2','-Wno-invalid-utf8','-Wno-extra-tokens',
            '-Wl,--no-entry','-Wl,--export-memory']
        for name in ['run_callback','result_ptr','result_count','command_abi_version']:flags.append('-Wl,--export='+name)
        result=subprocess.run([str(args.zig),*flags,'-o',str(wasm)],capture_output=True,encoding='utf-8',errors='replace',env=env)
        if result.returncode:raise RuntimeError(result.stdout+result.stderr)
        contract['compiler']={'version':subprocess.check_output([str(args.zig),'version'],text=True).strip(),
            'exeSha256':sha(args.zig.read_bytes()),'flags':flags[2:]}
        contract['wasm']={'bytes':wasm.stat().st_size,'sha256':sha(wasm.read_bytes())}
    (args.out_dir/'source-contract.json').write_text(json.dumps(contract,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(args.out_dir),'functions':len(contract['functions']),'wasm':contract.get('wasm')}))
if __name__=='__main__':main()
