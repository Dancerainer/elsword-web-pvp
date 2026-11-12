"""Deduplicate exact VC inputs against already shipped Raven/LK assets.

Only this task's generated VC directory is changed. Source material and shared
RF/LK inputs remain read-only. Original conversions stay in source-proof.
"""
import gzip,json,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import write_json,digest
from runtime_path_case import canonicalize_effect_paths
def read(p):return json.loads(p.read_text('utf8'))

def pack(profession_id='vc'):
    if profession_id not in ('vc', 'bm'):
        raise ValueError('Expected an explicitly registered Raven profession')
    root=ROOT/'artifacts'/profession_id;manifest=read(root/'manifest.json');pose_bytes=(root/'runtime-pose.json').read_bytes()
    if manifest.get('id') != profession_id:
        raise ValueError('Character manifest identity differs from packing target')
    pose=json.loads(pose_bytes)
    # A second packing pass must not replace full evidence with its own subset.
    if pose.get('sharedPose'):
        pose_bytes=gzip.decompress((root/'source-proof/runtime-pose-full.json.gz').read_bytes())
        pose=json.loads(pose_bytes)
    rf=read(ROOT/'artifacts/rf/runtime-pose.json');rfclips={c['name']:c for c in rf['clips']}
    frames={f['name']:f for f in pose['frames']};shared=[];private=[]
    needed={s['animationName'] for s in read(ROOT/f'packages/combat-core/{profession_id}-profile.json')['states'].values()}
    needed.update(('Wait','Wait3','Walk','BoostPower','RespawnLanding'))
    proof=root/'source-proof';proof.mkdir(exist_ok=True)
    # Every reused pose channel must be byte-for-byte numerically identical,
    # including the private hierarchy's entire track subset. No resampling.
    for c in pose['clips']:
        if c['name'] not in needed:continue
        candidate=rfclips.get(c['name'])
        if candidate and all(candidate.get(k)==c.get(k) for k in ('name','durationSeconds','ticks_per_second','nativePlaybackField')):
            tracks=[t for t in candidate['tracks'] if t['frame_name'] in frames]
            if tracks==c['tracks']:shared.append(c['name']);continue
        private.append(c)
    before=len(pose_bytes)
    (proof/'runtime-pose-full.json.gz').write_bytes(gzip.compress(pose_bytes,mtime=0))
    pose.update(clips=private,sharedPose='../rf/runtime-pose.json',sharedClips=shared,
        selection=f'Exact RF channels shared; {profession_id.upper()} frames/helpers retained; only registered state/awakening/respawn clips loaded')
    write_json(root/'runtime-pose.json',pose,True)
    (root/'runtime-pose.json.gz').write_bytes(gzip.compress((root/'runtime-pose.json').read_bytes(),mtime=0))
    audio=read(root/'audio/manifest.json');shared_audio=read(ROOT/'artifacts/audio/manifest.json')['files']
    sound_by_sha={r['sha256']:r for r in shared_audio.values()};audio_saved=0;audio_count=0
    if profession_id == 'bm':
        # Shared Raven/common voices and impacts can already be supplied by
        # either existing profession; exact raw bytes are the reuse key.
        for folder in ('lk', 'vc'):
            for record in read(ROOT/f'artifacts/{folder}/audio/manifest.json')['files'].values():
                candidate = root/record['file']
                if not record['file'].startswith('../'):
                    raise ValueError('Expected profession-root-relative shared audio reference')
                raw = candidate.read_bytes()
                if digest(raw) != record['sha256'] or len(raw) != record['bytes']:
                    raise ValueError('Shared original audio bytes differ: '+str(candidate))
                sound_by_sha.setdefault(record['sha256'], record)
    for r in audio['files'].values():
        if r['sha256'] in sound_by_sha:
            old=sound_by_sha[r['sha256']];r['file']=old['file'] if old['file'].startswith('../') else '../audio/'+old['file'];r['sharedSource']='RF/common audio exact SHA256'
            audio_saved+=r['bytes'];audio_count+=1
    write_json(root/'audio/manifest.json',audio)
    fx=read(root/'fx/index.json');textures={};texture_count=0;texture_saved=0
    for folder in (('rf','lk','vc') if profession_id == 'bm' else ('rf','lk')):
        for index in sorted((ROOT/'artifacts'/folder).glob('*/index.json')):
            for t in read(index).get('templates',{}).values():
                for r in t.get('textures',{}).values():
                    if r.get('source',{}).get('sha256'):textures.setdefault(r['source']['sha256'],('../'+folder+'/'+r['file'],r))
    for t in fx['templates'].values():
        for r in t.get('textures',{}).values():
            entry=textures.get(r.get('source',{}).get('sha256'))
            if entry and not r['file'].startswith('../'):
                r['file']=entry[0];r['sharedSource']='Identical original texture SHA256'
            if r.get('sharedSource')=='Identical original texture SHA256':
                texture_saved+=(root/r['file']).stat().st_size;texture_count+=1
    canonicalize_effect_paths(fx, root)
    write_json(root/'fx/index.json',fx);write_json(ROOT/f'contracts/{profession_id}-fx-index.json',fx)
    write_json(root/'effect-assets.json',{'schemaVersion':1,'templates':fx['templates']})
    manifest['effectTemplates']={'schemaVersion':1,'templates':fx['templates']}
    manifest['glb']=f'source-proof/{profession_id}.glb'
    write_json(root/'manifest.json',manifest)
    required={'manifest.json','runtime-pose.json','runtime-pose.json.gz',manifest['runtimeGlb'],'effect-assets.json','fx/index.json','audio/manifest.json','ui/manifest.json'}
    required.update(r['file'] for r in manifest['portraits'].values())
    for r in audio['files'].values():
        if r['file'].startswith(f'../{profession_id}/audio/'):required.add('audio/'+Path(r['file']).name)
    for t in fx['templates'].values():
        required.update(t[k] for k in ('glb','poseData') if t.get(k) and not t[k].startswith('../'))
        required.update(r['file'] for r in t['textures'].values() if not r['file'].startswith('../'))
    for p in list(root.rglob('*')):
        if not p.is_file() or p.is_relative_to(proof):continue
        rel=p.relative_to(root)
        if rel.as_posix() not in required:
            dest=proof/rel;dest.parent.mkdir(parents=True,exist_ok=True);p.replace(dest)
    outputs=[{'file':p,'sha256':digest((root/p).read_bytes()),'bytes':(root/p).stat().st_size} for p in sorted(required)]
    result={'schemaVersion':1,'clientMeasured':False,'poseBeforeBytes':before,'poseAfterBytes':(root/'runtime-pose.json').stat().st_size,
        'sharedPoseClips':len(shared),'privatePoseClips':len(private),'sharedModelClips':len(manifest['sharedCharacterAnimations']['clips']),
        'sharedFxTemplates':len(fx['sharedTemplates']),'sharedAudioFiles':audio_count,'sharedAudioBytes':audio_saved,
        'sharedAdditionalTextureReferences':texture_count,'sharedTextureReferenceBytes':texture_saved,
        'runtimeFiles':len(outputs),'runtimeBytes':sum(o['bytes'] for o in outputs),'outputs':outputs,
        'limits':['Exact original keys/bytes reuse only; no decimation, lower animation rate or lower particle counts.',
            'Source-proof is excluded from runtime asset inventory. Full conversions remain task-local and ignored.']}
    write_json(ROOT/f'reports/{profession_id}-resource-reuse-v1.json',result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('outputs','limits')}))
    return result
if __name__=='__main__':pack()
