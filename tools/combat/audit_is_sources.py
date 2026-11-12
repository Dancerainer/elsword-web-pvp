"""Freeze the hash-qualified SwordMan reference, separately from target2016."""
from pathlib import Path
import argparse,hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from run_camera_source import extract
EXPECTED='ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'
def audit(source):
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=EXPECTED:raise ValueError('Pinned SwordMan SHA mismatch')
    rows=[];methods={}
    for m in re.finditer(rb'(?:void|bool|float|int) CX2GUElsword_SwordMan::([A-Za-z0-9_]+)\([^\r\n]*',data):
        name=m[1].decode('ascii')
        if not any(t in name for t in ('ETK','EIS','Phantom','Brutal','Harsh','ComboX1','ComboZ2','DashAttackX','Buff')):continue
        block,start,end=extract(data,m[0]);decoded=block.decode('cp949',errors='replace')
        methods[name]=re.sub(r'/\*.*?\*/|//[^\n]*','',decoded,flags=re.S)
        rows.append({'method':name,'line':data[:start].count(b'\n')+1,'lastLine':data[:end].count(b'\n')+1,
            'sha256':hashlib.sha256(block).hexdigest(),'literalResources':sorted(set(re.findall(r'L"([^"\r\n]+)"',decoded)))})
    result={'schemaVersion':1,'clientMeasured':False,'source':{'path':'X2Lib/X2GUElsword_SwordMan.cpp',
        'sha256':EXPECTED,'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'gitBlob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),
        'evidenceClass':'fixedV5 version reference, includes later reconstruction; not matching target2016 executable'},
        'methods':rows,'targetSource':'packages/combat-core/is-profile.json#sources',
        'limits':['Old memo IDs and numeric values do not override target2016 fields.','No original-client combat or GPU trace.']}
    (ROOT/'contracts/is-reference-consumers-v1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    (ROOT/'.cache/is-source/methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'methods':len(rows),'sha256':EXPECTED}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=ROOT/'.cache/is-source/X2GUElsword_SwordMan.cpp')
    audit(p.parse_args().source)
