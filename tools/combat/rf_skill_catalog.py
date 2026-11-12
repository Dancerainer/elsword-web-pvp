"""Full target RF tree + explicitly labelled fixed-source callback candidates.

The target's trait array is not the older V5 memo-item format. Preserve all
positions; never silently feed a 2016 memo ID into the old memo enum.
"""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/native'))
from run_camera_source import extract

ACTIVE_BINDINGS = {
    900: ('RSI_THROW_ITEM', 'RelationshipLove'),
    24025: ('RSI_SI1_MAXIMUM_CANNON', 'MaximumCannon'),
    24026: ('RSI_SI2_CANNON_BLADE', 'CannonBlade'),
    24027: ('RSI_SI2_POWER_ASSAULT', 'PowerAssault'),
    24028: ('RSI_SI3_SEVEN_BURST', 'SevenBurst'),
    24029: ('RSI_SA_ROT_VALKYRIESJAVELIN', 'ValkyriesJavelin'),
    24032: ('RSI_SI1_OVER_TAKER_CHARGED_BOLT', 'ChargedBolt'),
    24006: ('RSI_SI3_OVER_TAKER_GUARDIAN_STRIKE', 'GuardianStrike'),
    24007: ('RSI_A_ROT_NUCLEAR', 'Nuclear'),
    24008: ('RSI_SI2_OVER_TAKER_ARC_ENEMY', 'Archenemy'),
    24009: ('RSI_SA_RRF_WILD_CHARGE_READY', 'WildCharge'),
    24010: ('SI_SA_RRF_X_CRASH', 'XCrash'),
    24217: ('RSI_SI_A_RF_SHADOW_STEP', 'ShadowStep'),
    24218: ('RSI_A_RWT_FLAME_SWORD', 'FlameSword'),
    24219: ('RSI_A_RRF_HELL_DIVE_UPGRADE', 'HellDive'),
    24203: ('RSI_A_RF_MEGADRILL_BREAK', 'MegaDrill'),
    24204: ('RSI_A_ROT_WEAPON_BREAK', 'WeaponCrash'),
    24205: ('RSI_A_RRF_LIMIT_CRUSHER_CHARGE', 'LimitCrusher'),
    24206: ('RSI_A_RRF_ENCHANT_HAND', 'EnchantHand'),
    24603: ('RSI_HA_RRF_INFERNAL_ARM', 'InfernalArms'),
}
FOLLOWUP_STATES = {
    24029: ['RSI_SA_ROT_VALKYRIESJAVELIN_LANDING'],
    24009: ['RSI_SA_RRF_WILD_CHARGING', 'RSI_SA_RRF_WILD_CHARGE_DASH'],
    24217: ['RSI_SHADOW_BACK_SLIDE_UPGRADE', 'RSI_SHADOW_BACK_SLIDE_END_UPGRADE',
            'RSI_SHADOW_STEP_Z', 'RSI_SHADOW_STEP_Z_UPGRADE', 'RSI_SHADOW_STEP_X_UPGRADE'],
    24218: ['RSI_A_RWT_FLAME_SWORD_GROUND', 'RSI_A_RWT_FLAME_SWORD_FLY'],
    24219: ['RSI_A_RRF_HELL_DIVE'],
    24205: ['RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK', 'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK'],
}
# Literal names from fixed V5 registration. They are reference aliases, not
# recovered numeric bindings in the 2016 executable.
REFERENCE_PREFIXES = {
    900: [('CX2GUUser', 'COMMON_RELATIONSHIP_SKILL')],
    24219: [('CX2GURaven', 'RSI_A_RRF_HELL_DIVE')],
    24218: [('CX2GURaven', 'RSI_A_RWT_FLAME_SWORD')],
    24217: [('CX2GURaven', 'RSI_SI_A_RF_SHADOW_STEP'), ('CX2GURaven', 'RSI_SHADOW_STEP'),
            ('CX2GURaven', 'RSI_SHADOW_BACK_SLIDE')],
    24009: [('CX2GURaven', 'RSI_SA_RRF_WILD_CHARGE'), ('CX2GURaven', 'RSI_SA_RRF_WILD_CHARGING')],
    24205: [('CX2GURaven', 'RSI_A_RRF_LIMIT_CRUSHER')],
}
PASSIVE_IDS = [24400, 24401, 24402, 24403, 24404, 24405]
LEGACY_IMPLEMENTED_ACTIVE = {24027, 24203, 24217, 24219}
EXECUTABLE_ACTIVE = LEGACY_IMPLEMENTED_ACTIVE | {24025,24026,24028,24032,24218,24204,
    24006,24007,24205,24206,24010,24603,24008,24009,24029,900}
