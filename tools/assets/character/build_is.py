"""Convert original Infinity Sword promotion parts with the shared KSM exporter.

LK animation sharing is accepted only for identical names and decoded keys.
The IS body, bind hierarchy and helper geometry always remain independent.
"""
import argparse
import json
from pathlib import Path
from build_rf import Catalog, build_character, write_json, digest

ROOT = Path(__file__).resolve().parents[3]
SPEC = {
    'id': 'is',
    'motions': ('Motion_Elsword.x', 'Motion_Elsword_Common.x', 'Motion_Elsword_TK.x', 'Motion_Elsword_IS.x'),
    'supplementalMotions': {},
    'body': ('Mesh_Elsword_EIS_Base_Hair_Sorted.X', 'Mesh_Elsword_EIS_Basic_Face_Sorted.X',
             'Mesh_Elsword_EIS_Cash_Upbody_Sorted.X', 'Mesh_Elsword_EIS_Cash_Lowbody_Sorted.X',
             'Mesh_Elsword_EIS_Cash_Hand_Sorted.X', 'Mesh_Elsword_EIS_Cash_Foot_Sorted.X'),
    'weapon': 'Mesh_Elsword_EIS_Cash_Weapon_Sorted.X',
}


def build(source, output):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must stay outside original inputs')
    output.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(source)
    lk = json.loads((ROOT/'artifacts/lk/manifest.json').read_text('utf8'))
    available = set(lk['runtimeCharacter']['selection']['included'])
    shared = {c['name']: c['decodedKeysSha256'] for c in lk['clips'] if c['name'] in available}
    manifest = {'schemaVersion': 1, 'converterVersion': 'elsword-shared-assets-is-v1',
        'id': 'is', 'unitClass': 112, 'name': 'Infinity Sword',
        'referenceVersion': 'Steam-NA-2016-V6.0420.5', 'evidenceLevel': 'original-file-data',
        'clientMeasured': False, 'costumeSelection': 'Exact target2016 EIS promotion filenames',
        'limits': ['Original client/GPU comparison unavailable; native parts and animation keys are source evidence.',
                   'Unlit materials and alpha MASK are declared display adapters.']}
    manifest.update(build_character(catalog, output, all_character_animations=True,
                                   spec={**SPEC, 'sharedRuntimeClips': shared}))
    manifest['runtimeCharacter']['selection']['purpose'] = 'Original Elsword/common/Sheath/Infinity Sword keys; exact LK keys shared'
    manifest['sharedCharacterAnimations'] = {'glb': '../lk/'+lk['runtimeGlb'],
        'clips': manifest['runtimeCharacter'].get('sharedAnimationNames', []),
        'evidence': 'Identical original decoded keys and names, available in the LK runtime GLB'}
    manifest['mechanismResources'] = {'awakening': {'characterClip': 'BoostPower',
        'timeSemantics': 'target declaration plus simulation executor'},
        'wayOfSword': {'status': 'shared SwordMan consumer; original IS target declarations'}}
    manifest['sourceEvidence'] = sorted(catalog.used.values(), key=lambda row: row['rawPath'])
    write_json(output/'manifest.json', manifest)
    write_json(ROOT/'contracts/is-assets-motion-index.json', {'schemaVersion': 1,
        'selection': SPEC, 'clientMeasured': False, 'sourceEvidence': manifest['sourceEvidence'],
        'runtimeClipNames': manifest['runtimeCharacter']['selection']['included'],
        'sharedCharacterAnimations': manifest['sharedCharacterAnimations'],
        'clips': [{k: v for k, v in row.items() if k != 'rootMotion'} for row in manifest['clips']]})
    print({'clips': len(manifest['clips']), 'shared': len(manifest['sharedCharacterAnimations']['clips']),
           'glb': manifest['runtimeGlb'], 'sha256': digest((output/manifest['runtimeGlb']).read_bytes())})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    parser.add_argument('--output', type=Path, default=ROOT/'artifacts/is')
    args = parser.parse_args()
    build(args.source_root, args.output)
