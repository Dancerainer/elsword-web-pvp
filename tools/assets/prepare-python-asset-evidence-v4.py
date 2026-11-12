"""Copy only hash-frozen private Python regression inputs into task runtime.

This never updates the public closure, original client, or shared caches.
Source inventories stay independent of the current asset generator.
"""
import argparse
import hashlib
import json
from pathlib import Path
from task_output import checked_output
from build_lk_sword_ui import read_flicker_sources

ROOT = Path(__file__).resolve().parents[2]


def prepare(asset_source, sword_source, output):
    asset_source = Path(asset_source).resolve()
    output = checked_output(output, asset_source, ROOT, output, 'Private Python evidence')
    rows = {}
    for report_name in ('rf-buff-display-assets.json','rf-shadow-weapon-assets.json'):
        report = json.loads((ROOT / 'reports' / report_name).read_bytes())
        for row in report['outputInventory']:
            rows[row['path']] = row
    for manifest_name in ('rf-landing-d3dx-keyframes-v1.json','rf-shadow-weapon-d3dx-keyframes.json'):
        entry = json.loads((ROOT / 'reports' / manifest_name).read_bytes())['artifact']
        rows[entry['path']] = entry
    staged = []
    for relative, entry in sorted(rows.items()):
        source = (asset_source / relative).resolve()
        target = (output / relative).absolute()
        if not source.is_relative_to(asset_source) or not target.is_relative_to(output):
            raise ValueError('Frozen inventory path escapes selected source/output')
        data = source.read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
            raise ValueError('Frozen private input differs: ' + relative)
        staged.append((relative,data,entry['sha256']))
    for name,(data,_) in read_flicker_sources(sword_source).items():
        staged.append(('sword-ui/KTDXLIB/'+name,data,hashlib.sha256(data).hexdigest()))
    # All source hashes pass before any output is written. Existing files must
    # also be the same bytes; never overwrite an unknown task-local artifact.
    for relative,data,_ in staged:
        target=checked_output(output/relative,asset_source,ROOT,output,'Private Python evidence')
        if target.exists() and target.read_bytes()!=data:
            raise ValueError('Existing private evidence differs: '+relative)
    evidence={'schemaVersion':1,'classification':'independently frozen source inventory; private Python regression inputs',
        'output':output.relative_to(ROOT).as_posix(),'fileCount':len(staged),
        'files':{relative:{'bytes':len(data),'sha256':sha} for relative,data,sha in staged}}
    receipt=checked_output(output/'evidence.json',asset_source,ROOT,output,'Private evidence receipt')
    receipt_bytes=(json.dumps(evidence,indent=2)+'\n').encode('utf-8')
    if receipt.exists() and receipt.read_bytes()!=receipt_bytes:
        raise ValueError('Existing private evidence receipt differs')
    for relative,data,_ in staged:
        target=output/relative;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():target.write_bytes(data)
    if not receipt.exists():receipt.write_bytes(receipt_bytes)
    return evidence


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-source',type=Path,required=True,help='Read-only project root with frozen artifacts')
    parser.add_argument('--sword-source',type=Path,required=True,help='Read-only KTDXLIB directory containing the two pinned files')
    parser.add_argument('--output',type=Path,default=ROOT/'runtime/python-asset-evidence-v4')
    args=parser.parse_args();result=prepare(args.asset_source,args.sword_source,args.output)
    print(json.dumps({'fileCount':result['fileCount'],'output':result['output']}))
