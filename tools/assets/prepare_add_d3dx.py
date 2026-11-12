"""Freeze/recheck every new ADD source mesh against the original 2016 D3DX DLL."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path[:0]=[str(ROOT/'tools/assets/character'),str(ROOT/'tools/assets')]
from build_rf import Catalog,write_json,digest
from build_rf_fx import read_definitions,select_templates
from build_add_costumes import contract

def prepare(profile_root,complete=False):
 c=Catalog(Path('asset_work'));defs=read_definitions(c);rows={};shared=set()
 for old in ('rf','lk','vc','rs','bm','is'):
  for p in (ROOT/'artifacts'/old).glob('*/index.json'):
   for n,r in json.loads(p.read_text('utf8')).get('templates',{}).items():shared.add((n,r['declarationSha256']))
 def add(name):
  p=c.path(name);raw=p.read_bytes()
  if raw.startswith(b'xof '):rows[digest(raw)]={'source':str(p),'sourceSha256':digest(raw),'sourceBytes':len(raw)}
 for job in ('lp','mm','de'):
  profile=json.loads((profile_root/f'{job}-profile.json').read_text('utf8'));selected,_=select_templates(defs,profile,[])
  for t in selected.values():
   if (t['name'],t['declarationSha256'])in shared:continue
   n=t['fields'].get('MeshName')or t['fields'].get('Mesh')
   if n:add(n)
 for item in contract(c)['items'].values():
  names=[x for x in item['models']if x and item['useType']!=1 and item['slot']!=0]+[x['name']for x in item['attachedMeshes']]
  if item['canHyperMode']:names+=['Hyper_'+x for x in item['models']if x]
  for name in names:add(name)
 if complete:
  result=json.loads((ROOT/'reports/add-fx-d3dx-execution-v1.json').read_text('utf-8-sig'));traces={r['sourceSha256']:r for r in result['traces']if 'sourceSha256'in r and 'hresult'in r}
  for row in rows.values():
   trace=traces[row['sourceSha256']]
   if trace['hresult']!='0x00000000':raise ValueError('Original DLL rejected '+row['source'])
   row.update(actualLoaderHresult=trace['hresult'],nativeAnimations=[{k:a[k]for k in ('index','name','period','ticksPerSecond','playbackType')}for a in trace.get('animations',[])])
 p=ROOT/'reports/add-fx-d3dx-sources-v1.json';write_json(p,{'schema':'elsword.native-d3dx-source-request.v1','dllSha256':'0b28546be22c71834501f7d7185ede5d79742457331c7ee09efc14490dd64f5f','sources':sorted(rows.values(),key=lambda r:r['source'].lower())})
 print(len(rows),digest(p.read_bytes()))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile-root',type=Path,default=ROOT/'packages/combat-core');p.add_argument('--complete',action='store_true');a=p.parse_args();prepare(a.profile_root,a.complete)
