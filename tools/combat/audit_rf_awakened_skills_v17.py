"""Independent target declarations + pinned reference callbacks, never simulation goldens."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from kl82_static import read_declarations

REFERENCE_COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'
RAVEN_SHA = 'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237'
TARGET = {
    'Enum.lua': 'e5c98600ea7dafe8a4bc9d45fbd473cd0f6b91b4e3073017ec2d88ed76eb1eb6',
    'RAVEN_FIGHTER.lua': 'a5c3a8abf0f6c9c7d6fa185e20bdf7d43c0f2b463a3a98168bf9c7e0f92552e3',
    'DamageEffect.lua': '21747879161f19722278568dc2392c8778f88be491123a15f5f550cd63ac7397',
    'EffectSet.lua': '6c6a0fd7759921c070a8d04fa26ddd1a6432c307e185d9a4d5188919099b16c7',
    'NewSkillTempletVer2.lua': 'c8047731095475dda3f5bedb54e6e87509bc0438500acdf4005211ce0f5ed266',
    'SkillData.lua': '42765ec042e805c1971b1ebc858b4edda2ad46e81700066ec88cd4efa897f7e4',
    'SkillNoteTemplet.lua': 'eadf9ccd9b546500688ef4eaf60e9b6183cbe8c65103ff3f198d7d144ef72816',
}

def sha(value):
    return hashlib.sha256(value).hexdigest()

def masked(source):
    return re.sub(rb'//[^\n]*|/\*.*?\*/|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'',
                  lambda m: b' ' * len(m.group()), source, flags=re.S)

def fragment(source, name, klass='CX2GURaven'):
    matches = list(re.finditer(rb'\b(?:void|bool|float|int)\s+' + klass.encode() +
                              b'::' + name.encode() + rb'\s*\([^)]*\)', source))
    if len(matches) != 1:
        raise ValueError('Missing/ambiguous method ' + klass + '::' + name)
    start = matches[0].start()
    code = masked(source[start:])
    opening = code.index(b'{')
    depth = 0
    for i, char in enumerate(code[opening:], opening):
        depth += (char == 123) - (char == 125)
        if not depth:
            end = start + i + 1
            return source[start:end], {'name': klass + '::' + name,
                'startLine': source[:start].count(b'\n') + 1,
                'endLine': source[:end].count(b'\n') + 1,
                'sha256': sha(source[start:end])}
    raise ValueError('Malformed method ' + name)

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from strings(child)

def fields(value, pattern, prefix=''):
    result = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = prefix + str(key)
            if re.search(pattern, str(key), re.I):
                result.append({'field': path, 'value': child})
            result.extend(fields(child, pattern, path + '.'))
    return result

def read_target(directory):
    result = {}
    enums = None
    for name, expected in TARGET.items():
        path = directory / name
        if sha(path.read_bytes()) != expected:
            raise ValueError('Target source hash drift: ' + name)
        result[name] = json.loads(json.dumps(read_declarations(path, enums, capture_calls=True, capture_unresolved=True)))
        if name == 'Enum.lua':
            enums = result[name]['globals']
    return result

def audit(target_dir, reference_dir, compiled_contract=ROOT / '.cache/native-awakened-skills-v17/source-contract.json'):
    target = read_target(target_dir)
    source = (reference_dir / 'X2Lib/X2GURaven.cpp').read_bytes()
    if sha(source) != RAVEN_SHA:
        raise ValueError('Pinned Raven source hash drift')
    registration, registration_record = fragment(source, 'SetEquippedSkillFuncBySkillSlotIndex')
    # Preserve both preprocessor alternatives. This scanner does not guess a
    # 2016 build's flags from a field/table name.
    code_registration = re.sub(rb'//[^\n]*|/\*.*?\*/', lambda m: b' ' * len(m.group()), registration, flags=re.S)
    tables = list(re.finditer(rb'MakeTableReference\(\s*"([^"]+)",\s*(\w+)\.stateID\s*\)', code_registration))
    source_callbacks = {}
    bindings = []
    for i, match in enumerate(tables):
        tail = code_registration[match.end():tables[i+1].start() if i+1 < len(tables) else len(registration)]
        callbacks = []
        # An assignment following a memo's else table belongs to the same
        # normalStateData. Retain table records even where no callback follows.
        for callback in re.finditer(rb'(\w+)\.(\w+)\s*=\s*(?:SET_CB_FUNC\(\s*(\w+),\s*(\w+)\s*\)|(\w+)\.(\w+))', tail):
            owner, phase, klass, name, copied_owner, copied_phase = [x.decode() if x else None for x in callback.groups()]
            if owner != match.group(2).decode():
                continue
            callbacks.append({'phase': phase, 'class': klass, 'function': name,
                              'copyFrom': (copied_owner + '.' + copied_phase) if copied_owner else None})
            if name and klass == 'CX2GURaven' and name not in source_callbacks:
                body, record = fragment(source, name)
                text = body.decode('latin1')
                record.update({'modeReads': [x for x in ['IsHyperState()', 'GetRemainHyperModeTime()'] if x in text],
                    'file': 'X2Lib/X2GURaven.cpp', 'sourceFileSha256': RAVEN_SHA,
                    'wideStringLiterals': sorted(set(re.findall(r'L"([^"\n]+)"', text))),
                    'preprocessor': [x.strip() for x in text.splitlines() if x.lstrip().startswith('#')],
                    'animationTimers': re.findall(r'EventTimer(?:Oneshot)?\(\s*([\d.]+)f', text)})
                source_callbacks[name] = record
        bindings.append({'table': match.group(1).decode(), 'owner': match.group(2).decode(),
            'line': registration_record['startLine'] + registration[:match.start()].count(b'\n'),
            'callbacks': callbacks})
    user = (reference_dir / 'X2Lib/X2GUUser.cpp').read_bytes()
    user_sha = 'ef727830832c902d23bde254faf97dfe6c2e04183502db427b4de25995d78f38'
    if sha(user) != user_sha:
        raise ValueError('Pinned User source hash drift')
    for name in ['COMMON_RELATIONSHIP_SKILL_FrameMove', 'COMMON_RELATIONSHIP_SKILL_EventProcess']:
        body, record = fragment(user, name, 'CX2GUUser')
        text = body.decode('latin1')
        record.update({'file': 'X2Lib/X2GUUser.cpp', 'sourceFileSha256': user_sha,
            'modeReads': [x for x in ['IsHyperState()', 'GetRemainHyperModeTime()'] if x in text],
            'wideStringLiterals': sorted(set(re.findall(r'L"([^"\n]+)"', text))),
            'preprocessor': [x.strip() for x in text.splitlines() if x.lstrip().startswith('#')],
            'animationTimers': re.findall(r'EventTimer(?:Oneshot)?\(\s*([\d.]+)f', text)})
        source_callbacks[name] = record
    profile = json.loads((ROOT / 'packages/combat-core/rf-profile.json').read_text(encoding='utf-8'))
    compiled = json.loads(compiled_contract.read_text(encoding='utf-8'))
    if compiled.get('sourceFileSha256') != RAVEN_SHA or compiled.get('sourceCommit') != REFERENCE_COMMIT:
        raise ValueError('Compiled reviewed candidate source pairing drift')
    if len(compiled.get('functions', [])) + len(compiled.get('extraFunctions', [])) != 70:
        raise ValueError('Reviewed candidate must retain70 complete original methods')
    compiled_names = set()
    def compiled_walk(value):
        if isinstance(value, dict):
            if isinstance(value.get('name'), str):
                compiled_names.add(value['name'].split('::')[-1])
            for child in value.values():
                compiled_walk(child)
        elif isinstance(value, list):
            for child in value:
                compiled_walk(child)
    compiled_walk(compiled)
    state_globals = target['RAVEN_FIGHTER.lua']['globals']
    effect_sets = {call['args'][-1]['NAME']: call['args'][-1] for call in target['EffectSet.lua']['nativeCalls']
                   if call['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(call['args'][-1], dict)
                   and 'NAME' in call['args'][-1]}
    pool = {**target['DamageEffect.lua']['globals'], **effect_sets}
    templates = {call['args'][-1]['m_eID']: call['args'][-1] for call in target['NewSkillTempletVer2.lua']['nativeCalls']
                 if call['target'].endswith('AddSkillTemplet_LUA') and isinstance(call['args'][-1], dict)
                 and 'm_eID' in call['args'][-1]}
    branch_raw = {}
    for call in target['SkillNoteTemplet.lua']['nativeCalls']:
        if call['target'].endswith('.AddNewSkillNoteTemplet'):
            table = call['args'][-1]
            if table.get('UNIT_CLASS') in [4, 17, 107]:
                for value in table['MEMO_LIST'].values():
                    branch_raw[value['3']] = value
    rows = []
    for skill in profile['skillCatalog']:
        if not skill.get('topTier') or skill.get('passive'):
            continue
        target_raw = templates.get(skill['skillId'])
        differences = sorted(k for k in set(skill['raw']) | set(target_raw or {}) if skill['raw'].get(k) != target_raw.get(k))
        # Existing catalog retains a symbolic missing enum instead of nil.
        # Do not turn that context gap into an acquired native consumer.
        if differences and not (skill['skillId'] == 24206 and differences == ['BUFF_FACTOR']
                                and target_raw['BUFF_FACTOR'] == {'1': None}):
            raise ValueError('Profile skill raw differs from target: ' + str(skill['skillId']))
        for branch in skill['branches']:
            if branch['rawPositions'] != branch_raw[branch['memoId']]:
                raise ValueError('Profile trait raw differs from target: ' + branch['id'])
        names = set(skill['states'])
        relevant = [b for b in bindings if b['table'] in names or b['table'].removesuffix('_HYPER') in names]
        # HellDive's upgraded target successor and EnchantHand aren't renamed
        # to absent fixed-source callbacks; they remain version gaps.
        found = set()
        def visit(raw):
            for name in strings(raw):
                if name in pool and isinstance(pool[name], dict) and name not in found:
                    found.add(name)
                    visit(pool[name])
        states = []
        for name in skill['states']:
            raw = state_globals.get(name)
            if not isinstance(raw, dict):
                raise ValueError('Profile state missing from target: ' + name)
            visit(raw)
            states.append({'name': name, 'sourcePc': target['RAVEN_FIGHTER.lua']['locations'][name],
                          'rawSha256': sha(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()),
                          'modeFields': fields(raw, 'HYPER|MAX.?EFFECT'),
                          'animation': raw.get('ANIM_NAME'), 'effectSets': raw.get('EFFECT_SET_LIST')})
        # Include source-created direct damage/effect literals only if the
        # target itself defines them; keep absent literals separately.
        callback_names = {c['function'] for b in relevant for c in b['callbacks'] if c['function'] in source_callbacks}
        literals = sorted({s for n in callback_names for s in source_callbacks[n]['wideStringLiterals']})
        for name in literals:
            if name in pool:
                visit({'NAME': name})
        closure = [{'name': name, 'rawSha256': sha(json.dumps(pool[name], sort_keys=True, ensure_ascii=False).encode()),
                    'main': pool[name].get('MAIN_EFFECT_NAME'), 'modeFields': fields(pool[name], 'HYPER|MAX.?EFFECT'),
                    'resourceReferences': sorted({s for s in strings(pool[name]) if s not in pool and s != name})}
                   for name in sorted(found)]
        rows.append({'skillId': skill['skillId'], 'state': skill['state'], 'targetStates': states,
            'targetSkillRawSha256': sha(json.dumps(templates[skill['skillId']], sort_keys=True, ensure_ascii=False).encode()),
            'profileRawContextDifferences': differences,
            'referenceRegistrations': [{**b, 'targetTablePresent': b['table'] in state_globals,
                'callbacks': [{**c, 'compiled': c['function'] in compiled_names if c['function'] else None} for c in b['callbacks']]}
                for b in relevant],
            'callbacks': [source_callbacks[n] for n in sorted(callback_names)],
            'targetClosure': closure, 'referenceLiteralsOutsideDamageEffectSetRegistry': [s for s in literals if s not in pool],
            'branchArrays': [{'id': b['id'], 'rawPositions': b['rawPositions']} for b in skill['branches']],
            'branchModeConsumer': 'target-2016 trait consumer unknown; no invented Hyper trait coefficients',
            'status': 'disabled-in-PvP' if skill['skillId'] == 900 else 'fixed-reference candidate; target native registration not acquired'})
    if len(rows) != 20:
        raise ValueError('Expected exactly 20 highest RF active nodes')
    return {'schemaVersion': 1, 'evidenceClass': 'independent-static-source-not-simulation-or-original-client-measurement',
        'targetClientMeasured': 0, 'referenceCommit': REFERENCE_COMMIT, 'referenceRavenSha256': RAVEN_SHA,
        'targetFiles': {name: value['source']['sha256'] for name, value in target.items()},
        'registration': registration_record, 'compiledContractSha256': sha(compiled_contract.read_bytes()),
        'compiledContractInput': str(compiled_contract.resolve().relative_to(ROOT)).replace('\\', '/'),
        'compiledEvidence': 'explicit reviewed candidate; compiled coverage is current-reference implementation, not2016 native answer',
        'targetHyperTables': sorted(name for name, raw in state_globals.items() if isinstance(raw, dict) and 'HYPER' in name),
        'skills': rows}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target-dir', type=Path, default=Path('asset_work/raw/data/data036.kom'))
    parser.add_argument('--reference-dir', type=Path, default=ROOT / '.cache/native-skills-source')
    parser.add_argument('--compiled-contract', type=Path, default=ROOT / '.cache/native-awakened-skills-v17/source-contract.json',
                        help='Reviewed candidate only; compile it before source audit. Never infer original2016 behavior from current runtime.')
    parser.add_argument('--output', type=Path, default=ROOT / 'reports/rf-awakened-skills-source-v17.json')
    args = parser.parse_args()
    result = audit(args.target_dir, args.reference_dir, args.compiled_contract)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'skills': len(result['skills']), 'sha256': sha(args.output.read_bytes()),
        'missingHyperTables': sorted({b['table'] for row in result['skills'] for b in row['referenceRegistrations']
                                    if b['owner'] == 'hyperStateData' and not b['targetTablePresent']})}))

if __name__ == '__main__':
    main()