SOURCE_CONTRACT = ROOT / 'contracts/rf-full-skill-source.json'


def verify_native(source_root):
    contract = json.loads(SOURCE_CONTRACT.read_text('utf-8'))
    for entry in contract['referenceFiles']:
        data = (source_root / entry['relativePath']).read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if hashlib.sha256(data).hexdigest() != entry['sha256'] or blob != entry['gitBlob']:
            raise ValueError('Fixed source hash mismatch: ' + entry['relativePath'])


def strings(v):
    if isinstance(v, dict):
        for child in v.values():
            yield from strings(child)
    elif isinstance(v, list):
        for child in v:
            yield from strings(child)
    elif isinstance(v, str):
        yield v


def read_optional(cache, name):
    path = cache / (name + '-declarations.json')
    return json.loads(path.read_text('utf-8')) if path.is_file() else None


def trait_catalog(notes, enums, templates, nodes, allowed_classes=(4, 17, 107)):
    if notes is None:
        return {}, {'status': 'target-note-cache-missing'}
    owned = {n['m_iSkillID'] for n in nodes}
    families = {}
    for sid in owned:
        family, cursor = [sid], sid
        while templates[cursor].get('m_DeleteSkillIDByUpgrade'):
            cursor = templates[cursor]['m_DeleteSkillIDByUpgrade']
            if cursor in family:
                raise ValueError('Cyclic skill replacement')
            family.append(cursor)
        families[sid] = family
    labels = {v: k for k, v in enums['globals']['MEMO_ID'].items()}
    by_sid = {sid: [] for sid in owned}
    for call in notes['nativeCalls']:
        if not call['target'].endswith('AddNewSkillNoteTemplet'):
            continue
        t = call['args'][-1]
        if t.get('UNIT_CLASS') not in allowed_classes:
            continue
        for ordinal, raw in t.get('MEMO_LIST', {}).items():
            original_sid, kind, memo_id = raw['2'], raw['1'], raw['3']
            for sid, family in families.items():
                if original_sid not in family:
                    continue
                params = [raw[k] for k in sorted(raw, key=int) if int(k) >= 4]
                by_sid[sid].append({
                    'id': 'memo-' + str(memo_id), 'memoId': memo_id,
                    'memoType': kind, 'memoTypeName': labels.get(kind),
                    'originalSkillId': original_sid, 'unitClass': t['UNIT_CLASS'],
                    'parameters': params, 'rawPositions': raw, 'ordinal': int(ordinal),
                    'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']},
                    'supported': False,
                    'selectable': True,
                    'supportStatus': 'target-2016-array-confirmed; target-native-consumer-not-acquired',
                    'positionSemanticsEvidence': '2016 MEMO_ID + skill-ID references; positions 4+ retained without guessing a consumer',
                })
    for sid, rows in by_sid.items():
        if len(rows) not in (0, 2):
            raise ValueError('Unexpected RF branch count for ' + str(sid))
    return by_sid, {
        'status': 'target-static-restored; native-trait-execution-unverified',
        'source': notes['source'], 'allowedClasses': list(allowed_classes),
        'rawLayout': ['MEMO_ID type', 'original skillId', 'local memoId', 'type-specific parameters...'],
        'olderV5Incompatible': 'AddSkillNoteTemplet_LUA reads [memoItemId, skillId], not AddNewSkillNoteTemplet; older item-note logic must not execute these IDs',
    }


