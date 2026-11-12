"""Seal full Elesis poses/closures and pack only byte-verified runtime files."""
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


def read(path): return json.loads(path.read_text('utf8'))


def pack(job):
    root = ROOT/'artifacts'/job; proof = root/'source-proof'; proof.mkdir(exist_ok=True)
    profile = ROOT/f'packages/combat-core/{job}-profile.json'
    finalize(root, profile, job, unsupported_owner_bones=('Bop01',) if job == 'bh' else ())
    manifest = read(root/'manifest.json'); pose = read(root/'runtime-pose.json')
    (proof/'runtime-pose-full.json.gz').write_bytes(gzip.compress((json.dumps(pose, separators=(',',':'))+'\n').encode(), mtime=0))
    shared, private, supplements = [], pose['clips'], {}
    if job != 'gm':
        candidates = {c['name']: c for c in read(ROOT/'artifacts/gm/runtime-pose.json')['clips']}
        frames = {f['name'] for f in pose['frames']}; private = []
        for clip in pose['clips']:
            other = candidates.get(clip['name'])
            if other and all(other.get(k) == clip.get(k) for k in ('name','durationSeconds','ticks_per_second','nativePlaybackField')):
                target = {t['frame_name']: t for t in clip['tracks']}
                reused = {t['frame_name']: t for t in other['tracks'] if t['frame_name'] in frames}
                if reused and all(target.get(name) == track for name, track in reused.items()):
                    shared.append(clip['name'])
                    extra = [track for name, track in target.items() if name not in reused]
                    if extra: supplements[clip['name']] = extra
                    continue
            private.append(clip)
        pose.update(clips=private, sharedPose='../gm/runtime-pose.json', sharedClips=shared,
                    sharedClipTrackSupplements=supplements,
                    selection='Original profession frames/helpers retained; exact GM common channels shared, original extra bone channels retained')
        write_json(root/'runtime-pose.json', pose, True)
        (root/'runtime-pose.json.gz').write_bytes(gzip.compress((root/'runtime-pose.json').read_bytes(), mtime=0))
    audio = read(root/'audio/manifest.json'); known = {}
    previous = ('rf','lk','vc','rs','bm','is','gm','bh','ca')
    for other in previous[:previous.index(job)]:
        folder = ROOT/'artifacts'/('audio' if other == 'rf' else other+'/audio')
        for row in read(folder/'manifest.json')['files'].values():
            path = (ROOT/'artifacts/audio'/row['file']).resolve()
            if path.is_file() and digest(path.read_bytes()) == row['sha256']:
                relative = Path(os.path.relpath(path, ROOT/'artifacts/audio')).as_posix()
                known.setdefault(row['sha256'], relative if relative.startswith('../') else '../audio/'+relative)
    shared_audio = 0
    for row in audio['files'].values():
        if row['sha256'] in known:
            row.update(file=known[row['sha256']], sharedSource='Exact SHA256 of original existing audio')
            shared_audio += 1
    seal = digest(profile.read_bytes().replace(b'\r\n', b'\n'))
    audio['profile']['sha256'] = seal; write_json(root/'audio/manifest.json', audio)
    fx = read(root/'fx/index.json'); canonicalize_effect_paths(fx, root)
    fx['profileSha256'] = seal
    write_json(root/'fx/index.json', fx); write_json(ROOT/f'contracts/{job}-fx-index.json', fx)
    write_json(root/'effect-assets.json', {'schemaVersion': 1, 'templates': fx['templates']})
    manifest.update(effectTemplates={'schemaVersion': 1, 'templates': fx['templates']}, glb='source-proof/'+job+'.glb')
    manifest['profile']['sha256'] = seal; write_json(root/'manifest.json', manifest)
    required = {'manifest.json','runtime-pose.json','runtime-pose.json.gz',manifest['runtimeGlb'],
                'effect-assets.json','fx/index.json','audio/manifest.json','ui/manifest.json'}
    required.update(row['file'] for row in manifest['portraits'].values())
    for row in audio['files'].values():
        if row['file'].startswith('../'+job+'/audio/'): required.add('audio/'+Path(row['file']).name)
    for template in fx['templates'].values():
        required.update(template[k] for k in ('glb','poseData') if template.get(k) and not template[k].startswith('../'))
        required.update(row['file'] for row in template.get('textures',{}).values() if not row['file'].startswith('../'))
    for path in list(root.rglob('*')):
        if not path.is_file() or path.is_relative_to(proof): continue
        if path.relative_to(root).as_posix() not in required:
            target = proof/path.relative_to(root)
            if not target.resolve().is_relative_to(proof.resolve()): raise ValueError('Proof output escapes task')
            target.parent.mkdir(parents=True, exist_ok=True); path.replace(target)
    outputs = [{'file': name, 'sha256': digest((root/name).read_bytes()), 'bytes': (root/name).stat().st_size} for name in sorted(required)]
    summary = {'files': len(outputs), 'bytes': sum(row['bytes'] for row in outputs),
        'originalCharacterClips': len(manifest['clips']), 'sharedCharacterClips': len(manifest.get('sharedCharacterAnimations',{}).get('clips',[])),
        'sharedPoseClips': len(shared), 'privatePoseClips': len(private), 'sharedAudioFiles': shared_audio,
        'fxTemplates': len(fx['templates']), 'sharedFxTemplates': len(fx.get('sharedTemplates',[])),
        'missingTemplates': len(fx['missingTemplates']), 'meshFailures': len(fx['meshFailures'])}
    result = {'schemaVersion': 1, 'clientMeasured': False, 'outputDirectory': str(root.resolve()),
        'profile': manifest['profile'], 'summary': summary, 'outputs': outputs,
        'unsupportedEffects': fx['meshFailures'], 'missingTemplates': fx['missingTemplates'], 'limits': manifest['limits']}
    write_json(ROOT/f'reports/{job}-assets-runtime.json', result); print(job, json.dumps(summary), flush=True)


if __name__ == '__main__':
    for job in ('gm','bh','ca'): pack(job)
