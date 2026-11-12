"""Freeze all new Elesis X inputs for the existing original-DLL offline probe."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog, digest, write_json


def prepare(complete=False):
    catalog = Catalog(Path('asset_work')); rows = {}
    receipt = ROOT/'reports/elesis-fx-d3dx-sources-v1.json'
    names = []
    if receipt.exists(): names.extend(Path(row['source']).name for row in json.loads(receipt.read_text('utf8'))['sources'])
    for job in ('gm','bh','ca'):
        index = json.loads((ROOT/f'artifacts/{job}/fx/index.json').read_text('utf8'))
        names.extend(name for row in index['templates'].values() if not row.get('sharedResourceEvidence')
                     if (name := row['fields'].get('MeshName') or row['fields'].get('Mesh')))
    costume = ROOT/'contracts/elesis-costumes-source-v1.json'
    if costume.exists():
        for item in json.loads(costume.read_text('utf8'))['items'].values():
            for name in filter(None, item['models']):
                if item['slot'] not in (2,6,8,9,10,11):
                    names.append(name)
                    if item['canHyperMode']: names.append('Hyper_'+name)
            names.extend(row['name'] for row in item['attachedMeshes'] if not row.get('unsupported'))
    for name in set(names):
        source = catalog.path(name); data = source.read_bytes()
        if data.startswith(b'xof '):
            rows[digest(data)] = {'source': str(source), 'sourceSha256': digest(data), 'sourceBytes': len(data)}
    if complete:
        execution = json.loads((ROOT/'reports/elesis-fx-d3dx-execution-v1.json').read_text('utf8'))
        traces = {r['sourceSha256']: r for r in execution['traces'] if 'sourceSha256' in r and 'hresult' in r}
        for sha, row in rows.items():
            trace = traces[sha]
            if trace['hresult'] != '0x00000000': raise ValueError('Original DLL rejected '+row['source'])
            row.update(actualLoaderHresult=trace['hresult'], nativeAnimations=[
                {k: a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace.get('animations',[])])
    write_json(receipt, {'schema': 'elsword.native-d3dx-source-request.v1',
        'dllSha256': '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'sources': sorted(rows.values(), key=lambda r: r['source'].lower())})
    print(json.dumps({'sources': len(rows), 'requestSha256': digest(receipt.read_bytes())}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--complete', action='store_true')
    prepare(parser.parse_args().complete)
