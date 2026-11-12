"""Audit VC SOUNDn against target declarations, then rebuild only local audio.

The fixed-V5 sound consumers are shared with the existing RF hit-audio adapter;
no trigger or waveform is invented and no upstream file is written.
"""
from pathlib import Path
import json, sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/combat'))
sys.path.insert(0, str(ROOT/'tools/assets/character'))
import audio
from build_rf import Catalog, digest, write_json
from kl82_static import read_declarations


def audit():
    source = Path('asset_work')
    catalog = Catalog(source)
    enum_path, damage_path, sound_path = [catalog.path(n) for n in ('Enum.lua', 'DamageEffect.lua', 'DamageSound.lua')]
    enum = read_declarations(enum_path)['globals']
    damage = read_declarations(damage_path, enum, True, True)['globals']
    sounds = read_declarations(sound_path)['globals']
    profile = json.loads((ROOT/'packages/combat-core/vc-profile.json').read_bytes())
    records = audio.effect_sound_references(profile)
    # Expected source data are independently decoded, not copied from the
    # implementation profile or accepted because a simulation ended normally.
    original = {name: {key: value for key, value in damage[name].items()
                     if key.startswith('SOUND') and key[5:].isdigit()} for name in records}
    if records != original:
        raise ValueError('VC profile SOUNDn differs from target DamageEffect.lua')
    table = {str(enum['HIT_TYPE'][name]): {str(enum['HITTED_TYPE'][key]): value for key, value in row.items()}
             for name, row in sounds.items() if name in enum['HIT_TYPE']}
    rf = json.loads((ROOT/'contracts/rf-hit-audio-source-v17.json').read_bytes())
    if table != rf['bindings']['damageSoundTables']:
        raise ValueError('Shared RF hit lookup differs from target DamageSound.lua')
    contract = {'schemaVersion': 1, 'targetClientMeasured': False,
        'classification': 'target2016 declarations/audio + fixed-V5 consumer reference; no target-client trajectory',
        'sources': [catalog.evidence(p) for p in (enum_path, damage_path, sound_path)],
        'sharedConsumerContract': 'contracts/rf-hit-audio-source-v17.json',
        'consumerLines': rf['consumerLines'], 'cppSources': rf['cppSources'],
        'vcHittedType': profile['components']['HITTED_TYPE'], 'damageSoundTables': table,
        'effectSounds': original, 'soundDefaults': rf['bindings']['soundDefaults'],
        'limits': ['SOUNDn follows the effect mesh clock, independently of hit/miss, and removes each record once.',
                   'Two source records with the same filename are two requests, not a filename deduplication bug.',
                   'HT_GROUND_HIT/default has no target audio mapping: do not invent a generic impact.',
                   'Retained old Gatling bullet SOUND is a resource dependency, not authorization to emit it from modern Gatling.',
                   'Audio readiness/play promises and mock playback do not establish audible output or native mixer/spatial gain parity.']}
    write_json(ROOT/'contracts/vc-hit-audio-source-v5.json', contract)
    return contract


def build():
    contract = audit()
    output = ROOT/'artifacts/vc/audio'
    # This path does not regenerate profile, mesh/texture closures, or source
    # seals. The existing packer shares identical RF bytes and refreshes only
    # this task's runtime inventory after the audio manifest changes.
    manifest = audio.build(ROOT/'packages/combat-core/vc-profile.json', Path('asset_work'),
                           output, ROOT/'reports/vc-audio.json')
    for row in manifest['files'].values():
        row['file'] = '../vc/audio/'+row['file']
    manifest['hitAudioContract'] = 'contracts/vc-hit-audio-source-v5.json'
    write_json(output/'manifest.json', manifest)
    from pack_vc_runtime import pack
    from vc_landing_resources import refresh_runtime_inventory
    runtime = refresh_runtime_inventory(pack())
    manifest = json.loads((output/'manifest.json').read_bytes())
    names = sorted({v['FILE_NAME'] for rows in contract['effectSounds'].values() for v in rows.values()})
    proof = {'schemaVersion': 1, 'targetClientMeasured': False,
        'sourceContract': 'contracts/vc-hit-audio-source-v5.json',
        'sourceContractSha256': digest((ROOT/'contracts/vc-hit-audio-source-v5.json').read_bytes()),
        'referenceSounds': manifest['referenceTriggers'],
        'soundOwners': len(contract['effectSounds']), 'soundRecords': sum(map(len, contract['effectSounds'].values())),
        'uniqueEffectSounds': len(names), 'effectSounds': {name:manifest['files'][name] for name in names},
        'audioManifest': {'file':'artifacts/vc/audio/manifest.json', 'sha256':digest((output/'manifest.json').read_bytes())},
        'runtimeSummary':runtime['summary']}
    write_json(ROOT/'reports/vc-hit-audio-assets-v5.json', proof)
    print(json.dumps({k:v for k,v in proof.items() if k not in ('effectSounds', 'runtimeSummary')}))
    return proof


if __name__ == '__main__':
    build()