def native_functions(source_root):
    if source_root is None:
        return {}
    verify_native(source_root)
    found = {}
    selected_prefixes = {p for sid, (state, _) in ACTIVE_BINDINGS.items()
                         for p in REFERENCE_PREFIXES.get(sid, [('CX2GURaven', state)])}
    call_pattern = re.compile(r'\b(CheckAnimationTime|CheckStateTime|PlayEffectSet|CreateInstance|CreateDamageEffect|SetEffectSet|StateChange|SetUnitState|GetSkillAbilityValue|SetPowerRate|UpNowHp|UpNowMp)\s*\(')
    for file in ('X2GURaven.cpp', 'X2GUUser.cpp'):
        path = source_root / 'X2Lib' / file
        data = path.read_bytes()
        for match in re.finditer(rb'^(?:/\*virtual\*/\s*)?(?:void|bool|float|int)\s+(CX2(?:GURaven|GUUser)::\w+)\s*\([^;{]*\)\s*\{', data, re.M):
            name = match.group(1).decode()
            if not any(name.startswith(cls + '::' + prefix + '_') for cls, prefix in selected_prefixes):
                continue
            signature = data[match.start():data.index(b'{', match.start())].strip()
            try:
                body, line_start, line_end = extract(data, signature)
            except ValueError as ex:
                raise ValueError(name + ': ' + str(ex)) from ex
            text = body.decode('latin1')
            rows = []
            for call in call_pattern.finditer(text):
                pos, depth = call.end(), 1
                while pos < len(text) and depth:
                    depth += (text[pos] == '(') - (text[pos] == ')')
                    pos += 1
                args = re.sub(r'\s+', ' ', text[call.end():pos-1]).strip()
                rows.append({'operation': call.group(1), 'arguments': args,
                             'sourceLine': line_start + text[:call.start()].count('\n')})
            lua_fields = sorted(set(re.findall(r'LUA_GET_\w+\([^\n]*?"([A-Z_a-z0-9]+)"', text)))
            literals = sorted(set(re.findall(r'"([^"\n]+)"', text)))
            found[match.group(1).decode()] = {
                'file': 'X2Lib/' + file, 'function': match.group(1).decode(),
                'lineStart': line_start, 'lineEnd': line_end,
                'sourceFileSha256': hashlib.sha256(data).hexdigest(),
                'functionTextSha256': hashlib.sha256(body).hexdigest(),
                'evidenceClass': 'fixed-reference-V5-not-target2016',
                'modificationDates': sorted(set(re.findall(r'20\d{2}-\d{2}-\d{2}', text))),
                'luaReadFields': lua_fields, 'calls': rows, 'stringLiterals': literals,
                'referencedStates': sorted(set(re.findall(r'\b(?:RSI|SI_A|SI_SA)_\w+', text))),
            }
    return found


def extend_catalog(catalog, cache, native_source=None):
    notes, enums = read_optional(cache, 'skill-note'), read_optional(cache, 'enum')
    templates = {row['skillId']: row['raw'] for row in catalog}
    branches, branch_provenance = trait_catalog(notes, enums, templates, [row['treeNode'] for row in catalog])
    functions = native_functions(native_source)
    power_data = read_optional(cache, 'skill-data')
    power_tables = {}
    if power_data:
        for call in power_data['nativeCalls']:
            if call['target'].endswith('AddSkillPowerRate_LUA'):
                raw = call['args'][-1]
                power_tables[raw['m_eID']] = {'values': raw['m_Value'], 'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']}}
    target_states = read_optional(cache, 'raven')['globals']
    for row in catalog:
        sid = row['skillId']
        row['branches'] = branches.get(sid, [])
        row['branchStatus'] = branch_provenance['status']
        row['selectable'] = row['topTier'] and not row['passive']
        row['defaultGranted'] = row['topTier'] and row['passive']
        row['slotEligible'] = not row['passive']
        kind = row['raw'].get('m_ePowerRate')
        row['powerRateType'] = kind
        row['levelPowerRate'] = power_tables.get(kind, {}).get('values', {}).get(str(row['maxLevel']))
        row['levelPowerRateEvidence'] = 'target SkillData.AddSkillPowerRate_LUA; V5 SkillTemplet.GetSkillPowerRateValue(level - 1), target-native-binding-unmeasured'
        if sid not in ACTIVE_BINDINGS:
            continue
        state, executor = ACTIVE_BINDINGS[sid]
        states = [state] + FOLLOWUP_STATES.get(sid, [])
        missing = [name for name in states if name not in target_states]
        if missing:
            raise ValueError('Target state absent: ' + str(missing))
        row['state'], row['executor'] = state, executor
        row['states'] = states
        prefixes = REFERENCE_PREFIXES.get(sid, [('CX2GURaven', state)])
        selected = [f for name, f in functions.items() if any(name.startswith(cls + '::' + prefix + '_') for cls, prefix in prefixes)]
        row['referenceBinding'] = {
            'status': 'fixed-V5-callback-candidate; target-native-ID-unverified',
            'functions': selected,
            'targetDeclarationEvidence': '2016 state spelling/raw fields confirmed; target native executable callbacks not measured',
        }
        row['supportStatus'] = 'source-backed-executor-candidate; target-runtime-acceptance-pending' if sid in EXECUTABLE_ACTIVE else 'target-data-restored; executor-hooks-pending'
        row['supported'] = sid in EXECUTABLE_ACTIVE
        row['fidelityVerified'] = False
        if sid == 900:
            row['supported'] = True
            row['supportStatus'] = 'source-recovery-candidate; target-relationship-use-permission-unverified'
            row['mpCost'] = 0
        row['powerRateEvidence'] = 'Target positive strengthening field applied once as explicit candidate; zero strengthening field unsupported and not multiplied. Original level power curve remains separate; no description-derived multiplier.'
        if sid == 24008:
            row['referenceBinding']['targetConflict'] = 'Target descriptor is a 30s four-javelin normal/active-attack buff; V5 FlyingImpact callback launches directly. Target coefficient consumer not acquired; 4.48 must not be labelled the stated 7.61.'
        if sid == 24009:
            row['referenceBinding']['targetConflict'] = 'V5 charge hardcodes 10s/HP%-loss accumulation and up to 2x; target SA_EFFECTIVE_TIME=.75 and SA_ATK_REL=1.5 are not read by these callbacks.'
    branch_provenance['powerRateTables'] = {str(k): v for k, v in sorted(power_tables.items())}
    branch_provenance['powerRateSource'] = power_data['source'] if power_data else None
    return branch_provenance


