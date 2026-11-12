"""Private, independently sealed Apocalypse NPC DLL request; old receipts unchanged."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import Catalog,write_json,digest
from build_rf_fx import read_definitions,select_templates
REQUEST='reports/mm-apocalypse-d3dx-sources-v1.json'
def prepare(declarations,resource_profile=None,complete=False):
    doc=json.loads(declarations.read_text('utf8'));c=Catalog(Path('asset_work'));g=doc['globals']
    names={g['INIT_MOTION']['MOTION_FILE_NAME'],*g['INIT_DEVICE']['READY_XSKIN_MESH'].values()}
    if resource_profile:
        selected,_=select_templates(read_definitions(c),json.loads(resource_profile.read_text('utf8')),[])
        known=set()
        for receipt in (ROOT/'reports').glob('*d3dx-sources*.json'):
            if receipt.name==Path(REQUEST).name:continue
            known.update(r['sourceSha256'] for r in json.loads(receipt.read_text('utf-8-sig')).get('sources',[]))
        for t in selected.values():
            name=t['fields'].get('MeshName')or t['fields'].get('Mesh')
            if name and c.path(name).read_bytes().startswith(b'xof ') and c.evidence(c.path(name))['sha256'] not in known:names.add(name)
    rows=[]
    traces={}
    if complete:
        executed=json.loads((ROOT/'reports/mm-apocalypse-d3dx-execution-v1.json').read_text('utf-8-sig'))
        traces={r['sourceSha256']:r for r in executed['traces'] if 'sourceSha256'in r and 'hresult'in r}
    for name in sorted(names,key=str.lower):
        path=c.path(name);raw=path.read_bytes()
        if not raw.startswith(b'xof '):raise ValueError('Expected original DirectX mesh: '+name)
        row={'source':str(path),'sourceSha256':digest(raw),'sourceBytes':len(raw)}
        if complete:
            trace=traces[row['sourceSha256']]
            if trace['hresult']!='0x00000000':raise ValueError('Original DLL rejected '+name)
            row.update(actualLoaderHresult=trace['hresult'],nativeAnimations=[{k:a[k] for k in ('index','name','period','ticksPerSecond','playbackType')} for a in trace.get('animations',[])])
        rows.append(row)
    p=ROOT/REQUEST;write_json(p,{'schema':'elsword.native-d3dx-source-request.v1',
        'dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f','sources':rows})
    print(len(rows),digest(p.read_bytes()))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--declarations',required=True,type=Path);p.add_argument('--resource-profile',type=Path);p.add_argument('--complete',action='store_true');a=p.parse_args();prepare(a.declarations,a.resource_profile,a.complete)
