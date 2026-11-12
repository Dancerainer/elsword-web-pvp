"""Seal RS runtime files and share only byte-identical LK animation/audio/texture data."""
import gzip
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import write_json, digest
from build_rs import required_runtime_clips, SWORD_WAIT_RUNTIME_CLIPS
from finalize_lk_assets import finalize
from runtime_path_case import canonicalize_effect_paths


def read(path): return json.loads(path.read_text('utf8'))


def pack(output, profile_path):
    output = output.resolve()
    manifest = read(output/'manifest.json')
    pose_bytes = (output/'runtime-pose.json').read_bytes()
    pose = json.loads(pose_bytes)
    proof = output/'source-proof'
    proof.mkdir(exist_ok=True)
    if pose.get('sharedPose'):
        pose_bytes = gzip.decompress((proof/'runtime-pose-full.json.gz').read_bytes())
        pose = json.loads(pose_bytes)
    lk = read(ROOT/'artifacts/lk/runtime-pose.json')
    lk_clips = {c['name']: c for c in lk['clips']}
    frames = {f['name'] for f in pose['frames']}
    profile = read(profile_path)
    needed = required_runtime_clips(profile)
    # Earlier RS packages omitted Wait_W1 from both the compact pose and the
    # browser's shared-animation declaration. Repair that declaration only
    # when the original decoded keys match an already published LK clip.
    lk_manifest = read(ROOT/'artifacts/lk/manifest.json')
    rs_model = {c['name']: c for c in manifest['clips']}
    lk_model = {c['name']: c for c in lk_manifest['clips']}
    shared_model = set(manifest['sharedCharacterAnimations']['clips'])
    private_model = set(manifest['runtimeCharacter']['selection']['included'])
    lk_available = set(lk_manifest['runtimeCharacter']['selection']['included'])
    for name in sorted(needed - private_model - shared_model):
        if (name not in lk_available or name not in rs_model or name not in lk_model
                or not rs_model[name].get('decodedKeysSha256')
                or rs_model[name]['decodedKeysSha256'] != lk_model[name].get('decodedKeysSha256')):
            raise ValueError('RS runtime model must be rebuilt for original clip: '+name)
        shared_model.add(name)
    manifest['sharedCharacterAnimations']['clips'] = sorted(shared_model)
    manifest['runtimeCharacter']['sharedAnimationNames'] = sorted(shared_model)
    manifest.setdefault('mechanismResources', {}).setdefault('wayOfSword', {}).update(
        characterClips=list(SWORD_WAIT_RUNTIME_CLIPS),
        runtimeClosureEvidence='Target2016 RS clip declarations + shared SwordMan wait consumer; original decoded LK/RS key identity required')
    shared, private = [], []
    for clip in pose['clips']:
        if clip['name'] not in needed: continue
        candidate = lk_clips.get(clip['name'])
        if candidate and all(candidate.get(k) == clip.get(k) for k in
            ('name', 'durationSeconds', 'ticks_per_second', 'nativePlaybackField')):
            if [t for t in candidate['tracks'] if t['frame_name'] in frames] == clip['tracks']:
                shared.append(clip['name'])
                continue
        private.append(clip)
    if needed - {c['name'] for c in private} - set(shared):
        raise ValueError('Missing RS runtime pose clips')
    (proof/'runtime-pose-full.json.gz').write_bytes(gzip.compress(pose_bytes, mtime=0))
    pose.update(clips=private, sharedPose='../lk/runtime-pose.json', sharedClips=shared,
        selection='Exact LK channels shared; original RS frames/helpers and unique animation keys retained')
    write_json(output/'runtime-pose.json', pose, True)
    (output/'runtime-pose.json.gz').write_bytes(gzip.compress((output/'runtime-pose.json').read_bytes(), mtime=0))
    audio = read(output/'audio/manifest.json')
    shared_audio = {}
    for path in (ROOT/'artifacts/lk/audio/manifest.json', ROOT/'artifacts/audio/manifest.json'):
        for row in read(path)['files'].values():
            shared_audio.setdefault(row['sha256'], row)
    for row in audio['files'].values():
        candidate = shared_audio.get(row['sha256'])
        if candidate:
            row['file'] = candidate['file'] if candidate['file'].startswith('../') else '../audio/'+candidate['file']
            row['sharedSource'] = 'Identical original Ogg SHA256; LK/common audio'
    write_json(output/'audio/manifest.json', audio)
    fx = read(output/'fx/index.json')
    textures = {}
    for folder in ('lk', 'rf'):
        for index in sorted((ROOT/'artifacts'/folder).glob('*/index.json')):
            for template in read(index).get('templates', {}).values():
                for row in template.get('textures', {}).values():
                    if row.get('source', {}).get('sha256'):
                        textures.setdefault(row['source']['sha256'], '../'+folder+'/'+row['file'])
    for template in fx['templates'].values():
        for row in template.get('textures', {}).values():
            candidate = textures.get(row.get('source', {}).get('sha256'))
            if candidate:
                row['file'] = candidate
                row['sharedSource'] = 'Identical original texture SHA256'
    canonicalize_effect_paths(fx, output)
    profile_sha = digest(profile_path.read_bytes().replace(b'\r\n', b'\n'))
    fx['profileSha256'] = profile_sha
    write_json(output/'fx/index.json', fx)
    write_json(ROOT/'contracts/rs-fx-index.json', fx)
    write_json(output/'effect-assets.json', {'schemaVersion': 1, 'templates': fx['templates']})
    manifest['effectTemplates'] = {'schemaVersion': 1, 'templates': fx['templates']}
    manifest['profile']['sha256'] = profile_sha
    manifest['glb'] = 'source-proof/rs.glb'
    manifest['unitClass'] = 101
    manifest.setdefault('mechanismResources', {})['magicReflection'] = {
        'majorParticles': ['RevengeImpactSlashCW', 'RevengeImpactSlashCCW', 'RevengeImpact'],
        'minorParticles': ['RevengeImpactTick'], 'visualEffectIndex': 'fx/index.json',
        'evidence': 'contracts/rs-reflection-source-v1.json'}
    write_json(output/'manifest.json', manifest)
    motion_contract_path = ROOT/'contracts/rs-assets-motion-index.json'
    motion_contract = read(motion_contract_path)
    motion_contract['sharedCharacterAnimations'] = manifest['sharedCharacterAnimations']
    write_json(motion_contract_path, motion_contract)
    required = {'manifest.json', 'runtime-pose.json', 'runtime-pose.json.gz', manifest['runtimeGlb'],
        'effect-assets.json', 'fx/index.json', 'audio/manifest.json', 'ui/manifest.json'}
    required.update(row['file'] for row in manifest['portraits'].values())
    for row in audio['files'].values():
        if row['file'].startswith('../rs/audio/'): required.add('audio/'+Path(row['file']).name)
    for template in fx['templates'].values():
        required.update(template[k] for k in ('glb', 'poseData') if template.get(k) and not template[k].startswith('../'))
        required.update(row['file'] for row in template['textures'].values() if not row['file'].startswith('../'))
    for path in list(output.rglob('*')):
        if not path.is_file() or path.is_relative_to(proof): continue
        rel = path.relative_to(output)
        if rel.as_posix() not in required:
            destination = (proof/rel).resolve()
            if not path.resolve().is_relative_to(output) or not destination.is_relative_to(proof.resolve()):
                raise ValueError('RS proof output escapes task directory')
            destination.parent.mkdir(parents=True, exist_ok=True)
            path.replace(destination)
    outputs = [{'file': name, 'sha256': digest((output/name).read_bytes()), 'bytes': (output/name).stat().st_size}
        for name in sorted(required)]
    result = {'schemaVersion': 1, 'clientMeasured': False, 'profileSha256': profile_sha,
        'excludedSourceDefinitions': [r for r in profile.get('unsupported', []) if r['id'].startswith('missing-original-template:')],
        'sharedPoseClips': len(shared), 'privatePoseClips': len(private),
        'sharedModelClips': len(manifest['sharedCharacterAnimations']['clips']),
        'sharedFxTemplates': len(fx['sharedTemplates']),
        'sharedAudioFiles': sum(bool(r.get('sharedSource')) for r in audio['files'].values()),
        'runtimeFiles': len(outputs), 'runtimeBytes': sum(row['bytes'] for row in outputs), 'outputs': outputs,
        'limits': ['Only original-byte/key identity permits sharing; original client comparison remains unavailable.',
                   'Source-proof contains full generated evidence and is excluded from runtime distribution.']}
    write_json(ROOT/'reports/rs-resource-reuse-v1.json', result)
    report = read(ROOT/'reports/rs-assets-runtime.json')
    report.update(outputs=outputs, profile=manifest['profile'])
    report['excludedSourceDefinitions'] = result['excludedSourceDefinitions']
    report['summary'].update(files=len(outputs), bytes=result['runtimeBytes'])
    report['summary']['fxTextures'] = len({r['file'] for t in fx['templates'].values() for r in t['textures'].values()})
    write_json(ROOT/'reports/rs-assets-runtime.json', report)
    print(json.dumps({k: v for k, v in result.items() if k not in ('outputs', 'limits')}))
    return result


def main():
    output = ROOT/'artifacts/rs'
    profile = ROOT/'packages/combat-core/rs-profile.json'
    finalize(output, profile, 'rs')
    pack(output, profile)


if __name__ == '__main__': main()
