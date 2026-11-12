"""Build original RS promotion parts and motions with the shared Elsword converter."""
import argparse
import json
from pathlib import Path
from build_rf import Catalog, digest, write_json
from build_lk import build_character

ROOT = Path(__file__).resolve().parents[3]
# SwordMan's shared wait consumer selects these original clips dynamically;
# they are not all reachable through states[].animationName alone.
SWORD_WAIT_RUNTIME_CLIPS = ('Wait_W0', 'Wait_W1', 'Fatal')
FAST_STANDUP_RUNTIME_CLIPS = ('SI_A_EL_GET_CHANCE_FRONT', 'SI_A_EL_GET_CHANCE_BACK')


def required_runtime_clips(profile):
    wanted = {s['animationName'] for s in profile['states'].values()}
    wanted.update(('Wait', 'Walk', 'BoostPower', 'RespawnLanding', *SWORD_WAIT_RUNTIME_CLIPS,
                   *FAST_STANDUP_RUNTIME_CLIPS))
    missing = wanted - profile['clips'].keys()
    if missing:
        raise ValueError('Missing original RS runtime clip declarations: '+str(sorted(missing)))
    return wanted


SPEC = {
    'id': 'rs',
    'motions': ('Motion_Elsword.x', 'Motion_Elsword_Common.x', 'Motion_Elsword_MK.x', 'Motion_Elsword_RS.x'),
    'supplementalMotions': {},
    'body': ('Mesh_Elsword_ERS_Base_Hair_Sorted.X', 'Mesh_Elsword_ERS_Basic_Face_Sorted.X',
             'Mesh_Elsword_ERS_Cash_Upbody_Sorted.X', 'Mesh_Elsword_ERS_Cash_Lowbody_Sorted.X',
             'Mesh_Elsword_ERS_Cash_Hand_Sorted.X', 'Mesh_Elsword_ERS_Cash_Foot_Sorted.X'),
    'weapon': 'Mesh_Elsword_ERS_Cash_Weapon_Sorted.X',
}


def build(source, output, profile_path=None):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must stay outside original inputs')
    output.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(source)
    lk = json.loads((ROOT/'artifacts/lk/manifest.json').read_text('utf8'))
    available = set(lk['runtimeCharacter']['selection']['included'])
    shared = {c['name']: c['decodedKeysSha256'] for c in lk['clips'] if c['name'] in available}
    spec = {**SPEC, 'sharedRuntimeClips': shared}
    if profile_path is not None:
        profile = json.loads(profile_path.read_text('utf8'))
        spec['runtimeClips'] = sorted(required_runtime_clips(profile))
    manifest = {'schemaVersion': 1, 'converterVersion': 'elsword-shared-assets-rs-v1',
        'id': 'rs', 'name': 'Rune Slayer', 'referenceVersion': 'Steam-NA-2016-V6.0420.5',
        'evidenceLevel': 'original-file-data', 'clientMeasured': False,
        'costumeSelection': 'exact original ERS promotion meshes; selectable costumes are independent display assets',
        'limits': ['Original client/GPU comparison unavailable; parts and animation keys are original file evidence.',
                   'Unlit rendering and alpha MASK remain explicit display adapters.']}
    manifest.update(build_character(catalog, output, profile_path, True, spec))
    manifest['sharedCharacterAnimations'] = {'glb': '../lk/'+lk['runtimeGlb'],
        'clips': manifest['runtimeCharacter'].get('sharedAnimationNames', []),
        'evidence': 'Identical decoded original clip names/keys; every referenced clip is present in LK runtime'}
    manifest['mechanismResources'] = {'awakening': {'characterClip': 'BoostPower',
        'timeSemantics': 'original RS declaration executed through shared Elsword awakening'},
        'wayOfSword': {'status': 'shared SwordMan implementation; RS declarations remain independent'}}
    manifest['sourceEvidence'] = sorted(catalog.used.values(), key=lambda row: row['rawPath'])
    write_json(output/'manifest.json', manifest)
    write_json(ROOT/'contracts/rs-assets-motion-index.json', {'schemaVersion': 1,
        'selection': SPEC, 'clientMeasured': False, 'sourceEvidence': manifest['sourceEvidence'],
        'sharedCharacterAnimations': manifest['sharedCharacterAnimations'],
        'clips': [{k: v for k, v in row.items() if k != 'rootMotion'} for row in manifest['clips']]})
    print(json.dumps({'clips': len(manifest['clips']), 'sharedClips': len(manifest['sharedCharacterAnimations']['clips']),
        'glb': manifest['runtimeGlb'], 'sha256': digest((output/manifest['runtimeGlb']).read_bytes())}))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, default=Path('asset_work'))
    p.add_argument('--output', type=Path, default=ROOT/'artifacts/rs')
    p.add_argument('--profile', type=Path)
    a = p.parse_args()
    build(a.source_root, a.output, a.profile)
