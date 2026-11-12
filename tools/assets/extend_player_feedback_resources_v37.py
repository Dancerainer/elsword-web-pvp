"""Extend only source-bound v37 effect closures; preserve all original raw data."""
from pathlib import Path
import copy
import hashlib
import json
import posixpath
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tools/assets/character'), str(ROOT / 'tools/assets')]
from build_lk_fx import build
import build_rf
from native_d3dx_keys import decode_measured_native_keys

def sha(data):
    return hashlib.sha256(data).hexdigest()

def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))

def write(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)

ROOTS = {
    'ca': ['EffectSet_SDK_Dash_Jump_Combo_ZX'],
    'mm': ['DAMAGE_EFFECT_Star_Fall_Start_MESH', 'DAMAGE_EFFECT_Star_Fall_Explode',
           'EffectSet_SI_SA_AMM_Installation_Star_Fall_Attack',
           'EffectSet_SI_SA_AMM_Installation_Star_Fall_LockOn',
           'DamageEffect_AMM_Shooting_Chaser_Attacker',
           *['EffectSet_SI_SA_AMM_Installation_Shooting_Chaser_A' + str(i) for i in range(1, 5)]],
    'de': ['EffectSet_ATT_Stardust_Shower_End'],
}

def main():
    cache = ROOT / '.cache/player-feedback-v37/add-target'
    measured = ROOT / '.cache/player-feedback-v37/native-input'
    build_rf.decode_measured_native_keys = lambda file, clips: decode_measured_native_keys(file, clips, repo_root=measured)
    effects, damage = [read(cache / (name + '-declarations.json')) for name in ['effect', 'damage']]
    for parsed in [effects, damage]:
        source = parsed['source']
        if sha(Path(source['path']).read_bytes()) != source['sha256']:
            raise ValueError('Original declaration source changed')
    sets = {c['args'][-1]['NAME']: {'raw': c['args'][-1], 'sourcePc': {
            'prototype': c['prototype'], 'instruction': c['instruction']}}
            for c in effects['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA')
            and c['args'][-1].get('NAME')}
    declarations = {name: {'raw': raw, 'sourcePc': damage['locations'][name]}
                    for name, raw in damage['globals'].items()}
    closures = {}
    for role, roots in ROOTS.items():
        selected_sets, selected_damage, seen, pending = {}, {}, set(), list(roots)
        while pending:
            name = pending.pop()
            if name in seen:
                continue
            seen.add(name)
            if name in sets:
                selected_sets[name] = sets[name]
                pending.extend(strings(sets[name]['raw']))
            if name in declarations:
                selected_damage[name] = declarations[name]
                pending.extend(strings(declarations[name]['raw']))
        if any(name not in seen or name not in sets and name not in declarations for name in roots):
            raise ValueError('Unbound original resource root for ' + role)
        closures[role] = {'effectSets': selected_sets, 'damageEffects': selected_damage}
    subset = {'professionId': 'v37-source-closure', 'states': {},
              'effectSets': {k: v for c in closures.values() for k, v in c['effectSets'].items()},
              'damageEffects': {k: v for c in closures.values() for k, v in c['damageEffects'].items()}}
    profile_input = ROOT / 'runtime/player-feedback-v37/resource-profile.json'
    write(profile_input, subset)
    output = ROOT / 'artifacts/mm/v37/fx'
    index = build(output, profile_input, index_output=None, shared_indexes=[
        (ROOT / f'.cache/player-feedback-v37/baseline-indexes/{role}.json', f'../../{role}/')
        for role in ['ca', 'mm', 'de', 'bh', 'gm', 'lp']])
    # This original spelling is absent from the source registry. Stardust
    # remains disabled; never fabricate the particle or hide another missing
    # dependency of either enabled skill/command.
    if set(index['missingTemplates']) - {'ATT_Stardust_Shower_Explosion_P04'}:
        raise ValueError('Original templates absent: ' + str(index['missingTemplates']))
    receipts = {}
    for role, closure in closures.items():
        file = ROOT / f'packages/combat-core/{role}-profile.json'
        profile = read(file)
        before = json.loads(subprocess.check_output(['git', 'show', 'HEAD:packages/combat-core/' + role + '-profile.json'], cwd=ROOT))
        for key, values in closure.items():
            for name, value in values.items():
                if name in profile[key] and profile[key][name]['raw'] != value['raw']:
                    raise ValueError('Existing raw source differs: ' + role + '/' + name)
                profile[key][name] = value
        # Include only this career's dependency records, without duplicating
        # the shared converted files or prewarming another career's models.
        fx_file = ROOT / f'artifacts/{role}/fx/index.json'
        fx = read(fx_file)
        selected_templates, pending = set(), list(strings(closure))
        while pending:
            name = pending.pop()
            if name in selected_templates or name not in index['templates']:
                continue
            selected_templates.add(name)
            pending.extend(strings(index['templates'][name]))
        for name in sorted(selected_templates):
            template = index['templates'][name]
            if name in profile['effectTemplates']:
                if profile['effectTemplates'][name]['declarationSha256'] != template['declarationSha256']:
                    raise ValueError('Existing original template differs: ' + name)
                if profile['effectTemplates'][name].get('glb') or not template.get('glb'):
                    continue
            record = copy.deepcopy(template)
            for key in ['glb', 'poseData']:
                if record.get(key):
                    record[key] = posixpath.normpath(('v37/' if role == 'mm' else '../mm/v37/') + record[key])
            for texture in record.get('textures', {}).values():
                if texture.get('file'):
                    texture['file'] = posixpath.normpath(('v37/' if role == 'mm' else '../mm/v37/') + texture['file'])
            initial = {e['property']: e['value'] for e in record['events'] if e['start'] == 0 and not e['fade']}
            profile['effectTemplates'][name] = {**record, 'initialSize': initial.get('Size'),
                'initialVelocity': initial.get('Velocity'), 'initialDirSpeed': initial.get('DirSpeed'),
                'initialAnimation': {'name': initial['AniName']['animation'], 'playback': initial['AniName']['playback']}
                    if 'AniName' in initial else None,
                'missingExplicitTickRate': record.get('animationMissingTickRate', False)}
            fx['templates'][name] = record
        profile['sourceLiteralResources'] = sorted(set(profile.get('sourceLiteralResources', [])) | set(ROOTS[role]))
        if role == 'mm':
            for skill_id, old_key, key, message in [
                (29018, 'shooting-chaser-beam', 'shooting-chaser-selection-fidelity', 'Target range, contact retention and allocation use original declarations/native evidence; nearest eligible body selection is a deterministic Web adapter, not target PvP measurement.'),
                (29016, 'starfall-attack-driver', 'starfall-selection-fidelity', 'Original squared range, generation and timer consumers recovered; live target filters, seeded RNG and posed target attachment retain explicit Web adapters.')]:
                row = next(s for s in profile['skillCatalog'] if s['skillId'] == skill_id)
                row.update(supported=True, supportStatus='target2016-native-control+qualified-web-selection')
                row.pop('unavailableReason', None)
                row['limitations'] = [l for l in row.get('limitations', []) if l['key'] not in [old_key, key]]
                row['limitations'].append({'key': key, 'message': message,
                    'evidenceClass': 'target2016-static-native+qualified-web-adapter'})
        write(file, profile)
        digest = sha(file.read_bytes())
        fx['profileSha256'] = digest
        write(fx_file, fx)
        # Keep the tracked source contract aligned only for this exact closure.
        contract_file = ROOT / f'contracts/{role}-fx-index.json'
        contract = read(contract_file)
        for name in selected_templates:
            if name in fx['templates']:
                contract['templates'][name] = fx['templates'][name]
        contract['profileSha256'] = digest
        write(contract_file, contract)
        manifest_file = ROOT / f'artifacts/{role}/manifest.json'
        manifest = read(manifest_file)
        manifest['profile']['sha256'] = digest
        write(manifest_file, manifest)
        receipts[role] = {'profileSha256': digest,
            'addedDamageEffects': sorted(set(profile['damageEffects']) - set(before['damageEffects'])),
            'addedEffectSets': sorted(set(profile['effectSets']) - set(before['effectSets'])),
            'addedTemplates': sorted(set(profile['effectTemplates']) - set(before['effectTemplates']))}
    write(ROOT / 'contracts/player-feedback-resource-closure-v37.json', {
        'schemaVersion': 1, 'originalClientMeasured': False,
        'sources': [effects['source'], damage['source']], 'roots': ROOTS, 'profiles': receipts,
        'templates': {k: {'source': v.get('source'), 'declarationSha256': v['declarationSha256']}
                      for k, v in index['templates'].items()},
        'meshFailures': index.get('meshFailures', []), 'missingTemplates': index['missingTemplates'],
        'qualification': 'Exact source closure; no original raw field changes or inferred missing animation clips.'})
    print(json.dumps({'profiles': receipts, 'convertedTemplates': len(index['templates'])}))

if __name__ == '__main__':
    main()
