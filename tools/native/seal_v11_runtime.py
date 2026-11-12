"""Seal nine retained native modules and an optional independent Mana Break.

This tool never compiles, rewrites WASM or repairs source contracts. A reviewed
contract refresh needs an explicit, bounded republish list and reason; prior
republish history is retained. A paired commands-recovery rebuild additionally
needs --republish-module and immutable superseded CPP/contract/WASM by hash;
the other eight binaries remain sealed. Run the individual builders first. All inputs are checked before
one atomic manifest replacement. v8 has nine modules; --add-mana-break verifies
the tenth independently compiled module and publishes v9. The old nine records,
binaries and publication history are retained. Existing v9/v10 drift is rejected;
the separately reviewed skills Hyper command bridge release v10 and awakened
Arc callback release v11 are preserved.
"""
from pathlib import Path, PurePosixPath
import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile

ROOT=Path(__file__).resolve().parents[2]
COMMIT='a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
RECOVERY_COMMIT='a1bcdabf39ee1699873b587b40cedefcce61c7f0'
BASE=('geometry','camera','commands','skills','skill-values','effect-random')
ADDITIONS=('commands-recovery','nasod','critical')
PREFIX='JP_TW_EU_CN_US/Trunk/'
HEX=re.compile(r'^[0-9a-f]{64}$')
SEALED_CONTRACTS=('artifacts/native/commands-recovery/source-contract.json',
    'contracts/rf-native-nasod-v11.json','.cache/native-critical-generated/module-entry.json',
    'contracts/rf-critical-source-v11.json')
MANA_CONTRACTS=('contracts/rf-mana-break-source-v12.json','.cache/native-mana-build/module-entry.json','.cache/native-mana-build/execution.json')
SKILL_V11_CONTRACT='contracts/rf-native-skills-arc-v19.json'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pairs(items):
    result={}
    for key,value in items:
        if key in result:raise ValueError('Duplicate JSON key: '+key)
        result[key]=value
    return result


def read_json(path):
    value=json.loads(path.read_text('utf-8'),object_pairs_hook=pairs)
    if not isinstance(value,dict):raise ValueError('Expected JSON object: '+str(path))
    return value


def local(root,name):
    if not isinstance(name,str) or '\\' in name or ':' in name or name.startswith('/'):
        raise ValueError('Unsafe relative path: '+str(name))
    parts=PurePosixPath(name).parts
    if not parts or any(p in ('.','..') for p in parts):raise ValueError('Unsafe relative path: '+name)
    path=(root/name).resolve()
    if not path.is_relative_to(root.resolve()):raise ValueError('Path escapes task directory: '+name)
    return path


def digest(value,label):
    if not isinstance(value,str) or not HEX.fullmatch(value):raise ValueError('Invalid SHA256: '+label)
    return value


def matches(path,record,label):
    data=path.read_bytes()
    count=record.get('bytes')
    if type(count) is not int or count<=0:raise ValueError('Invalid byte count: '+label)
    if len(data)!=count:raise ValueError('Byte count drift: '+label)
    if sha(data)!=digest(record.get('sha256'),label):raise ValueError('Hash drift: '+label)
    return data


def leb(data,pos,end):
    value=0
    for index in range(5):
        if pos>=end:raise ValueError('Truncated WASM section length')
        byte=data[pos];pos+=1
        if index==4 and byte&0xf0:raise ValueError('Invalid WASM section length')
        value|=(byte&0x7f)<<(7*index)
        if byte<128:return value,pos
    raise ValueError('Invalid WASM section length')


def wasm(data,label):
    if not data.startswith(b'\x00asm\x01\x00\x00\x00'):raise ValueError('Invalid WASM header: '+label)
    pos=8;seen=set()
    while pos<len(data):
        section=data[pos];pos+=1
        if section>13:raise ValueError('Invalid WASM section: '+label)
        count,pos=leb(data,pos,len(data));end=pos+count
        if end>len(data):raise ValueError('Truncated WASM section: '+label)
        if section:
            if section in seen:raise ValueError('Duplicate WASM section: '+label)
            seen.add(section)
        if section==2:
            imports,_=leb(data,pos,end)
            if imports:raise ValueError('WASM host imports are unsupported: '+label)
        pos=end


