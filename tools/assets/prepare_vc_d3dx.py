"""Prepare/freeze the task-local original DLL measurement request for new VC FX.

Run without --complete before the shared d3dx-animation-probe.ps1; run with
--complete afterwards. The printed hash requires an explicit registry update.
"""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog

def main(complete, profession_id='vc'):
    if profession_id not in ('vc', 'bm'):
        raise ValueError('Expected an explicitly registered Raven profession')
    index=json.loads((ROOT/f'artifacts/{profession_id}/fx/index.json').read_text('utf8'))
    cat=Catalog(Path('asset_work'));rows={}
    measured=json.loads((ROOT/f'reports/{profession_id}-fx-d3dx-execution-v1.json').read_text('utf8'))['traces'] if complete else []
    traces={row['sourceSha256']:row for row in measured if 'sourceSha256' in row and 'hresult' in row}
    for t in index['templates'].values():
        if t.get('sharedResourceEvidence'):continue
        n=t['fields'].get('MeshName') or t['fields'].get('Mesh')
        if not n:continue
        src=cat.path(n);data=src.read_bytes()
        if not data.startswith(b'xof '):continue
        sha=hashlib.sha256(data).hexdigest()
        row={'source':str(src),'sourceSha256':sha,'sourceBytes':len(data)}
        if complete:
            trace=traces[sha]
            if trace['hresult']!='0x00000000':raise ValueError('DLL rejected '+str(src))
            row['actualLoaderHresult']=trace['hresult']
            row['nativeAnimations']=[{k:a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace.get('animations',[])]
        rows[sha]=row
    request={'schema':'elsword.native-d3dx-source-request.v1','dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f',
        'sources':sorted(rows.values(),key=lambda r:r['source'].lower())}
    p=ROOT/f'reports/{profession_id}-fx-d3dx-sources-v1.json';p.write_bytes((json.dumps(request,indent=2)+'\n').encode('utf8'))
    print(len(rows),hashlib.sha256(p.read_bytes()).hexdigest())

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--complete',action='store_true')
    p.add_argument('--profession', choices=('vc', 'bm'), default='vc')
    a=p.parse_args();main(a.complete,a.profession)
