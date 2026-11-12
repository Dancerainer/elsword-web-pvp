"""Freeze VC command trace declarations from independent target Lua evidence."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
read = lambda path: json.loads(path.read_text('utf8'))
sha = lambda data: hashlib.sha256(data).hexdigest()
sys.path.insert(0, str(ROOT/'tools/assets/character'))
from runtime_path_case import canonical_runtime_path


def build():
    source = read(ROOT/'.cache/vc/raven-declarations.json')
    if sha(Path(source['source']['path']).read_bytes()) != source['source']['sha256']:
        raise ValueError('Original Raven Lua identity changed')
    profile = read(ROOT/'packages/combat-core/vc-profile.json')
    skill_states = {name for skill in profile['skillCatalog'] for name in skill.get('states', [])}
    states = {}
    for name, state in profile['states'].items():
        if name in skill_states:
            continue
        original_name = state.get('sourceState', name)
        original = source['globals'].get(original_name, {})
        fields = {key: value for key, value in original.items() if 'SLASH_TRACE' in key or key.startswith('EFFECT_SET_LIST')}
        if not fields:
            continue
        if any(state['raw'].get(key) != value for key, value in fields.items()):
            raise ValueError('Command presentation declaration changed: '+name)
        states[name] = {'sourceState': original_name, 'sourcePc': source['locations'][original_name],
                        'animationName': state['animationName'], 'fields': fields}
    pose = read(ROOT/'artifacts/vc/runtime-pose.json')
    names = {'TRACE_START0', 'TRACE_END0', 'ATTACK_SPHERE1_Lhand1', 'Bip01_L_Hand'}
    helpers = {frame['name']: frame for frame in pose['frames'] if frame['name'] in names}
    for frame in helpers.values():
        frame['parentName'] = pose['frames'][frame['parent']]['name']
    raven = (ROOT/'.cache/native-source-runtime/X2Lib/X2GURaven.cpp').read_bytes()
    effect_source = read(ROOT/'.cache/vc/effect-declarations.json')
    damage_source = read(ROOT/'.cache/vc/damage-declarations.json')
    for declaration in (effect_source, damage_source):
        if sha(Path(declaration['source']['path']).read_bytes()) != declaration['source']['sha256']:
            raise ValueError('Original effect declaration identity changed')
    original_sets = {call['args'][1]['NAME']: call['args'][1] for call in effect_source['nativeCalls']
                     if call['target'] == 'g_pEffectSet.AddEffectSetTemplet_LUA' and len(call['args']) > 1 and 'NAME' in call['args'][1]}
    original_damage = damage_source['globals']
    index = read(ROOT/'artifacts/vc/fx/index.json')
    # These callbacks are part of the separately frozen airborne consumer.
    # State-authored effect roots alone cannot discover native CreateEffect calls.
    callback_roots = ['DAMAGE_EFFECT_DASH_JUMP_X_BULLET', 'DAMAGE_EFFECT_DASH_JUMP_X_BULLET_LOOP',
                      'RWT_COMBO_X_SHELL', 'RWT_COMBO_XXX_LOOP', 'RWT_COMBO_XXX_LOOP_OVERHEAT']
    callback_lines = {name: [number for number, line in enumerate(raven.splitlines(), 1)
                             if b'"'+name.encode('ascii')+b'"' in line] for name in callback_roots}
    if any(not lines for lines in callback_lines.values()):
        raise ValueError('Command FX callback root lacks fixed-consumer source evidence')
    queue = callback_roots.copy()
    def enqueue(value):
        if isinstance(value, str): queue.append(value)
        elif isinstance(value, dict):
            for child in value.values(): enqueue(child)
        elif isinstance(value, list):
            for child in value: enqueue(child)
    for state in states.values(): enqueue(state['fields'])
    closure = {'effectSets': {}, 'damageEffects': {}, 'templates': {}}
    seen = set()
    while queue:
        name = queue.pop()
        if name in seen: continue
        seen.add(name)
        if name in original_sets:
            raw = original_sets[name]
            if profile['effectSets'].get(name, {}).get('raw') != raw: raise ValueError('Source EffectSet mismatch: '+name)
            closure['effectSets'][name] = raw
            enqueue(raw)
        elif name in original_damage:
            raw = original_damage[name]
            if profile['damageEffects'].get(name, {}).get('raw') != raw: raise ValueError('Source DamageEffect mismatch: '+name)
            closure['damageEffects'][name] = raw
            enqueue(raw)
        elif name in index['templates']:
            row = index['templates'][name]
            closure['templates'][name] = {key: row[key] for key in ('kind', 'fields', 'events', 'repeated', 'source', 'declarationSha256')}
            enqueue(row['fields']); enqueue(row['repeated'])
    references = set()
    for row in index['templates'].values():
        references.update(row[key] for key in ('glb', 'poseData') if row.get(key))
        references.update(texture['file'] for texture in row.get('textures', {}).values())
    for reference in references:
        if canonical_runtime_path(ROOT/'artifacts/vc', reference) != reference:
            raise ValueError('Case-sensitive runtime path mismatch: '+reference)
    result = {'schemaVersion': 1, 'targetClientMeasured': False,
        'evidence': 'target2016 Lua declarations and converted native helper records; fixed-V5 inherited Raven consumer',
        'source': source['source'], 'states': states, 'helpers': helpers,
        'effectSources': [effect_source['source'], damage_source['source']], 'effectClosure': closure,
        'callbackRoots': callback_roots, 'callbackSourceLines': callback_lines,
        'callbackConsumerContract': 'contracts/vc-air-command-source-v3.json',
        'runtimePathAudit': {'references': len(references), 'missing': 0, 'caseMismatches': 0},
        'fixedConsumer': {'path': 'X2Lib/X2GURaven.cpp', 'sha256': sha(raven), 'lines': [21944, 21969],
                          'fragmentSha256': sha(b''.join(raven.splitlines(keepends=True)[21943:21969]))},
        'sharedConsumerContract': 'contracts/rf-camera-trails-source.json',
        'limits': ['No original-client GPU capture', 'Shader/alpha-quantization parity remains unmeasured',
                   'Only states with original SLASH_TRACE or UNIT_SLASH_TRACE may emit weapon strips']}
    path = ROOT/'contracts/vc-command-presentation-source-v5.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'states': len(states), 'traceStates': sum(any('SLASH_TRACE' in k for k in s['fields']) for s in states.values())}))


if __name__ == '__main__':
    build()
