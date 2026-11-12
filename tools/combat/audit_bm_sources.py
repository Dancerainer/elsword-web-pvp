"""Freeze BM reference method hashes separately from original 2016 tables."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/native'))
from run_camera_source import extract

def audit(source, output):
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest() != 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237':
        raise ValueError('Pinned Raven reference source hash mismatch')
    selections=[];methods={}
    for match in re.finditer(rb'(?:void|bool|float) CX2GURaven::([A-Za-z0-9_]+)\([^\r\n]*',data):
        name=match[1].decode('ascii')
        if not any(token in name for token in ('RST','RBM','SOUL_TAKER','SWORD_TAKER','Berserker','Blade','Bloody','Evacuation','SwordMaster','Winning','SharpSword','DamageReact')) and not name.startswith(('RSI_COMBO_','RSI_DASH_JUMP_COMBO_X_')) and name!='RSI_DASH_COMBO_Z_EventProcess':
            continue
        block,start,end=extract(data,match[0]);text=block.decode('cp949',errors='replace')
        methods[name]=re.sub(r'/\*.*?\*/|//[^\n]*','',text,flags=re.S)
        selections.append({'method':name,'line':start,'lastLine':end,
            'sha256':hashlib.sha256(block).hexdigest(),'literalResources':sorted(set(re.findall(r'L"([^"\r\n]+)"',text)))})
    output.mkdir(parents=True,exist_ok=True)
    (output/'source-methods.json').write_text(json.dumps(methods,ensure_ascii=False,indent=2)+'\n','utf8')
    result={'schemaVersion':1,'source':{'path':'X2Lib/X2GURaven.cpp','sha256':hashlib.sha256(data).hexdigest(),
        'gitBlob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest(),'commit':'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'evidenceClass':'fixedV5-version-reference; not target2016 runtime'},'methods':selections,'clientMeasured':False,
        'limits':['Target2016 declarations take precedence over fixedV5 magnitudes.','No original client trajectory or GPU comparison.']}
    (ROOT/'contracts/bm-reference-consumers-v1.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf8')
    print(json.dumps({'methods':len(methods),'source':result['source']}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True)
    p.add_argument('--output',type=Path,default=ROOT/'.cache/bm')
    a=p.parse_args();audit(a.source,a.output)
