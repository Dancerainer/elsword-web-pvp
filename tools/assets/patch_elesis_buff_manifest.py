"""Correct the frozen buff manifest without copying unused converter intermediates.

The v1 handoff intentionally excluded .animation.json; runtime uses .pose.json.
The old common-buff builder nevertheless put intermediate files in its manifest.
Merge reviewed v4 receipts into the integration manifest, retaining other roots,
then verify every runtime receipt against the read-only integration directory.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def read(path): return json.loads(path.read_text('utf8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf8')

def reconcile(runtime, reviewed):
    prior = read(runtime/'manifest.json')
    refs = set()
    for row in read(runtime/'fx/index.json')['templates'].values():
        refs.update(row[k] for k in ('glb', 'poseData') if row.get(k))
        refs.update(t['file'] for t in row.get('textures', {}).values())
    receipts = {row['file']: row for row in prior['outputs']}
    receipts.update({row['file']: row for row in reviewed['outputs']})
    removed = [row for name, row in sorted(receipts.items()) if name.endswith('.animation.json')]
    for row in removed:
        if row['file'] in refs:
            raise ValueError('Converter intermediate is referenced by runtime: '+row['file'])
        del receipts[row['file']]
    for name, row in receipts.items():
        path = (runtime/name).resolve()
        if not path.is_relative_to(runtime.resolve()): raise ValueError('Receipt escapes runtime directory')
        if not path.is_file(): raise ValueError('Missing runtime receipt: '+name)
        if path.stat().st_size != row['bytes'] or sha(path) != row['sha256']:
            raise ValueError('Runtime differs from reviewed receipt: '+name)
    missing = refs-receipts.keys()
    if missing: raise ValueError('Unsealed runtime reference: '+str(sorted(missing)))
    result = dict(prior, outputs=[receipts[k] for k in sorted(receipts)])
    return result, removed

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root', type=Path, required=True)
    parser.add_argument('--reviewed-manifest', type=Path, default=ROOT/'.cache/elesis-buff-v4/runtime/common-buffs/manifest.json')
    parser.add_argument('--output-root', type=Path, default=ROOT/'.cache/elesis-buff-v4b/runtime')
    args = parser.parse_args()
    runtime = args.runtime_root/'common-buffs'
    if args.output_root.resolve().is_relative_to(args.runtime_root.resolve()):
        raise ValueError('Correction output must not change the integration tree')
    manifest, removed = reconcile(runtime, read(args.reviewed_manifest))
    output = args.output_root/'common-buffs/manifest.json'
    write(output, manifest)
    write(ROOT/'reports/elesis-buff-manifest-v4b.json', {
        'schemaVersion': 1, 'id': 'elesis-buff-manifest-correction-v4b',
        'sourceReviewedManifestSha256': sha(args.reviewed_manifest),
        'precedingPatch': 'reports/elesis-buff-resource-v4.json',
        'patchRoot': str(args.output_root.resolve()),
        'files': [{'file': 'common-buffs/manifest.json', 'bytes': output.stat().st_size,
                   'sha256': sha(output), 'priorSha256': sha(runtime/'manifest.json')}],
        'runtimeOutputs': len(manifest['outputs']), 'removedConverterIntermediates': removed,
        'cause': 'The common-buff builder inventoried intermediate .animation.json files; the runtime handoff intentionally excludes them and references .pose.json instead.',
        'validation': 'All retained bytes and hashes match reviewed receipts; every runtime GLB, pose and explicit texture reference has a retained receipt.',
        'clientMeasured': False})
    print({'outputs': len(manifest['outputs']), 'removed': len(removed), 'sha256': sha(output)})

if __name__ == '__main__': main()
