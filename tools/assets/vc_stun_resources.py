"""Restore only the common target2016 Fatal state and its exact shared keys.

Run against task-owned VC assets. RF and original full conversions stay read-only.
Profile builders already include the state; this repairs an older packed closure
without rebuilding skills or changing any other current profile field.
"""
import copy
import gzip
import hashlib
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/combat'))
from record_debuff_stun_sources import main as record_sources
from vc_landing_resources import read_json, json_bytes, write_profile_with_seals, refresh_runtime_inventory


def restore(root=ROOT):
    output = (root/'artifacts/vc').resolve()
    if not output.is_relative_to(root.resolve()):
        raise ValueError('VC output must resolve inside this task workspace')
    pose = read_json(output/'runtime-pose.json')
    manifest = read_json(output/'manifest.json')
    if pose.get('sharedPose') != '../rf/runtime-pose.json':
        raise ValueError('Expected existing shared Raven pose binding')
    rf = read_json(root/'artifacts/rf/runtime-pose.json')
    full_bytes = gzip.decompress((output/'source-proof/runtime-pose-full.json.gz').read_bytes())
    full = json.loads(full_bytes)
    original = next(c for c in full['clips'] if c['name'] == 'Fatal')
    candidate = next(c for c in rf['clips'] if c['name'] == 'Fatal')
    frames = {f['name'] for f in pose['frames']}
    keys = ('name', 'durationSeconds', 'ticks_per_second', 'nativePlaybackField')
    if (any(original.get(k) != candidate.get(k) for k in keys) or
            original['tracks'] != [t for t in candidate['tracks'] if t['frame_name'] in frames]):
        raise ValueError('VC Fatal does not exactly match shared original Raven channels')
    rf_manifest = read_json(root/'artifacts/rf/manifest.json')
    shared = manifest['sharedCharacterAnimations']
    if shared['glb'] != '../rf/'+rf_manifest['runtimeGlb'] or 'Fatal' not in rf_manifest['runtimeCharacter']['animations']:
        raise ValueError('Original shared Fatal model animation is unavailable')
    if any(c['name'] == 'Fatal' for c in pose['clips']) or 'Fatal' in manifest['runtimeCharacter']['animations']:
        raise ValueError('Fatal is already private; shared registration would duplicate it')
    files = ('runtime-pose.json', 'runtime-pose.json.gz', 'manifest.json', 'fx/index.json')
    sha = lambda data: hashlib.sha256(data).hexdigest()
    before = {name: sha((output/name).read_bytes()) for name in files}
    profile_before = read_json(root/'packages/combat-core/vc-profile.json')
    if 'Fatal' not in pose['sharedClips']:
        pose['sharedClips'].append('Fatal')
    if 'Fatal' not in shared['clips']:
        shared['clips'].append('Fatal')
    pose_bytes = (json.dumps(pose, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf8')
    (output/'runtime-pose.json').write_bytes(pose_bytes)
    (output/'runtime-pose.json.gz').write_bytes(gzip.compress(pose_bytes, mtime=0))
    (output/'manifest.json').write_bytes(json_bytes(manifest))
    record_sources(True, ('VC',), root/'contracts/debuff-stun-vc-sources-v2.json')
    profile = read_json(root/'packages/combat-core/vc-profile.json')
    unchanged = copy.deepcopy(profile)
    if 'RSI_DAMAGE_GROGGY' in profile_before['states']:
        unchanged['states']['RSI_DAMAGE_GROGGY'] = profile_before['states']['RSI_DAMAGE_GROGGY']
    else:
        del unchanged['states']['RSI_DAMAGE_GROGGY']
    if unchanged != profile_before:
        raise ValueError('Unexpected VC profile change outside the recovered state')
    profile_sha = write_profile_with_seals(profile, read_json(output/'fx/index.json'), root)
    reuse = read_json(root/'reports/vc-resource-reuse-v1.json')
    reuse.update(sharedPoseClips=len(pose['sharedClips']), sharedModelClips=len(shared['clips']))
    refresh_runtime_inventory(reuse, root)
    proof = {'schemaVersion': 1, 'originalClientMeasured': False,
        'sourceContract': 'contracts/debuff-stun-vc-sources-v2.json',
        'fullOriginalPoseSha256': sha(full_bytes), 'exactSharedTimingAndChannels': True,
        'state': 'RSI_DAMAGE_GROGGY', 'animation': 'Fatal', 'profileSha256': profile_sha,
        'files': {name: {'beforeSha256': before[name], 'afterSha256': sha((output/name).read_bytes())} for name in files}}
    (root/'reports/vc-stun-resource-recovery-v2.json').write_bytes(json_bytes(proof))
    print(json.dumps({'restored': proof['state'], 'profileSha256': profile_sha, 'changedAssets': len(files)}))


if __name__ == '__main__':
    restore()
