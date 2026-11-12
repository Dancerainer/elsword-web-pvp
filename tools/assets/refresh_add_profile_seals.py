"""Refresh only final ADD profile association hashes, never repack/move assets."""
import argparse,hashlib,json
from pathlib import Path
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(p):return json.loads(p.read_text('utf8'))
def write(p,v):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf8',newline='\n')
def refresh(artifact_root,profile_root,report):
    artifact_root=artifact_root.resolve();profile_root=profile_root.resolve()
    if any(p.resolve().as_posix().lower().startswith(('asset_sources/upstream','asset_sources/client'))for p in (artifact_root,report)):raise ValueError('Original inputs are read-only')
    if report.resolve().is_relative_to(profile_root):raise ValueError('Report cannot overwrite source profiles')
    prepared=[];profiles={}
    for job,unit_class in (('lp',122),('mm',123),('de',126)):
        path=profile_root/(job+'-profile.json');raw=path.read_bytes().replace(b'\r\n',b'\n');p=json.loads(raw)
        if p['target']['unitClass']!=unit_class:raise ValueError('Wrong source profile: '+job)
        profiles[job]={'path':str(path),'sha256':sha(raw),'normalization':'UTF-8 LF'}
        for relative,field in ((job+'/manifest.json','profile'),(job+'/fx/index.json','profileSha256')):
            destination=artifact_root/relative;original=destination.read_bytes();value=json.loads(original)
            old=value[field].get('sha256')if field=='profile'else value.get(field)
            if field=='profile':value['profile']={**value['profile'],'sha256':profiles[job]['sha256']}
            else:value[field]=profiles[job]['sha256']
            prepared.append((destination,value,{'file':relative,'previousSha256':sha(original),'previousProfileSha256':old,'profileSha256':profiles[job]['sha256']}))
    # Validate every input before the first write. Audio profile hashes remain
    # extraction provenance; changing gameplay callbacks is not a new extraction.
    rows=[]
    for destination,value,row in prepared:
        write(destination,value);row.update(sha256=sha(destination.read_bytes()),bytes=destination.stat().st_size);rows.append(row)
    result={'schemaVersion':1,'artifactRoot':str(artifact_root),'profiles':profiles,'overrides':rows,
        'scope':'Final profile association only. No source curves, poses, audio extraction receipts, resource paths, or source-only contracts changed.',
        'applyAfter':['reports/add-assets-handoff-v1.json','reports/mm-apocalypse-assets-handoff-v1.json','reports/mm-mutation-assets-handoff-v1.json']}
    write(report,result);return result
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--artifact-root',type=Path,required=True);p.add_argument('--profile-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
    print(json.dumps(refresh(a.artifact_root,a.profile_root,a.report),ensure_ascii=False))
