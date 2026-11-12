"""Explicit target2016 Elesis identities, skill entry states and command roles."""
from types import SimpleNamespace
from build_lk_profile import COMMON

JOBS = {'gm': (120, 29, 'ELESIS_GRAND_MASTER', 'GM / Grand Master', ('SSK', 'SGM')),
        'bh': (121, 30, 'ELESIS_BLAZING_HEART', 'BH / Blazing Heart', ('SPK', 'SBH')),
        'ca': (125, 35, 'ELESIS_CRIMSON_AVENGER', 'CA / Crimson Avenger', ('SDK', 'SCA'))}
COMMON_ACTIVE = {
    900: ('ESI_THROW_ITEM', 'RelationshipLove'),
    28026: ('ESI_SI_SA_SSK_SPIRAL_BLAST', 'ElesisSpiralBlast'),
    28217: ('ESI_SI_A_EL_DODGE_AND_SLASH', 'ElesisDodgeAndSlash'),
    28027: ('ESI_SI_SA_EL_WILD_SHOCK', 'ElesisWildShock'),
    28028: ('ESI_SI_SA_EL_MEGA_BURSTER', 'ElesisMegaBuster'),
    28029: ('ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_READY', 'ElesisSonicAssault'),
    28030: ('ESI_SI_SA_EL_UNLIMITED_BLADE', 'ElesisUnlimitedBlade'),
    28218: ('ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE', 'ElesisIronBody'),
}
ACTIVE = {
    'gm': {28219: ('ESI_SI_A_EL_RUSHING_SWORD', 'ElesisRushingSword'),
        28033: ('ESI_SI_SA_SSK_EXTINCTION_START', 'ElesisExtinction'),
        28036: ('ESI_SA_SGM_CRITICAL_DIVE', 'ElesisCriticalDive'),
        28203: ('ESI_SI_A_SSK_POWER_BREAK', 'ElesisPowerBreak'),
        28204: ('ESI_SI_A_EL_LEAP_CRASH', 'ElesisLeap'),
        28007: ('ESI_SI_SA_SSK_JUDGEMENT_DRIVE', 'ElesisSwordOfJudgement'),
        28008: ('ESI_SI_SA_SSK_VICTORIOUS_SWORD', 'ElesisSwordOfVictory'),
        28205: ('ESI_A_SGM_PROVOKE', 'ElesisProvoke'),
        28009: ('ESI_SA_SGM_WAR_PRELUDE', 'ElesisWarPrelude'),
        28010: ('ESI_SA_SGM_JUGGERNAUT_BUSTER_START', 'ElesisJuggernautBuster'),
        28206: ('ESI_A_SGM_DRASTIC_CHARGE_START', 'ElesisDrasticCharge'),
        28011: ('ESI_SA_SGM_SONIC_BLADE', 'ElesisSonicBlade'),
        28603: ('ESI_HA_SGM_SWORD_OF_RELICS', 'ElesisSwordOfRelics')},
    'bh': {28220: ('ESI_SI_A_SPK_BIG_BURST', 'ElesisExplosiveFist'),
        28034: ('ESI_SI_SA_SPK_SWORDFIRE', 'ElesisSwordFire'),
        28037: ('ESI_SI_SA_SBH_SCALDIC_SWORD', 'ElesisScaldicSword'),
        28208: ('ESI_SI_A_SPK_AVATAR_OF_THE_FIRE', 'ElesisAvatarOfFire'),
        28209: ('ESI_SI_A_SBH_FIREWORKS', 'ElesisFireplay'),
        28014: ('ESI_SI_SA_SPK_INFERNAL_BLADE', 'ElesisInfernalBlade'),
        28015: ('ESI_SI_SA_SPK_ETERNAL_FIRE', 'ElesisEternalFire'),
        28210: ('ESI_SI_A_SBH_FLAME_SWORD', 'ElesisRedLotusSword'),
        28016: ('ESI_SI_SA_SBH_BLAZING_DANCE_START', 'ElesisBlazingDance'),
        28017: ('ESI_SI_SA_SBH_BLAZE_WING', 'ElesisBlazingWing'),
        28211: ('ESI_SI_A_SBH_SCALET_ROSE', 'ElesisFlameRose'),
        28018: ('ESI_SI_SA_SBH_WALL_OF_PROMINENCE', 'ElesisFireWall'),
        28604: ('ESI_SI_HA_SBH_ANCIENT_FIRE', 'ElesisAncientFire')},
    'ca': {28221: ('SI_A_SDK_DARK_WAVE', 'ElesisDarkWave'),
        28035: ('SI_SA_SDK_EJECTION_BUSTER_CHARGE', 'ElesisEjectionBuster'),
        28038: ('SI_SA_SDK_BRUTAL_CUTTER', 'ElesisBrutalCutter'),
        28213: ('SI_A_SDK_INJECTION_STIGMA', 'ElesisInjectionStigma'),
        28214: ('SI_A_SCA_SHADE_SCRATCH', 'ElesisShadeScratch'),
        28021: ('SI_SA_SDK_BURNING_PHANTOM_READY', 'ElesisBurningPhantom'),
        28022: ('SI_SA_SDK_BRANDISH_BREAKER_START', 'ElesisBrandishBreaker'),
        28215: ('SI_A_SCA_SHADOW_EDGE', 'ElesisShadowEdge'),
        28023: ('SI_SA_SCA_BLOOD_CUTTER', 'ElesisBloodCutter'),
        28024: ('SI_SA_SCA_SHADE_THE_ILLUSION', 'ElesisShadeIllusion'),
        28216: ('SI_A_SCA_ASSAULT_STRIKE', 'ElesisAssaultStrike'),
        28025: ('SI_SA_SCA_DREAD_WEAPON_START', 'ElesisDreadWeapon'),
        28605: ('SI_HA_SCA_FATE_SMASHER', 'ElesisFateSmash')},
}
FOLLOWUPS = {
    28217: ['ESI_SI_A_EL_DODGE_AND_SLASH_BACK', 'ESI_SI_A_EL_DODGE_AND_SLASH_ATTACK_Z'],
    28029: ['ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_CHARGE', 'ESI_SI_A_EL_SONIC_ASSAULT_STING_MEMO_FIRE'],
    28218: ['ESI_SA_A_EL_ENDURANCE_POWER_ACTIVE_MEMO'],
    28219: ['ESI_SI_A_EL_RUSHING_SWORD_2nd', 'ESI_SI_A_EL_RUSHING_SWORD_3rd'],
    28033: ['ESI_SI_SA_SSK_EXTINCTION_CHARGE', 'ESI_SI_SA_SSK_EXTINCTION_DEGREE', 'ESI_SI_SA_SSK_EXTINCTION_ATTACK'],
    28036: ['ESI_SA_SGM_CRITICAL_DIVE_HIT'],
    28204: ['ESI_SI_A_EL_LEAP_CRASH_JUMP', 'ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING'],
    28007: ['ESI_SI_SA_SSK_JUDGEMENT_DRIVE_FINAL'],
    28205: ['ESI_A_SGM_PROVOKE_REVENGE'],
    28010: ['ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP', 'ESI_SA_SGM_JUGGERNAUT_BUSTER_LOOP_LAST', 'ESI_SA_SGM_JUGGERNAUT_BUSTER_END'],
    28206: ['ESI_A_SGM_DRASTIC_CHARGE_LOOP', 'ESI_A_SGM_DRASTIC_CHARGE_END'],
    28034: ['ESI_SI_SA_SPK_SWORDFIRE_FLY', 'ESI_SI_SA_SPK_SWORDFIRE_GROUND'],
    28210: ['ESI_SI_A_SBH_FLAME_SWORD_FINISH'],
    28016: ['ESI_SI_SA_SBH_BLAZING_DANCE_1ST', 'ESI_SI_SA_SBH_BLAZING_DANCE_ATTACK_BACK', 'ESI_SI_SA_SBH_BLAZING_DANCE_ATTACK_FRONT', 'ESI_SI_SA_SBH_BLAZING_DANCE_FINISH'],
    28211: ['ESI_SI_A_SBH_SCALET_ROSE_SUCCESS'],
    28035: ['SI_SA_SDK_EJECTION_BUSTER_ATTACK'],
    28214: ['SI_A_SCA_SHADE_SCRATCH_ATTACK'],
    28021: ['SI_SA_SDK_BURNING_PHANTOM_START', 'SI_SA_SDK_BURNING_PHANTOM_LOOP', 'SI_SA_SDK_BURNING_PHANTOM_END'],
    28022: ['SI_SA_SDK_BRANDISH_BREAKER_LOOP', 'SI_SA_SDK_BRANDISH_BREAKER_FINISH'],
    28025: ['SI_SA_SCA_DREAD_WEAPON_LOOP', 'SI_SA_SCA_DREAD_WEAPON_END'],
}
ALIASES = {'RSI_'+role: 'ESI_'+role for role in COMMON}
ALIASES.update({'RSI_'+role: 'ESI_'+role for role in (
    'COMBO_Z', 'COMBO_ZZ', 'COMBO_ZZZ', 'COMBO_ZZZZ', 'COMBO_X', 'COMBO_XX', 'COMBO_XXX',
    'DASH_COMBO_Z', 'DASH_COMBO_ZZ', 'DASH_COMBO_X', 'DASH_JUMP_COMBO_Z', 'DASH_JUMP_COMBO_ZZ', 'DASH_JUMP_COMBO_X')})
