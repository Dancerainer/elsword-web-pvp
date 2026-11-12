"""Recheck Sword Fall against original2016 KOM bytes, separately from simulation.

Only the upstream archive reader is imported read-only; no upstream cache or
game client is run. Large decoded inputs stay in this task's ignored cache.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
CLIENT = Path('asset_sources/client')
READER = Path('asset_sources/upstream/tools/kom.py')
sha = lambda data: hashlib.sha256(data).hexdigest()


def main():
    reader_receipt = json.loads((ROOT / 'contracts/rs-missing-fx-search-v1.json').read_text('utf-8'))['reader']
    if sha(READER.read_bytes()) != reader_receipt['sha256']:
        raise ValueError('Pinned read-only archive reader changed')
    spec = importlib.util.spec_from_file_location('swordfall_readonly_kom', READER)
    kom = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(kom)
    profile = json.loads((ROOT / 'packages/combat-core/is-profile.json').read_text('utf-8'))
    fx = json.loads((ROOT / 'contracts/is-fx-index.json').read_text('utf-8'))
    mesh_names = [f'elsword_A_swordFall_M0{i}' for i in range(1, 6)] + [f'SwordFallBlade{i}' for i in range(1, 5)]
    particle_names = ['elsword_A_swordFall_08', 'elsword_A_swordFall_02', 'elsword_A_swordFall_09']
    templates = {name: fx['templates'][name] for name in mesh_names + particle_names}
    wanted = {}
    for key in ['elsword', 'damage', 'skill', 'enum']:
        source = profile['sources'][key]
        wanted[('data/data036.kom', Path(source['path']).name)] = source['sha256']
    for template in templates.values():
        source = template['source']
        wanted[(source['archive'], source['name'])] = source['sha256']
    for row in fx['sourceFiles']:
        if 'swordfall' in row['name'].lower() or 'sisknight_sword' in row['name'].lower():
            wanted[(row['archive'], row['name'])] = row['sha256']
    receipts = []
    out = ROOT / '.cache/swordfall-original-v3'
    for archive in sorted({key[0] for key in wanted}):
        path = CLIENT / archive
        with path.open('rb') as stream:
            entries, index = kom.index(stream)
            for ordinal, entry in enumerate(entries):
                key = (archive, entry['Name'])
                if key not in wanted:
                    continue
                stream.seek(entry['offset'])
                raw = kom.unpack(entry, stream.read(int(entry['CompressedSize'])))
                data, codec = kom.decode_asset(raw)
                if sha(data) != wanted[key]:
                    raise ValueError('Original2016 archived bytes differ: ' + str(key))
                destination = out / Path(archive).name / entry['Name']
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(data)
                receipts.append({'archive': archive, 'ordinal': ordinal, 'name': entry['Name'],
                                 'sha256': sha(data), 'bytes': len(data), 'codec': codec})
    if len(receipts) != len(wanted):
        raise ValueError('Original archived input incomplete')
    damage_names = [f'ELSWORD_SWORDFALL_BLADE{i}' for i in range(1, 5)] + [
        'ELSWORD_SWORDFALL_BLADE_FALLEN4', 'ELSWORD_SWORDFALL_BLADE_SPARK4',
        'ELSWORD_SWORDFALL_BLADE_SECOND_SPARK4']
    callbacks = json.loads((ROOT / 'contracts/is-reference-consumers-v1.json').read_text('utf-8'))
    source = ROOT / '.cache/is-source/X2GUElsword_SwordMan.cpp'
    expected = 'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'
    if sha(source.read_bytes()) != expected:
        raise ValueError('Qualified fixedV5 callback source differs')
    result = {'schemaVersion': 3, 'clientMeasured': False,
              'evidenceClass': 'original2016 archive bytes/static declarations plus qualified fixedV5 callback reference',
              'originalFilesVerified': receipts, 'readerSha256': sha(READER.read_bytes()),
              'rawProfileLfSha256': sha((ROOT / 'packages/combat-core/is-profile.json').read_bytes().replace(b'\r\n', b'\n')),
              'state': profile['states']['ESSI_SI_SA_ETK_SWORD_FALL']['raw'],
              'templates': {name: {key: t.get(key) for key in ['source', 'declarationSha256', 'fields', 'events', 'glb', 'poseData']}
                            for name, t in templates.items()},
              'damageEffects': {name: profile['damageEffects'][name]['raw'] for name in damage_names},
              'callbackReference': {'fileSha256': expected,
                                    'contract': 'contracts/is-reference-consumers-v1.json',
                                    'referenceCommit': callbacks['source']['commit'],
                                    'evidenceClass': 'fixedV5 reference, not original2016 executable measurement',
                                    'prepareAnimationSeconds': [.03333, .06666, .1, .15],
                                    'releaseAnimationSeconds': [1, 1.16666, 1.33333, 1.5],
                                    'anchor': 'Bip01 + worldY60; released from live preparation Dummy01, facingX-59 and worldY+42'},
              'supersedes': 'Only the historical swordFall userAdapters in is-feedback-source-v2; raw profile remains frozen',
              'limits': ['Source/helper geometry and current simulator/GPU receipts remain separate.',
                         'No full original2016 client input/collision/render trace; timing callbacks are version-qualified.']}
    (ROOT / 'contracts/is-swordfall-source-v3.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'originalFilesVerified': len(receipts), 'templates': len(templates),
                      'sourceContract': 'contracts/is-swordfall-source-v3.json'}))


if __name__ == '__main__':
    main()
