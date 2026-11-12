"""Add the omitted shared Raven counter pose using verified original channels."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda p: json.loads(p.read_text('utf8'))
root = ROOT/'artifacts/vc'
pose = read(root/'runtime-pose.json')
manifest = read(root/'manifest.json')
rf = read(ROOT/'artifacts/rf/runtime-pose.json')
full = json.loads(gzip.decompress((root/'source-proof/runtime-pose-full.json.gz').read_bytes()))
name = 'DamageRevenge'
original = next(c for c in full['clips'] if c['name'] == name)
shared = next(c for c in rf['clips'] if c['name'] == name)
frames = {f['name'] for f in pose['frames']}
candidate = {**shared, 'tracks': [t for t in shared['tracks'] if t['frame_name'] in frames]}
if candidate != original:
    raise ValueError('Original shared Raven counter channels differ')
if name not in pose['sharedClips']:
    pose['sharedClips'].append(name)
if name not in manifest['sharedCharacterAnimations']['clips']:
    manifest['sharedCharacterAnimations']['clips'].append(name)
for key in ['sharedAnimationNames']:
    if name not in manifest['runtimeCharacter'][key]:
        manifest['runtimeCharacter'][key].append(name)
selection = manifest['runtimeCharacter']['selection']
if name not in selection['included']:
    selection['included'].append(name)
if name in selection.get('excluded', []):
    selection['excluded'].remove(name)
for file, value in [('runtime-pose.json', pose), ('manifest.json', manifest)]:
    data = (json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n').encode()
    (root/file).write_bytes(data)
    if file == 'runtime-pose.json':
        (root/(file+'.gz')).write_bytes(gzip.compress(data,mtime=0))
    print(file, hashlib.sha256(data).hexdigest())
