"""Verify a prepared private asset receipt, then copy only with --apply."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

def receipt(path):return {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
def expected(row):return {key:row[key]for key in ('bytes','sha256')}
def preflight(plan):
    root=Path(plan['targetRoot']).resolve();destinations={}
    for row in plan['files']:
        dest=(root/row['file']).resolve()
        if dest==root or not dest.is_relative_to(root) or row['file'] in destinations:raise ValueError('Unsafe or duplicate destination')
        destinations[row['file']]=(dest,row)
        source=Path(row['source'])
        if not source.is_file() or receipt(source)!=expected(row):raise ValueError('Prepared source changed: '+str(source))
        actual=receipt(dest)if dest.is_file()else None
        if actual not in (row['prior'],expected(row)):raise ValueError('Destination changed after preparation: '+str(dest))
    by_path={str(dest):row for dest,row in destinations.values()}
    for item in plan['inputs']:
        path=Path(item['path']).resolve()
        if not path.is_file():raise ValueError('Input disappeared: '+str(path))
        actual=receipt(path);op=by_path.get(str(path))
        if actual!=expected(item) and not(op and actual==expected(op)):raise ValueError('Pinned input changed: '+str(path))
    return destinations

def execute(plan,apply=False):
    destinations=preflight(plan);copied=[];unchanged=[]
    if apply:
        for name,(dest,row)in destinations.items():
            if dest.is_file()and receipt(dest)==expected(row):unchanged.append(name);continue
            # Recheck immediately before the mutation as well as globally above.
            if (receipt(dest)if dest.is_file()else None)!=row['prior']:raise ValueError('Concurrent target change: '+str(dest))
            dest.parent.mkdir(parents=True,exist_ok=True);temporary=dest.with_name(dest.name+'.add-import.tmp')
            with temporary.open('xb')as output,Path(row['source']).open('rb')as source:shutil.copyfileobj(source,output)
            if receipt(temporary)!=expected(row):raise ValueError('Copy bytes differ: '+str(dest))
            os.replace(temporary,dest);copied.append(name)
        preflight(plan)
    return {'mode':'applied'if apply else'verified-only','files':len(destinations),'copied':len(copied),'alreadyPresent':len(unchanged)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--receipt',type=Path,default=Path(__file__).with_name('receipt.json'));p.add_argument('--apply',action='store_true');args=p.parse_args()
    plan=json.loads(args.receipt.read_text('utf8'));result=execute(plan,args.apply);result['receiptSha256']=receipt(args.receipt)['sha256']
    if args.apply:args.receipt.with_name('applied.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result))
