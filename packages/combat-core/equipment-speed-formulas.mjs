/** Already-converted equipment percentages, followed by the fixed V5
 * AdditionalStatByBuff composition. This adapter does not treat percentages
 * as raw socket points and does not apply an invented target2016 socket curve.
 * Source boundaries: contracts/equipment-speed-formulas-source-v1.json.
 */
export const EQUIPMENT_SPEED_FORMULA_VERSION='equipment-final-percent-buff-composition-v1';
export const EQUIPMENT_SPEED_KEYS=Object.freeze(['animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier']);
const f=Math.fround;
const number=(value,label)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(f(value)))throw new TypeError(label+' must be finite in binary32');
  return f(value);
};

/** Evaluate a single original speed stat in its native units. Swap values
 * are absolute (walk speed, jump velocity, or animation multiplier), while
 * percentages combine before the movement/jump half-increment adjustment.
 * Raw-point FIX/RELATION factors need a verified option converter and remain
 * unsupported rather than being added to an already-final percentage.
 */
export function composeEquipmentSpeedValue({baseValue,equipmentPercent,passiveSum=0,passiveMultiple=1,modifiers=[],halfIncrement=false}={}){
  const basic=number(baseValue,'baseValue'),percent=number(equipmentPercent,'equipmentPercent');
  const passiveAdd=number(passiveSum,'passiveSum'),passiveMultiply=number(passiveMultiple,'passiveMultiple');
  if(basic<=0||percent<0||passiveAdd<0||passiveMultiply<=0)throw new RangeError('Positive base/passive multiplier and nonnegative equipment/passive percentages required');
  if(!Array.isArray(modifiers))throw new TypeError('modifiers must be an array');
  let buffPercent=1,swapValue;
  for(const row of modifiers){
    const value=number(row?.value,'speed Buff value');
    if(row.changeType===0)swapValue=value;
    else if(row.changeType===3){
      if(value<0)throw new RangeError('speed Buff percentage must be nonnegative');
      buffPercent=f(buffPercent*value);
    }else throw new TypeError('Raw socket FIX/RELATION speed factors require a verified option converter');
  }
  // BCT_SWAP_VALUE ignores every other group; insertion order selects last.
  if(swapValue!==undefined)return swapValue;
  let multiplier=f(f(f(1+percent)*f(1+passiveAdd))*passiveMultiply);
  multiplier=f(multiplier*buffPercent);
  // X2BuffTemplet.h ADJUST_BUFF_CALCULATE: a slow Buff does not get the
  // minimum-half-speed behavior intended for positive move/jump options.
  if(multiplier>0){
    if(buffPercent>=1){
      multiplier=f(f(f(multiplier-1)*f(halfIncrement ? .5 : 1))+1);
    }
    return Math.max(0,f(basic*multiplier));
  }
  // Original guard applies no multiplier when the product is zero.
  return basic;
}

/** Current actor model exposes common walk/run and normal/dash-jump ratios.
 * Percent Buffs preserve that representation. Absolute movement/jump swaps
 * cannot: each source base has a different denominator, so reject nonzero
 * swaps here. Exact zero is zero under every positive source denominator.
 * Call composeEquipmentSpeedValue with each raw base to support such a state.
 */
export function composeEquipmentSpeedAttributes(equipmentAttributes,{passives={},modifiers=[]}={}){
  if(!Array.isArray(modifiers))throw new TypeError('modifiers must be an array');
  const result={};
  for(const key of EQUIPMENT_SPEED_KEYS){
    const multiplier=number(equipmentAttributes?.[key],'equipment '+key);
    if(multiplier<1)throw new RangeError('equipment '+key+' must represent 1 + nonnegative final percentage');
    const rows=modifiers.filter(row=>row.stat===key),passive=passives[key]??{};
    if(key!=='animationSpeedMultiplier'&&rows.some(row=>row.changeType===0&&row.value!==0))
      throw new TypeError('Absolute movement/jump swap requires separate source base speeds');
    result[key]=composeEquipmentSpeedValue({baseValue:1,equipmentPercent:f(multiplier-1),
      passiveSum:passive.sum??0,passiveMultiple:passive.multiple??1,
      modifiers:rows,halfIncrement:key!=='animationSpeedMultiplier'});
  }
  return result;
}
