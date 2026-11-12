"""Build LK from hash-checked target2016 declarations and original motion keys.

No source Lua/native callback is executed and no Raven data is substituted.
Canonical RSI common roles point to explicit Elsword source states; raw target
values stay intact. Native-only skill mechanisms retain unsupported records.
"""
from pathlib import Path
import argparse
import hashlib
import json
from rf_skill_catalog import buff_catalog, buff_templates, strings

ROOT = Path(__file__).resolve().parents[2]
ACTIVE = {
    900: ('ESSI_THROW_ITEM', 'RelationshipLove'),
    21026: ('ESSI_SI_A_MEGASLASH_MEMO_READY', 'MegaSlash'),
    21217: ('ESSI_SI_A_ES_ROLLING', 'Roll'),
    21027: ('ESSI_SI2_ES_FLAME_GEYSER', 'FlameGeyser'),
    21028: ('ESSI_SI3_ES_UNLIMITED_BLADE', 'UnlimitedBlade'),
    21029: ('ESSI_SI1_ES_ASSAULT_SLASH', 'AssaultSlash'),
    21219: ('ESSI_SI_A_ES_KICK', 'Kick'),
    21031: ('ESSI_SI2_ES_SPIRAL_BLAST', 'SpiralBlast'),
    21030: ('ESSI_SI3_ES_TRIPLE_GEYSER', 'TripleGeyser'),
    21218: ('ESSI_SI_A_ES_ENDURANCE', 'IronBody'),
    21034: ('ESSI_SA_ESK_MORTAL_BLOW', 'MortalBlow'),
    21203: ('ESSI_A_ELK_IMPACT_SMASH', 'ImpactSmash'),
    21204: ('ESSI_A_ESK_ARMOR_BREAK', 'ArmorBreak'),
    21007: ('ESSI_SA_ESK_DOUBLE_SLASH', 'DoubleSlash'),
    21008: ('ESSI_SI3_ES_ARMAGEDDON_BLADE', 'ArmageddonBlade'),
    21205: ('ESSI_A_ELK_ROLLING_SMASH_READY', 'RollingSmash'),
    21009: ('ESSI_SA_ELK_SAND_STORM', 'Sandstorm'),
    21010: ('ESSI_SA_ESK_WINDMILL_START', 'Windmill'),
    21206: ('ESSI_REVENGE_WAIT', 'CounterAttack'),
    21011: ('ESSI_SA_ELK_SONIC_BLADE', 'SonicBlade'),
    21603: ('ESSI_HA_ELK_GIGANTIC_SLASH', 'GiganticSlash'),
}
FOLLOWUP = {
    21026: ['ESSI_SI_A_MEGASLASH_MEMO_CHARGE', 'ESSI_SI_A_MEGASLASH_MEMO_FIRE'],
    21217: ['ESSI_SI_A_ES_ROLLING_END'],
    21028: ['ESSI_SI3_ES_UNLIMITED_BLADE_HYPER'],
    21219: ['ESSI_SI_A_ES_FULL_CHARGE_KICK'],
    21218: ['ESSI_SI_A_ES_ENDURANCE_HYPER'],
    21205: ['ESSI_A_ELK_ROLLING_SMASH', 'ESSI_A_ELK_ROLLING_SMASH_LANDING'],
    21010: ['ESSI_SA_ESK_WINDMILL', 'ESSI_SA_ESK_WINDMILL_END'],
    21206: ['ESSI_REVENGE_ATTACK'],
}
PASSIVE_STATES = ['ESSI_SI_P_ESK_AUTO_GUARD', 'ESSI_SI_P_ESK_AUTO_GUARD_SMALL',
    'ESSI_SI_P_ESK_AUTO_GUARD_END', 'ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL']
