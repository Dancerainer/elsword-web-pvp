"""Seal IS runtime assets and verify all shared references by exact bytes.

Full original character/effect conversion evidence remains in source-proof;
repacking is deterministic and never overwrites it with a runtime subset.
"""
import gzip
import json
import os
import sys
from pathlib import Path
from finalize_lk_assets import finalize
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import digest, write_json
from runtime_path_case import canonicalize_effect_paths


def read(path):
    return json.loads(path.read_text('utf8'))


def relative(path, root):
    return Path(os.path.relpath(path.resolve(), root.resolve())).as_posix()


def pack():
    root = ROOT/'artifacts/is'
    proof = root/'source-proof'
    proof.mkdir(exist_ok=True)
    manifest = read(root/'manifest.json')
    pose = read(root/'runtime-pose.json')
    if pose.get('sharedPose'):
        pose = json.loads(gzip.decompress((proof/'runtime-pose-full.json.gz').read_bytes()))
    raw_pose = (json.dumps(pose, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf8')
    (proof/'runtime-pose-full.json.gz').write_bytes(gzip.compress(raw_pose, mtime=0))
    lk = read(ROOT/'artifacts/lk/runtime-pose.json')
    candidates = {c['name']: c for c in lk['clips']}
    frames = {f['name'] for f in pose['frames']}
    shared, private, supplements = [], [], {}
    for clip in pose['clips']:
        other = candidates.get(clip['name'])
        if other and all(other.get(k)==clip.get(k) for k in ('name', 'durationSeconds', 'ticks_per_second', 'nativePlaybackField')):
            target={t['frame_name']:t for t in clip['tracks']}
            reused={t['frame_name']:t for t in other['tracks'] if t['frame_name'] in frames}
            if reused and all(target.get(name)==track for name,track in reused.items()):
                shared.append(clip['name'])
                extra=[track for name,track in target.items() if name not in reused]
                if extra:supplements[clip['name']]=extra
                continue
        private.append(clip)
    pose.update(clips=private, sharedPose='../lk/runtime-pose.json', sharedClips=shared,
        sharedClipTrackSupplements=supplements,
        selection='IS original frames/helpers retained; exact LK channels shared, IS-only original bone channels retained without resampling')
    write_json(root/'runtime-pose.json', pose, True)
    (root/'runtime-pose.json.gz').write_bytes(gzip.compress((root/'runtime-pose.json').read_bytes(), mtime=0))

    audio = read(root/'audio/manifest.json')
    sounds = {}
    for folder in ('audio', 'lk/audio', 'vc/audio'):
        for row in read(ROOT/'artifacts'/folder/'manifest.json')['files'].values():
            path = (ROOT/'artifacts/audio'/row['file']).resolve()
            if path.is_file() and digest(path.read_bytes())==row['sha256']:
                sounds.setdefault(row['sha256'], relative(path, ROOT/'artifacts/audio'))
    shared_audio = 0
    for row in audio['files'].values():
        if row['sha256'] in sounds:
            shared_file = sounds[row['sha256']]
            # Profession manifests are rebased by the web loader unless their
            # URL is explicit. Retain the shared /assets/audio directory.
            row['file'] = shared_file if shared_file.startswith('../') else '../audio/'+shared_file
            row['sharedSource'] = 'Existing original audio exact SHA256'
            shared_audio += 1
    write_json(root/'audio/manifest.json', audio)

    fx = read(root/'fx/index.json')
    textures = {}
    for folder in ('lk', 'rf', 'vc'):
        for index in sorted((ROOT/'artifacts'/folder).glob('*/index.json')):
            for template in read(index).get('templates', {}).values():
                for row in template.get('textures', {}).values():
                    path=(ROOT/'artifacts'/folder/row['file']).resolve()
                    if row.get('source', {}).get('sha256') and path.is_file():
                        textures.setdefault(row['source']['sha256'], relative(path, root))
    for template in fx['templates'].values():
        for row in template.get('textures', {}).values():
            path=textures.get(row.get('source', {}).get('sha256'))
            if path and not row['file'].startswith('../'):
                row['file']=path
                row['sharedSource']='Identical original texture SHA256'
    canonicalize_effect_paths(fx, root)
    profile=ROOT/'packages/combat-core/is-profile.json'
    profile_sha=digest(profile.read_bytes().replace(b'\r\n',b'\n'))
    fx['profileSha256']=profile_sha
    write_json(root/'fx/index.json',fx)
    write_json(ROOT/'contracts/is-fx-index.json',fx)
    write_json(root/'effect-assets.json',{'schemaVersion':1,'templates':fx['templates']})
    manifest.update(effectTemplates={'schemaVersion':1,'templates':fx['templates']}, glb='source-proof/is.glb')
    manifest['profile']['sha256']=profile_sha
    write_json(root/'manifest.json',manifest)

    required={'manifest.json','runtime-pose.json','runtime-pose.json.gz',manifest['runtimeGlb'],
              'effect-assets.json','fx/index.json','audio/manifest.json','ui/manifest.json'}
    required.update(row['file'] for row in manifest['portraits'].values())
    for row in audio['files'].values():
        if row['file'].startswith('../is/audio/'):
            required.add('audio/'+Path(row['file']).name)
    for template in fx['templates'].values():
        required.update(template[k] for k in ('glb','poseData') if template.get(k) and not template[k].startswith('../'))
        required.update(row['file'] for row in template['textures'].values() if not row['file'].startswith('../'))
    for path in list(root.rglob('*')):
        if not path.is_file() or path.is_relative_to(proof):continue
        rel=path.relative_to(root)
        if rel.as_posix() not in required:
            target=proof/rel
            if not target.resolve().is_relative_to(proof.resolve()):raise ValueError('Evidence path escapes output')
            target.parent.mkdir(parents=True,exist_ok=True)
            path.replace(target)
    outputs=[{'file':name,'sha256':digest((root/name).read_bytes()),'bytes':(root/name).stat().st_size} for name in sorted(required)]
    summary={'files':len(outputs),'bytes':sum(r['bytes'] for r in outputs),'originalCharacterClips':len(manifest['clips']),
             'sharedModelClips':len(manifest['sharedCharacterAnimations']['clips']), 'sharedPoseClips':len(shared),
             'privatePoseClips':len(private),'sharedAudioFiles':shared_audio,'fxTemplates':len(fx['templates']),
             'sharedFxTemplates':len(fx.get('sharedTemplates',[])), 'missingTemplates':len(fx['missingTemplates']),
             'meshFailures':len(fx['meshFailures'])}
    result={'schemaVersion':1,'clientMeasured':False,'outputDirectory':str(root.resolve()),'profile':manifest['profile'],
            'summary':summary,'outputs':outputs,'unsupportedEffects':fx['meshFailures'],'missingTemplates':fx['missingTemplates'],
            'limits':manifest['limits']}
    write_json(ROOT/'reports/is-assets-runtime.json',result)
    print(json.dumps(summary))
    return result


def main():
    finalize(ROOT/'artifacts/is',ROOT/'packages/combat-core/is-profile.json','is')
    return pack()


if __name__=='__main__':
    main()
