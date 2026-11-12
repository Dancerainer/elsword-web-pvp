/** Versioned equipment inputs: legacy authored combat values or explicitly
 * accepted source-gear/PvP candidates. Neither policy infers raw socket curves. */
import {BASE_FIELDS,calculateSourceEquipmentCandidate,SOURCE_EQUIPMENT_VERSION} from './source-equipment-base.mjs';
export const PVP_FORMULA_VERSION='pvp-equipment-source-candidate-v1';
export const SOURCE_EQUIPMENT_SEMANTICS='source-equipment-pvp-baseline-and-final-options';
export const SOURCE_CHARACTER_MP_BASE=300;
export const CUSTOM_EQUIPMENT_OPTIONS_POLICY='user-150hp-skill-damage-v2';
export function usesPvpEquipmentFormulas(actor){return actor?.formulaRules?.version===PVP_FORMULA_VERSION;}
/** GUUser::ResetMaxMP uses ONE_CHARGE*3 (GageUI defines ONE_CHARGE=100),
 * then character and equipment options. Under the user's all-equipment rule,
 * the existing mpMax field is flat equipment capacity, not the final total.
 * No known RF/LK default passive adds capacity. The source branch carries its
 * explicitly accepted character inference separately from raw equipment.
 */
export function composeEquipmentCombatStats(input,rules){
  if(!input||!Number.isFinite(input.mpMax)||input.mpMax<0||!Number.isFinite(Math.fround(SOURCE_CHARACTER_MP_BASE+input.mpMax)))
    throw new TypeError('Finite nonnegative equipment MP capacity required');
  if(input.additionalAttackRatio!=null&&(!Number.isFinite(input.additionalAttackRatio)||input.additionalAttackRatio<0||input.additionalAttackRatio>.384375))throw new RangeError('Resolved additional attack ratio outside target curve');
  if(input.criticalDamageBonus!=null&&(!Number.isFinite(input.criticalDamageBonus)||input.criticalDamageBonus<0))throw new RangeError('Invalid equipment critical damage bonus');
  const hpBonus=input.hpBonus??0;
  const hpLimit=rules?.equipmentOptionPolicy===CUSTOM_EQUIPMENT_OPTIONS_POLICY?1.5:.5;
  if(!Number.isFinite(hpBonus)||hpBonus<0||hpBonus>hpLimit)throw new RangeError('Equipment HP option exceeds explicit policy limit '+hpLimit);
  const baseline=rules?.sourceEquipmentBaseline;
  // V5 SERV_USE_PERCENT_IN_OPTION_DATA: HP percent points use level-linked
  // 100+15*(level-1). User v2 explicitly extends the cap to150%; ranked .6 stays.
  const f=Math.fround;
  const rawOptionHp=baseline?Math.trunc(f(f(f(hpBonus)+f(.0005))*100))*(100+15*(baseline.level-1)):0;
  const rawHp=baseline?baseline.character.naked.hpMax+baseline.equipment.hpMax-baseline.character.levelOne.hpMax:0;
  const optionHp=baseline?Math.trunc(f(f(rawHp+rawOptionHp)*f(.6)))-Math.trunc(f(f(rawHp)*f(.6))):0;
  return {...input,...(baseline?{
    ...baseline.pvp,hpMax:baseline.pvp.hpMax+optionHp,...rules.combatBaseOverrides}:{}),
    mpMax:Math.fround(SOURCE_CHARACTER_MP_BASE+input.mpMax),
    ...(input.criticalDamageBonus!=null?{criticalAttack:Math.fround(1.5+input.criticalDamageBonus)}:{})};
}
export function equipmentAttributeContext(preset,overrides={}){
  if(preset.formulaVersion==null)return null;
  if(preset.formulaVersion!==PVP_FORMULA_VERSION)throw new TypeError('Unsupported combat formula version');
  if(preset.attributeSemantics===SOURCE_EQUIPMENT_SEMANTICS){
    if(preset.sourceEquipment?.version!==SOURCE_EQUIPMENT_VERSION)throw new TypeError('Explicit source equipment version required');
    if(preset.equipmentOptionPolicy!=null&&preset.equipmentOptionPolicy!==CUSTOM_EQUIPMENT_OPTIONS_POLICY)throw new TypeError('Unknown equipment option policy');
    const profession={UC_RAVEN_RECKLESS_FIST:'RF',UC_ELSWORD_LORD_KNIGHT:'LK',UC_RAVEN_VETERAN_COMMANDER:'VC',UC_ELSWORD_RUNE_SLAYER:'RS',UC_RAVEN_BLADE_MASTER:'BM',UC_ELSWORD_INFINITY_SWORD:'IS',UC_ELESIS_GRAND_MASTER:'GM',UC_ELESIS_BLAZING_HEART:'BH',UC_ELESIS_CRIMSON_AVENGER:'CA',UC_ADD_LUNATIC_PSYKER:'LP',UC_ADD_MASTERMIND:'MM',UC_ADD_DIABOLIC_ESPER:'DE'}[preset.career];
    const baseline=calculateSourceEquipmentCandidate({...preset.sourceEquipment,profession,level:preset.combatLevel});
    for(const key of BASE_FIELDS)if(preset.attributes[key]!==baseline.pvp[key])throw new TypeError('Stale source equipment PvP baseline '+key);
    const optionOverrides=Object.fromEntries(Object.entries(overrides).filter(([key])=>!BASE_FIELDS.includes(key)));
    const equipment={...preset.attributes,...baseline.equipment,...optionOverrides};
    for(const [key,value]of Object.entries(overrides))if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value<0)throw new TypeError('Invalid source actor attribute '+key);
    for(const [key,value]of Object.entries(equipment))if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value<0)throw new TypeError('Invalid equipment attribute '+key);
    for(const key of ['mpMax','animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'])
      if(!Object.hasOwn(equipment,key))throw new TypeError('Missing equipment attribute '+key);
    const combatBaseOverrides=Object.fromEntries(BASE_FIELDS.filter(k=>Object.hasOwn(overrides,k)).map(k=>[k,overrides[k]]));
    if((combatBaseOverrides.hpMax??baseline.pvp.hpMax)<=0)throw new TypeError('Positive source equipment HP required');
    return {equipmentAttributes:equipment,formulaRules:{version:PVP_FORMULA_VERSION,combatLevel:preset.combatLevel,
      ...(preset.equipmentOptionPolicy?{equipmentOptionPolicy:preset.equipmentOptionPolicy}:{}),
      attributeSemantics:preset.attributeSemantics,characterBase:{...baseline.character.naked,mpMax:SOURCE_CHARACTER_MP_BASE,
        evidence:baseline.characterPolicy},sourceEquipmentBaseline:baseline,combatBaseOverrides,
      pvpEquipmentNormalization:baseline.referencePolicy}};
  }
  if(preset.attributeSemantics!=='equipment-combat-values-and-final-options')throw new TypeError('Explicit equipment attribute semantics required');
  if(!Number.isSafeInteger(preset.combatLevel)||preset.combatLevel<1||!Number.isFinite(Math.fround(62*preset.combatLevel)))throw new TypeError('Explicit positive combatLevel required for PvP defence');
  const equipment={...preset.attributes,...overrides};
  for(const [key,value]of Object.entries(equipment))if(!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||value<0)throw new TypeError('Invalid equipment attribute '+key);
  for(const key of ['hpMax','mpMax','physicalAttack','magicAttack','animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'])
    if(!Object.hasOwn(equipment,key))throw new TypeError('Missing equipment attribute '+key);
  if(equipment.hpMax<=0)throw new TypeError('Positive equipment HP required');
  return {equipmentAttributes:equipment,formulaRules:{version:PVP_FORMULA_VERSION,combatLevel:preset.combatLevel,
    attributeSemantics:preset.attributeSemantics,characterBase:{mpMax:SOURCE_CHARACTER_MP_BASE,
      unresolved:['hpMax','physicalAttack','magicAttack','physicalDefence','magicDefence']},
    pvpEquipmentNormalization:'user-defined-combat-values'}};
}
