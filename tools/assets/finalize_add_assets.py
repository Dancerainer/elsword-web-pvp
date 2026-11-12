"""Seal ADD runtime payloads; share only identical source keys and bytes.

Full original proof stays below each private output's source-proof directory.
Original curves are never resampled or reduced to a presentation budget.
"""
import argparse
import gzip
import json
import os
import sys
from pathlib import Path
from finalize_lk_assets import finalize
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/assets/character'))
from build_rf import digest,write_json
from runtime_path_case import canonicalize_effect_paths

def read(path):return json.loads(path.read_text('utf8'))
def relative(path,root):return Path(os.path.relpath(path.resolve(),root.resolve())).as_posix()

def pack(job,profile):
    root=ROOT/'artifacts'/job;proof=root/'source-proof';proof.mkdir(exist_ok=True)
    manifest=read(root/'manifest.json');pose=read(root/'runtime-pose.json')
    if pose.get('sharedPose'):pose=json.loads(gzip.decompress((proof/'runtime-pose-full.json.gz').read_bytes()))
    raw=(json.dumps(pose,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf8')
    (proof/'runtime-pose-full.json.gz').write_bytes(gzip.compress(raw,mtime=0))
    shared=[];private=pose['clips'];supplements={}
    if job!='lp':
        candidates={c['name']:c for c in read(ROOT/'artifacts/lp/runtime-pose.json')['clips']}
        frames={f['name'] for f in pose['frames']};private=[]
        for clip in pose['clips']:
            other=candidates.get(clip['name'])
            if other and all(other.get(k)==clip.get(k) for k in ('name','durationSeconds','ticks_per_second','nativePlaybackField')):
                target={t['frame_name']:t for t in clip['tracks']}
                reused={t['frame_name']:t for t in other['tracks'] if t['frame_name'] in frames}
                if reused and all(target.get(n)==track for n,track in reused.items()):
                    shared.append(clip['name']);extra=[t for n,t in target.items() if n not in reused]
                    if extra:supplements[clip['name']]=extra
                    continue
            private.append(clip)
        pose.update(clips=private,sharedPose='../lp/runtime-pose.json',sharedClips=shared,
            sharedClipTrackSupplements=supplements,selection='Exact LP source keys shared; all ADD profession frames, supplemental channels and original timestamps retained')
        write_json(root/'runtime-pose.json',pose,True)
        (root/'runtime-pose.json.gz').write_bytes(gzip.compress((root/'runtime-pose.json').read_bytes(),mtime=0))
    audio=read(root/'audio/manifest.json');sounds={}
    for old in ('lp','mm'):
        if old==job:break
        for row in read(ROOT/f'artifacts/{old}/audio/manifest.json')['files'].values():
            path=(ROOT/'artifacts/audio'/row['file']).resolve()
            if path.is_file() and digest(path.read_bytes())==row['sha256']:sounds.setdefault(row['sha256'],row['file'])
    shared_audio=0
    for row in audio['files'].values():
        if row['sha256'] in sounds:
            row.update(file=sounds[row['sha256']],sharedSource='Identical original ADD audio SHA256');shared_audio+=1
    write_json(root/'audio/manifest.json',audio)
    fx=read(root/'fx/index.json');canonicalize_effect_paths(fx,root)
    profile_sha=digest(profile.read_bytes().replace(b'\r\n',b'\n'));fx['profileSha256']=profile_sha
    write_json(root/'fx/index.json',fx);write_json(ROOT/f'contracts/{job}-fx-index.json',fx)
    write_json(root/'effect-assets.json',{'schemaVersion':1,'templates':fx['templates']})
    manifest.update(effectTemplates={'schemaVersion':1,'templates':fx['templates']},glb=f'source-proof/{job}.glb')
    manifest['profile']['sha256']=profile_sha;write_json(root/'manifest.json',manifest)
    required={'manifest.json','runtime-pose.json','runtime-pose.json.gz',manifest['runtimeGlb'],
        'effect-assets.json','fx/index.json','audio/manifest.json','ui/manifest.json'}
    refs=set();required.update(row['file'] for row in manifest['portraits'].values())
    for row in audio['files'].values():
        path=(ROOT/'artifacts/audio'/row['file']).resolve()
        if digest(path.read_bytes())!=row['sha256']:raise ValueError('Audio SHA mismatch: '+str(path))
        if path.is_relative_to(root):required.add(path.relative_to(root).as_posix())
        else:refs.add(relative(path,root))
    for template in fx['templates'].values():
        for ref in [template[k] for k in ('glb','poseData') if template.get(k)]+[r['file'] for r in template['textures'].values()]:
            (refs if ref.startswith('../') else required).add(ref)
    if manifest.get('sharedCharacterAnimations'):refs.add(manifest['sharedCharacterAnimations']['glb'])
    if pose.get('sharedPose'):refs.add(pose['sharedPose'])
    for ref in refs:
        if not (root/ref).resolve().is_file():raise ValueError('Missing shared dependency: '+ref)
    for path in list(root.rglob('*')):
        if not path.is_file() or path.is_relative_to(proof):continue
        rel=path.relative_to(root)
        if rel.as_posix() not in required:
            target=proof/rel
            if not target.resolve().is_relative_to(proof.resolve()):raise ValueError('Proof path escapes private output')
            target.parent.mkdir(parents=True,exist_ok=True);path.replace(target)
    outputs=[{'file':n,'sha256':digest((root/n).read_bytes()),'bytes':(root/n).stat().st_size} for n in sorted(required)]
    dependencies=[{'file':n,'sha256':digest((root/n).read_bytes())} for n in sorted(refs)]
    summary={'files':len(outputs),'bytes':sum(r['bytes'] for r in outputs),'originalCharacterClips':len(manifest['clips']),
        'sharedModelClips':len(manifest.get('sharedCharacterAnimations',{}).get('clips',[])),
        'sharedPoseClips':len(shared),'privatePoseClips':len(private),'sharedAudioFiles':shared_audio,
        'fxTemplates':len(fx['templates']),'sharedFxTemplates':len(fx.get('sharedTemplates',[])),
        'missingTemplates':len(fx['missingTemplates']),'meshFailures':len(fx['meshFailures'])}
    result={'schemaVersion':1,'clientMeasured':False,'outputDirectory':str(root.resolve()),'profile':manifest['profile'],
        'summary':summary,'outputs':outputs,'dependencies':dependencies,'missingTemplates':fx['missingTemplates'],'limits':manifest['limits']}
    write_json(ROOT/f'reports/{job}-assets-runtime.json',result);print(job,json.dumps(summary),flush=True)
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile-root',type=Path,default=ROOT/'packages/combat-core');a=p.parse_args()
    for job in ('lp','mm','de'):
        profile=a.profile_root/f'{job}-profile.json'
        finalize(ROOT/'artifacts'/job,profile,job,tuple(f'Weapon{i:02}' for i in range(1,7))+('EF01','EF02'),
            ('Dummy1_Rhand',) if job=='lp' else ())
        pack(job,profile)
if __name__=='__main__':main()