def module(directory,name,record):
    if not isinstance(record,dict) or record.get('file')!=name+'.wasm':
        raise ValueError('Unsafe or mismatched module file: '+name)
    data=matches(local(directory,record['file']),record,name)
    wasm(data,name)
    return record


def check_files(cache,records):
    if not isinstance(records,list) or not records:raise ValueError('Missing source file provenance')
    sources={}
    for record in records:
        name=record.get('relativePath') or str(record.get('path','')).removeprefix(PREFIX)
        if name in sources:raise ValueError('Duplicate source file: '+name)
        data=matches(local(cache,name),record,'source '+name)
        if 'gitBlob' in record:
            blob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
            if blob!=record['gitBlob']:raise ValueError('Source Git blob drift: '+name)
        sources[name]=data
    return sources


def check_fragments(records,sources):
    if not isinstance(records,list) or not records:raise ValueError('Missing source extraction provenance')
    for record in records:
        name=str(record.get('file') or record.get('path','')).removeprefix(PREFIX)
        if name not in sources:raise ValueError('Unknown extraction source: '+name)
        first,last=record.get('lines') or [record.get('startLine',record.get('lineStart')),record.get('endLine',record.get('lineEnd'))]
        rows=sources[name].splitlines(keepends=True)
        if type(first) is not int or type(last) is not int or not 1<=first<=last<=len(rows):
            raise ValueError('Invalid source extraction range: '+name)
        selected=b''.join(rows[first-1:last])
        count=record.get('bytes')
        if type(count) is not int or not 0<count<=len(selected):raise ValueError('Invalid source extraction byte count: '+name)
        # extract() begins at the signature, so /*virtual*/ on the same line
        # is outside the selected function even though the line span contains it.
        # Search only that bounded span for the exact pinned contiguous bytes.
        # Do not normalize whitespace, comments or source line endings.
        excess=len(selected)-count
        if excess>256:raise ValueError('Ambiguous source extraction span: '+name)
        candidates=(selected[i:i+count] for i in range(excess+1))
        if not any(len(b)==record.get('bytes') and sha(b)==digest(record.get('sha256'),name) for b in candidates):
            raise ValueError('Source extraction drift: '+name)


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')


def check_arc_origins(generated,methods):
    if generated.get('sourceCommit')!=COMMIT:raise ValueError('Wrong awakened Arc generated source commit')
    for row in methods:
        origin=row.get('sourceCommit',COMMIT)
        if origin not in (COMMIT,RECOVERY_COMMIT):raise ValueError('Unsupported awakened Arc method source commit')
        if row['name']=='RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove' and origin!=COMMIT:
            raise ValueError('Awakened Arc method requires the fixed source commit')


