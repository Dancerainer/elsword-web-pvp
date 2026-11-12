"""Build an independent Mana Break module; never recompile the older modules."""
import argparse, json, os, re
from pathlib import Path
from run_camera_source import source, extract, sha, git_blob, execute, COMMIT, PREFIX

ROOT=Path(__file__).resolve().parents[2]
EXPORTS=('mb_abi','mb_input_ptr','mb_output_ptr','mb_input_count','mb_output_count','mb_evaluate')
HEADER={'relativePath':'X2Lib/X2GageUI.h','path':PREFIX+'X2Lib/X2GageUI.h',
        'gitBlob':'aa4bd9bcc1cac1df7eee0c1aa394466e9de47b7c',
        'sha256':'226734011c12ea7b2101ed967612437c27ff1d29f1906940bc7d54ffd039f212'}
SERVER={'relativePath':'KncWX2Server/Common/ServerDefine.h','path':PREFIX+'KncWX2Server/Common/ServerDefine.h',
        'gitBlob':'d2ab84a4d390189ddee1f3224a654e03da55fa7b',
        'sha256':'a83078882b7ff835acaae640eb3b8b58a000f33da2e3ab01eb30c0b9170fed29'}
SELECTIONS=(
 ('X2Lib/X2GageData.cpp',b'void CX2GageData::Gage::Increase(', 'gauge'),
 ('X2Lib/X2GageData.cpp',b'void CX2GageData::DetonationFrameMove(', 'gauge'),
 ('X2Lib/X2GageData.cpp',b'bool CX2GageData::DamageFlushMp()', 'gauge'),
 ('X2Lib/X2GageData.cpp',b'bool CX2GageData::UpdateDamageFlushMP()', 'gauge'),
 ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::DetonationEventProcess()', 'user'),
 ('X2Lib/X2GUUser.cpp',b'void CX2GUUser::DetonationStateChange(', 'user'))

def fragments(cache):
    records={r['relativePath']:r for r in json.loads((ROOT/'contracts/rf-native-runtime-sources.json').read_text('utf-8'))['files']}
    records['X2Lib/X2GageUI.h']=HEADER
    records[SERVER['relativePath']]=SERVER
    paths=sorted({p for p,_,_ in SELECTIONS}|{'X2Lib/X2GageData.h','X2Lib/X2GageUI.h','X2Lib/X2DamageManager.h','KTDXLIB/Always.h','KncWX2Server/Common/ServerDefine.h'})
    raw={p:source([cache],records[p]) for p in paths}
    for p in paths:records[p]['bytes']=len(raw[p])
    macros=('FIX_FORCE_DOWN_AND_DETONATION_BUG','RIDING_SYSTEM','NO_DETONATION','SERV_9TH_NEW_CHARACTER')
    defined=set(re.findall(rb'^\s*#define\s+(\w+)',raw['KTDXLIB/Always.h']+raw[SERVER['relativePath']],re.M))
    for macro in macros:
        if macro.encode() not in defined:raise ValueError('Missing frozen macro '+macro)
    constants=b'\n'.join(raw['X2Lib/X2GageUI.h'].splitlines()[3:6])+b'\n'
    if constants!=b'#define ONE_CHARGE 100.0f\n#define TWO_CHARGE 200.0f\n#define THREE_CHARGE 300.0f\n':
        raise ValueError('Frozen charge constants changed')
    pieces=[(p,*extract(raw[p],s),group) for p,s,group in SELECTIONS]
    return [records[p] for p in paths],pieces,macros,constants

