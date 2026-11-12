"""Keep both released counter/stun and VC v8 non-down rise shared clips.

Only the calling task's physical VC output is writable. Prior runtime and RF
conversions are read-only inputs; no new animation keys or model bytes are made.
"""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda path: json.loads(path.read_bytes())
sha = lambda data: hashlib.sha256(data).hexdigest()
packed = lambda value: (json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n').encode()
pretty = lambda value: (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def merge(prior):
    output = (ROOT/'artifacts/vc').resolve()
    if not output.is_relative_to(ROOT.resolve()):
        raise ValueError('VC output must resolve inside the task workspace')
    pose = read(output/'runtime-pose.json')
    manifest = read(output/'manifest.json')
    previous = read(prior/'runtime-pose.json')
    previous_manifest = read(prior/'manifest.json')
    rf_path = ROOT/'artifacts/rf/runtime-pose.json'
    rf_bytes = rf_path.read_bytes()
    rf = json.loads(rf_bytes)
    full_bytes = gzip.decompress((output/'source-proof/runtime-pose-full.json.gz').read_bytes())
    originals = {clip['name']: clip for clip in json.loads(full_bytes)['clips']}
    shared = {clip['name']: clip for clip in rf['clips']}
    frames = {frame['name'] for frame in pose['frames']}
    protected = ('DamageRevenge', 'Fatal')
    added = ('SI_A_RF_GET_CHANCE_FRONT', 'SI_A_RF_GET_CHANCE_BACK')
    for name in protected:
        if name not in previous['sharedClips'] or name not in previous_manifest['sharedCharacterAnimations']['clips']:
            raise ValueError('Previous release is missing protected '+name)
        candidate = {**shared[name], 'tracks': [track for track in shared[name]['tracks'] if track['frame_name'] in frames]}
        original = originals[name]
        if any(candidate.get(key) != original.get(key) for key in ('name', 'durationSeconds', 'ticks_per_second', 'nativePlaybackField', 'tracks')):
            raise ValueError('Protected original Raven channels differ: '+name)
    for name in added:
        if name not in pose['sharedClips'] or name not in manifest['sharedCharacterAnimations']['clips']:
            raise ValueError('Incoming VC feedback is missing '+name)
        if not shared[name]['tracks']:
            raise ValueError('Shared rise clip has no original keys: '+name)
    before = {name: sha((output/name).read_bytes()) for name in ('manifest.json', 'runtime-pose.json', 'runtime-pose.json.gz', 'fx/index.json')}
    for name in protected:
        for names in (pose['sharedClips'], manifest['sharedCharacterAnimations']['clips'],
                      manifest['runtimeCharacter']['sharedAnimationNames'], manifest['runtimeCharacter']['selection']['included']):
            if name not in names:
                names.append(name)
        excluded = manifest['runtimeCharacter']['selection'].get('excluded', [])
        if name in excluded:
            excluded.remove(name)
    all_names = {clip['name'] for clip in pose['clips']} | set(pose['sharedClips'])
    profile_bytes = (ROOT/'packages/combat-core/vc-profile.json').read_bytes()
    profile = json.loads(profile_bytes)
    missing = sorted({state['animationName'] for state in profile['states'].values()}-all_names)
    if missing:
        raise ValueError('Combined profile animations are unavailable: '+','.join(missing))
    if profile['states']['RSI_DAMAGE_GROGGY']['animationName'] != 'Fatal':
        raise ValueError('Released Fatal state was lost in the profile merge')
    profile_sha = sha(profile_bytes)
    manifest['profile']['sha256'] = profile_sha
    pose_bytes = packed(pose)
    (output/'runtime-pose.json').write_bytes(pose_bytes)
    (output/'runtime-pose.json.gz').write_bytes(gzip.compress(pose_bytes, mtime=0))
    (output/'manifest.json').write_bytes(packed(manifest))
    for path in (output/'fx/index.json', ROOT/'contracts/vc-fx-index.json'):
        data, count = re.subn(rb'("profileSha256"\s*:\s*")[0-9a-f]{64}("|$)',
                             lambda match: match[1]+profile_sha.encode()+match[2], path.read_bytes())
        if count != 1:
            raise ValueError('Expected one profile seal in '+str(path))
        path.write_bytes(data)
    reuse_path = ROOT/'reports/vc-resource-reuse-v1.json'
    reuse = read(reuse_path)
    for row in reuse['outputs']:
        data = (output/row['file']).read_bytes()
        row.update(bytes=len(data), sha256=sha(data))
    reuse.update(runtimeBytes=sum(row['bytes'] for row in reuse['outputs']),
                 poseAfterBytes=len(pose_bytes), sharedPoseClips=len(pose['sharedClips']),
                 sharedModelClips=len(manifest['sharedCharacterAnimations']['clips']))
    reuse_path.write_bytes(pretty(reuse))
    report_path = ROOT/'reports/vc-assets-runtime.json'
    report = read(report_path)
    report.update(outputDirectory=str(output), outputs=reuse['outputs'], profile=manifest['profile'])
    report['summary'].update(files=len(reuse['outputs']), bytes=reuse['runtimeBytes'])
    report_path.write_bytes(pretty(report))
    proof = {'schemaVersion': 1, 'evidenceClass': 'combined-local-runtime-inventory', 'originalClientMeasured': False,
             'preservedReleasedClips': list(protected), 'incomingSharedClips': list(added),
             'sharedClips': len(pose['sharedClips']), 'runtimeAnimations': len(all_names),
             'newModelBytes': 0, 'newTextureBytes': 0, 'newAudioBytes': 0, 'newPoseKeyBytes': 0,
             'profileSha256': profile_sha, 'rfConvertedPoseSha256': sha(rf_bytes), 'fullOriginalVCPoseSha256': sha(full_bytes),
             'metadataChanges': [{'file': name, 'beforeSha256': before[name], 'sha256': sha((output/name).read_bytes()),
                                  'bytes': (output/name).stat().st_size} for name in before]}
    (ROOT/'reports/vc-shared-feedback-merge-v5.json').write_bytes(pretty(proof))
    print(json.dumps({key: proof[key] for key in ('sharedClips', 'runtimeAnimations', 'newModelBytes', 'newPoseKeyBytes')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--prior', type=Path, required=True)
    merge(parser.parse_args().prior)
