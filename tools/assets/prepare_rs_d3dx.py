"""Freeze RS-only original X files for the existing task-local D3DX key probe."""
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog, digest, write_json


def prepare(complete=False):
    index = json.loads((ROOT/'artifacts/rs/fx/index.json').read_text('utf8'))
    catalog = Catalog(Path('asset_work'))
    traces = {}
    if complete:
        execution = json.loads((ROOT/'reports/rs-fx-d3dx-execution-v1.json').read_text('utf8'))
        traces = {r['sourceSha256']: r for r in execution['traces'] if 'sourceSha256' in r and 'hresult' in r}
    # Preserve previously measured RS inputs when exact sharing later makes a
    # subset redundant. Each retained identity is rechecked against raw bytes.
    receipt = ROOT/'reports/rs-fx-d3dx-sources-v1.json'
    rows = {}
    if receipt.is_file():
        for previous in json.loads(receipt.read_text('utf8'))['sources']:
            source = catalog.path(Path(previous['source']).name)
            data = source.read_bytes()
            if digest(data) != previous['sourceSha256'] or len(data) != previous['sourceBytes']:
                raise ValueError('Previously measured RS source identity changed')
            rows[previous['sourceSha256']] = {'source': str(source), 'sourceSha256': digest(data), 'sourceBytes': len(data)}
    for template in index['templates'].values():
        if template.get('sharedResourceEvidence'): continue
        name = template['fields'].get('MeshName') or template['fields'].get('Mesh')
        if not name: continue
        source = catalog.path(name)
        data = source.read_bytes()
        if not data.startswith(b'xof '): continue
        sha = digest(data)
        row = {'source': str(source), 'sourceSha256': sha, 'sourceBytes': len(data)}
        rows[sha] = row
    if complete:
        for sha, row in rows.items():
            trace = traces[sha]
            if trace['hresult'] != '0x00000000': raise ValueError('Original DLL rejected '+row['source'])
            row['actualLoaderHresult'] = trace['hresult']
            row['nativeAnimations'] = [{k: a[k] for k in ('index', 'name', 'period', 'ticksPerSecond', 'playbackType')}
                for a in trace.get('animations', [])]
    request = {'schema': 'elsword.native-d3dx-source-request.v1',
        'dllSha256': '0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'sources': sorted(rows.values(), key=lambda r: r['source'].lower())}
    path = ROOT/'reports/rs-fx-d3dx-sources-v1.json'
    write_json(path, request)
    print(json.dumps({'sources': len(rows), 'requestSha256': digest(path.read_bytes())}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--complete', action='store_true')
    prepare(p.parse_args().complete)
