/** Shared equipment/IS additional attack: target2016 curve + accepted V5 candidate.
 * FIX_VALUE uses nominal points; user equipmentRatio is already resolved.
 * See contracts/is-additional-attack-source-v1.json; no original-client claim.
 */
const f=Math.fround;
export function isAdditionalAttackRatio(points,level,equipmentRatio=0){
  if(!Number.isFinite(points)||points<0)throw new RangeError('Additional attack points must be finite and nonnegative');
  if(!Number.isSafeInteger(level)||level<1)throw new RangeError('Explicit positive combat level required');
  if(!Number.isFinite(equipmentRatio)||equipmentRatio<0||equipmentRatio>.384375)throw new RangeError('Resolved equipment additional ratio exceeds target curve range');
  // User presets are resolved final option ratios. Invert target prototype74
  // only to combine raw FIX/option points before the shared curve (BuffTemplet.h).
  const equipmentIntermediate=equipmentRatio<=.15?equipmentRatio/.375:
    (1.32-Math.sqrt(1.32**2-1.6*(.064+equipmentRatio/.375)))/.8;
  // BuffBehavior::GetValue converts nominal FIX values into socket points.
  // Target SocketOptionForm prototypes 8/41 convert back (level1 uses10).
  const buffUnit=f(f(1.5*f(level-1))+f(9.5));
  const socketUnit=level===1?10:1.5*(level-1)+9.5;
  let value=Math.min(equipmentIntermediate+f(f(points)*buffUnit)/socketUnit*.01,1.65);
  if(value>.4)value=value*(-.4*value+1.32)-.064;
  value=Math.min(value*.375,1);
  // CX2AdditionalStatByBuff: zero base temporarily becomes1, then subtract1.
  return Math.max(0,f(f(1+f(value))-1));
}

export function isAdditionalAttackDamage({points=0,equipmentRatio=0,level,data,stats,powerMultiplier=1}={}){
  if(!(points>0||equipmentRatio>0)||data?.NO_DAMAGE||data?.LV_DAMAGE)return 0;
  const type=data?.DAMAGE_TYPE??0;
  // DT_BUFF / unknown types cannot acquire an invented attack coefficient.
  if(!Number.isInteger(type)||type<0||type>5)return 0;
  if(!Number.isFinite(powerMultiplier)||powerMultiplier<0)throw new RangeError('Invalid additional attack power multiplier');
  // SetDamageExceptionProcess applies the recorded cast/trait power before
  // CalcAdditionalAttackDamage reads the motion coefficients.
  const kind=type%3,physical=f((data.DAMAGE?.PHYSIC??0)*powerMultiplier),magic=f((data.DAMAGE?.MAGIC??0)*powerMultiplier);
  const power=kind===0?physical:kind===1?magic:f(f(physical+magic)*.5);
  const stat=kind===0?stats.physicalAttack:kind===1?stats.magicAttack:f(f(stats.physicalAttack+stats.magicAttack)*.5);
  if(!Number.isFinite(power)||power<0||!Number.isFinite(stat)||stat<0)throw new RangeError('Invalid additional attack inputs');
  // CalcAdditionalAttackDamage uses total attack even for DT_WEAPON_*.
  // Caller adds this after critical and equipment reduction, not into either.
  return f(f(f(1.5*f(Math.pow(f(power),f(.65))))*isAdditionalAttackRatio(points,level,equipmentRatio))*f(stat));
}
