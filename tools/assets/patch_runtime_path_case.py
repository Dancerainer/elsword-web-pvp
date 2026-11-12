"""Correct consumer reference spelling without renaming any shared media bytes."""
import argparse
import json
import hashlib
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'character'))
from runtime_path_case import canonical_runtime_path

def read(path):return json.loads(path.read_text('utf8'))
def receipt(path):return {'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def prepare(target,output):
    target,output=target.resolve(),output.resolve()
    if output.is_relative_to(target):raise ValueError('Independent output required')
    rows=[];changes=[];inputs={}
    for name in ('rf/shadow-weapon-fx/index.json','lk/effect-assets.json','lk/manifest.json'):
        obj=read(target/name);base=target/name.split('/')[0]
        templates=obj.get('templates',obj.get('effectTemplates',{}).get('templates',{}))
        for template,row in templates.items():
            fields=[(row,key)for key in ('glb','poseData')if row.get(key)]+[(item,'file')for item in row.get('textures',{}).values()]
            for item,key in fields:
                old=item[key];new=canonical_runtime_path(base,old)
                if old==new:continue
                inputs[str((base/new).resolve())]=receipt(base/new);item[key]=new
                changes.append({'file':name,'template':template,'field':key,'before':old,'after':new})
        if name=='lk/manifest.json':
            profile_path=target.parent/'packages/combat-core/lk-profile.json';profile=read(profile_path)
            if profile['target']['unitClass']!=100 or profile['profileId']!=obj['profile']['profileId']:raise ValueError('LK source identity changed')
            # Match server-assets.mjs: effect-assets plus the visual indexes.
            # The old embedded manifest inventory predates later particle closure.
            consumed={}
            for index_name in [obj['effectAssetIndex'],*obj.get('visualEffectIndexes',['fx/index.json'])]:
                index_path=target/'lk'/index_name
                inputs[str(index_path)]=receipt(index_path)
                consumed.update(read(index_path)['templates'])
            for template,row in profile.get('effectTemplates',{}).items():
                actual=consumed.get(template)
                if actual is None or row.get('declarationSha256')and row['declarationSha256']!=actual.get('declarationSha256'):raise ValueError('LK source template coverage differs: '+template)
            canonical=profile_path.read_bytes().replace(b'\r\n',b'\n')
            if b'\r'in canonical:raise ValueError('Noncanonical profile newline')
            sealed=hashlib.sha256(canonical).hexdigest();old=obj['profile']['sha256']
            if old!=sealed:
                obj['profile']['sha256']=sealed;obj['profile']['hashNormalization']='UTF-8 LF';inputs[str(profile_path)]=receipt(profile_path)
                changes.append({'file':name,'field':'profile.sha256','before':old,'after':sealed,'evidence':'Current original profile UTF-8 LF bytes and complete native template declaration identity coverage'})
        if any(row['file']==name for row in changes):
            path=output/'metadata'/name;write(path,obj);rows.append({'file':name,'source':str(path),'prior':receipt(target/name),**receipt(path)})
    plan={'schemaVersion':1,'targetRoot':str(target),'files':rows,'inputs':[{'path':path,**row}for path,row in inputs.items()],'changes':changes,
        'scope':'Consumer path spelling and current UTF-8 LF LK profile binding only. Native template declarations, source fields, profile values and all mesh/texture bytes are preserved.'}
    write(output/'receipt.json',plan);(output/'apply.py').write_bytes(Path(__file__).with_name('apply_prepared_asset_import.py').read_bytes())
    return plan
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--target-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True);args=parser.parse_args()
    plan=prepare(args.target_root,args.output_root)
    print({'files':len(plan['files']),'caseReferences':sum('template'in row for row in plan['changes']),'profileSeals':sum(row['field']=='profile.sha256'for row in plan['changes'])})
if __name__=='__main__':main()
