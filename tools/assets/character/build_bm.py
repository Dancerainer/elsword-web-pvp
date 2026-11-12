"""Convert the target2016 Blade Master using the shared Raven converter.

Run --all-clips before building the profile; the final pass retains only profile
motions and shares RF animations only when original decoded keys match exactly.
"""
import argparse
import json
from pathlib import Path
from build_rf import Catalog, build_character, write_json, digest

ROOT = Path(__file__).resolve().parents[3]
SPEC = {
    'id': 'bm',
    'motions': ('Motion_Raven.x', 'Motion_Raven_Common.x', 'Motion_Raven_ST.x', 'Motion_Raven_BM.x'),
    # Target2016 shared Raven Flame Sword entry/air states name these exact
    # clips; retain the verified original parent paths and byte identities.
    'supplementalMotions': {
        'Motion_Raven_WT.x': {'sha256': 'e1c6bcce13404b980d16db8a2b7a0237b97c6736b9c69a2deeb6b5f5c0dd1a2f',
                              'clips': ('SI_A_RVC_BLEEDING_SLICER_AIR',)},
        'Motion_Raven_VC.x': {'sha256': 'cfaae409b0994665e378b42fc589c4cabdad9fd241d3b06c7d417f5a02d837aa',
                              'clips': ('Wait10',)},
    },
    'body': ('Mesh_Raven_RBM_Base_Hair_Sorted.X', 'Mesh_Raven_Cash_Face_Sorted.X',
             'Mesh_Raven_RBM_Cash_Upbody_Sorted.X', 'Mesh_Raven_RBM_Cash_Lowbody_Sorted.X',
             'Mesh_Raven_RBM_Cash_Left_Hand_Sorted.x', 'Mesh_Raven_RBM_Cash_Right_Hand_Sorted.X',
             'Mesh_Raven_RBM_Cash_Foot_Sorted.X'),
    'weapon': 'Mesh_Raven_RBM_Cash_Weapon_Sorted.X',
}


def build(source, output, all_clips=False):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must stay outside original inputs')
    output.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(source)
    manifest = {'schemaVersion': 1, 'converterVersion': 'raven-shared-assets-bm-v1',
        'id': 'bm', 'unitClass': 106, 'name': 'Blade Master',
        'referenceVersion': 'Steam-NA-2016-V6.0420.5',
        'evidenceLevel': 'original-file-data', 'clientMeasured': False,
        'limits': ['Original client/GPU comparison unavailable; native parts and animation keys are source evidence.']}
    spec = dict(SPEC)
    if not all_clips:
        rf = json.loads((ROOT/'artifacts/rf/manifest.json').read_text('utf8'))
        profile = json.loads((ROOT/'packages/combat-core/bm-profile.json').read_text('utf8'))
        wanted = {s['animationName'] for s in profile['states'].values()}
        wanted.update(('Wait', 'Wait3', 'Walk', 'BoostPower', 'RespawnLanding'))
        available = set(rf['runtimeCharacter']['selection']['included'])
        shared = {c['name']: c['decodedKeysSha256'] for c in rf['clips'] if c['name'] in available}
        spec.update(runtimeClips=sorted(wanted), sharedRuntimeClips=shared)
    manifest.update(build_character(catalog, output, all_character_animations=True, spec=spec))
    if not all_clips:
        manifest['sharedCharacterAnimations'] = {'glb': '../rf/'+rf['runtimeGlb'],
            'clips': manifest['runtimeCharacter'].get('sharedAnimationNames', []),
            'evidence': 'Identical decoded original keys and names; RF runtime contains every referenced clip'}
    manifest['sourceEvidence'] = sorted(catalog.used.values(), key=lambda row: row['rawPath'])
    write_json(output/'manifest.json', manifest)
    write_json(ROOT/'contracts/bm-assets-motion-index.json', {'schemaVersion': 1,
        'selection': SPEC, 'clientMeasured': False, 'sourceEvidence': manifest['sourceEvidence'],
        'clips': [{k: v for k, v in row.items() if k != 'rootMotion'} for row in manifest['clips']]})
    print({'clips': len(manifest['clips']), 'glb': manifest['runtimeGlb'],
           'sha256': digest((output/manifest['runtimeGlb']).read_bytes())})


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, default=Path('asset_work'))
    p.add_argument('--output', type=Path, default=ROOT/'artifacts/bm')
    p.add_argument('--all-clips', action='store_true')
    a = p.parse_args()
    build(a.source_root, a.output, a.all_clips)
