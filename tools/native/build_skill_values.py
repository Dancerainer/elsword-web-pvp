"""Compile unchanged fixed-reference C++ skill-value methods; no client launch."""
import argparse
import json
import os
from pathlib import Path
import shutil

from run_camera_source import source, extract, sha, execute

ROOT = Path(__file__).resolve().parents[2]
PREFIX = 'JP_TW_EU_CN_US/Trunk/'
EXPORTS = ['sv_input_ptr', 'sv_input_capacity', 'sv_ability', 'sv_power', 'sv_increasing',
           'sv_buff_fixed','sv_buff_relation','sv_buff_percent','sv_buff_interval','sv_buff_interval_sum']


def build(cache, output, zig):
    cache, output = cache.resolve(), output.resolve()
    if output.is_relative_to(cache) or cache.is_relative_to(output):
        raise ValueError('Read-only source cache and generated output must not overlap')
    contract = json.loads((ROOT / 'contracts/rf-native-skill-values.json').read_text('utf-8'))
    output.mkdir(parents=True, exist_ok=True)
    records = {x['path']: x for x in contract['referenceFiles']}
    groups = {'members': b'', 'rate': b'', 'buff': b'', 'timer': b''}
    extractions = []
    for entry in contract['extractions']:
        data = source([cache], records[entry['path']])
        body, first, last = extract(data, entry['signature'].encode())
        if entry.get('classTerminator'):
            if data[data.index(entry['signature'].encode())+len(body):][:1]!=b';':
                raise ValueError('Original class terminator missing')
            body+=b';'
        if sha(body) != entry['sha256'] or [first,last] != entry['lines']:
            raise ValueError('Original function extraction changed: ' + entry['signature'])
        groups[entry['group']] += f'#line {first} "{entry["path"]}"\n'.encode() + body + b'\n'
        extractions.append(entry)
    for group, data in groups.items():
        (output / f'original_skill_values_{group}.inc').write_bytes(data)
    adapter = (ROOT / 'tools/native/skill_values_adapter.cpp').read_bytes()
    (output / 'skill_values_adapter.cpp').write_bytes(adapter)
    env = dict(os.environ, ZIG_LOCAL_CACHE_DIR=str(output / 'zig-local'), ZIG_GLOBAL_CACHE_DIR=str(output / 'zig-global'))
    command = [str(zig.resolve()), 'c++', '-std=c++17', '-O2', '-fno-fast-math', '-fno-builtin',
               '-Wno-invalid-source-encoding', '-Wno-ignored-qualifiers','-Wno-extra-tokens']
    native = execute(command + ['-DSKILL_VALUES_NATIVE_HARNESS', 'skill_values_adapter.cpp', '-o', 'skill-values-harness.exe'], output, env)
    wasm = execute(command + ['-target', 'wasm32-freestanding', '-nostdlib', '-fno-exceptions', '-fno-rtti',
                   'skill_values_adapter.cpp', '-Wl,--no-entry', '-Wl,--export-memory'] +
                   [f'-Wl,--export={x}' for x in EXPORTS] + ['-o', 'skill-values-source.wasm'], output, env)
    run = execute([str(output / 'skill-values-harness.exe')], output, env) if native['success'] else None
    wasm_run = execute(['node', str(ROOT / 'tools/native/test_skill_values_wasm.mjs'), str(output / 'skill-values-source.wasm')], output, env) if wasm['success'] else None
    result = {'referenceCommit': contract['commit'], 'evidenceClass': 'reference-V5-not2016',
              'originalMethodsUnchanged': True, 'targetClientMeasured': False,
              'compatibilityBoundary': 'Fixed-capacity numeric vector/map, primitive buff factor and original timer class; macro X2OPTIMIZE_NPC_ADAPTIVE_FRAME_MOVE supplies dt. No Lua/actor/network/renderer dependency; higher-level buff lifetime routing remains explicit reference candidate',
              'referenceFiles': contract['referenceFiles'], 'extractions': extractions,
              'adapterSha256': sha(adapter), 'compilerSha256': sha(zig.read_bytes()),
              'nativeCompile': native, 'wasmCompile': wasm, 'nativeExecution': run, 'wasmExecution': wasm_run,
              'success': all(r and r['success'] for r in (native,wasm,run,wasm_run)), 'artifacts': []}
    for name in ('skill-values-harness.exe', 'skill-values-source.wasm'):
        path = output / name
        if path.exists(): result['artifacts'].append({'file': name, 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size})
    (output / 'execution.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    print(json.dumps({'success':result['success'],'output':str(output)}))
    return result['success']


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-cache',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--zig',type=Path,required=True)
    args=parser.parse_args()
    raise SystemExit(0 if build(args.source_cache,args.output_dir,args.zig) else 1)
