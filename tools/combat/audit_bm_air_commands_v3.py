"""Audit target2016 BM air-command roots; never treat adapter traces as client evidence."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from build_rf import Catalog
from build_rf_fx import read_definitions

def read(path):
    return json.loads(path.read_bytes())

def main():
    profile = read(ROOT/'packages/combat-core/bm-profile.json')
    documents = {key: read(ROOT/f'.cache/bm/{key}-declarations.json') for key in ('raven', 'damage', 'effect')}
    for key, document in documents.items():
        source = document['source']
        if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256'] or source != profile['sources'][key]:
            raise ValueError('BM target source changed: '+key)
    states = ['RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ', 'RSI_SOUL_TAKER_DASH_JUMP_COMBO_ZZZ_Landing',
              'RBM_DASH_JUMP_COMBO_X', 'RBM_DASH_JUMP_COMBO_XZ']
    sets = ['EffectSet_RST_DashJump_X', 'EffectSet_RST_DashJump_XZ']
    damages = ['DamageEffect_RBM_DashJump_X', 'DamageEffect_RST_DashJump_XZ']
    original_sets = {row['args'][-1]['NAME']: row['args'][-1] for row in documents['effect']['nativeCalls']
                     if row['target'].endswith('AddEffectSetTemplet_LUA') and row['args'][-1].get('NAME')}
    for name in states:
        if profile['states'][name]['raw'] != documents['raven']['globals'][name]:
            raise ValueError('BM state declaration changed: '+name)
    for category, names, originals in [('effectSets', sets, original_sets), ('damageEffects', damages, documents['damage']['globals'])]:
        for name in names:
            if profile[category][name]['raw'] != originals[name]:
                raise ValueError('BM effect declaration changed: '+name)
    definitions = read_definitions(Catalog(Path('asset_work')))
    templates = ['RBM_DashJump_X_AttackBox', 'RST_DashJump_XZ_ProDummy', 'RST_DashJumpX_AP01', 'RuneGuardIce_S05']
    evidence = {}
    for name in templates:
        record = definitions[name]
        for field in ('declarationSha256', 'fields', 'events', 'repeated'):
            if record[field] != profile['effectTemplates'][name][field]:
                raise ValueError('BM original template changed: '+name+'/'+field)
        evidence[name] = {field: record[field] for field in ('source', 'declarationSha256', 'fields', 'events', 'repeated')}
    result = {'schemaVersion': 1, 'originalClientMeasured': False,
        'classification': 'target2016 original declarations; user-confirmed input adapter; bounded fixed-V5 mesh/reaction consumers',
        'targetSources': {key: document['source'] for key, document in documents.items()},
        'states': {name: profile['states'][name] for name in states},
        'effectSets': {name: profile['effectSets'][name] for name in sets},
        'damageEffects': {name: profile['damageEffects'][name] for name in damages}, 'templates': evidence,
        'inputAdapter': {'requested': '668XX', 'retained': '668XZ', 'secondSourceState': 'RBM_DASH_JUMP_COMBO_XZ',
            'diveRule': 'Held direction cannot cancel an unfinished dive. Fourth Z waits for actual landing; explicit air66, X, awakening and skill cancels remain.',
            'evidence': 'User feedback; not a recovered target2016 native callback'},
        'meshMovementReference': 'contracts/rf-shadow-mesh-source-v11.json',
        'reactionReference': 'contracts/rf-reaction-source.json',
        'shockwave': {'firstReactType': 5, 'followingReactType': 2, 'changeTimes': [.2, .4],
            'airReaction': 'RSI_DAMAGE_AIR_SMALL', 'groundSuccessor': 'RSI_JUMP_LANDING',
            'forceFlyMeaning': 'Reset fly-count attenuation; not an override of REACT_TYPE.',
            'interpretation': 'Airborne big-hit posture keeps floating; retaining AIR_FLY through physical landing would choose a down state.'},
        'limits': ['No target2016 client trajectory or current GPU pixel measurement.',
            'First-X 5 MP gate retains the existing shared callback adapter; the original new BM native callback is unavailable.']}
    output = ROOT/'contracts/bm-air-commands-source-v3.json'
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'sourceDeclarationsVerified': True, 'templates': len(templates), 'output': output.relative_to(ROOT).as_posix()}))

if __name__ == '__main__':
    main()