COMMON = [
    'WAIT', 'WALK', 'DASH', 'DASH_END', 'JUMP_READY', 'JUMP_UP', 'JUMP_DOWN',
    'JUMP_LANDING', 'DASH_JUMP', 'DASH_JUMP_LANDING', 'DASH_JUMP_POWER_LANDING',
    'HYPER_MODE', 'DIE_FRONT', 'DIE_BACK', 'DAMAGE_GROGGY', 'DAMAGE_SMALL_FRONT', 'DAMAGE_SMALL_BACK',
    'DAMAGE_BIG_FRONT', 'DAMAGE_BIG_BACK', 'DAMAGE_DOWN_FRONT', 'DAMAGE_DOWN_BACK',
    'DAMAGE_STANDUP_FRONT', 'DAMAGE_STANDUP_BACK', 'DAMAGE_AIR_SMALL',
    'DAMAGE_AIR_DOWN', 'DAMAGE_AIR_DOWN_INVINCIBLE', 'DAMAGE_AIR_DOWN_LANDING',
    'DAMAGE_AIR_FALL', 'DAMAGE_AIR_UP', 'DAMAGE_AIR_FLY_FRONT', 'DAMAGE_AIR_FLY_BACK',
    'STANDUP_ATTACK_FRONT', 'STANDUP_ATTACK_BACK', 'DAMAGE_REVENGE',
]
ALIASES = {'RSI_' + role: 'ESSI_' + role for role in COMMON}
ALIASES.update({
    'RSI_COMBO_Z': 'ESSI_COMBO_Z1', 'RSI_COMBO_ZZ': 'ESSI_COMBO_Z2',
    'RSI_COMBO_ZZZ': 'ESSI_COMBO_Z3', 'RSI_COMBO_ZZZZ': 'ESSI_COMBO_Z4',
    'RSI_COMBO_X': 'ESSI_COMBO_X1', 'RSI_COMBO_XX': 'ESSI_COMBO_X2',
    'RSI_COMBO_XXX': 'ESSI_ELK_XXX',
    'RSI_DASH_COMBO_Z': 'ESSI_DASH_COMBO_Z1', 'RSI_DASH_COMBO_ZZ': 'ESSI_KNIGHT_DASH_COMBO_Z2',
    'RSI_DASH_COMBO_X': 'ESSI_DASH_ATTACK_X',
    'RSI_JUMP_COMBO_Z': 'ESSI_JUMP_ATTACK_Z', 'RSI_JUMP_COMBO_X': 'ESSI_JUMP_ATTACK_X',
    'RSI_DASH_JUMP_COMBO_Z': 'ESSI_DASH_JUMP_COMBO_Z1',
    'RSI_DASH_JUMP_COMBO_ZZ': 'ESSI_DASH_JUMP_COMBO_Z2',
    'RSI_DASH_JUMP_COMBO_X': 'ESSI_DASH_JUMP_COMBO_X1',
})
COMMANDS = {'groundZ': 'RSI_COMBO_Z', 'groundX': 'RSI_COMBO_X',
    'dashZ': 'RSI_DASH_COMBO_Z', 'dashX': 'RSI_DASH_COMBO_X',
    'jumpZ': 'RSI_JUMP_COMBO_Z', 'jumpX': 'RSI_JUMP_COMBO_X',
    'dashJumpZ': 'RSI_DASH_JUMP_COMBO_Z', 'dashJumpX': 'RSI_DASH_JUMP_COMBO_X'}