def build(cache,output,zig,refresh_contract=False):
    cache=cache.resolve();output=output.resolve()
    if not output.is_relative_to(ROOT/'.cache') or output.is_relative_to(cache):raise ValueError('Output must be separate task cache')
    records,pieces,macros,constants=fragments(cache)
    profile=json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf-8'))
    if profile['components']['MP_CHARGE_RATE']!=130:raise ValueError('Target2016 charge component drift')
    contract={'schemaVersion':1,'referenceCommit':COMMIT,'targetClientMeasured':False,
      'evidenceClass':'compiled-fixed-V5-Gauge-and-User-ManaBreak-subset; target2016 constants + reference host scheduling candidate',
      'files':records,'macros':list(macros),'constants':{'minimumCharge':100,'maxCharge':300,'targetChargeRate':130},
      'targetComponent':{'field':'components.MP_CHARGE_RATE','value':130,'ravenSource':profile['sources']['raven'],
        'evidenceClass':'target2016 KL declaration; not client measured'},
      'adapterSha256':sha((ROOT/'tools/native/mana_break_adapter.cpp').read_bytes()),
      'fragments':[{'path':p,'sha256':sha(body),'bytes':len(body),'lineStart':first,'lineEnd':last,'group':group} for p,body,first,last,group in pieces],
      'hostBoundary':['Only the listed six bodies are original compiled functions; full OnFrameMove/StateStart are bounded JS scheduling adapters',
        'RF host supplies raw held Z/X, future-foot status, attacker-front, noDetonation and actual registered BBT_DETONATION_IMPOSSIBLE identities',
        'DetonationEventProcess contains a 2026-09-01 comment; this frozen reference implementation is not proof of target2016 equivalent control flow',
        'MP regen and item MP factors in original OnFrameMove are outside this module; charge precedes any host MP gain',
        'Riding is false; state enums map to host front/back/air-down labels; DT_BUFF ordinal is confirmed separately from original DamageManager header',
        'Original down request preserves pending gauge cost; actual consumption occurs at bounded immediate host down StateStart; complete native Now/Future frame buffers remain unported',
        'Packet-start stop>0 skips this Gauge/Event packet even when it expires midpacket; existing movement partial-elapsed clock is a separate candidate',
        'Screen flash suppressed by user policy; RevengeImpactTick request returned as an event, not claimed as rendered',
        'Enchant Hand target immediate factor trigger consumer is missing; the caster two-second EMPTY factor does not justify a guessed target two-second debuff']}
    destination=ROOT/'contracts/rf-mana-break-source-v12.json'
    if destination.exists() and not refresh_contract and json.loads(destination.read_text('utf-8'))!=contract:raise ValueError('Mana source selection drift')
    # This tracked contract has eol=lf; seal the same bytes Git checks out.
    destination.write_bytes((json.dumps(contract,indent=2)+'\n').encode('utf-8'))
    output.mkdir(parents=True,exist_ok=True)
    for group in ('gauge','user'):
        (output/f'mana_{group}.inc').write_bytes(b''.join(f'#line {first} "{p}"\n'.encode()+body+b'\n' for p,body,first,last,g in pieces if g==group))
    (output/'mana_constants.inc').write_bytes(constants)
    adapter=ROOT/'tools/native/mana_break_adapter.cpp';(output/adapter.name).write_bytes(adapter.read_bytes())
    env=dict(os.environ,ZIG_LOCAL_CACHE_DIR=str(output/'zig-local'),ZIG_GLOBAL_CACHE_DIR=str(output/'zig-global'))
    command=[str(zig.resolve()),'c++','-std=c++17','-O2','-fno-fast-math','-ffp-contract=off','-target','wasm32-freestanding',
      '-nostdlib','-fno-exceptions','-fno-rtti','-fno-builtin',adapter.name,'-Wl,--no-entry','-Wl,--export-memory']
    result=execute(command+[f'-D{x}' for x in macros]+[f'-Wl,--export={x}' for x in EXPORTS]+['-o','mana-break.wasm'],output,env)
    result['translationUnitSha256']=sha((output/adapter.name).read_bytes());result['includeHashes']={f:sha((output/f).read_bytes()) for f in ('mana_constants.inc','mana_gauge.inc','mana_user.inc')}
    (output/'execution.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    if not result['success']:raise RuntimeError(result)
    binary=(output/'mana-break.wasm').read_bytes();published=ROOT/'artifacts/native';published.mkdir(parents=True,exist_ok=True)
    result['compilerExeSha256']=sha(zig.read_bytes());result['moduleSha256']=sha(binary)
    (output/'execution.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    (published/'mana-break.wasm').write_bytes(binary)
    entry={'file':'mana-break.wasm','sha256':sha(binary),'bytes':len(binary),'sourceCommit':COMMIT,'compilationStatus':'compiled',
      'evidenceClass':contract['evidenceClass'],'originalFunctions':contract['fragments'],'sourceContract':'contracts/rf-mana-break-source-v12.json',
      'compilation':{key:result[key] for key in ('translationUnitSha256','includeHashes','compilerExeSha256','moduleSha256')}}
    (output/'module-entry.json').write_text(json.dumps(entry,indent=2)+'\n','utf-8');print(json.dumps(entry))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-cache',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--zig',type=Path,required=True);p.add_argument('--refresh-contract',action='store_true')
    a=p.parse_args();build(a.source_cache,a.output_dir,a.zig,a.refresh_contract)
