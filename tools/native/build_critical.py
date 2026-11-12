"""Compile byte-preserved critical getters and DamageReact critical block.

Original source and generated translation units stay in this task's cache.
The adapter supplies RF-only objects and reports its omitted host consumers.
"""
import argparse, json, os
from pathlib import Path
from run_camera_source import source, extract, sha, execute

ROOT=Path(__file__).resolve().parents[2]
FILES=('X2Lib/X2GUUser.cpp','X2Lib/X2GameUnit.cpp','KTDXLIB/Always.h','X2Lib/X2GURaven.cpp')
EXPORTS=('nc_abi','nc_input_ptr','nc_output_ptr','nc_input_count','nc_output_count','nc_evaluate','nr_evaluate','nl_phase','nl_revenge')

def fragments(cache):
    manifest=json.loads((ROOT/'contracts/rf-native-runtime-sources.json').read_text('utf-8'))
    records={r['relativePath']:r for r in manifest['files']}
    data={p:source([cache],records[p]) for p in FILES}
    pieces=[]
    for path,signature in [('X2Lib/X2GUUser.cpp',b'float CX2GUUser::GetCriticalPercent('),
                           ('X2Lib/X2GameUnit.cpp',b'const float CX2GameUnit::GetCriticalValueFromDefender()')]:
        body,first,last=extract(data[path],signature)
        pieces.append((path,body,first,last))
    path='X2Lib/X2GUUser.cpp'
    lines=data[path].splitlines(keepends=True)
    for first,last in [(9092,9098),(9118,9231)]:
        pieces.append((path,b''.join(lines[first-1:last]),first,last))
    path='X2Lib/X2GameUnit.cpp';lines=data[path].splitlines(keepends=True)
    pieces.append((path,b''.join(lines[2712:2740]),2713,2740))
    path='X2Lib/X2GURaven.cpp'
    for name in ('RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateStart','RSI_A_RRF_LIMIT_CRUSHER_CHARGE_StateEnd'):
        raw,first,last=extract(data[path],('void CX2GURaven::'+name+'(').encode())
        pieces.append((path,raw,first,last))
    path='X2Lib/X2GUUser.cpp';lines=data[path].splitlines(keepends=True)
    pieces.append((path,b''.join(lines[11468:11480]),11469,11480))
    # These macros are enabled in the fixed header, verified from the input.
    macros=('FIX_RAVEN_CRITICAL_RATE','NEW_CHARACTER_EL',
            'UPGRADE_SKILL_SYSTEM_2013','ELSWORD_WAY_OF_SWORD','CHUNG_SECOND_CLASS_CHANGE',
            'CASH_SKILL_FOR_CHUNG_2011_04','RENA_SECOND_CLASS_CHANGE','ADD_MEMO_1ST_CLASS','UPGRADE_RAVEN')
    import re
    defines=set(re.findall(rb'^\s*#define\s+(\w+)',data['KTDXLIB/Always.h'],re.M))
    for macro in macros:
        if macro.encode() not in defines:raise ValueError('Fixed critical macro missing: '+macro)
    return [records[p] for p in FILES],pieces,macros

def build(cache,output,zig,refresh_contract=False):
    cache=cache.resolve();output=output.resolve()
    if not output.is_relative_to(ROOT/'.cache') or output.is_relative_to(cache):raise ValueError('Output must be task-owned cache')
    records,pieces,macros=fragments(cache)
    contract={'schemaVersion':1,'referenceCommit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
      'evidenceClass':'compiled-reference-V5-critical-subset; not target2016 measurement',
      'targetClientMeasured':False,'files':records,'macros':list(macros),
      'fragments':[{'path':p,'lineStart':a,'lineEnd':b,'sha256':sha(s),'bytes':len(s)} for p,s,a,b in pieces],
      'hostBoundary':['RF-only unit with supplied final critical stats and defender roll; no pet, stigma, panic, WayOfSword or other-character side effects unless explicit input',
        'Critical defence/base1.5 follow fixed reference getters; target socket conversion and original RNG stream scheduling remain unmeasured',
        'Camera calls are suppressed by user requirement; original particle/sound requests returned to browser',
        'DamageReact block receives host-computed base damage; complete original damage calculation is not transplanted by this module',
        'WildCharge state-reduction block receives explicit integer percent/guard flags; IsIgnoreStateGuardByBuff is false in the current RF fixture, full guard buffs remain unsupported',
        'Limit charge Start/End flag and DamageReactStateChange branch execute original bytes; CommonStateStart/End are bounded sinks, symbolic successor tags are host ABI labels',
        'RF host supplies CAN_REVENGE with fixed DamageManager Lua default true; whole riding/quickslot/network state-change dispatch remains outside this module']}
    contractPath=ROOT/'contracts/rf-critical-source-v11.json'
    if not refresh_contract and contractPath.exists() and json.loads(contractPath.read_text('utf-8'))!=contract:raise ValueError('Critical source contract drift')
    contractPath.write_bytes((json.dumps(contract,indent=2)+'\n').encode('utf-8'))
    output.mkdir(parents=True,exist_ok=True)
    def inc(piece):
        p,s,a,_=piece;return f'#line {a} "{p}"\n'.encode()+s+b'\n'
    (output/'critical_getters.inc').write_bytes(b''.join(map(inc,pieces[:2])))
    (output/'critical_position.inc').write_bytes(inc(pieces[2]))
    (output/'critical_damage.inc').write_bytes(inc(pieces[3]))
    (output/'damage_reduce.inc').write_bytes(inc(pieces[4]))
    (output/'limit_lifecycle.inc').write_bytes(b''.join(map(inc,pieces[5:7])))
    (output/'limit_revenge.inc').write_bytes(inc(pieces[7]))
    (output/'critical_adapter.cpp').write_bytes((ROOT/'tools/native/critical_adapter.cpp').read_bytes())
    env=dict(os.environ,ZIG_LOCAL_CACHE_DIR=str(output/'zig-local'),ZIG_GLOBAL_CACHE_DIR=str(output/'zig-global'))
    command=[str(zig.resolve()),'c++','-std=c++17','-O2','-fno-fast-math','-ffp-contract=off',
      '-target','wasm32-freestanding','-nostdlib','-fno-exceptions','-fno-rtti','-fno-builtin',
      'critical_adapter.cpp','-Wl,--no-entry','-Wl,--export-memory']
    result=execute(command+[f'-D{x}' for x in macros]+[f'-Wl,--export={x}' for x in EXPORTS]+['-o','critical.wasm'],output,env)
    (output/'execution.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    if not result['success']:raise RuntimeError(result)
    binary=(output/'critical.wasm').read_bytes()
    destination=ROOT/'artifacts/native';destination.mkdir(parents=True,exist_ok=True)
    (destination/'critical.wasm').write_bytes(binary)
    entry={'file':'critical.wasm','sha256':sha(binary),'bytes':len(binary),
      'sourceCommit':contract['referenceCommit'],'evidenceClass':contract['evidenceClass'],
      'originalFunctions':contract['fragments'],'sourceContract':'contracts/rf-critical-source-v11.json'}
    (output/'module-entry.json').write_text(json.dumps(entry,indent=2)+'\n','utf-8')
    print(json.dumps(entry))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-cache',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--zig',type=Path,required=True)
    p.add_argument('--refresh-contract',action='store_true',help='Publish explicitly changed source selection after review')
    args=p.parse_args();build(args.source_cache,args.output_dir,args.zig,args.refresh_contract)
