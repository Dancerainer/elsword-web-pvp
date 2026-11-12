"""Read-only original inputs; emit qualified evidence, never simulation goldens."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHA = lambda data: hashlib.sha256(data).hexdigest()


def build(sword, native):
    records = []
    for path, expected, ranges in [
        (sword, 'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d',
         [(7575, 7609, 'destruction rage'), (13472, 13525, 'Kick consumer')]),
        (native/'X2Lib/X2GUUser.cpp', 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
         [(8428, 8432, 'conditional received-hit stun erase'), (12904, 12917, 'RT_REVENGE state'),
          (26039, 26120, 'DamageRevenge start and end')]),
        (native/'KTDXLIB/KTDGXMeshPlayer.cpp', '0a98af22b4f4b260dc9fe61d7866f8251ebf2c4a94d90032c8462e6b5831417d',
         [(1845, 1865, 'mesh size applied to transform'), (3219, 3271, 'literal Size interpolation')])]:
        data = path.read_bytes()
        if SHA(data) != expected:
            raise ValueError('Pinned reference changed: '+str(path))
        for first, last, purpose in ranges:
            records.append(dict(file=path.name, sha256=expected, startLine=first, endLine=last,
                fragmentSha256=SHA(b'\n'.join(data.split(b'\n')[first-1:last])+b'\n'), purpose=purpose,
                evidenceClass='fixedV5-version-reference', commit='a8438f3ed18dd6f0944793de6c0d8bb9334e9633'))
    states = {}
    for profession, cache, names in [
        ('LK', '.cache/lk/elsword-declarations.json', ['ESSI_DAMAGE_REVENGE', 'ESSI_SI_A_ES_KICK']),
        ('RF', '.cache/rf-skills-v1/raven-declarations.json', ['RSI_DAMAGE_REVENGE']),
        ('VC', '.cache/rf-skills-v1/raven-declarations.json', ['RSI_DAMAGE_REVENGE'])]:
        doc = json.loads((ROOT/cache).read_text('utf8'))
        if SHA(Path(doc['source']['path']).read_bytes()) != doc['source']['sha256']:
            raise ValueError('Target declaration changed')
        profile = json.loads((ROOT/f'packages/combat-core/{profession.lower()}-profile.json').read_text('utf8'))
        for name in names:
            if profile['states'][name]['raw'] != doc['globals'][name]:
                raise ValueError('Profile differs from target: '+name)
        states[profession] = dict(source=doc['source'], states={n:doc['globals'][n] for n in names})
    profile = json.loads((ROOT/'packages/combat-core/lk-profile.json').read_text('utf8'))
    result = dict(schemaVersion=1, originalClientMeasured=False, references=records, targetDeclarations=states,
        rageDamage=profile['damageEffects']['ELSWORD_ANGRY_WIND'],
        limits=['User explicitly chooses stun cure on received hit; target macro selection remains unknown.',
                'UI scales and outline thickness are user-requested web presentation changes.',
                'Kick overlap measurements and rendered-matrix tests are current simulation evidence.',
                'No target2016 executable trajectory or GPU pixel comparison.'])
    target = ROOT/'contracts/lk-hit-feedback-source-v4.json'
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(dict(references=len(records), professions=list(states), originalClientMeasured=False)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sword-source', type=Path, required=True)
    parser.add_argument('--native-source', type=Path, required=True)
    args = parser.parse_args()
    build(args.sword_source, args.native_source)
