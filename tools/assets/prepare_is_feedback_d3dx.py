"""Hash-check the two previously unmeasured original IS command sword meshes.

Only prepares the task-local request. Execute the existing frozen-DLL probe;
pin its receipt separately before rebuilding converted keys.
"""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog

def main(complete=False):
    catalog=Catalog(Path('asset_work'))
    sources=[]
    for name in ('elsword_C_DashXX_sword.X','elsword_C_DashXX_sheath.X'):
        path=catalog.path(name);data=path.read_bytes()
        row={'source':str(path),'sourceSha256':hashlib.sha256(data).hexdigest(),'sourceBytes':len(data)}
        if complete:
            execution=json.loads((ROOT/'reports/is-feedback-d3dx-execution-v2.json').read_text('utf8'))
            if execution['dll']['sha256']!='0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f':raise ValueError('Unexpected DLL')
            trace=next(t for t in execution['traces'] if t.get('sourceSha256')==row['sourceSha256'])
            if trace['hresult']!='0x00000000':raise ValueError('Original DLL rejected '+name)
            row.update(actualLoaderHresult=trace['hresult'],nativeAnimations=[{k:a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace['animations']])
        sources.append(row)
    request={'schema':'elsword.native-d3dx-source-request.v1',
        'dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f','sources':sources}
    path=ROOT/'reports/is-feedback-d3dx-sources-v2.json'
    path.write_bytes((json.dumps(request,indent=2)+'\n').encode('utf8'))
    print(hashlib.sha256(path.read_bytes()).hexdigest())
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--complete',action='store_true')
    main(parser.parse_args().complete)
