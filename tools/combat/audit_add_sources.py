"""Freeze qualified Add callbacks and independently audit target cancel fields."""
import argparse,hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/native'));from run_camera_source import extract
EXPECTED='b9ea0a23c074dfb366a9886823d046ad419acc474c53ae6ccd5c71ab3071de6a'
def method_records(data):
 rows=[];methods={}
 for m in re.finditer(rb'(?:void|bool|float|int) CX2GUAdd::([A-Za-z0-9_]+)\s*\([^\r\n]*',data):
  block,start,end=extract(data,m[0]);name=m[1].decode('ascii');decoded=block.decode('cp949',errors='replace');methods[name]=re.sub(r'/\*.*?\*/|//[^\n]*','',decoded,flags=re.S)
  # extract already returns one-based source lines, not byte offsets.
  rows.append(dict(method=name,line=start,lastLine=end,sha256=hashlib.sha256(block).hexdigest(),laterReconstruction='2026-' in decoded))
 return rows,methods
def audit(source,cache):
 data=source.read_bytes()
 if hashlib.sha256(data).hexdigest()!=EXPECTED:raise ValueError('Fixed Add source hash mismatch')
 rows,methods=method_records(data)
 result=dict(schemaVersion=1,clientMeasured=False,source=dict(path='JP_TW_EU_CN_US/Trunk/X2Lib/X2GUAdd.cpp',sha256=EXPECTED,gitBlob=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633',evidenceClass='fixedV5 reference containing later reconstruction; not matching 2016'),methods=rows)
 header=source.with_suffix('.h').read_bytes();header_sha=hashlib.sha256(header).hexdigest()
 if header_sha!='040e51f3723b8beea44251c945be3c2de4dfc742ea6ef83306b26af014d66f04':raise ValueError('Fixed Add header hash mismatch')
 result['header']={'path':'JP_TW_EU_CN_US/Trunk/X2Lib/X2GUAdd.h','sha256':header_sha,'nasodMacroLines':[23,35],'evidenceClass':'fixedV5 reference containing later reconstruction; not matching 2016'}
 (ROOT/'contracts/add-reference-consumers-v1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8');(cache/'source-methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2)+'\n','utf8')
 unit=json.loads((cache/'add-declarations.json').read_text('utf8'));auditrows=[]
 for prof in ('lp','mm','de'):
  profile=json.loads((ROOT/f'packages/combat-core/{prof}-profile.json').read_text('utf8'));unique={v['sourceState']:v for v in profile['states'].values()}
  for name,state in unique.items():
   raw=unit['globals'][name];fields={k:v for k,v in raw.items() if '_CANCEL_AFTER' in k or k.startswith('EVENT_PROCESS_TIME')}
   if not fields:continue
   for k,v in fields.items():
    if state['raw'].get(k)!=v:raise ValueError('Target cancel declaration altered: '+prof+'/'+name+'/'+k)
   auditrows.append(dict(profession=prof.upper(),state=name,sourcePc=unit['locations'][name],kind='command' if re.search('COMBO|JUMP_ATTACK',name) else 'skill' if re.match('ANSI_(A_|SA_|HA_)',name) else 'common',fields=fields,rawSha256=hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest(),clientMeasured=False))
 report=dict(schemaVersion=1,targetSource=unit['source'],referenceSource=result['source'],clientMeasured=False,rows=auditrows,limitations=['Raw 2016 values independently checked. No original-client trajectories acquired.','Promotion route bindings absent from reconstructed V5 are explicit target2016 adapters, not proved native callbacks.','Unknown animation states and native-only control flow stay recorded in each profile.'])
 (ROOT/'reports/add-cancel-declarations-v1.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf8');return report
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--cache',type=Path,default=ROOT/'.cache/add-target');a=p.parse_args();r=audit(a.source,a.cache);print(json.dumps(dict(cancelRows=len(r['rows']))))
