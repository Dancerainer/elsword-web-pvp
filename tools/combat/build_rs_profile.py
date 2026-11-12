"""RS target2016 profile using the shared Elsword declaration builder."""
import argparse
import hashlib
import json
from pathlib import Path
from build_lk_profile import build as build_elsword, ACTIVE as LK_ACTIVE, FOLLOWUP as LK_FOLLOWUP, ALIASES as LK_ALIASES

ROOT = Path(__file__).resolve().parents[2]
SHARED = (900, 21026, 21217, 21027, 21028, 21029, 21030, 21218)
ACTIVE = {sid: LK_ACTIVE[sid] for sid in SHARED}
ACTIVE.update({
    21220: ('ESSI_SA_EMK_BIG_BURST', 'ExplosiveFist'),
    21032: ('ESSI_SI2_ES_RISING_SLASH', 'RisingSlash'),
    21035: ('ESSI_SI1_ES_WIND_BLADE', 'WindBlade'),
    21208: ('ESSI_A_ES_SWORD_WAVE', 'SwordWave'),
    21209: ('ESSI_SI_A_ERS_CRITICAL_SWORD', 'CriticalSword'),
    21014: ('ESSI_SI3_ES_STORM_BLADE', 'StormBlade'),
    21015: ('ESSI_SA_EMK_PHOENIX_TALON', 'PhoenixTalon'),
    21210: ('ESSI_SI_A_ERS_RUNE_OF_FIRE', 'FireRune'),
    21016: ('ESSI_SA_EMK_SWORD_FIRE', 'SwordFire'),
    21017: ('ESSI_SA_ERS_LUNA_BLADE', 'LunaBlade'),
    21211: ('ESSI_ERS_COUNTER_GUARD_READY', 'MagicCounter'),
    21018: ('ESSI_SA_ERS_SPLASH_EXPLOSION', 'SplashExplosive'),
    21604: ('ESSI_HA_ERS_SHINING_RUNE_BUSTER', 'ShiningRuneBuster'),
})
FOLLOWUP = {sid: LK_FOLLOWUP[sid] for sid in SHARED if sid in LK_FOLLOWUP}
FOLLOWUP.update({21035:['ESSI_SI1_ES_WIND_BLADE_ULTIMATE'],21016:['ESSI_SA_EMK_SWORD_FIRE_LANDING'],
    21211:['ESSI_ERS_COUNTER_GUARD','ESSI_ERS_COUNTER_GUARD_END']})
ALIASES = {**LK_ALIASES, 'RSI_COMBO_ZZZ':'ESSI_ERS_COMBO_ZZZ','RSI_COMBO_ZZZZ':'ESSI_ERS_COMBO_ZZZZ',
    'RSI_COMBO_XXX':'ESSI_COMBO_X3','RSI_DASH_COMBO_ZZ':'ESSI_KNIGHT_DASH_COMBO_Z2'}
SPECIFIC = ['ESSI_COMBO_Z3','ESSI_COMBO_Z4','ESSI_COMBO_Z4a','ESSI_COMBO_X3a','ESSI_DASH_JUMP_COMBO_Z3',
    'ESSI_DASH_JUMP_COMBO_Z3_LANDING','ESSI_DASH_JUMP_COMBO_X2','ESSI_DASH_JUMP_COMBO_X2_LANDING',
    'ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3','ESSI_MAGIC_KNIGHT_DASH_COMBO_Z3a','ESSI_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a',
    'ESSI_ERS_XZ','ESSI_ERS_XZ_CHARGE','ESSI_ERS_XZZ','ESSI_ERS_FULL_CHARGE_XZZ',
    'ESSI_ERS_DASH_COMBO_XZ','ESSI_ERS_DASH_JUMP_XZ','ESSI_ERS_DASH_JUMP_XZZ',
    'ESSI_EMK_DASH_JUMP_ZX','ESSI_EMK_DASH_JUMP_ZXX','ESSI_START_INTRUDE','ESSI_DESTRUCTION_RAGE','ESSI_SWORD_WAIT']
CALLBACK_ROOTS = ['EffectSet_ERS_COMBO_XZ','EffectSet_ERS_COMBO_XZZ','EffectSet_ERS_COMBO_FULL_CHARGE_XZZ',
    'EffectSet_ELSWORD_DASH_JUMP_XZ','EffectSet_ELSWORD_DASH_JUMP_XZZ',
    'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ','ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ',
    'EffectSet_RunSlayer_RUNE_GUARD_FIRE','EffectSet_ELSWORD_MAGIC_KNIGHT_DASH_COMBO_Z3a',
    'ELSWORD_MAGIC_KNIGHT_DASH_COMBO_Z3a','ELSWORD_MAGIC_KNIGHT_DASH_JUMP_COMBO_X2a',
    'ELSWORD_MAGIC_BULLET','ELSWORD_MAGIC_BULLET_HYPER']