def all_skill_states(catalog):
    return sorted({name for row in catalog for name in row.get('states', [])})


def buff_catalog(cache, roots):
    """Preserve original factor bodies and their IDs, never flatten hit-count
    arrays into level values or invent missing Enum symbols.
    """
    factors, definitions, sources = {}, {}, {}
    wanted = set()

    def references(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key in ('BUFF_FACTOR','BUFF_FACTOR_ID') and isinstance(child, dict) and 'BUFF_TEMPLET_ID' not in child:
                    for item in child.values():
                        if isinstance(item, int):
                            wanted.add(item)
                elif key.startswith('BUFF_FACTOR_ID_AND_APPLY_TIME') and isinstance(child, dict):
                    for item in child.values():
                        if isinstance(item, dict) and isinstance(item.get('1'), int):
                            wanted.add(item['1'])
                references(child)
        elif isinstance(value, list):
            for child in value:
                references(child)

    references(roots)
    # This marker/debuff pair is present in the target Enchant Hand family.
    # Inclusion supplies data only; BBT_EMPTY is not a detonation prohibition.
    if 632 in wanted:
        wanted.add(633)
    for key in ('buff-factor', 'buff-factor-int'):
        declaration = read_optional(cache, key)
        if declaration is None:
            continue
        sources[key] = declaration['source']
        for call in declaration['nativeCalls']:
            raw = call['args'][-1]
            if not isinstance(raw, dict) or 'BUFF_FACTOR_ID' not in raw:
                continue
            sid = raw['BUFF_FACTOR_ID']
            entry = {'raw': raw['BUFF_FACTOR'], 'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']},
                     'sourceKey': key, 'evidenceClass': 'static-target-2016; behavior-execution-separate'}
            if sid in definitions:
                raise ValueError('Duplicate target buff factor: ' + str(sid))
            definitions[sid] = entry
    for sid in sorted(wanted):
        if sid in definitions:
            factors[str(sid)] = definitions[sid]
    return factors, {'sources': sources, 'requestedIds': sorted(wanted),
                     'missingIds': sorted(wanted - definitions.keys()),
                     'status': 'target-factor-raw-data; native-buff-hooks-separate'}


def buff_templates(cache, roots):
    wanted = set()
    def visit(v):
        if isinstance(v, dict):
            if isinstance(v.get('BUFF_TEMPLET_ID'), int):
                wanted.add(v['BUFF_TEMPLET_ID'])
            for child in v.values():
                visit(child)
        elif isinstance(v, list):
            for child in v:
                visit(child)
    visit(roots)
    definitions, sources = {}, {}
    for key in ('battle-buff', 'battle-buff-int'):
        declaration = read_optional(cache, key)
        if declaration is None:
            continue
        sources[key] = declaration['source']
        for call in declaration['nativeCalls']:
            raw = call['args'][-1]
            if call['target'].endswith('AddBuffTemplet_LUA') and isinstance(raw, dict) and raw.get('BUFF_TEMPLET_ID') in wanted:
                sid = str(raw['BUFF_TEMPLET_ID'])
                if sid in definitions:
                    raise ValueError('Duplicate target buff template: ' + sid)
                definitions[sid] = {'raw': raw, 'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']},
                                    'sourceKey': key, 'evidenceClass': 'static-target-2016; registration-execution-separate'}
    return definitions, {'sources': sources, 'requestedIds': sorted(wanted),
                          'missingIds': sorted(wanted - {int(k) for k in definitions}),
                          'status': 'target-battle-buff-templet-raw-data; do-not-substitute-world-buff-templet'}
