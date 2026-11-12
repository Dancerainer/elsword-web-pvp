"""Compile byte-preserved fixed-reference RandomNumber overloads; no client run."""
import argparse
import json
import os
from pathlib import Path

from run_camera_source import source, extract, sha, execute

ROOT = Path(__file__).resolve().parents[2]
EXPORTS = ['er_abi', 'er_rand_max', 'er_draws', 'er_float', 'er_int']


def original_functions(cache, contract):
    records = {row['path']: row for row in contract['referenceFiles']}
    # The call-chain header is verified too, although its generic containers
    # need no translation in this numeric ABI.
    verified = {name: source([cache], row) for name, row in records.items()}
    fragments = []
    for entry in contract['extractions']:
        body, first, last = extract(verified[entry['path']], entry['signature'].encode())
        if sha(body) != entry['sha256'] or len(body) != entry['bytes'] or [first,last] != entry['lines']:
            raise ValueError('Original RandomNumber bytes changed: ' + entry['signature'])
        fragments.append(f'#line {first} "{entry["path"]}"\n'.encode() + body + b'\n')
    if contract['macros'] != {'RAND_MAX': 32767} or contract['windowsRandMax'] != 32767:
        raise ValueError('Windows rand ABI changed')
    return b''.join(fragments)


def build(cache, output, zig):
    cache, output = cache.resolve(), output.resolve()
    if output.is_relative_to(cache) or cache.is_relative_to(output):
        raise ValueError('Read-only input and generated output must not overlap')
    contract = json.loads((ROOT / 'contracts/rf-native-effect-random.json').read_text('utf-8'))
    original = original_functions(cache, contract)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'original_effect_random.inc').write_bytes(original)
    adapter = (ROOT / 'tools/native/effect_random_adapter.cpp').read_bytes()
    (output / 'effect_random_adapter.cpp').write_bytes(adapter)
    env = dict(os.environ, ZIG_LOCAL_CACHE_DIR=str(output / 'zig-local'), ZIG_GLOBAL_CACHE_DIR=str(output / 'zig-global'))
    command = [str(zig.resolve()), 'c++', '-std=c++17', '-O2', '-fno-fast-math', '-ffp-contract=off', '-fno-builtin']
    native = execute(command + ['-DEFFECT_RANDOM_NATIVE_HARNESS', 'effect_random_adapter.cpp', '-o', 'effect-random-harness.exe'], output, env)
    wasm = execute(command + ['-target', 'wasm32-freestanding', '-nostdlib', '-fno-exceptions', '-fno-rtti',
                              'effect_random_adapter.cpp', '-Wl,--no-entry', '-Wl,--export-memory'] +
                   [f'-Wl,--export={name}' for name in EXPORTS] + ['-o', 'effect-random-source.wasm'], output, env)
    run = execute([str(output / 'effect-random-harness.exe')], output, env) if native['success'] else None
    test_env = dict(env, RF_EFFECT_RANDOM_WASM=str(output / 'effect-random-source.wasm'))
    wasm_run = execute(['node','--test',str(ROOT / 'tests/integration/native-effect-random.test.mjs')], output, test_env) if wasm['success'] else None
    result = {'schema':1, 'referenceCommit':contract['commit'], 'evidenceClass':contract['evidenceClass'],
              'targetClientMeasured':False, 'originalMethodsUnchanged':True,
              'referenceFiles':contract['referenceFiles'], 'extractions':contract['extractions'],
              'hostBoundary':contract['hostBoundary'], 'windowsRandMax':32767,
              'adapterSha256':sha(adapter), 'compilerSha256':sha(zig.read_bytes()),
              'nativeCompile':native, 'wasmCompile':wasm, 'nativeExecution':run, 'wasmExecution':wasm_run,
              'success':all(row and row['success'] for row in (native,wasm,run,wasm_run)), 'artifacts':[]}
    for name in ('effect-random-harness.exe','effect-random-source.wasm'):
        path=output/name
        if path.exists():result['artifacts'].append({'file':name,'sha256':sha(path.read_bytes()),'bytes':path.stat().st_size})
    (output/'execution.json').write_text(json.dumps(result,indent=2)+'\n','utf-8')
    print(json.dumps({'success':result['success'],'output':str(output)}))
    return result['success']


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-cache',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--zig',type=Path,required=True)
    args=parser.parse_args()
    raise SystemExit(0 if build(args.source_cache,args.output_dir,args.zig) else 1)
