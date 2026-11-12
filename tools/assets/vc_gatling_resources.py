"""Supplement four target2016 Gatling declarations without rebuilding profile.

All referenced templates already belong to the target start/end closure. Original
Lua bytes are verified before mutation; existing unrelated profile fields remain
identical. Reuse the profile seal/inventory writer, never finalize_vc_assets.
"""
import copy
import hashlib
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'tools/combat'))
from build_vc_profile import TARGET_ADAPTER_SETS
from vc_landing_resources import read_json, json_bytes, write_profile_with_seals, refresh_runtime_inventory


def target_declarations(cache=ROOT/'.cache/vc'):
    docs = {key: read_json(cache/(key+'-declarations.json')) for key in ('effect', 'damage')}
    for doc in docs.values():
        if hashlib.sha256(Path(doc['source']['path']).read_bytes()).hexdigest() != doc['source']['sha256']:
            raise ValueError('Original target Lua hash differs')
    calls = {c['args'][-1]['NAME']: c for c in docs['effect']['nativeCalls']
             if c['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(c['args'][-1], dict) and c['args'][-1].get('NAME')}
    sets = {name: {'raw': calls[name]['args'][-1],
                   'sourcePc': {k: calls[name][k] for k in ('prototype', 'instruction')}} for name in TARGET_ADAPTER_SETS}
    names = {row['raw']['EFFECT0']['NAME'] for row in sets.values()}
    if names != {'DamageEffect_SA_RWT_HellFire_Explosion', 'DamageEffect_SA_RWT_HellFire_Explosion_OverHit'}:
        raise ValueError('Unexpected target Gatling loop closure')
    damages = {name: {'raw': docs['damage']['globals'][name], 'sourcePc': docs['damage']['locations'][name]} for name in sorted(names)}
    return sets, damages


def supplemented(profile, sets, damages):
    result = copy.deepcopy(profile)
    if set(sets) != set(TARGET_ADAPTER_SETS) or len(damages) != 2:
        raise ValueError('Exactly two target sets and two damage declarations required')
    # Refuse a half-available closure. Existing source records are kept verbatim.
    for row in damages.values():
        raw = row['raw']
        if raw['MAIN_EFFECT_NAME'] not in profile['effectTemplates']:
            raise ValueError('Missing target main mesh')
        for entry in raw.values():
            if not isinstance(entry, dict):
                continue
            if entry.get('PARTICLE_NAME') and entry['PARTICLE_NAME'] not in profile['effectTemplates']:
                raise ValueError('Missing target particle')
            if entry.get('DAMAGE_EFFECT_NAME') and entry['DAMAGE_EFFECT_NAME'] not in profile['damageEffects']:
                raise ValueError('Missing target damage child')
    result['effectSets'].update(copy.deepcopy(sets))
    result['damageEffects'].update(copy.deepcopy(damages))
    result['resourceOnlyEffectSets'] = sorted(set(result['resourceOnlyEffectSets']) | set(sets))
    return result


def add_gatling(root=ROOT):
    sets, damages = target_declarations(root/'.cache/vc')
    profile = supplemented(read_json(root/'packages/combat-core/vc-profile.json'), sets, damages)
    seal = write_profile_with_seals(profile, read_json(root/'artifacts/vc/fx/index.json'), root)
    return {'effectSets': len(sets), 'damageEffects': len(damages), 'newBinaryResources': 0, 'profileSha256': seal}


if __name__ == '__main__':
    print(json_bytes(add_gatling()).decode('utf8'))
    # No conversion, no full profile regeneration; only task-local metadata.
    output = (ROOT/'artifacts/vc').resolve()
    proof = (output/'source-proof').resolve()
    if not output.is_relative_to(ROOT.resolve()) or not proof.is_relative_to(output):
        raise ValueError('VC packing directory escaped the task workspace')
    for path in output.rglob('*'):
        if path.is_file() and not path.is_relative_to(proof):
            if not path.resolve().is_relative_to(output) or not (proof/path.relative_to(output)).resolve().is_relative_to(proof):
                raise ValueError('VC packing path escaped task-local outputs')
    from pack_vc_runtime import pack
    report = refresh_runtime_inventory(pack())
    print(json_bytes({'profile': report['profile'], 'summary': report['summary']}).decode('utf8'))