CALLBACK_ROOTS += ['ELSWORD_RUNE_SLAYER_DASH_ZZX','FIREBALL_SMALL_DOWN_ELSWORD']
CALLBACK_PARTICLES = ['Flare_Elsword_SI_A_Big_Burst04', 'Flare_Elsword_SI_A_Big_Burst05', 'Smoke_Elsword_SI_A_Big_Burst06']
CALLBACK_ROOTS += ['EffectSet_ELSWORD_SPLASH_EXPLOSION', 'DAMEGA_EFFECT_ELSWORD_MNK_BIG_BURST', *CALLBACK_PARTICLES]

def build(cache, assets):
    result=build_elsword(cache,assets,dict(active=ACTIVE,followup=FOLLOWUP,aliases=ALIASES,specific=SPECIFIC,
        passiveStates=[],classId=101,classes=(1,11,101),profession='rs',label='RS / Rune Slayer',
        poseKey='ELSWORD_RUNE_SLAYER',passiveIds=[21407],callbackRoots=CALLBACK_ROOTS,buffFactorIds=[2,165,166,167]))
    for skill in result['skillCatalog']:
        for branch in skill.get('branches',[]):
            if branch['memoTypeName']=='MI_CRITICAL':
                branch['limitations']=['defensive-effect-bypass unavailable; target cost plus project25% defence reduction execute; no fabricated passive bypass']
        if skill['skillId'] in SHARED: skill['sharedConsumer']='Elsword common / LK verified adapter'
        if skill['skillId']==21407:
            skill['classificationEvidence']='target2016 SKILL_TYPE.ST_PASSIVE=8 overrides inconsistent useCondition=1; no MP/cooldown declared'
        if skill['skillId']==21211:
            skill['cooldown']=0
            skill['cooldownEvidence']='target skill omits cooldown; initialized empty skill-cooldown table, no old cooldown substituted'
    result['unsupported']=[e for e in result['unsupported'] if e['id'] not in ('kick-charge-animation','windmill-hold','skill-traits','consumer-version')]
    result['unsupported'] += [
        {'id':'consumer-version','reason':'RS and shared Elsword callbacks combine target2016 declarations with pinned fixedV5 consumers and explicit target-description adapters; no target2016 executable trace'},
        {'id':'skill-traits','reason':'MI_USEFUL additional-hit schedule and MI_CRITICAL defensive-effect bypass remain partial where declared; each original branch preserves its specific limitations'},
        {'id':'sword-enchant-socket-rate','reason':'21407 applies original exclusive elemental buffs and ordinary-hit burn/frost/poison factors; the additional10% weapon-element socket trigger-rate field is preserved but no shared weapon-element socket consumer exists'}]
    result['referenceSemantics']['airStates']=['ESSI_SA_EMK_SWORD_FIRE']
    result['referenceSemantics']['runeSlayer']={'ruleVersion':'rs-target2016-runes-v1',
        'evidence':'target2016 declaration fields + pinned SwordMan callbacks, target executable unmeasured',
        'sourceSha256':'ebf61b55464e6c43a0d5fd0b75b1cef8be6bf1049a3e1a4c818104bb6c03e84d'}
    result['resourceOnlyTemplates'] = sorted(set(result['resourceOnlyTemplates']) | set(CALLBACK_PARTICLES))
    result['resourceOnlyTemplatesEvidence'] += '; RS Big Burst direct particle callbacks from the fixed SwordMan source identity above'
    # Absence from an earlier converted index is not evidence that an original
    # template is absent: new callback roots still need to reach the converter.
    # Only these exact names have a complete original-KOM script search receipt.
    for name,entry in list(result['damageEffects'].items()):
        mesh=entry['raw'].get('MAIN_EFFECT_NAME')
        if mesh in ('Elsword_RS_DashJumpComboXa_Mesh01Die', 'Elsword_RS_DashZZXDie'):
            result['unsupported'].append({'id':'missing-original-template:'+name,
                'evidence':'contracts/rs-missing-fx-search-v1.json',
                'reason':mesh+' is referenced by target damage data but its original definition was not found; damage execution excluded, no substitute collision'})
            del result['damageEffects'][name]
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--assets',type=Path,default=ROOT/'artifacts/rs');p.add_argument('--output',type=Path,default=ROOT/'packages/combat-core/rs-profile.json')
    a=p.parse_args();result=build(a.cache,a.assets);a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'states':len(result['states']),'skills':len(result['skillCatalog']),'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()}))
