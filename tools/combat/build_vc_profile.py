"""VC target declarations; common Raven data and consumers keep their provenance."""
import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from rf_skill_catalog import ACTIVE_BINDINGS, FOLLOWUP_STATES, trait_catalog, buff_catalog, buff_templates, strings

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = {sid: ACTIVE_BINDINGS[sid] for sid in (900, 24025, 24026, 24027, 24028, 24217, 24218)}
ACTIVE.update({
    24221: ('RSI_A_RWT_BARRAGE_ATTACK', 'HazeExplosion'),
    24031: ('RSI_SA_RWT_HARPOON_SPEAR', 'HarpoonSpear'),
    24034: ('RSI_SA_RWT_REVOLVER_CANNON', 'RevolverCannon'),
    24213: ('RSI_A_RVC_NAPALM_GRENADE', 'NapalmGrenade'),
    24214: ('RSI_A_RWT_MENTAL_BREAK', 'MentalCrash'),
    24020: ('RSI_SA_RWT_HELLFIRE_GATLING', 'HellfireGatling'),
    24021: ('RSI_SA_RWT_GIGA_PROMINENCE', 'GigaProminence'),
    24215: ('RSI_A_RF_BREAKING_FIST', 'BreakingFist'),
    24022: ('RVC_SI_SA_IGNITION_CROW', 'IgnitionCrow'),
    24023: ('RVC_SI_SA_IGNITION_CROW_INCINERATION', 'IgnitionCrowIncinerator'),
    24216: ('SI_A_RRF_GROUND_IMPACT', 'GroundImpact'),
    24024: ('RVC_SI_SA_DEADLY_RAID', 'DeadlyRaid'),
    24605: ('RSI_HA_RVC_BURNING_BUSTER', 'BurningBuster'),
})
ALIASES = {'RSI_COMBO_X': 'RWT_COMBO_X', 'RSI_COMBO_XX': 'RSI_WEAPON_TAKER_COMBO_XX',
    'RSI_COMBO_XXX': 'RSI_WEAPON_TAKER_COMBO_XXX', 'RSI_DASH_COMBO_ZZ': 'RVC_DASH_COMBO_ZZ',
    'RSI_DASH_JUMP_COMBO_X': 'RVC_DASH_JUMP_COMBO_X'}
COMMANDS = {'groundZ': 'RSI_COMBO_Z', 'groundX': 'RSI_COMBO_X', 'dashZ': 'RSI_DASH_COMBO_Z',
    'dashX': 'RSI_DASH_COMBO_X', 'jumpZ': 'RSI_JUMP_COMBO_Z', 'jumpX': 'RSI_JUMP_COMBO_X',
    'dashJumpZ': 'RSI_DASH_JUMP_COMBO_Z', 'dashJumpX': 'RSI_DASH_JUMP_COMBO_X'}
# The fixed V5 callback names the older projectile version of this skill.
# These target2016 loop declarations complement its target start/end sets;
# their adapter scheduling remains explicitly qualified in the v4 contract.
TARGET_ADAPTER_SETS = ('EffectSet_SA_RWT_HellFire_Loop', 'EffectSet_SA_RWT_HellFire_Loop_OverHit')

