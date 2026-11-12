"""Select original VC parts and motions using the existing Raven converter."""
import argparse
import json
from pathlib import Path
from build_rf import Catalog, build_character, write_json, digest

ROOT = Path(__file__).resolve().parents[3]
SPEC = {
    'id': 'vc',
    'motions': ('Motion_Raven.x', 'Motion_Raven_Common.x', 'Motion_Raven_WT.x', 'Motion_Raven_VC.x'),
    'supplementalMotions': {},
    'body': ('Mesh_Raven_RVC_Base_Hair_Sorted.X', 'Mesh_Raven_Cash_Face_Sorted.X',
             'Mesh_Raven_RVC_Cash_Upbody_Sorted.X', 'Mesh_Raven_RVC_Cash_Lowbody_Sorted.X',
             'Mesh_Raven_RVC_Cash_Left_Hand_Sorted.X', 'Mesh_Raven_RVC_Cash_Right_Hand_Sorted.X',
             'Mesh_Raven_RVC_Cash_Foot_Sorted.X'),
    'weapon': 'Mesh_Raven_RVC_Cash_Weapon_Sorted.X',
}

def build(source, output):
    if output.resolve().is_relative_to(source.resolve()):
        raise ValueError('Output must stay outside original inputs')
    output.mkdir(parents=True, exist_ok=True)
    catalog = Catalog(source)
    manifest = {'schemaVersion': 1, 'converterVersion': 'raven-shared-assets-vc-v1',
        'id': 'vc', 'name': 'Veteran Commander', 'referenceVersion': 'Steam-NA-2016-V6.0420.5',
        'evidenceLevel': 'original-file-data', 'clientMeasured': False,
        'limits': ['Original client/GPU comparison unavailable; native parts and animation keys are source evidence.']}
    rf=json.loads((ROOT/'artifacts/rf/manifest.json').read_text('utf8'))
    profile=json.loads((ROOT/'packages/combat-core/vc-profile.json').read_text('utf8'))
    wanted={s['animationName'] for s in profile['states'].values()}
    wanted.update(('Wait','Wait3','Walk','BoostPower','RespawnLanding'))
    available=set(rf['runtimeCharacter']['selection']['included'])
    shared={c['name']:c['decodedKeysSha256'] for c in rf['clips'] if c['name'] in available}
    spec={**SPEC,'runtimeClips':sorted(wanted),'sharedRuntimeClips':shared}
    manifest.update(build_character(catalog, output, all_character_animations=True, spec=spec))
    manifest['sharedCharacterAnimations']={'glb':'../rf/'+rf['runtimeGlb'],
        'clips':manifest['runtimeCharacter'].get('sharedAnimationNames',[]),
        'evidence':'Identical decoded original keys and names; RF runtime contains every referenced clip'}
    manifest['sourceEvidence'] = sorted(catalog.used.values(), key=lambda row: row['rawPath'])
    write_json(output/'manifest.json', manifest)
    write_json(ROOT/'contracts/vc-assets-motion-index.json', {'schemaVersion': 1,
        'selection': SPEC, 'clientMeasured': False, 'sourceEvidence': manifest['sourceEvidence'],
        'clips': [{k: v for k, v in row.items() if k != 'rootMotion'} for row in manifest['clips']]})
    print({'clips': len(manifest['clips']), 'glb': manifest['runtimeGlb'],
           'sha256': digest((output/manifest['runtimeGlb']).read_bytes())})

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-root', type=Path, default=Path('asset_work'))
    p.add_argument('--output', type=Path, default=ROOT/'artifacts/vc')
    a = p.parse_args()
    build(a.source_root, a.output)
