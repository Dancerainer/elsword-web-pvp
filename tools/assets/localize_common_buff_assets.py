"""Materialize borrowed buff visuals inside the consumer's common-buff boundary."""
import argparse
import copy
import hashlib
import json
import posixpath
import struct
from pathlib import Path
from urllib.parse import unquote

def receipt(path):return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size}
def read(path):return json.loads(path.read_text('utf8'))
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
def kind(path):return 'pose'if path.name.endswith('.pose.json')else path.suffix.lower()
def glb_refs(path):
    raw=path.read_bytes()
    if raw[:4]!=b'glTF' or struct.unpack_from('<I',raw,4)[0]!=2:raise ValueError('Invalid GLB')
    size,tag=struct.unpack_from('<II',raw,12)
    if tag!=0x4e4f534a:raise ValueError('GLB JSON chunk missing')
    doc=json.loads(raw[20:20+size]);return [unquote(row['uri'])for group in ('images','buffers')for row in doc.get(group,[])if row.get('uri')and not row['uri'].startswith('data:')]

def localize(index,catalog,target,stage,source_root=None):
    common=target/'common-buffs';staged=stage/'common-buffs';outputs={};inputs={};hashes={};changes=[]
    def pin(path):inputs[str(path.resolve())]=receipt(path)
    def file_for(name):return staged/name if(staged/name).is_file()else common/name
    for path in common.rglob('*'):
        if path.is_file()and (path.suffix.lower()in('.png','.glb')or path.name.endswith('.pose.json')):
            hashes.setdefault((kind(path),receipt(path)['sha256']),path.relative_to(common).as_posix())
    def safe(root,name):
        path=(root/name).resolve()
        if not path.is_relative_to(root.resolve()):raise ValueError('Asset reference escapes its root')
        return path
    def store(source,name):
        dest=safe(common,name);existing=file_for(name);info=receipt(source);pin(source)
        if existing.is_file():
            if receipt(existing)!=info:raise ValueError('Localized resource collision: '+name)
            if existing==dest:pin(dest)
            else:outputs['common-buffs/'+name]=existing
        else:
            staged_path=staged/name;staged_path.parent.mkdir(parents=True,exist_ok=True);staged_path.write_bytes(source.read_bytes());outputs['common-buffs/'+name]=staged_path
        hashes.setdefault((kind(source),info['sha256']),name)
        return name
    def dependency_pairs(source,dest_name):
        source_base=target if source.is_relative_to(target)else source_root
        return [(safe(source_base,source.parent.relative_to(source_base)/uri),posixpath.normpath(posixpath.dirname(dest_name)+'/'+uri))for uri in glb_refs(source)]
    def transfer(ref):
        relative=posixpath.normpath('common-buffs/'+ref);source=safe(target,relative)
        if not source.is_file()and source_root is not None:source=safe(source_root,relative)
        pin(source);info=receipt(source)
        previous=hashes.get((kind(source),info['sha256']))
        if previous and source.suffix.lower()=='.glb':
            if any(not file_for(name).is_file()or receipt(file_for(name))!=receipt(dep)for dep,name in dependency_pairs(source,previous)):previous=None
        if previous:pin(file_for(previous));return previous
        folder='fx/meshes'if kind(source)in('.glb','pose')else'fx/textures'
        name=folder+'/'+source.name
        if file_for(name).is_file()and receipt(file_for(name))!=info:name=folder+'/import-'+info['sha256'][:16]+'/'+source.name
        if source.suffix.lower()=='.glb':
            pairs=dependency_pairs(source,name)
            if any(file_for(n).is_file()and receipt(file_for(n))!=receipt(p)for p,n in pairs):
                name=folder+'/import-'+info['sha256'][:16]+'/'+source.name;pairs=dependency_pairs(source,name)
            for dep,local in pairs:store(dep,local)
        return store(source,name)
    for name,row in index['templates'].items():
        changed=False
        for key in ('glb','poseData'):
            if (row.get(key)or'').startswith('../'):old=row[key];row[key]=transfer(old);changes.append({'template':name,'field':key,'before':old,'after':row[key]});changed=True
        for texture in row.get('textures',{}).values():
            if texture.get('file','').startswith('../'):
                old=texture['file'];texture['file']=transfer(old);changes.append({'template':name,'field':'texture','before':old,'after':texture['file']});changed=True
        if changed:catalog['effectTemplates'][name]=copy.deepcopy(row)
    return outputs,inputs,changes

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--target-root',type=Path,required=True);parser.add_argument('--output-root',type=Path,required=True);args=parser.parse_args()
    target,output=args.target_root.resolve(),args.output_root.resolve();stage=output/'metadata'
    if output.is_relative_to(target):raise ValueError('Patch output must be independent')
    index=read(target/'common-buffs/fx/index.json');catalog=read(target/'common-buffs/catalog.json');manifest=read(target/'common-buffs/manifest.json')
    outputs,inputs,changes=localize(index,catalog,target,stage)
    for name,value in [('common-buffs/fx/index.json',index),('common-buffs/catalog.json',catalog)]:write(stage/name,value);outputs[name]=stage/name
    rows={row['file']:row for row in manifest['outputs']}
    for name,path in outputs.items():relative=name[len('common-buffs/'):];rows[relative]={'file':relative,**receipt(path)}
    manifest['outputs']=[rows[name]for name in sorted(rows)];write(stage/'common-buffs/manifest.json',manifest);outputs['common-buffs/manifest.json']=stage/'common-buffs/manifest.json'
    files=[]
    for name,path in sorted(outputs.items()):
        dest=target/name;files.append({'file':name,'source':str(path),'kind':'localize-common-buff','prior':receipt(dest)if dest.is_file()else None,**receipt(path)})
    plan={'schemaVersion':1,'targetRoot':str(target),'files':files,'inputs':[{'path':path,**row}for path,row in sorted(inputs.items())],'changes':changes,
        'validation':'Original converted mesh/pose/texture bytes preserved; explicit references deduplicate by SHA and GLB-relative texture dependencies retain their original URI layout.'}
    write(output/'receipt.json',plan);(output/'apply.py').write_bytes(Path(__file__).with_name('apply_prepared_asset_import.py').read_bytes())
    print({'files':len(files),'rewrittenReferences':len(changes),'mediaBytes':sum(r['bytes']for r in files if r['prior']is None)})
if __name__=='__main__':main()
