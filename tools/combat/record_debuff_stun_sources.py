"""Read pinned target declarations and reference consumers; no client execution.

Writes only the small source contract and, with --update-profiles, the selected
explicitly recovered groggy states. Full profile builders include the same keys.
"""
import argparse
import hashlib
import json
from pathlib import Path
from kl82_static import read_declarations

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path('./.cache')
TARGET = Path('asset_work/raw/data/data036.kom')
TARGETS = [
    ('RF', 'RAVEN_FIGHTER.lua', 'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3', 'RSI_DAMAGE_GROGGY'),
    ('LK', 'Elsword_SwordMan.lua', '743fc48b74fd35ed69a2e8573acd2d7759d3005340ff4e1655c0678dbf741031', 'ESSI_DAMAGE_GROGGY'),
    ('VC', 'RAVEN_FIGHTER.lua', 'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3', 'RSI_DAMAGE_GROGGY'),
]
REFERENCES = [
    ('pvp-source/X2Lib/X2GUUser.cpp', [(6566, 6571, 'Base unit buff update precedes Future frame-stop gate'),
        (6765, 6785, 'Frame-stop skips Future and reduces stop timers'),
        (16281, 16344, 'Stun selects groggy; reference macro includes KD/detonation exceptions'),
        (24434, 24443, 'No stun registration: groggy returns to common wait')]),
    ('pvp-source/X2Lib/X2GURaven.cpp', [(1269, 1273, 'RF binds groggy to common event handler')]),
    ('pvp-source/X2Lib/X2GameUnit.cpp', [(1021, 1031, 'OnFrameMoveBuff receives normal elapsed time'),
        (12647, 12683, 'Finished buff removes behavior, displayer and gauge icon')]),
    ('native-skills-source/X2Lib/X2BuffFinalizerTemplet.cpp', [(152, 166, 'Time finalizer decrements application/explicit elapsed time')]),
    ('native-skills-source/X2Lib/X2BuffBehaviorTemplet.cpp', [(2012, 2033, 'First stun registration requests groggy'),
        (2061, 2082, 'Packet registration and finish deregistration')]),
]
REFERENCE_HASHES = {
    'pvp-source/X2Lib/X2GUUser.cpp': 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38',
    'pvp-source/X2Lib/X2GURaven.cpp': 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
    'pvp-source/X2Lib/X2GameUnit.cpp': '764868222f4e728bb4e14297126844177106076183d4f099548ecb78da0ee923',
    'native-skills-source/X2Lib/X2BuffFinalizerTemplet.cpp': 'c41cc3b322eb602b74b8d6581393c1079121fcabdd1e742b6d02f0bb30e2f173',
    'native-skills-source/X2Lib/X2BuffBehaviorTemplet.cpp': '6996a32c7c7fa3c4feba22a6732f946cea38ddc080d45bb83d61cfb1c5a84c5d',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main(update=False, roles=('RF', 'LK'), output=ROOT / 'contracts/debuff-stun-sources-v1.json'):
    enum_file = TARGET / 'Enum.lua'
    if digest(enum_file.read_bytes()) != 'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6':
        raise ValueError('Target enum changed')
    enums = read_declarations(enum_file)['globals']
    records = []
    for role, filename, expected, state in TARGETS:
        if role not in roles:
            continue
        source = TARGET / filename
        if digest(source.read_bytes()) != expected:
            raise ValueError('Target source changed: ' + filename)
        declarations = read_declarations(source, enums)
        raw = declarations['globals'][state]
        assets = ROOT / 'artifacts' / role.lower()
        clips_file = assets / ('source-proof/clips.json' if role == 'VC' else 'clips.json')
        clips = json.loads(clips_file.read_text('utf8'))
        clip = next(c for c in clips if c['name'] == raw['ANIM_NAME'])
        pose = json.loads((assets / 'runtime-pose.json').read_text('utf8'))
        available = [c['name'] for c in pose['clips']]
        if pose.get('sharedPose'):
            shared = json.loads((assets / pose['sharedPose']).read_text('utf8'))
            available += [c['name'] for c in shared['clips'] if c['name'] in pose.get('sharedClips', [])]
        if raw['ANIM_NAME'] not in available:
            raise ValueError('Groggy animation is missing from deployed pose closure')
        entry = {'raw': raw, 'animationName': raw['ANIM_NAME'],
            'clip': {k: clip[k] for k in ('durationSeconds', 'durationTicks', 'ticksPerSecond', 'sourceName', 'decodedKeysSha256')},
            'rootMotion': clip['rootMotion'], 'sourcePc': declarations['locations'][state],
            'defaultAnimationEvidence': 'target-2016' if role == 'RF' else 'target2016'}
        if role in ('LK', 'VC'):
            entry['sourceState'] = state
        records.append({'kind': 'target2016-static', 'role': role, 'file': filename, 'sha256': expected,
            'state': state, 'raw': raw, 'sourcePc': entry['sourcePc'], 'clip': entry['clip'],
            'clipInventorySha256': digest(clips_file.read_bytes())})
        if update:
            file = ROOT / 'packages/combat-core' / (role.lower() + '-profile.json')
            profile = json.loads(file.read_text('utf8'))
            profile['states'][state] = entry
            if role == 'LK':
                profile['states']['RSI_DAMAGE_GROGGY'] = {**entry, 'stateRole': 'RSI_DAMAGE_GROGGY'}
            file.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + '\n', 'utf8')
    for name, spans in REFERENCES:
        data = (REFERENCE / name).read_bytes()
        if digest(data) != REFERENCE_HASHES[name]:
            raise ValueError('Fixed reference source changed: ' + name)
        lines = data.splitlines(keepends=True)
        records.append({'kind': 'fixedV5-reference', 'file': name, 'sha256': digest(data),
            'spans': [{'first': first, 'last': last, 'meaning': meaning,
                'sha256': digest(b''.join(lines[first-1:last]))} for first, last, meaning in spans]})
    contract = {'schemaVersion': 1, 'fixedV5Commit': 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
        'targetClientExecuted': False, 'originalClientTraces': 0, 'records': records,
        'userRequiredPolicy': 'Accepted stun forces groggy, clears current/pending knockdown and its activation latch, including a threshold hit; expiration returns to wait.',
        'limits': ['Reference macro guards are not proof of target2016 executable behavior.',
            'User-required stun-over-knockdown precedence is explicit and supersedes the reference guard.',
            'Web fixed-step elapsed is deterministic; browser pause and room time scale remain host behavior.']}
    output.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', 'utf8')
    print(json.dumps({'sources': len(records), 'profilesUpdated': update, 'originalClientExecuted': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--update-profiles', action='store_true')
    parser.add_argument('--roles', nargs='+', choices=('RF', 'LK', 'VC'), default=['RF', 'LK'])
    parser.add_argument('--output-contract', type=Path, default=ROOT / 'contracts/debuff-stun-sources-v1.json')
    args = parser.parse_args()
    main(args.update_profiles, args.roles, args.output_contract)
