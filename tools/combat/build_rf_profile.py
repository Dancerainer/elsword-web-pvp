"""Build a small RF combat dataset from target KL82 declarations, never execute Lua.

Inputs are read-only extracted target files and this task's declaration cache.
The generated JSON keeps raw target fields apart from V5 reference semantics.
"""
from pathlib import Path
import argparse
import hashlib
import json

from rf_skill_catalog import extend_catalog, all_skill_states, buff_catalog, buff_templates


ROOT = Path(__file__).resolve().parents[2]
V5_COMMIT = 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633'


def build(cache, assets, native_source=None):
    def read(name):
        return json.loads((cache / (name + '-declarations.json')).read_text('utf-8'))
    raven, skills, damage, effects, enums = [read(x) for x in ('raven', 'skill', 'damage', 'effect', 'enum')]
    raw = raven['globals']
    clips = json.loads((assets / 'clips.json').read_text('utf-8'))
    clip_info = {v['name']: {k: v[k] for k in ('durationSeconds', 'durationTicks', 'ticksPerSecond', 'sourceName', 'decodedKeysSha256')} for v in clips}
    templates = {v['args'][-1]['m_eID']: v['args'][-1] for v in skills['nativeCalls']
                 if v['target'].endswith('AddSkillTemplet_LUA') and isinstance(v['args'][-1], dict) and 'm_eID' in v['args'][-1]}
    nodes = [v['args'][-1] for v in skills['nativeCalls']
             if v['target'].endswith('AddSkillTreeTemplet_LUA') and isinstance(v['args'][-1], dict) and v['args'][-1].get('m_eUnitClass') == 107]
    owned = {v['m_iSkillID'] for v in nodes}
    replaced = {templates[s].get('m_DeleteSkillIDByUpgrade') for s in owned}
    bindings = {
        24027: ('RSI_SI2_POWER_ASSAULT', 'PowerAssault'),
        24203: ('RSI_A_RF_MEGADRILL_BREAK', 'MegaDrill'),
        24217: ('RSI_SI_A_RF_SHADOW_STEP', 'ShadowStep'),
        24219: ('RSI_A_RRF_HELL_DIVE_UPGRADE', 'HellDive'),
    }
    # State spelling is checked against target declarations, never filled from old Lua.
    if bindings[24027][0] not in raw:
        matches = [k for k in raw if 'POWER_ASSAULT' in k and 'HYPER' not in k]
        if len(matches) != 1:
            raise ValueError('Ambiguous PowerAssault state: ' + str(matches))
        bindings[24027] = (matches[0], 'PowerAssault')
    catalog = []
    for node in nodes:
        sid = node['m_iSkillID']
        t = templates[sid]
        passive = t.get('m_eActiveSkillUseCondtion', 0) == 0
        max_level = node['m_iMasterLevel']
        supported = sid in bindings
        strengthened = t.get('SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE', {}).get(str(max_level))
        catalog.append({
            'skillId': sid, 'name': t.get('m_wstrName'), 'unitClass': 107,
            'maxLevel': max_level, 'maxLevelEvidence': '2016 AddSkillTreeTemplet_LUA.m_iMasterLevel',
            'topTier': sid not in replaced, 'replacesSkillId': t.get('m_DeleteSkillIDByUpgrade'),
            'passive': passive, 'type': t.get('m_eType'),
            'useCondition': t.get('m_eActiveSkillUseCondtion'),
            'mpCost': t.get('m_MPConsumption', {}).get(str(max_level)),
            'cooldown': t.get('m_SkillCoolTime', {}).get(str(max_level)),
            'powerMultiplier': strengthened if strengthened is not None and strengthened > 0 else 1,
            'strengtheningPowerRate': {'rawValue': strengthened, 'supported': False,
                'executionPolicy': 'positive-declaration-candidate-applied-once' if strengthened is not None and strengthened > 0 else 'not-applied; neutral prototype factor, native state-power binding separate',
                'reason': 'Target native strengthened-field consumer unavailable; zero is not confirmed as a damage multiplier'},
            'state': bindings.get(sid, (None, None))[0],
            'executor': bindings.get(sid, (None, None))[1],
            'supported': supported,
            'supportStatus': 'static-data + reference-semantics + prototype-collision' if supported else 'unimplemented',
            'branches': [], 'branchStatus': 'target trait declaration not yet identified; unknown branch IDs rejected',
            'raw': t, 'treeNode': node,
        })
    branch_provenance = extend_catalog(catalog, cache, native_source)
    names = [
        'RSI_WAIT', 'RSI_WALK', 'RSI_DASH', 'RSI_DASH_END', 'RSI_JUMP_READY',
        'RSI_JUMP_UP', 'RSI_JUMP_DOWN', 'RSI_JUMP_LANDING', 'RSI_DASH_JUMP',
        'RSI_HYPER_MODE', 'RSI_COMBO_Z', 'RSI_COMBO_ZZ', 'RSI_COMBO_ZZZ', 'RSI_COMBO_ZZZZ',
        'RSI_COMBO_X', 'RSI_COMBO_XX', 'RSI_COMBO_XXX', 'RSI_JUMP_COMBO_Z', 'RSI_JUMP_COMBO_X',
        'RSI_DASH_COMBO_Z', 'RSI_DASH_COMBO_ZZ', 'RSI_DASH_COMBO_X', 'RSI_OVER_TAKER_DASH_COMBO_ZX',
        'RSI_DASH_JUMP_COMBO_Z', 'RRF_DASH_JUMP_COMBO_X', 'RSI_PARRYING',
        'RSI_DAMAGE_GROGGY', 'RSI_DAMAGE_DOWN_FRONT', 'RSI_DAMAGE_STANDUP_FRONT', 'RSI_STANDUP_ATTACK_FRONT',
        'RSI_DAMAGE_SMALL_FRONT', 'RSI_DAMAGE_BIG_FRONT', 'RSI_DAMAGE_AIR_FLY_FRONT',
        'RSI_DAMAGE_AIR_DOWN', 'RSI_DAMAGE_AIR_DOWN_LANDING', 'RSI_DASH_JUMP_LANDING',
        'RSI_DAMAGE_SMALL_BACK', 'RSI_DAMAGE_BIG_BACK', 'RSI_DAMAGE_DOWN_BACK', 'RSI_DAMAGE_STANDUP_BACK',
        'RSI_DAMAGE_AIR_SMALL', 'RSI_DAMAGE_AIR_FLY_BACK', 'RSI_DASH_JUMP_POWER_LANDING',
        'RSI_COMBO_ZZX', 'RSI_COMBO_ZZXX', 'RRF_COMBO_ZZXFRONTX', 'RRF_COMBO_ZZXFRONTXX',
        'RSI_OVER_TAKER_COMBO_XXfrontX', 'RSI_OVER_TAKER_COMBO_XXdownX',
        'RSI_OVER_TAKER_COMBO_XXfrontXX', 'RSI_OVER_TAKER_COMBO_XXfrontXX2',
        'RSI_OVER_TAKER_COMBO_XXfrontXX3', 'RSI_OVER_TAKER_COMBO_XXfrontXX4',
        'RSI_OVER_TAKER_COMBO_XXfrontXXdownX',
        'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX', 'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING',
        'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX', 'RSI_DASH_JUMP_COMBO_ZZ', 'RSI_DASH_JUMP_COMBO_ZZ_Landing',
        'RRF_DASH_JUMP_COMBO_XX', 'RRF_DASH_JUMP_COMBO_XX_LANDING',
        'RSI_DIE_FRONT', 'RSI_DIE_BACK', 'RSI_DAMAGE_AIR_UP', 'RSI_DAMAGE_AIR_FALL',
        'RSI_DAMAGE_AIR_DOWN_INVINCIBLE', 'RSI_STANDUP_ATTACK_BACK', 'RSI_DAMAGE_REVENGE',
        'RSI_STANDUP_ATTACK_FRONT_NO_DOWN', 'RSI_STANDUP_ATTACK_BACK_NO_DOWN',
    ] + [v[0] for v in bindings.values()] + all_skill_states(catalog)
    states = {}
    for name in names:
        if name not in raw:
            continue
        value = raw[name]
        anim = value.get('ANIM_NAME')
        if name == 'RSI_WAIT':
            anim = 'Wait'  # V5 default common-animation mapping, labelled below.
        if name == 'RSI_WALK':
            anim = anim or 'Walk'
        motion = next((c['rootMotion'] for c in clips if c['name'] == anim), None)
        states[name] = {'raw': value, 'animationName': anim, 'clip': clip_info.get(anim), 'rootMotion': motion,
                        'sourcePc': raven['locations'][name],
                        'defaultAnimationEvidence': 'reference-v5' if not value.get('ANIM_NAME') else 'target-2016'}
    effect_sets = {}
    all_sets = {}
    for call in effects['nativeCalls']:
        if not call['target'].endswith('AddEffectSetTemplet_LUA'):
            continue
        t = call['args'][-1]
        if isinstance(t, dict) and t.get('NAME'):
            all_sets[t['NAME']] = {'raw': t, 'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']}}
        if isinstance(t, dict) and t.get('NAME') in {
            'EffectSet_RF_COMBO_Z', 'EffectSet_RF_COMBO_X', 'EffectSet_RF_DASH_COMBO_Z',
            'EffectSet_SA_Raven_PowerAssault', 'EffectSet_A_ROT_HellDive',
            'Effectset_SI_A_RF_MEGADRILL_BREAK_MEMO', 'EffectSet_RAVEN_HYPER_AURA',
            'EffectSet_ROT_DASHJUMP_ZXX',
        }:
            effect_sets[t['NAME']] = {'raw': t, 'sourcePc': {'prototype': call['prototype'], 'instruction': call['instruction']}}
    damage_names = {
        'DamageEffect_RF_COMBO_Z', 'DamageEffect_RF_COMBO_X', 'DamageEffect_RF_DASH_COMBO_Z',
        'DAMAGE_EFFECT_POWER_ASSAULT_HYPER', 'DAMAGE_EFFECT_POWER_ASSAULT',
        'DAMAGE_EFFECT_RRF_HELL_DIVE_FIRST_PUNCH', 'DAMAGE_EFFECT_RRF_HELL_DIVE_SECOND_PUNCH',
        'RAVEN_NASOD_BALL', 'RAVEN_HYPER_AURA',
    }
    def strings(value):
        if isinstance(value, dict):
            for child in value.values():
                yield from strings(child)
        elif isinstance(value, list):
            for child in value:
                yield from strings(child)
        elif isinstance(value, str):
            yield value
    # Follow declarations, including visual-only sets and damage/particle chains.
    # The previous seven-name allowlist silently omitted most original effects.
    resource_only_sets = ['EffectSet_Raven_Shadow_Buster','EffectSet_RRF_DashJumpX','EffectSet_A_RF_XXX',
                          'EffectSet_SA_ROT_VALKYRIESJAVELIN_NEW','EffectSet_Heal']
    pending = list(strings(states)) + list(damage_names) + list(effect_sets) + resource_only_sets
    # Literal effect names in reference callbacks are extra resource roots;
    # they do not become automatic effect triggers or proven 2016 bindings.
    pending += [s for row in catalog for f in row.get('referenceBinding', {}).get('functions', []) for s in f['stringLiterals']]
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        if name in all_sets:
            effect_sets[name] = all_sets[name]
            pending.extend(strings(all_sets[name]['raw']))
        if name in damage['globals']:
            damage_names.add(name)
            pending.extend(strings(damage['globals'][name]))
    effect_asset_path = assets / 'effect-assets.json'
    effect_assets = json.loads(effect_asset_path.read_text('utf-8'))['templates'] if effect_asset_path.exists() else {}
    # Keep original mesh-player lifetime/motion declarations in the headless
    # executor as well as presentation. The original effect-assets index omits
    # DirSpeed; notably the ZXX hidden parent travels at exactly 1000 units/s.
    for fx_index_path in [ROOT / 'contracts/rf-fx-index.json', ROOT / 'contracts/rf-shadow-weapon-fx-index.json',
                          ROOT / 'contracts/rf-command-fx-index-v9.json', ROOT / 'contracts/rf-skill-fx-index-v11.json']:
        if not fx_index_path.exists():
            continue
        for name, template in json.loads(fx_index_path.read_text('utf-8'))['templates'].items():
            if template.get('kind') != 'mesh':
                continue
            initial = {e['property']: e['value'] for e in template['events'] if e['start'] == 0 and not e['fade']}
            effect_assets[name] = {**effect_assets.get(name, {}), **template,
                                  'initialSize': initial.get('Size'),
                                  'initialVelocity': initial.get('Velocity'),
                                  'initialDirSpeed': initial.get('DirSpeed'),
                                  'initialAnimation': {'name': initial['AniName']['animation'], 'playback': initial['AniName']['playback']} if 'AniName' in initial else None,
                                  'missingExplicitTickRate': template.get('animationMissingTickRate', False)}
    # CreateSequence literals in compiled command callbacks are independent
    # visual resources. Keep their source declarations without inventing a
    # damage helper or automatically attaching any new gameplay trigger.
    command_particle_assets = {}
    command_particle_index = ROOT / 'contracts/rf-xx2x-fx-index-v12.json'
    if command_particle_index.exists():
        for name, template in json.loads(command_particle_index.read_text('utf-8'))['templates'].items():
            if template.get('kind') != 'particle':
                raise ValueError('Command-particle index contains a nonparticle template')
            command_particle_assets[name] = template
            effect_assets[name] = template
    factors, factor_provenance = buff_catalog(cache, [states, catalog,
        {name: damage['globals'][name] for name in damage_names if name in damage['globals']}])
    buffs, buff_provenance = buff_templates(cache, [states, catalog, factors,
        {name: damage['globals'][name] for name in damage_names if name in damage['globals']}])
    # Buff displayers are original resource roots too. Preserve their closure
    # without treating the renderer color constructor as a known numeric value.
    pending = list(strings(buffs))
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        if name in all_sets:
            effect_sets[name] = all_sets[name]
            pending.extend(strings(all_sets[name]['raw']))
        if name in damage['globals']:
            damage_names.add(name)
            pending.extend(strings(damage['globals'][name]))
    main_names = {damage['globals'][k].get('MAIN_EFFECT_NAME') for k in damage_names if k in damage['globals']}
    combo_buffers = {
        'RSI_COMBO_Z': {'until': .3, 'after': .29, 'Z': 'RSI_COMBO_ZZ'},
        'RSI_COMBO_ZZ': {'until': .39, 'after': .39, 'Z': 'RSI_COMBO_ZZZ', 'X': 'RSI_COMBO_ZZX'},
        'RSI_COMBO_ZZZ': {'until': .59, 'after': .59, 'Z': 'RSI_COMBO_ZZZZ'},
        'RSI_COMBO_X': {'until': .53, 'after': .53, 'X': 'RSI_COMBO_XX'},
        'RSI_COMBO_XX': {'until': .55, 'after': .55, 'X': 'RSI_COMBO_XXX'},
        'RSI_COMBO_ZZX': {'until': .6, 'after': .6, 'X': 'RSI_COMBO_ZZXX'},
        'RRF_COMBO_ZZXFRONTX': {'until': .57, 'after': .57, 'X': 'RRF_COMBO_ZZXFRONTXX'},
        'RSI_DASH_COMBO_Z': {'until': .397, 'after': .397, 'Z': 'RSI_DASH_COMBO_ZZ', 'grounded': True},
        'RSI_DASH_JUMP_COMBO_Z': {'until': 9999, 'after': .2, 'Z': 'RSI_DASH_JUMP_COMBO_ZZ',
                                  'X': 'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX', 'grounded': False},
        'RRF_DASH_JUMP_COMBO_X': {'until': .39, 'after': .39, 'inclusiveAfter': True,
                                 'X': 'RRF_DASH_JUMP_COMBO_XX', 'grounded': False},
    }
    # 2016 EVENT_PROCESS_TIME means inputStart,inputEnd,stateChange according to
    # GUUser.h:250 and GUUser.cpp:13873. The callback-to-successor bindings below
    # are explicit candidates: the V5 tree includes 2026-edited XX callbacks whose
    # literal .5 windows and old state aliases do not match this target script.
    def candidate_chain(name, next_name, window_index=0, **extra):
        w = raw[name].get('EVENT_PROCESS_TIME' + str(window_index))
        if w is None:
            return
        combo_buffers[name] = {'from': w['1'], 'until': w['2'], 'after': w['3'], 'strictUntil': True,
                               'X': next_name, 'bindingEvidence': 'target-2016-window + callback-binding-candidate',
                               **extra}
    candidate_chain('RSI_OVER_TAKER_DASH_JUMP_COMBO_ZX_LANDING', 'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX')
    candidate_chain('RSI_OVER_TAKER_COMBO_XXfrontX', 'RSI_OVER_TAKER_COMBO_XXfrontXX')
    candidate_chain('RSI_OVER_TAKER_COMBO_XXfrontXX', 'RSI_OVER_TAKER_COMBO_XXfrontXX2')
    candidate_chain('RSI_OVER_TAKER_COMBO_XXfrontXX2', 'RSI_OVER_TAKER_COMBO_XXfrontXX3')
    candidate_chain('RSI_OVER_TAKER_COMBO_XXfrontXX3', 'RSI_OVER_TAKER_COMBO_XXfrontXX4')
    # The older source has no target 66ZX callback. Keep this user-requested
    # successor candidate separate from its unchanged 66ZZ timing window.
    dash_z_window = raw['RSI_DASH_COMBO_Z']['EVENT_PROCESS_TIME0']
    combo_buffers['RSI_DASH_COMBO_Z']['X'] = 'RSI_OVER_TAKER_DASH_COMBO_ZX'
    combo_buffers['RSI_DASH_COMBO_Z']['keyWindows'] = {'X': {
        'from': dash_z_window['1'], 'until': dash_z_window['2'], 'after': dash_z_window['3'],
        'strictUntil': True, 'grounded': True,
        'bindingEvidence': 'target2016 state/effect/window + user-requested 66ZX successor candidate; callback not acquired',
    }}
    return {
        'resourceOnlyEffectSets': resource_only_sets,
        'resourceOnlyEffectSetsEvidence': 'fixed-V5 Shadow_Buster FrameMove literal; no automatic target2016 state binding',
        'resourceOnlyTemplates': ['Flare_Raven_Overtaker_Sp1a_ChargedBolt02', *sorted(command_particle_assets)],
        'resourceOnlyTemplatesEvidence': 'fixed-V5 ChargedBolt .7 literal and pinned2026 XXdownX .3 CreateSequence literal; resource dependencies do not prove target2016 native triggers',
        'schemaVersion': 1, 'profileId': 'rf-2016-m3-research-v5',
        'target': {'region': 'Steam NA', 'build': 'V6.0420.5', 'unitType': 4, 'unitClass': 107, 'displayName': 'RF / Reckless Fist'},
        'validation': {'clientMeasured': False, 'fidelityGate': 'pending', 'simulationEvidence': 'independent from original baseline'},
        'presentation': {'cameraDynamic': False, 'skillCutIn': False, 'skillBarMode': 'eight', 'slotKeys': ['A','S','D','C','Q','W','E','R']},
        'physics': raw['INIT_PHYSIC'], 'body': raw['INIT_SYSTEM'], 'components': raw['INIT_COMPONENT'],
        'states': states, 'skillCatalog': catalog, 'clips': clip_info,
        'skillBranches': branch_provenance,
        'defaultPassiveSkillIds': sorted(row['skillId'] for row in catalog if row['defaultGranted']),
        'buffFactors': factors, 'buffFactorProvenance': factor_provenance,
        'buffTemplates': buffs, 'buffTemplateProvenance': buff_provenance,
        'effectSets': effect_sets,
        'enums': {k: enums['globals'][k] for k in ('EFFECT_SET_TIMER_TYPE', 'DELETE_CONDITION_EFFECT_SET', 'REACT_TYPE', 'DAMAGE_TYPE',
                    'BUFF_BEHAVIOR_TYPE', 'BUFF_FINALIZER_TYPE', 'BUFF_CHANGE_TYPE', 'BUFF_RELATION_TYPE', 'BUFF_DURATION_TIME_TYPE', 'BUFF_USE_COUNT_TYPE', 'SKILL_TYPE', 'MEMO_ID', 'ACTIVE_SKILL_USE_CONDITION')},
        'effectTemplates': {k: effect_assets[k] for k in sorted(main_names | command_particle_assets.keys()) if k in effect_assets},
        'damageEffects': {k: {'raw': damage['globals'][k], 'sourcePc': damage['locations'][k]} for k in sorted(damage_names) if k in damage['globals']},
        'referenceSemantics': {
            'evidence': 'reference-v5; target runtime unmeasured', 'commit': V5_COMMIT,
            'skillUseCondition': {'source': 'X2GUUser.cpp:6225-6287; X2SkillTree.h:61-68',
                'semantics': 'Caller state requests GROUND/AIR/ANYTIME category, not a direct template==1 grounded check',
                'groundRequestAllowsTemplate': [1,2,5], 'airRequestAllowsTemplate': [2,4],
                'anytimeRequestAllowsTemplate': [3,5], 'anytimeTemplate5RequiresOnSomethingFuture': True,
                'bindingEvidence': 'fixed-V5 source only; each target state cancel/call-site must be independently matched'},
            'awakening': {'applyAnimationTime': .83, 'orbsMax': 3, 'chargePerOrb': 100, 'onHitBase': 1, 'onReceivedBase': 2, 'powerMultiplier': 1.2},
            'core': {'gaugeMax': 100, 'gaugePerLevel': 20, 'activationGauge': 40, 'commandGainMultiplier': 4,
                     'specialMpGainDivisor': 3, 'prepareSeconds': .3, 'attackTimeoutSeconds': 1.2,
                     'projectileSpeed': 3600, 'damageByLevel': [2.2,4.4,6.6,8.8,11],
                     'guardDamageMultiplier': .25, 'guardGaugeCost': 20, 'guardSeconds': .5,
                     'recallHpPerGauge': .0005, 'recallMpPerGauge': 1},
            'comboBuffers': combo_buffers,
            'mechanicBindings': {
                'RSI_OVER_TAKER_DASH_JUMP_COMBO_ZXX': {
                    'effectSet': 'EffectSet_ROT_DASHJUMP_ZXX',
                    'animationTime': None, 'supported': False,
                    'evidence': 'No automatic effect-set binding. commands-recovery module executes separately pinned reconstructed2015 .31 CreateInstance with target2016 damage chain; target callback remains unconfirmed',
                },
            },
            'dashJumpHorizontalMultiplier': 1.6, 'dashJumpAdditionalGravityMultiplier': 1.2,
            'lineRadius': 30, 'lineCanDownDefault': True,
            'lineCanDownDefaultEvidence': 'reference-v5 KTDGLineMap.cpp:221 / KTDGLineMap.h:411',
        },
        'unsupported': [
            {'id': 'rf-ZZZX-binding', 'reason': '2016 declares RRF_COMBO_ZZZX with SI_SA_ROT_STIGMA_OF_PAIN, while V5 binds RSI_COMBO_ZZZX start/loop/finish callbacks. No target-native binding evidence; command is not substituted.'},
            {'id': 'rf-XX6-chain-binding', 'reason': 'commands-recovery compiles 2026 reconstructed2015 callbacks with target2016 event windows, including corrected forward/down routes and dual X/Down latches. Target2016 callback equivalence remains unconfirmed.'},
            {'id': 'rf-668ZXX-effect-binding', 'reason': 'commands-recovery compiles separately pinned reconstructed2015 .31 CreateInstance callback; target2016 moving parent creates FOUR children at .01/.11/.21/.31. Target2016 callback equivalence remains unconfirmed.'},
            {'id': 'rf-66ZX-binding', 'reason': 'Target2016 declares the armored rushing state and effects but older source lacks its successor callback. User-requested X successor uses target dash-Z EVENT_PROCESS_TIME0 as an explicit candidate.'},
            {'id': 'updown-cancel-target-binding', 'reason': '2016 UPDOWN_CANCEL_AFTER is retained and the user-reported ZZXX82 cancel maps it to grounded jump/drop. This reader field and callback are absent from the pinned older C++ reference; candidate behavior requires native target evidence.'},
            {'id': 'client-baseline', 'reason': 'No target-client input/output trace; M3 fidelity gate cannot pass.'},
            {'id': 'native-collision', 'reason': 'Source meshes are available; exact native collision and swept trace semantics require validation.'},
            {'id': 'damage-formula', 'reason': 'Prototype uses zero-defense base-stat formula; full target PvP normalization/rounding/critical/resistance is not confirmed.'},
            {'id': 'skill-traits', 'reason': 'Target two-choice traits restored across upgraded families. Fixed V5 AddSkillNoteTemplet_LUA consumes an incompatible older memo-item layout; target AddNewSkillNoteTemplet consumer is missing.'},
            {'id': 'reawakening-duration', 'reason': 'Initial awakening uses target2016 .7 duration ratio. Every reawakening adds one-bead time and two core levels at .83 by explicit user correction plus fixed-V5 additive consumers; initial core activation adds40 regardless of bead count in the acquired V5 source. Target24405 maximum-charge descriptor differs. Matching target2016 duration/initial-core/core-return consumer remains unsupported; raw-gauge HP/MP return uses a fixed-V5 float32 candidate.'},
            {'id': 'root-motion', 'reason': 'Target Bip01 keys drive prototype horizontal motion and original helper sampling; native interpolation and GetMotionOffset timing remain unmeasured.'},
            {'id': 'exploding-hand-critical-trigger', 'reason': 'Original named additional-hit effect and impact point execute; independent critical buff437 activation consumer remains unconfirmed.'},
            {'id': 'knockdown-meter', 'reason': 'Raw force-down values preserved, native threshold/reset/down-time not yet target verified.'},
            {'id': 'MP-regeneration', 'reason': 'Raw MP_CHANGE_RATE retained; no unverified regen rate enabled.'},
        ],
        'sources': {k: x['source'] for k,x in [('raven', raven),('skills',skills),('damage',damage),('effects',effects),('enum',enums)]},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache')
    parser.add_argument('--assets', type=Path, required=True)
    parser.add_argument('--native-source', type=Path, help='Hash-checked fixed V5 source snapshot; functions remain reference candidates')
    parser.add_argument('--output', type=Path, default=ROOT / 'packages/combat-core/rf-profile.json')
    args = parser.parse_args()
    result = build(args.cache, args.assets, args.native_source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes((json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
    print(json.dumps({'output': str(args.output), 'states': len(result['states']), 'skills': len(result['skillCatalog']), 'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
