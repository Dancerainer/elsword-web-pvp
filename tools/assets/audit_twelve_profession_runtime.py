"""Read-only twelve-profession runtime path, seal and original declaration audit."""
import argparse
import hashlib
import json
import posixpath
import struct
from pathlib import Path

JOBS={'RF':107,'LK':100,'VC':115,'RS':101,'BM':106,'IS':112,'GM':120,'BH':121,'CA':125,'LP':122,'MM':123,'DE':126}
def read(path):return json.loads(path.read_text('utf8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def glb_external_uris(path):
    with path.open('rb')as stream:
        header=stream.read(20)
        if len(header)!=20:raise ValueError('Truncated GLB header: '+str(path))
        magic,version,length,json_length,kind=struct.unpack('<5I',header)
        if magic!=0x46546c67 or version!=2 or kind!=0x4e4f534a or length!=path.stat().st_size or json_length>length-20:raise ValueError('Invalid GLB header: '+str(path))
        payload=json.loads(stream.read(json_length))
    return [row['uri']for row in payload.get('images',[])+payload.get('buffers',[])if row.get('uri')and not row['uri'].startswith('data:')]
def audit(repo,assets):
    paths={p.relative_to(assets).as_posix()for p in assets.rglob('*')if p.is_file()};folded={p.casefold():p for p in paths}
    errors=[];references=set();metadata={};jobs={};profile_bindings=[]
    def load(name):
        verify('',name);metadata[name]=sha(assets/name);return read(assets/name)
    def verify(base,ref):
        if not isinstance(ref,str)or ref.startswith('/')or ':'in ref or '\\'in ref:raise ValueError('Invalid runtime reference: '+str(ref))
        name=posixpath.normpath(base+'/'+ref).lstrip('/')
        if name.startswith('../'):raise ValueError('Reference escapes assets: '+name)
        references.add(name)
        if name not in paths:errors.append({'kind':'case-mismatch'if name.casefold()in folded else'missing-file','requested':name,'actual':folded.get(name.casefold())})
        return name
    def templates(base,rows):
        for row in rows.values():
            for key in ('glb','poseData'):
                if row.get(key):verify(base,row[key])
            for image in row.get('textures',{}).values():verify(base,image['file'])
    def consumer_files(base,value,keys):
        if isinstance(value,list):
            for row in value:consumer_files(base,row,keys)
        elif isinstance(value,dict):
            for key,item in value.items():
                if key in keys and isinstance(item,str):verify(base,item)
                elif key not in ('source','sources','atlasSource','tetSource','sourceMotion'):consumer_files(base,item,keys)
    common=load('common-buffs/fx/index.json');templates('common-buffs',common['templates'])
    for name,row in common['templates'].items():
        refs=[row[key]for key in ('glb','poseData')if row.get(key)]+[v['file']for v in row.get('textures',{}).values()]
        for ref in refs:
            if any(part in ('','.','..')for part in ref.split('/')):errors.append({'kind':'common-buff-storage-boundary','template':name,'reference':ref})
    common_manifest=load('common-buffs/manifest.json')
    for row in common_manifest['outputs']:
        path=assets/verify('common-buffs',row['file'])
        if path.is_file()and (sha(path)!=row['sha256']or path.stat().st_size!=row['bytes']):errors.append({'kind':'common-buff-output-seal','file':row['file']})
    for folder in ('cast-display','battle-life'):
        manifest=load(folder+'/manifest.json')
        for name in manifest['visualEffectIndexes']:templates(folder,load(verify(folder,name))['templates'])
    for file in sorted((assets/'ui').rglob('*.json')):
        name=file.relative_to(assets).as_posix()
        if '/skills/'in name:continue
        consumer_files(posixpath.dirname(name),load(name),{'file'})
    costumes=load('costumes/manifest.json')
    for family,rows in costumes['characters'].items():
        for name,row in rows.items():consumer_files('costumes/'+family+'/'+name,row,{'glb','poseData'})
    if costumes.get('particleIndex'):templates('costumes',load(verify('costumes',costumes['particleIndex']))['templates'])
    for job,unit in JOBS.items():
        folder=job.lower();manifest=load(folder+'/manifest.json');profile_path=repo/f'packages/combat-core/{folder}-profile.json';profile=read(profile_path)
        if profile['target']['unitClass']!=unit:errors.append({'kind':'wrong-class','profession':job})
        current=hashlib.sha256(profile_path.read_bytes().replace(b'\r\n',b'\n')).hexdigest();bound=manifest.get('profile',{}).get('sha256')
        profile_bindings.append({'profession':job,'sourceClass':unit,'profileSha256':current,'manifestProfileSha256':bound,
            'status':'matched'if bound==current else'legacy-manifest-without-profile-binding'if bound is None else'source-profile-binding-stale'})
        verify(folder,manifest.get('runtimeGlb',manifest['glb']));pose=load(verify(folder,manifest['runtimePose']))
        if pose.get('sharedPose'):
            shared=load(verify(folder,pose['sharedPose']));shared_names={c['name']for c in shared['clips']}
            if not set(pose.get('sharedClips',[]))<=shared_names:errors.append({'kind':'shared-pose-clip-missing','profession':job})
        if manifest.get('sharedCharacterAnimations'):verify(folder,manifest['sharedCharacterAnimations']['glb'])
        visual={};indexes=manifest.get('visualEffectIndexes',
            [name+'/index.json'for name in ('fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17','landing-fx')]if job=='RF'else['fx/index.json'])
        for name in indexes:visual.update(load(verify(folder,name))['templates'])
        effect=load(verify(folder,manifest['effectAssetIndex']));templates(folder,effect['templates']);templates(folder,visual)
        missing=[];different=[]
        for name,row in profile.get('effectTemplates',{}).items():
            actual=visual.get(name,effect['templates'].get(name))
            if actual is None:missing.append(name)
            elif row.get('declarationSha256')and row['declarationSha256']!=actual.get('declarationSha256'):different.append(name)
        if missing or different:errors.append({'kind':'profile-visual-declaration-closure','profession':job,'missing':missing,'different':different})
        for row in manifest.get('portraits',{}).values():verify(folder,row['file'])
        if manifest.get('audioManifest'):
            audio=load(verify(folder,manifest['audioManifest']))
            for row in audio['files'].values():verify('audio',row['file'])
        catalog=load('ui/skills/'+folder+'/catalog.json')if job!='RF'else load('ui/skills/catalog.json')
        consumer_files('ui/skills',catalog['skills'],{'icon'})
        if catalog['classId']!=unit:errors.append({'kind':'skill-catalog-class','profession':job})
        jobs[job]={'classId':unit,'privateClips':len(pose['clips']),'sharedClips':len(pose.get('sharedClips',[])),
            'visualTemplates':len(visual),'profileTemplates':len(profile.get('effectTemplates',{}))}
    # These external image URIs are resolved by the GLB loader, not by a JSON
    # effect index. Validate exact spelling without decoding binary geometry.
    glb_count=0
    for name in sorted(references.copy()):
        if not name.endswith('.glb')or name not in paths:continue
        for uri in glb_external_uris(assets/name):verify(posixpath.dirname(name),uri)
        glb_count+=1
    return {'schemaVersion':1,'clientMeasured':False,'assetRoot':str(assets),'professions':jobs,'uniqueRuntimeReferences':len(references),
        'glbExternalUriInventories':glb_count,
        'profileBindings':profile_bindings,'errors':errors,'metadataSha256':metadata,
        'scope':'Read-only source identity, current runtime references, exact portable path spelling and shared buff output receipts. Profile binding differences remain explicit; no source values or seals are silently updated.'}
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo-root',type=Path,required=True);p.add_argument('--asset-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    result=audit(args.repo_root.resolve(),args.asset_root.resolve());args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    print(json.dumps({'references':result['uniqueRuntimeReferences'],'errors':result['errors'],'profileBindings':result['profileBindings']}))
    if result['errors']:raise SystemExit(1)