SPECIFIC_COMMANDS = [
    'ESSI_COMBO_Z4a', 'ESSI_COMBO_X3a', 'ESSI_ELK_XXXX', 'ESSI_ELK_XXXXX',
    'ESSI_ELK_ZZZfrontZ', 'ESSI_KNIGHT_DASH_COMBO_Z3', 'ESSI_KNIGHT_DASH_COMBO_Z3a',
    'ESSI_ESK_DASH_COMBO_ZChargeX', 'ESSI_ESK_DASH_COMBO_ZX', 'ESSI_ESK_DASH_COMBO_ZXX',
    'ESSI_ELK_DASH_COMBO_XChargeX', 'ESSI_ELK_DASH_COMBO_XX', 'ESSI_ELK_DASH_COMBO_XXX',
    'ESSI_ESK_DASH_JUMP_ZZZ', 'ESSI_ESK_DASH_JUMP_ZZZ_LANDING',
    'ESSI_DASH_JUMP_COMBO_Z3', 'ESSI_DASH_JUMP_COMBO_Z3_LANDING',
    'ESSI_DASH_JUMP_COMBO_X2', 'ESSI_DASH_JUMP_COMBO_X2_LANDING',
    'ESSI_KNIGHT_DASH_JUMP_COMBO_X2', 'ESSI_KNIGHT_DASH_JUMP_COMBO_X3',
    'ESSI_ELK_START', 'ESSI_ELK_WIN', 'ESSI_ELK_WIN2', 'ESSI_ELK_LOSE', 'ESSI_ELK_LOSE2',
    'ESSI_START_INTRUDE', 'ESSI_DESTRUCTION_RAGE', 'ESSI_SWORD_WAIT',
]


