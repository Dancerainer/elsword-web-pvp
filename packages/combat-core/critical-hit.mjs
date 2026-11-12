/** Supply explicit RF host values to the byte-preserved DamageReact block.
 * Defence/base damage and original random stream scheduling remain host
 * boundaries; the native module owns critical threshold, multiplier and FX.
 */
export function evaluateHitCritical(native,{amount=1,attacker,defender,data,traitPolicy={},roll,headPosition=null}){
  if(!native)return null;
  const head=headPosition??[0,0,0];
  // Current source-equipment options store percent points (50 means50%).
  // The native consumer and independently sourced passive/trait channels
  // consume probability ratios. Preserve old authored fixture ratios.
  const equipmentPercent=attacker.formulaRules?.attributeSemantics==='source-equipment-pvp-baseline-and-final-options';
  const result=native.evaluate({amount,criticalRate:(attacker.stats.criticalRate??0)/(equipmentPercent?100:1),
    criticalAttack:attacker.stats.criticalAttack??1.5,
    passiveCriticalRate:attacker.stats.passiveCriticalRate??0,
    magicCriticalRate:(attacker.stats.magicCriticalRate??0)+(attacker.passivePolicy?.elesis?.magicalCriticalRateAdd??0),
    magicCriticalDamage:(attacker.stats.magicCriticalDamage??0)+(attacker.passivePolicy?.elesis?.magicalCriticalDamageAdd??0),
    shadowCriticalRate:attacker.stats.shadowCriticalRate??0,
    antiCriticalRate:defender.stats.antiCriticalRate??0,
    unitAntiCriticalRate:defender.stats.unitAntiCriticalRate??0,
    criticalDefence:defender.stats.criticalDefence??1,
    damageType:data.DAMAGE_TYPE??0,
    extraCriticalRate:traitPolicy?.forceCritical?1:data.CRITICAL_RATE??0,
    extraCriticalDamage:data.APPLY_CRITICAL_DAMAGE_PERCENT??0,
    roll,headX:head[0],headY:head[1],headZ:head[2]});
  return {...result,effectPosition:headPosition?result.effectPosition:null};
}
