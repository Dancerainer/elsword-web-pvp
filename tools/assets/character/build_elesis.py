"""Convert original target2016 Elesis profession bodies and complete motions."""
import argparse
import json
from pathlib import Path
from build_rf import Catalog, build_character, write_json, digest

ROOT = Path(__file__).resolve().parents[3]
JOBS = {'gm': (120, 'SGM', 'SK', 'GM', 'Grand Master'),
        'bh': (121, 'SBH', 'PK', 'BH', 'Blazing Heart'),
        'ca': (125, 'SCA', 'DK', 'CA', 'Crimson Avenger')}


def build(profession, source, output):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must stay outside original inputs')
    output.mkdir(parents=True, exist_ok=True)
    class_id, code, first, second, label = JOBS[profession]
    hair = 'Basic' if profession == 'ca' else 'Base'
    spec = {'id': profession, 'motions': ('Motion_EL.x', 'Motion_EL_Common.x',
            f'Motion_EL_{first}.x', f'Motion_EL_{second}.x'), 'supplementalMotions': {},
        'body': (f'Mesh_EL_{code}_{hair}_Hair_Sorted.X',
                 'Mesh_EL_SCA_Basic_Face_Sorted.X' if profession == 'ca' else 'Mesh_EL_Basic_Face_Sorted.X',
                 *(f'Mesh_EL_{code}_Cash_{part}_Sorted.X' for part in ('Upbody', 'Lowbody', 'Hand', 'Foot'))),
        'weaponFrameRenames': {'Object02': 'GM_Weapon_Object02'} if profession == 'gm' else {},
        'bodyHelperGeometry': True,
        'weaponMount': 'Dummy3_Weapon', 'weapon': f'Mesh_EL_{code}_Cash_Weapon_Sorted.X'}
    if profession == 'ca':
        spec['additionalMotionRoots'] = {'Motion_EL_CA.x': ('EL_Face', 'EL_Foot', 'EL_Hair', 'EL_Hand', 'EL_Lowbody_990', 'EL_Upbody')}
    catalog = Catalog(source)
    shared_manifest = None
    if profession != 'gm':
        shared_manifest = json.loads((ROOT/'artifacts/gm/manifest.json').read_text('utf8'))
        available = set(shared_manifest['runtimeCharacter']['selection']['included'])
        spec['sharedRuntimeClips'] = {clip['name']: clip['decodedKeysSha256']
            for clip in shared_manifest['clips'] if clip['name'] in available}
    manifest = {'schemaVersion': 1, 'converterVersion': 'elesis-target2016-v1',
        'id': profession, 'unitClass': class_id, 'name': label,
        'referenceVersion': 'Steam-NA-2016-V6.0420.5', 'evidenceLevel': 'original-file-data',
        'clientMeasured': False, 'costumeSelection': 'Exact target2016 Elesis promotion filenames',
        'limits': ['Original client/GPU comparison unavailable; original geometry and motion keys are source evidence.',
                   'Web material/rendering remains a separately validated adapter.']}
    manifest.update(build_character(catalog, output, all_character_animations=True, spec=spec))
    if shared_manifest:
        manifest['sharedCharacterAnimations'] = {'glb': '../gm/'+shared_manifest['runtimeGlb'],
            'clips': manifest['runtimeCharacter'].get('sharedAnimationNames', []),
            'evidence': 'Identical original decoded keys and clip names; common Elesis bone paths unchanged'}
    manifest['runtimeCharacter']['selection']['purpose'] = 'All original Elesis/common/first/second-job motion keys'
    manifest['sourceEvidence'] = sorted(catalog.used.values(), key=lambda r: r['rawPath'])
    write_json(output/'manifest.json', manifest)
    write_json(ROOT/f'contracts/{profession}-assets-motion-index.json', {
        'schemaVersion': 1, 'selection': spec, 'clientMeasured': False,
        'sourceEvidence': manifest['sourceEvidence'], 'runtimeClipNames': manifest['runtimeCharacter']['selection']['included'],
        'clips': [{k: v for k, v in row.items() if k != 'rootMotion'} for row in manifest['clips']]})
    print({'profession': profession, 'clips': len(manifest['clips']), 'runtimeGlb': manifest['runtimeGlb'],
           'sha256': digest((output/manifest['runtimeGlb']).read_bytes())}, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profession', choices=JOBS)
    parser.add_argument('--source-root', type=Path, default=Path('asset_work'))
    args = parser.parse_args()
    for job in [args.profession] if args.profession else JOBS:
        build(job, args.source_root, ROOT/'artifacts'/job)