def build(cache, assets, bindings=None):
    # Elsword professions share declaration parsing, closures and common skills.
    # Only explicit profession bindings select class-owned states and tree rows.
    configuration = None
    if bindings is not None and not isinstance(bindings, dict):
        configuration = bindings
        b = {'active': configuration.ACTIVE, 'followup': configuration.FOLLOWUP,
             'aliases': configuration.ALIASES, 'specific': configuration.SPECIFIC_COMMANDS,
             'passiveStates': configuration.PASSIVE_STATES, 'classId': configuration.UNIT_CLASS,
             'classes': configuration.CLASSES, 'profession': configuration.PROFESSION,
             'label': configuration.DISPLAY_NAME, 'poseKey': configuration.POSE_CLASS,
             'buffFactorIds': getattr(configuration, 'BUFF_FACTOR_IDS', [])}
    else:
        b = bindings or {}
    active, followup = b.get('active', ACTIVE), b.get('followup', FOLLOWUP)
    aliases, commands = b.get('aliases', ALIASES), b.get('commands', COMMANDS)
    specific, passive_states = b.get('specific', SPECIFIC_COMMANDS), b.get('passiveStates', PASSIVE_STATES)
    class_id, classes = b.get('classId', 100), b.get('classes', (1, 10, 100))
    profession, label = b.get('profession', 'lk'), b.get('label', 'LK / Lord Knight')
    pose_key = b.get('poseKey', 'ELSWORD_LORD_KNIGHT')
    def read(name):
        return json.loads((cache / (name + '-declarations.json')).read_text('utf-8'))
    unit, skills, damage, effects, enum, notes, power, sword = [read(k) for k in
        ('elsword', 'skill', 'damage', 'effect', 'enum', 'skill-note', 'skill-data', 'way-of-sword')]
    raw = unit['globals']
    clip_path = assets / 'clips.json'
    if not clip_path.exists(): clip_path = assets / 'source-proof/clips.json'
    clips = json.loads(clip_path.read_text('utf-8'))
    clip_info = {c['name']: {k:c[k] for k in ('durationSeconds', 'durationTicks',
        'ticksPerSecond', 'sourceName', 'decodedKeysSha256')} for c in clips}
    templates = {c['args'][-1]['m_eID']: c['args'][-1] for c in skills['nativeCalls']
        if c['target'].endswith('AddSkillTemplet_LUA') and isinstance(c['args'][-1], dict) and 'm_eID' in c['args'][-1]}
    nodes = [c['args'][-1] for c in skills['nativeCalls']
        if c['target'].endswith('AddSkillTreeTemplet_LUA') and c['args'][-1].get('m_eUnitClass') == class_id]
    owned = {n['m_iSkillID'] for n in nodes}
    replaced = {templates[i].get('m_DeleteSkillIDByUpgrade') for i in owned}
    power_tables = {c['args'][-1]['m_eID']: c['args'][-1]['m_Value'] for c in power['nativeCalls']
        if c['target'].endswith('AddSkillPowerRate_LUA')}
    catalog = []
    for n in nodes:
        sid, t = n['m_iSkillID'], templates[n['m_iSkillID']]
        level, passive = n['m_iMasterLevel'], t.get('m_eActiveSkillUseCondtion', 0) == 0 or sid in b.get('passiveIds', ())
        family, cursor = [sid], sid
        while templates[cursor].get('m_DeleteSkillIDByUpgrade'):
            cursor = templates[cursor]['m_DeleteSkillIDByUpgrade']
            if cursor in family: raise ValueError('Cyclic skill replacement')
            family.append(cursor)
        branches = []
        for c in notes['nativeCalls']:
            if not c['target'].endswith('AddNewSkillNoteTemplet'): continue
            entry = c['args'][-1]
            if entry.get('UNIT_CLASS') not in classes: continue
            for ordinal, positions in entry.get('MEMO_LIST', {}).items():
                if positions['2'] in family:
                    memo_name=next(k for k,v in enum['globals']['MEMO_ID'].items() if v == positions['1'])
                    limitations={'MI_USEFUL':['additional-hit-count: original consumer unavailable; declared per-hit damage modifier executes, original hit schedule retained'],
                        'MI_CRITICAL':['defensive-effect-bypass: unavailable; cost and IGNORE_DEFENCE flag execute, no fabricated core-guard/passive bypass']} .get(memo_name,[])
                    branches.append({'id':'memo-' + str(positions['3']), 'memoId':positions['3'],
                        'memoType':positions['1'], 'memoTypeName':memo_name,
                        'originalSkillId':positions['2'], 'unitClass':entry['UNIT_CLASS'],
                        'parameters':[positions[k] for k in sorted(positions,key=int) if int(k)>=4],
                        'rawPositions':positions,'ordinal':int(ordinal),'selectable':True,'supported':not limitations,
                        'supportStatus':'partial-target-adapter' if limitations else 'target-declaration-adapter; V6-native-consumer-unverified',
                        'limitations':limitations,
                        'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']}})
        if len(branches) not in (0, 2): raise ValueError('Unexpected target branch count: '+str(sid))
        state, executor = active.get(sid, (None, None))
        states = ([state] + followup.get(sid, [])) if state else []
        if any(k not in raw for k in states): raise ValueError('Missing target skill state: '+str(states))
        direct = state is not None and sid != 900
        catalog.append({'skillId':sid,'name':t.get('m_wstrName'),'unitClass':class_id,'maxLevel':level,
            'maxLevelEvidence':'target2016 AddSkillTreeTemplet_LUA.m_iMasterLevel',
            'topTier':sid not in replaced,'replacesSkillId':t.get('m_DeleteSkillIDByUpgrade'),
            'limitations':(['hold-extension: base 2.1 seconds executes; target description says +2.8 seconds, additional MP amount and held-key consumer are unavailable'] if sid==21010 else []),
            'passive':passive,'type':t.get('m_eType'),'useCondition':t.get('m_eActiveSkillUseCondtion'),
            'mpCost':t.get('m_MPConsumption',{}).get(str(level)),
            'cooldown':t.get('m_SkillCoolTime',{}).get(str(level)),
            'powerRateType':t.get('m_ePowerRate'),
            'levelPowerRate':power_tables.get(t.get('m_ePowerRate'),{}).get(str(level)),
            'powerMultiplier':t.get('SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE',{}).get(str(level),1),
            'powerMultiplierEvidence':'target positive strengthened field, applied once using the existing RF target-data adapter; target executable unmeasured',
            'strengtheningPowerRate':{'rawValue':t.get('SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE',{}).get(str(level)),
                'supported':True,'executionPolicy':'positive target multiplier, separate from level curve'},
            'state':state,'executor':executor,'states':states,'supported':direct,
            'supportStatus':'target-declaration-generic-executor-candidate' if direct else 'target-data; native-controlflow-consumer-required',
            'fidelityVerified':False,'selectable':sid not in replaced and not passive,
            'slotEligible':not passive,'defaultGranted':sid not in replaced and passive,
            'branches':branches,'branchStatus':'target2016-raw-trait; native-consumer-unavailable','raw':t,'treeNode':n})
    pose_lists=raw['INIT_COMMON_RANDOM_STATE'][pose_key]
    chosen = set(aliases.values()) | set(specific) | set(passive_states) | {k for c in catalog for k in c['states']}
    chosen.update(v for group in pose_lists.values() for v in group.values() if isinstance(v,str))
    states = {}
    for name in sorted(chosen):
        value = raw[name]; animation = value.get('ANIM_NAME') or ({'ESSI_WAIT':'Wait','ESSI_SWORD_WAIT':'Wait_W0'}.get(name))
        if animation not in clip_info: raise ValueError('Target state animation unavailable: '+name+'/'+str(animation))
        states[name] = {'raw':value,'sourceState':name,'animationName':animation,'clip':clip_info[animation],
            'rootMotion':next((c.get('rootMotion') for c in clips if c['name']==animation),None),
            'sourcePc':unit['locations'][name],
            'defaultAnimationEvidence':('fixedV5 SwordMan PlayAnimationSwordWaitStart chooses Wait_W0/Wait_W1 by sword state; runtime binding owns the alternate'
                if name=='ESSI_SWORD_WAIT' else 'common-Wait-name adapter; target ANIM_NAME absent') if not value.get('ANIM_NAME') else 'target2016'}
    for role, source in aliases.items(): states[role] = {**states[source],'stateRole':role,'sourceState':source}
    pvp_poses={}
    for kind,group in [('start','START_STATE_LIST'),('win','WIN_STATE_LIST'),('lose','LOSE_STATE_LIST')]:
        entries=pose_lists[group]
        pvp_poses[kind]=[{'state':entries[str(i)],'weight':entries[str(i+1)],
            'animationName':states[entries[str(i)]]['animationName'],
            'duration':states[entries[str(i)]]['clip']['durationSeconds']/raw[entries[str(i)]].get('ANIM_SPEED',1),
            'durationEvidence':'source animation period / target ANIM_SPEED; simulation pose adapter, not client state-end measurement'}
            for i in range(1,len(entries)+1,2)]
    all_sets = {c['args'][-1]['NAME']:{'raw':c['args'][-1], 'sourcePc':{'prototype':c['prototype'],'instruction':c['instruction']}}
        for c in effects['nativeCalls'] if c['target'].endswith('AddEffectSetTemplet_LUA') and isinstance(c['args'][-1],dict) and c['args'][-1].get('NAME')}
    effect_sets, damage_effects, pending, seen = {}, {}, list(strings(states)) + (configuration.RESOURCE_ROOTS if configuration else []), set()
    while pending:
        name=pending.pop()
        if name in seen: continue
        seen.add(name)
        if name in all_sets:
            effect_sets[name]=all_sets[name];pending.extend(strings(all_sets[name]))
        if name in damage['globals']:
            damage_effects[name]={'raw':damage['globals'][name],'sourcePc':damage['locations'][name]}
            pending.extend(strings(damage['globals'][name]))
    import sys
    sys.path.insert(0,str(ROOT/'tools/assets/character'))
    from build_rf_fx import explicit_template_references
    resource_only_templates=sorted(set(explicit_template_references(states)))
    sword_factor_ids = {k:enum['globals']['BUFF_FACTOR_ID'][k] for k in getattr(configuration, 'WAY_FACTOR_KEYS', (
        'BFI_BUFF_GALE_WAY_OF_SWORD','BFI_BUFF_ANNIHILATION_WAY_OF_SWORD','BFI_BUFF_ANNIHILATION_WAY_OF_SWORD_PVP'))}
    factors, factor_provenance = buff_catalog(cache,[states,catalog,damage_effects,
        {'BUFF_FACTOR_ID':{str(i+1):v for i,v in enumerate([*sword_factor_ids.values(),*b.get('buffFactorIds',[])])}}])
    buffs, buff_provenance = buff_templates(cache,[states,catalog,damage_effects,factors])
    # Buff display sets and literal native callback sets are real source roots.
    # They were omitted by the first LK builder's state-only closure.
    pending = list(strings(buffs)) + list(getattr(configuration, 'CALLBACK_ROOTS', ['EffectSet_ELSWORD_WINDMILL',
        'EffectSet_ELSWORD_WINDMILL_LAND', 'EffectSet_ES_ROLLING', 'DamageEffect_SA_Elsword_MegaSlash_Damage',
        'EffectSet_VigorStart', 'EffectSet_VigorEnd', 'EffectSet_DestructionStart', 'EffectSet_DestructionEnd',
        'ELSWORD_ANGRY_WIND'])) + b.get('callbackRoots', [])
    while pending:
        name=pending.pop()
        if name in seen: continue
        seen.add(name)
        if name in all_sets:
            effect_sets[name]=all_sets[name];pending.extend(strings(all_sets[name]))
        if name in damage['globals']:
            damage_effects[name]={'raw':damage['globals'][name],'sourcePc':damage['locations'][name]}
            pending.extend(strings(damage['globals'][name]))
    result = {'schemaVersion':1,'profileId':profession+'-target2016-v1','professionId':profession,
        'target':{'region':'Steam NA','build':'V6.0420.5','unitType':getattr(configuration, 'UNIT_TYPE', 1),'unitClass':class_id,'displayName':label},
        'validation':{'clientMeasured':False,'fidelityGate':'pending','simulationEvidence':'independent from original baseline'},
        'presentation':{'cameraDynamic':False,'skillCutIn':False,'skillBarMode':'eight','slotKeys':['A','S','D','C','Q','W','E','R'],
            'pvpPoses':pvp_poses,'pvpPosesEvidence':'target2016 INIT_COMMON_RANDOM_STATE.'+pose_key+' weights and source animation bindings'},
        'physics':raw['INIT_PHYSIC'],'body':raw['INIT_SYSTEM'],'components':raw['INIT_COMPONENT'],
        'states':states,'stateAliases':aliases,'skillCatalog':catalog,'clips':clip_info,
        'defaultPassiveSkillIds':[c['skillId'] for c in catalog if c['defaultGranted']],
        'buffFactors':factors,'buffFactorProvenance':factor_provenance,'buffTemplates':buffs,'buffTemplateProvenance':buff_provenance,
        'effectSets':effect_sets,'damageEffects':damage_effects,'effectTemplates':{},
        'resourceOnlyTemplates':resource_only_templates,
        'resourceOnlyTemplatesEvidence':'target2016 literal PARTICLE_NAME/MAIN_EFFECT_NAME fields from state declarations; collection adds no guessed gameplay trigger',
        'skillBranches':{'status':'target2016-static-adapter; target-native-consumer-unverified','source':notes['source'],'allowedClasses':list(classes),
            'powerRateTables':{str(k):{'values':v} for k,v in power_tables.items()},'powerRateSource':power['source']},
        'enums':{k:enum['globals'][k] for k in ('EFFECT_SET_TIMER_TYPE','DELETE_CONDITION_EFFECT_SET','REACT_TYPE','DAMAGE_TYPE','ATTACK_TYPE',
            'BUFF_BEHAVIOR_TYPE','BUFF_FINALIZER_TYPE','BUFF_CHANGE_TYPE','BUFF_RELATION_TYPE','BUFF_DURATION_TIME_TYPE','BUFF_USE_COUNT_TYPE','SKILL_TYPE','MEMO_ID','ACTIVE_SKILL_USE_CONDITION')},
        'referenceSemantics':{'commandStates':commands,'comboBuffers':{},'mechanicBindings':{},
            'wayOfSword':{'targetFields':sword['globals']['WAY_OF_SWORD'],'source':sword['source'],
                'targetBuffFactorIds':sword_factor_ids,
                'status':'target2016-raw-fields; native-controlflow-binding-separate'},
            'awakening':{'applyAnimationTime':.83,'orbsMax':3,'chargePerOrb':100,
                'onHitBase':1,'onReceivedBase':2,'powerMultiplier':1.2,
                'evidence':'shared fixedV5 GUUser awakening consumers; target2016 native callback unmeasured'},
            'lineRadius':30,'lineCanDownDefault':True,
            'lineCanDownDefaultEvidence':'fixedV5 KTDGLineMap.cpp:221/KTDGLineMap.h:411; shared reference adapter, target2016 native unmeasured',
            'dashJumpHorizontalMultiplier':1.6,'dashJumpAdditionalGravityMultiplier':1.2,
            'commonConsumerEvidence':'Shared fixedV5 movement/collision/awakening consumer candidates previously frozen in RF contracts; class physics uses only Elsword target2016',
            'evidence':'common simulation executor adapter; no target native runtime measurements'},
        'unsupported':[{'id':k,'reason':v} for k,v in {
            'kick-charge-animation':'Target READY/CHARGE declarations refer to SI_A_ESK_KICK_READY/CHARGE absent from four original motion files; simple target Kick state retained, charge path not substituted',
            'skill-traits':'Two MI_USEFUL additional-hit schedules and two MI_CRITICAL defensive-effect bypasses remain partial; inspect branch limitations',
            'windmill-hold':'Target extra-duration description lacks numeric MP amount; qualified fixed source implements only base duration, no held-key path',
            'consumer-version':'LK callbacks combine target declarations with qualified fixedV5 references and explicit target-description adapters; no matching target executable trace',
            'client-baseline':'No target2016 runtime trace or native GPU comparison; do not call this 1:1',
            'native-collision':'Original weapon line and feet sphere helpers preserved; native swept intersection still unmeasured',
        }.items()],
        'sources':{k:d['source'] for k,d in [('elsword',unit),('skill',skills),('damage',damage),('effect',effects),('enum',enum),('skill-note',notes),('skill-data',power),('way-of-sword',sword)]}}
    if configuration:
        result['unsupported']=[row for row in result['unsupported'] if row['id'] not in ('kick-charge-animation','windmill-hold')]
        result['resourceOnlyTemplates']=sorted(set(resource_only_templates+configuration.VISUAL_ROOTS))
    fx_path=assets/'fx/index.json'
    if fx_path.is_file():
        fx=json.loads(fx_path.read_text('utf8'))
        for name,template in fx['templates'].items():
            initial={e['property']:e['value'] for e in template['events'] if e['start']==0 and not e['fade']}
            result['effectTemplates'][name]={**template,'initialSize':initial.get('Size'),
                'initialVelocity':initial.get('Velocity'),'initialDirSpeed':initial.get('DirSpeed'),
                'initialAnimation':{'name':initial['AniName']['animation'],'playback':initial['AniName']['playback']} if 'AniName' in initial else None,
                'missingExplicitTickRate':template.get('animationMissingTickRate',False)}
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--assets',type=Path,default=ROOT/'artifacts/lk')
    p.add_argument('--output',type=Path,default=ROOT/'packages/combat-core/lk-profile.json')
    a=p.parse_args();result=build(a.cache,a.assets);a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'states':len(result['states']),'skills':len(result['skillCatalog']),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
if __name__=='__main__':main()