def build(cache, assets):
    documents = {key: json.loads(path.read_text('utf8')) for path in cache.glob('*-declarations.json')
                 for key in [path.name.removesuffix('-declarations.json')]}
    unit, enum, skills = [documents[key] for key in ('raven', 'enum', 'skill')]
    raw = unit['globals']
    rf = json.loads((ROOT/'packages/combat-core/rf-profile.json').read_text('utf8'))
    clip_file=assets/'clips.json'
    if not clip_file.exists():clip_file=assets/'source-proof/clips.json'
    clips = json.loads(clip_file.read_text('utf8'))
    clip_info = {c['name']: {k: c[k] for k in ('durationSeconds', 'durationTicks', 'ticksPerSecond', 'sourceName', 'decodedKeysSha256')} for c in clips}
    templates = {c['args'][-1]['m_eID']: c['args'][-1] for c in skills['nativeCalls'] if c['target'].endswith('AddSkillTemplet_LUA')}
    nodes = [c['args'][-1] for c in skills['nativeCalls'] if c['target'].endswith('AddSkillTreeTemplet_LUA') and c['args'][-1]['m_eUnitClass'] == 115]
    replaced = {templates[n['m_iSkillID']].get('m_DeleteSkillIDByUpgrade') for n in nodes}
    branches, branch_provenance = trait_catalog(documents['skill-note'], enum, templates, nodes, (4, 25, 115))
    power_tables = {c['args'][-1]['m_eID']: c['args'][-1]['m_Value'] for c in documents['skill-data']['nativeCalls'] if c['target'].endswith('AddSkillPowerRate_LUA')}
    catalog = []
    rf_skills = {c['skillId']: c for c in rf['skillCatalog']}
    for node in nodes:
        sid, level = node['m_iSkillID'], node['m_iMasterLevel']
        t = templates[sid]; passive = t['m_eActiveSkillUseCondtion'] == 0
        state, executor = ACTIVE.get(sid, (None, None))
        if state is not None and state not in raw:
            raise ValueError('Missing explicit VC skill binding: '+str(sid)+'/'+state)
        shared = sid in rf_skills and sid in (900, 24025, 24026, 24027, 24028, 24217, 24218, 24400)
        states = ([state]+FOLLOWUP_STATES.get(sid, [])) if shared and state else ([state] if state else [])
        if state and not shared:
            states += [k for k in raw if k.startswith(state+'_') and isinstance(raw[k], dict) and 'ANIM_NAME' in raw[k]]
            if sid == 24034: states = [k for k in states if '_HE' not in k]
            if sid == 24022: states = [k for k in states if 'INCINERATION' not in k]
        entries = branches.get(sid, [])
        for branch in entries:
            limits = {'MI_USEFUL': ['additional-hit-count: matching consumer pending'],
                      'MI_CRITICAL': ['defensive-effect-bypass: shared incomplete final-defense pipeline']}.get(branch['memoTypeName'], [])
            branch.update(supported=not limits, limitations=limits,
                          supportStatus='partial-target-adapter' if limits else 'shared-target-trait-adapter')
            if sid == 24022 and branch['memoTypeName'] == 'MI_USEFUL':
                branch.update(supported=True, limitations=[], supportStatus='user-vc-ignition-crow-useful-v8',
                              runtimeUserRule={'damageMultiplier': .7, 'residualFireHitGapMultiplier': .5,
                                               'lifetimeMultiplier': 1, 'source': 'project-rule-vc'})
        catalog.append({**(copy.deepcopy(rf_skills[sid]) if shared else {}),
            'skillId': sid, 'unitClass': 115, 'name': t['m_wstrName'], 'raw': t, 'treeNode': node,
            'maxLevel': level, 'maxLevelEvidence': 'target2016 AddSkillTreeTemplet_LUA.m_iMasterLevel',
            'topTier': sid not in replaced, 'replacesSkillId': t.get('m_DeleteSkillIDByUpgrade'),
            'passive': passive, 'type': t['m_eType'], 'useCondition': t['m_eActiveSkillUseCondtion'],
            'mpCost': t.get('m_MPConsumption', {}).get(str(level)), 'cooldown': t.get('m_SkillCoolTime', {}).get(str(level)),
            'powerRateType': t.get('m_ePowerRate'), 'levelPowerRate': power_tables.get(t.get('m_ePowerRate'), {}).get(str(level)),
            'powerMultiplier': max(t.get('SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE', {}).get(str(level), 1), 1),
            'state': state, 'executor': executor, 'states': states, 'supported': state is not None,
            'supportStatus': 'shared-raven-consumer' if shared else 'target-declaration-and-fixedV5-adapter',
            'fidelityVerified': False, 'selectable': sid not in replaced and not passive, 'slotEligible': not passive,
            'defaultGranted': sid not in replaced and passive, 'branches': entries, 'branchStatus': branch_provenance['status'],
            'sharedWithRF': shared})
    common = {k for k in rf['states'] if k.startswith('RSI_') and not any(x in k for x in ('OVER_TAKER', 'RRF', 'ROT', '_SI', '_A_', '_SA_', '_HA_', '_THROW'))}
    chosen = common | set(ALIASES.values()) | {k for row in catalog for k in row['states']}
    chosen |= {k for k in raw if re.match(r'(RWT_COMBO|RVC_DASH|RSI_WEAPON_TAKER)', k)}
    poses = raw['INIT_COMMON_RANDOM_STATE']['RAVEN_VETERAN_COMMANDER']
    chosen |= {v for group in poses.values() for v in group.values() if isinstance(v, str)}
    states = {}
    for name in sorted(chosen):
        value = raw[name]; anim = value.get('ANIM_NAME') or {'RSI_WAIT': 'Wait', 'RSI_WALK': 'Walk'}.get(name)
        if anim not in clip_info:
            raise ValueError('VC state original animation missing: '+name+'/'+str(anim))
        states[name] = {'raw': value, 'sourceState': name, 'animationName': anim, 'clip': clip_info[anim],
            'rootMotion': next((c.get('rootMotion') for c in clips if c['name'] == anim), None), 'sourcePc': unit['locations'][name],
            'defaultAnimationEvidence': 'target2016' if value.get('ANIM_NAME') else 'shared-fixedV5-Raven-default'}
    for role, source in ALIASES.items():
        states[role] = {**states[source], 'stateRole': role}
    damage = documents['damage']; effects = documents['effect']
    all_sets = {c['args'][-1]['NAME']: {'raw': c['args'][-1], 'sourcePc': {'prototype': c['prototype'], 'instruction': c['instruction']}}
        for c in effects['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA') and c['args'][-1].get('NAME')}
    # Native callback literal roots are included as resources, never triggered
    # automatically. Their individual execution is owned by the VC adapter.
    methods = json.loads((cache/'source-methods.json').read_text('utf8'))
    selected = [text for method, text in methods.items() if
        any(method.startswith(name+'_') for name in chosen) or
        method.startswith('RSI_SA_RWT_GIGA_PROMINENCE_OVER_FINISH_') or
        method in ('CreateOverHeatObject', 'DeleteOverHeatObject', '_ShowOverheatIcon', '_SetOverheat')]
    extra_roots = sorted({name for text in selected for name in re.findall(r'L"([^"\r\n]+)"', text)})
    effect_sets, damage_effects, seen = {}, {}, set()
    def closure(pending):
        while pending:
            name = pending.pop()
            if name in seen: continue
            seen.add(name)
            if name in all_sets:
                effect_sets[name] = all_sets[name]; pending.extend(strings(all_sets[name]))
            if name in damage['globals']:
                damage_effects[name] = {'raw': damage['globals'][name], 'sourcePc': damage['locations'][name]}
                pending.extend(strings(damage['globals'][name]))
    closure(list(strings(states))+extra_roots+list(TARGET_ADAPTER_SETS)+['RAVEN_NASOD_BALL','RAVEN_HYPER_AURA','EffectSet_RAVEN_HYPER_AURA','EffectSet_Raven_Shadow_Buster'])
    factors, factor_provenance = buff_catalog(cache, [states, catalog, damage_effects, {'BUFF_FACTOR_ID': {'1': 84, '2': 217}}])
    buffs, buff_provenance = buff_templates(cache, [states, catalog, damage_effects, factors])
    closure(list(strings(buffs)))
    pvp_poses = {kind: [{'state': group[str(i)], 'weight': group[str(i+1)],
        'animationName': states[group[str(i)]]['animationName'],
        'duration': states[group[str(i)]]['clip']['durationSeconds']/raw[group[str(i)]].get('ANIM_SPEED', 1),
        'durationEvidence': 'target motion period/ANIM_SPEED; simulation pose adapter'} for i in range(1, len(group)+1, 2)]
        for kind, group in [(kind, poses[key]) for kind, key in [('start','START_STATE_LIST'),('win','WIN_STATE_LIST'),('lose','LOSE_STATE_LIST')]]}
    semantics = {k: copy.deepcopy(v) for k, v in rf['referenceSemantics'].items() if k not in ('comboBuffers', 'mechanicBindings')}
    semantics.update(commandStates=COMMANDS, comboBuffers={}, mechanicBindings={},
        commonConsumerEvidence='Shared Raven movement/reaction/awakening/Nasod consumers; no RF-only passive or command copied')
    result = {'schemaVersion': 1, 'profileId': 'vc-target2016-v1', 'professionId': 'vc',
        'target': {'region': 'Steam NA', 'build': 'V6.0420.5', 'unitType': 4, 'unitClass': 115, 'displayName': 'VC / Veteran Commander'},
        'validation': {'clientMeasured': False, 'fidelityGate': 'pending', 'simulationEvidence': 'independent from original baseline'},
        'presentation': {**rf['presentation'], 'pvpPoses': pvp_poses, 'pvpPosesEvidence': 'target2016 INIT_COMMON_RANDOM_STATE.RAVEN_VETERAN_COMMANDER'},
        'physics': raw['INIT_PHYSIC'], 'body': raw['INIT_SYSTEM'], 'components': raw['INIT_COMPONENT'],
        'states': states, 'stateAliases': ALIASES, 'skillCatalog': catalog, 'clips': clip_info,
        'defaultPassiveSkillIds': [c['skillId'] for c in catalog if c['defaultGranted']],
        'buffFactors': factors, 'buffFactorProvenance': factor_provenance, 'buffTemplates': buffs, 'buffTemplateProvenance': buff_provenance,
        'effectSets': effect_sets, 'damageEffects': damage_effects, 'effectTemplates': {},
        'resourceOnlyEffectSets': sorted({n for n in extra_roots if n in all_sets}|set(TARGET_ADAPTER_SETS)), 'resourceOnlyTemplates': [],
        'sourceLiteralResources': extra_roots,
        'skillBranches': {**branch_provenance, 'powerRateTables': {str(k): {'values': v} for k,v in power_tables.items()}, 'powerRateSource': documents['skill-data']['source']},
        'enums': rf['enums'], 'referenceSemantics': semantics,
        'unsupported': [{'id': 'client-baseline', 'reason': 'No target2016 client trajectory/GPU comparison; fixedV5 and current simulation remain distinct'}],
        'sources': {k: d['source'] for k,d in documents.items()}}
    fx_path = assets/'fx/index.json'
    if fx_path.is_file():
        for name, template in json.loads(fx_path.read_text('utf8'))['templates'].items():
            initial = {e['property']: e['value'] for e in template['events'] if e['start'] == 0 and not e['fade']}
            result['effectTemplates'][name] = {**template, 'initialSize': initial.get('Size'), 'initialVelocity': initial.get('Velocity'),
                'initialDirSpeed': initial.get('DirSpeed'), 'initialAnimation': {'name': initial['AniName']['animation'], 'playback': initial['AniName']['playback']} if 'AniName' in initial else None,
                'missingExplicitTickRate': template.get('animationMissingTickRate', False)}
    return result

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache', type=Path, default=ROOT/'.cache/vc')
    p.add_argument('--assets', type=Path, default=ROOT/'artifacts/vc')
    p.add_argument('--output', type=Path, default=ROOT/'packages/combat-core/vc-profile.json')
    a = p.parse_args(); result = build(a.cache, a.assets)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', 'utf8')
    print(json.dumps({'states': len(result['states']), 'skills': len(result['skillCatalog']),
        'topActive': sum(s['topTier'] and not s['passive'] for s in result['skillCatalog']),
        'passives': result['defaultPassiveSkillIds'], 'sha256': hashlib.sha256(a.output.read_bytes()).hexdigest()}))