ALIASES.update({'RSI_JUMP_COMBO_Z': 'ESI_JUMP_ATTACK_Z', 'RSI_JUMP_COMBO_X': 'ESI_JUMP_ATTACK_X'})


def bindings(job, raw, resource_roots=(), visual_roots=()):
    class_id, first, pose, label, codes = JOBS[job]
    active = {**COMMON_ACTIVE, **ACTIVE[job]}
    selected = []
    for name, value in raw.items():
        if not isinstance(value, dict) or not value.get('ANIM_NAME'): continue
        if not name.startswith(('ESI_', 'SI_')) or 'RIDING' in name or 'PEPPER' in name: continue
        if name == 'ESI_BERSERK_MODE': continue  # absent BoostPower_Front; unused by this PvP binding
        if job != 'gm' and 'QUICK_STANDUP' in name and 'ADVANCED' in name: continue
        foreign = any('_'+code+'_' in name for code in ('SSK','SGM','SPK','SBH','SDK','SCA') if code not in codes)
        if foreign and name != 'ESI_SI_SA_SSK_SPIRAL_BLAST': continue
        # Original common Rushing Sword and Leap belong to the GM tree only.
        if job != 'gm' and any(x in name for x in ('RUSHING_SWORD', 'LEAP_CRASH')): continue
        selected.append(name)
    aliases = dict(ALIASES)
    aliases['ESSI_SWORD_WAIT'] = 'ESI_SWORD_WAIT'
    if job == 'gm': aliases['RSI_DASH_COMBO_ZZ'] = 'ESI_DASH_COMBO_SSK_ZZ'
    if job == 'bh':
        aliases['RSI_DASH_COMBO_ZZ'] = 'ESI_DASH_COMBO_SPK_ZZ'
        aliases['RSI_DASH_COMBO_X'] = 'ESI_DASH_COMBO_SBH_X'
        # Fixed EL3646-3652 registers a separate repeat runtime state against
        # the same original XZ Lua table. The shared compiler copies that
        # table/clip/sourceState; do not create or change a target declaration.
        aliases['ESI_DASH_JUMP_COMBO_SPK_XZ_REATTACK'] = 'ESI_DASH_JUMP_COMBO_SPK_XZ'
    if job == 'ca':
        aliases['RSI_DASH_COMBO_ZZ'] = 'ESI_DASH_COMBO_SCA_ZZ'
        aliases['RSI_COMBO_XX'] = 'ESI_COMBO_SDK_XX'
        aliases['RSI_COMBO_XXX'] = 'ESI_COMBO_SDK_XXX'
    factors = ['BFI_BUFF_GALE_WAY_OF_SWORD', 'BFI_BUFF_ANNIHILATION_WAY_OF_SWORD',
               'BFI_BUFF_ANNIHILATION_WAY_OF_SWORD_PVP', 'BFI_BUFF_ANNIHILATION_SUPER_ARMOR', 'BFI_BUFF_GALE_MP_GAIN_INCREASE',
               'BFI_BUFF_ENDURANCE_POWER_PVP', 'BFI_BUFF_SUPER_ARMOR', 'BFI_ELESIS_ENDURANCE_MEMO', 'BFI_BUFF_ENDURANCE_POWER']
    if job == 'ca': factors += ['BFI_BUFF_GALE_WAY_OF_SWORD_DARK_KNIGHT',
        'BFI_BUFF_ANNIHILATION_WAY_OF_SWORD_DARK_KNIGHT', 'BFI_BUFF_ANNIHILATION_WAY_OF_SWORD_PVP_DARK_KNIGHT']
    return SimpleNamespace(UNIT_TYPE=8, UNIT_CLASS=class_id, CLASSES=(8,first,class_id),
        PROFESSION=job, DISPLAY_NAME=label, POSE_CLASS=pose, ACTIVE=active,
        FOLLOWUP={sid: rows for sid, rows in FOLLOWUPS.items() if sid in active},
        ALIASES=aliases, SPECIFIC_COMMANDS=selected, PASSIVE_STATES=[],
        RESOURCE_ROOTS=list(resource_roots), VISUAL_ROOTS=list(visual_roots),
        BUFF_FACTOR_IDS={'gm': [221,222,345,656], 'bh': [291,292,307,294,295,296,297,299,300,301,658],
                        'ca': [467,468,461,462,463,464,465,466,479,480,659,660,665,666]}[job],
        WAY_FACTOR_KEYS=factors, CALLBACK_ROOTS=list(resource_roots))