def seal(root=ROOT,check_only=False,republish=None,republish_reason=None,republish_modules=None,add_mana_break=False):
    root=Path(root).resolve()
    republish=set(republish or ())
    republish_modules=set(republish_modules or ())
    if republish_modules-{'commands-recovery'}:
        raise ValueError('Unsupported module republish: '+', '.join(sorted(republish_modules-{'commands-recovery'})))
    if republish_modules and 'artifacts/native/commands-recovery/source-contract.json' not in republish:
        raise ValueError('Recovery module republish requires its paired source-contract republish')
    if republish-set(SEALED_CONTRACTS):
        raise ValueError('Unknown republish source contract: '+', '.join(sorted(republish-set(SEALED_CONTRACTS))))
    if republish and (not isinstance(republish_reason,str) or not republish_reason.strip()):
        raise ValueError('Republishing a sealed source contract requires an explicit reason')
    directory=local(root,'artifacts/native')
    manifest_path=local(root,'artifacts/native/manifest.json')
    manifest=read_json(manifest_path)
    if manifest.get('schemaVersion')!=1 or manifest.get('referenceCommit')!=COMMIT or manifest.get('runtimeVersion') not in ('original-source-functions-v7','original-source-functions-v8','original-source-functions-v9','original-source-functions-v10','original-source-functions-v11'):
        raise ValueError('Wrong retained native manifest version/source')
    if manifest.get('fullTargetClientExecuted') is not False:raise ValueError('Invalid target-client evidence claim')
    records=manifest.get('modules')
    if not isinstance(records,dict) or set(BASE)-records.keys():raise ValueError('Missing retained baseline module')
    has_mana=manifest['runtimeVersion'] in ('original-source-functions-v9','original-source-functions-v10','original-source-functions-v11')
    has_arc=manifest['runtimeVersion']=='original-source-functions-v11'
    include_mana=has_mana or add_mana_break
    allowed=BASE+ADDITIONS+(('mana-break',) if has_mana else ())
    if set(records)-set(allowed):raise ValueError('Unexpected native module')
    if add_mana_break and (has_mana or not manifest.get('seal')):raise ValueError('Mana Break addition requires a sealed nine-module runtime')
    # A reviewed recovery rebuild is the only binary refresh supported here.
    # Its superseded bytes remain addressable by hash; every unrelated module
    # still has to match the previously sealed record exactly.
    for name,record in records.items():
        if name in republish_modules:
            old_data=matches(local(root,'artifacts/native/superseded/'+digest(record['sha256'],name)+'.wasm'),record,'superseded '+name)
            wasm(old_data,'superseded '+name)
        else:module(directory,name,record)
    old_seal=manifest.get('seal')
    republished={}
    if republish and old_seal is None:
        raise ValueError('Republishing requires an existing complete seal')
    if old_seal is not None:
        old=copy.deepcopy(manifest);old.pop('seal')
        if old_seal.get('manifestContentSha256')!=sha(canonical(old)):
            raise ValueError('Existing sealed manifest drift')
        if manifest['runtimeVersion'] not in ('original-source-functions-v8','original-source-functions-v9','original-source-functions-v10','original-source-functions-v11') or set(records)!=set(allowed):
            raise ValueError('Incomplete previously sealed runtime')
        sealed_contracts=old_seal.get('sourceContracts')
        if not isinstance(sealed_contracts,dict) or set(sealed_contracts)!=set(SEALED_CONTRACTS+(MANA_CONTRACTS if has_mana else ()) + ((SKILL_V11_CONTRACT,) if has_arc else ())):
            raise ValueError('Incomplete or unexpected sealed source contracts')
        for name,expected in sealed_contracts.items():
            if sha(local(root,name).read_bytes())==digest(expected,'sealed '+name):
                continue
            # A previously sealed contract may only be refreshed through the
            # explicit republish list, and the superseded hash plus the reason are
            # recorded in the new seal so the invalidation stays auditable.
            if name not in republish:
                raise ValueError('Previously sealed source contract drift: '+name)
            republished[name]={'previousSha256':expected,'sha256':sha(local(root,name).read_bytes()),'reason':republish_reason}
        if republish-set(republished):
            raise ValueError('Republish source contract did not change: '+', '.join(sorted(republish-set(republished))))
        if republish_modules:
            path='artifacts/native/commands-recovery/source-contract.json'
            old_hash=sealed_contracts[path]
            old_path=local(root,'artifacts/native/superseded/'+old_hash+'.json')
            old_bytes=old_path.read_bytes()
            if sha(old_bytes)!=old_hash:raise ValueError('Superseded recovery source-contract drift')
            old_contract=read_json(old_path)
            if old_contract.get('wasm')!={key:records['commands-recovery'][key] for key in ('bytes','sha256')}:
                raise ValueError('Superseded recovery module/source pairing drift')
            old_cpp=local(root,'artifacts/native/superseded/'+digest(old_contract['generatedCppSha256'],'superseded CPP')+'.cpp').read_bytes()
            if sha(old_cpp)!=old_contract['generatedCppSha256']:raise ValueError('Superseded recovery CPP drift')

    cache=local(root,'.cache/native-source-runtime')
    baseline=read_json(local(root,'contracts/rf-native-runtime-sources.json'))
    if baseline.get('commit')!=COMMIT:raise ValueError('Wrong baseline source commit')
    check_files(cache,baseline['files'])
    if has_arc:
        arc=read_json(local(root,SKILL_V11_CONTRACT))
        if arc.get('schemaVersion')!=1 or arc.get('referenceCommit')!=COMMIT or arc.get('targetClientMeasured') is not False:
            raise ValueError('Wrong awakened Arc release source/evidence')
        if arc.get('runtimeModule')!=records['skills']:
            raise ValueError('Awakened Arc skills release pairing drift')
        for name,row in arc.get('retainedPairings',{}).items():
            if name=='skills' or records.get(name)!=row:raise ValueError('Awakened Arc retained module drift: '+name)
        if set(arc.get('retainedPairings',{}))!=set(records)-{'skills'}:raise ValueError('Awakened Arc retained inventory drift')
        generated=read_json(local(root,arc['generatedSourceContract']))
        methods=generated['functions']+generated.get('extraFunctions',[])
        check_arc_origins(generated,methods)
        if records['skills']['originalFunctions']!=methods or len(methods)!=71 or generated.get('callbackGroupIds')!=list(range(1,71)):
            raise ValueError('Awakened Arc callback/source inventory drift')
        previous=arc['previousSkills']['originalFunctions']
        by_name={row['name']:row for row in methods}
        if len(by_name)!=71 or len(previous)!=70 or any(by_name.get(row['name'])!=row for row in previous):
            raise ValueError('Awakened Arc changed a retained original method')
        added=set(by_name)-{row['name'] for row in previous}
        if added!={'RSI_SI2_OVER_TAKER_ARC_ENEMY_HYPER_FrameMove'}:raise ValueError('Unexpected awakened Arc original method')
        for row in arc['compiledFiles']:matches(local(root,row['path']),row,'awakened Arc '+row['path'])
        helper_dir=str(Path(__file__).resolve().parent)
        if helper_dir not in sys.path:sys.path.insert(0,helper_dir)
        from check_arc_composition_v19 import check as check_arc_composition
        check_arc_composition(root,local(root,arc['generatedSourceContract']).parent)
        fixed=[row for row in methods if row.get('sourceCommit',COMMIT)==COMMIT]
        rebuilt=[row for row in methods if row.get('sourceCommit')==RECOVERY_COMMIT]
        check_fragments(fixed,{row['file']:local(cache,row['file']).read_bytes() for row in fixed})
        check_fragments(rebuilt,{'X2Lib/X2GURaven.cpp':local(root,'.cache/reference-combat-fixes-v11/X2GURaven.cpp').read_bytes()})

    recovery_path=local(root,'artifacts/native/commands-recovery/source-contract.json')
    recovery=read_json(recovery_path)
    authority=read_json(local(root,'contracts/rf-combo-recovery-source-v11.json'))
    for key in ('sourceCommit','sourcePath','sourceSha256','sourceGitBlob','sourceBytes','functions','generatedCppSha256','wasm'):
        if recovery.get(key)!=authority.get(key):raise ValueError('Recovery source contract drift: '+key)
    if recovery.get('compilationStatus')=='not-compiled':
        raise ValueError('Recovery source contract was extracted but not compiled')
    if recovery.get('sourceCommit')!=RECOVERY_COMMIT or recovery.get('baselineReferenceCommit')!=COMMIT:
        raise ValueError('Wrong recovery source commit')
    source_path=local(root,'.cache/reference-combat-fixes-v11/X2GURaven.cpp')
    source=matches(source_path,{'sha256':recovery['sourceSha256'],'bytes':recovery['sourceBytes']},'recovery source')
    blob=hashlib.sha1(b'blob '+str(len(source)).encode()+b'\0'+source).hexdigest()
    if blob!=recovery['sourceGitBlob']:raise ValueError('Recovery source Git blob drift')
    check_fragments(recovery['functions'],{recovery['sourcePath'].removeprefix(PREFIX):source})
    generated=local(root,'artifacts/native/commands-recovery/commands-recovery.generated.cpp').read_bytes()
    # The published v11 unit retains its original mixed line endings; newer
    # builds are LF-only. Keep the raw hash bound to the published module and
    # compare canonical bytes separately. Test-only legal fixtures lack the
    # tracked compatibility header and can only verify their recorded raw hash.
    if sha(generated)!=digest(recovery['generatedCppSha256'],'recovery generated C++'):
        raise ValueError('Recovery generated C++ drift')
    if recovery.get('compositionReproducible') or local(root,'tools/native/commands-compat.hpp').is_file():
        builder_path=Path(__file__).with_name('build_command_recovery.py')
        recovery_spec=importlib.util.spec_from_file_location('recovery_builder',builder_path)
        recovery_builder=importlib.util.module_from_spec(recovery_spec)
        # The builder imports its siblings from tools/native; a minimal test root
        # does not contain them, so resolve them against the tooling checkout.
        builder_dir=str(builder_path.parent)
        if builder_dir not in sys.path:sys.path.insert(0,builder_dir)
        recovery_spec.loader.exec_module(recovery_builder)
        composed,composed_contract=recovery_builder.generate(cache,source_path)
        canonical_generated=generated.replace(b'\r\n',b'\n')
        if composed!=canonical_generated:
            raise ValueError('Recovery generated C++ is not reproducible from the pinned sources')
        canonical_hash=sha(canonical_generated)
        if 'generatedCppCanonicalSha256' in recovery:
            if recovery['generatedCppCanonicalSha256']!=canonical_hash or authority.get('generatedCppCanonicalSha256')!=canonical_hash:
                raise ValueError('Recovery canonical C++ hash drift')
        if composed_contract['generatedCppSha256']!=canonical_hash:
            raise ValueError('Recovery builder canonical C++ hash drift')
    if 'compilation' in recovery:
        compiled=recovery['compilation']
        if not isinstance(compiled,dict) or compiled.get('generatedCppSha256')!=recovery['generatedCppSha256'] or compiled.get('moduleSha256')!=recovery['wasm']['sha256'] or compiled.get('compilerExeSha256')!=recovery.get('compiler',{}).get('exeSha256'):
            raise ValueError('Recovery compilation provenance drift')
    if republish_modules and (recovery.get('compilationStatus')!='compiled' or 'compilation' not in recovery):
        raise ValueError('Recovery module republish requires a compiled CPP/compiler/module provenance triple')
    recovery_entry={'file':'commands-recovery.wasm',**recovery['wasm'],
        'sourceCommit':recovery['sourceCommit'],'sourceSha256':recovery['sourceSha256'],
        'sourceContract':'contracts/rf-combo-recovery-source-v11.json',
        'originalFunctions':recovery['functions'],'evidenceClass':recovery['evidenceClass']}

    nasod_path=local(root,'contracts/rf-native-nasod-v11.json')
    nasod=read_json(nasod_path)
    if nasod.get('referenceCommit')!=COMMIT or nasod.get('targetClientMeasured') is not False:
        raise ValueError('Wrong Nasod source/evidence')
    check_fragments(nasod['extractions'],check_files(cache,nasod['referenceFiles']))
    adapter=local(root,'tools/native/nasod_source_adapter.cpp').read_bytes()
    if sha(adapter)!=digest(nasod['adapterSha256'],'Nasod adapter'):raise ValueError('Nasod adapter drift')
    nasod_entry={**nasod['module'],'sourceCommit':COMMIT,
        'sourceContract':'contracts/rf-native-nasod-v11.json','originalFunctions':nasod['extractions'],
        'evidenceClass':nasod['evidenceClass']}

    critical_path=local(root,'.cache/native-critical-generated/module-entry.json')
    critical_entry=read_json(critical_path)
    if critical_entry.get('sourceCommit')!=COMMIT or critical_entry.get('sourceContract')!='contracts/rf-critical-source-v11.json':
        raise ValueError('Wrong critical source contract/commit')
    critical_contract_path=local(root,critical_entry['sourceContract'])
    critical=read_json(critical_contract_path)
    if critical.get('referenceCommit')!=COMMIT or critical.get('targetClientMeasured') is not False:
        raise ValueError('Wrong critical source/evidence')
    if critical_entry.get('originalFunctions')!=critical.get('fragments') or critical_entry.get('evidenceClass')!=critical.get('evidenceClass'):
        raise ValueError('Critical extraction/evidence drift')
    check_fragments(critical['fragments'],check_files(cache,critical['files']))
    if local(root,'.cache/native-critical-generated/critical_adapter.cpp').read_bytes()!=local(root,'tools/native/critical_adapter.cpp').read_bytes():
        raise ValueError('Critical generated adapter drift')

    additions={'commands-recovery':recovery_entry,'nasod':nasod_entry,'critical':critical_entry}
    mana_paths=[]
    if include_mana:
        mana_paths=[local(root,p) for p in MANA_CONTRACTS]
        mana,mana_entry,compilation=map(read_json,mana_paths)
        if mana.get('referenceCommit')!=COMMIT or mana.get('targetClientMeasured') is not False or mana_entry.get('sourceCommit')!=COMMIT or mana_entry.get('sourceContract')!=MANA_CONTRACTS[0]:
            raise ValueError('Wrong Mana Break source/evidence')
        if mana_entry.get('compilationStatus')!='compiled':raise ValueError('Mana Break lacks a compiled publication marker')
        if mana_entry.get('originalFunctions')!=mana.get('fragments') or mana_entry.get('evidenceClass')!=mana.get('evidenceClass'):
            raise ValueError('Mana Break extraction/evidence drift')
        mana_sources=check_files(local(root,'.cache/mana-source'),mana['files'])
        check_fragments(mana['fragments'],mana_sources)
        adapter=local(root,'tools/native/mana_break_adapter.cpp').read_bytes()
        if sha(adapter)!=digest(mana['adapterSha256'],'Mana adapter') or local(root,'.cache/native-mana-build/mana_break_adapter.cpp').read_bytes()!=adapter:
            raise ValueError('Mana Break adapter drift')
        if compilation.get('success') is not True or compilation.get('exitCode')!=0:
            raise ValueError('Mana Break was not compiled')
        for key in ('translationUnitSha256','includeHashes','compilerExeSha256','moduleSha256'):
            if mana_entry.get('compilation',{}).get(key)!=compilation.get(key):raise ValueError('Mana Break compilation provenance drift: '+key)
        if compilation['moduleSha256']!=mana_entry['sha256'] or compilation['translationUnitSha256']!=sha(adapter):
            raise ValueError('Mana Break compilation pairing drift')
        digest(compilation['compilerExeSha256'],'Mana Break compiler')
        expected={'mana_constants.inc':b'\n'.join(mana_sources['X2Lib/X2GageUI.h'].splitlines()[3:6])+b'\n',
                  'mana_gauge.inc':b'','mana_user.inc':b''}
        for fragment in mana['fragments']:
            raw=b''.join(mana_sources[fragment['path']].splitlines(keepends=True)[fragment['lineStart']-1:fragment['lineEnd']])
            body=next(raw[i:i+fragment['bytes']] for i in range(len(raw)-fragment['bytes']+1) if sha(raw[i:i+fragment['bytes']])==fragment['sha256'])
            name='mana_'+fragment['group']+'.inc'
            if name not in expected:raise ValueError('Unknown Mana Break extraction group')
            expected[name]+=f'#line {fragment["lineStart"]} "{fragment["path"]}"\n'.encode()+body+b'\n'
        if set(compilation['includeHashes'])!=set(expected):raise ValueError('Mana Break include set drift')
        for name,body in expected.items():
            if local(root,'.cache/native-mana-build/'+name).read_bytes()!=body or compilation['includeHashes'][name]!=sha(body):
                raise ValueError('Mana Break generated include drift: '+name)
        additions['mana-break']=mana_entry
    for name,record in additions.items():
        module(directory,name,record)
        if name in records and records[name]['sha256']!=record['sha256']:
            if name not in republish_modules:raise ValueError('Existing addition provenance drift: '+name)
        elif name in republish_modules:
            raise ValueError('Republished module did not change: '+name)
    result=copy.deepcopy(manifest);result.pop('seal',None)
    result['runtimeVersion']=manifest['runtimeVersion'] if manifest['runtimeVersion'] in ('original-source-functions-v10','original-source-functions-v11') else 'original-source-functions-v9' if include_mana else 'original-source-functions-v8'
    result['modules']={name:copy.deepcopy(records[name]) for name in BASE}
    result['modules'].update(additions)
    boundaries=result.setdefault('boundaries',{})
    boundaries.update({'commands-recovery':recovery['boundaries'],
        'nasod':nasod['hostBoundary'],'critical':critical['hostBoundary']})
    if include_mana:boundaries['mana-break']=mana['hostBoundary']
    for name in BASE:
        if result['modules'][name]!=records[name]:raise ValueError('Baseline metadata changed: '+name)
    content_digest=sha(canonical(result))
    paths=(recovery_path,nasod_path,critical_path,critical_contract_path,*mana_paths,*([local(root,SKILL_V11_CONTRACT)] if has_arc else []))
    result['seal']={'schemaVersion':1,'tool':'tools/native/seal_v11_runtime.py','moduleCount':10 if include_mana else 9,
        'manifestContentSha256':content_digest,
        'sourceContracts':{p.relative_to(root).as_posix():sha(p.read_bytes()) for p in paths}}
    if old_seal:
        for key in ('republishedSourceContracts','republishHistory','moduleAdditionHistory','boundedRebuildHistory'):
            if key in old_seal:result['seal'][key]=copy.deepcopy(old_seal[key])
    if add_mana_break:
        result['seal'].setdefault('moduleAdditionHistory',[]).append({'module':'mana-break',
          'previousManifestContentSha256':old_seal['manifestContentSha256'],'sha256':mana_entry['sha256']})
    if republished:
        result['seal']['republishedSourceContracts']={**result['seal'].get('republishedSourceContracts',{}),**republished}
        history=result['seal'].setdefault('republishHistory',[])
        if not isinstance(history,list):raise ValueError('Invalid source-contract republish history')
        entry={'previousManifestContentSha256':old_seal['manifestContentSha256'],'sourceContracts':republished}
        if republish_modules:
            entry['modules']={name:{'previousSha256':records[name]['sha256'],'sha256':result['modules'][name]['sha256'],
                'reason':republish_reason,'supersededSourceContractSha256':old_seal['sourceContracts']['artifacts/native/commands-recovery/source-contract.json']}
                for name in sorted(republish_modules)}
        history.append(entry)
    if not check_only:
        payload=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
        tmp=None
        try:
            with tempfile.NamedTemporaryFile(dir=directory,prefix='.seal-v11-',suffix='.tmp',delete=False) as output:
                tmp=Path(output.name);output.write(payload);output.flush();os.fsync(output.fileno())
            os.replace(tmp,manifest_path)
        finally:
            if tmp is not None and tmp.exists():tmp.unlink()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT,help='Task-owned project checkout with prepared private inputs')
    parser.add_argument('--check-only',action='store_true',help='Validate the complete candidate without publishing a manifest')
    parser.add_argument('--add-mana-break',action='store_true',help='Add a verified independent tenth module to the sealed nine-module runtime')
    parser.add_argument('--republish-source-contract',action='append',default=[],metavar='PATH',
        help='Deliberately refresh a sealed source-contract hash after a reviewed rebuild; requires --republish-reason')
    parser.add_argument('--republish-reason',help='Why the sealed source contract is being refreshed; recorded in the new seal')
    parser.add_argument('--republish-module',action='append',default=[],choices=['commands-recovery'],
        help='Publish a paired recovery rebuild only after preserving superseded CPP/contract/WASM by hash')
    args=parser.parse_args();manifest=seal(args.root,args.check_only,args.republish_source_contract,args.republish_reason,args.republish_module,args.add_mana_break)
    print(json.dumps({'runtimeVersion':manifest['runtimeVersion'],'moduleCount':len(manifest['modules']),
        'manifestContentSha256':manifest['seal']['manifestContentSha256'],'published':not args.check_only}))


if __name__=='__main__':main()
