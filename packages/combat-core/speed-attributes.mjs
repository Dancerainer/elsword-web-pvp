/** Fixed V5 additional-stat consumer, for a preset supplying final option
 * percentages with no speed Buff or speed passive factors. These inputs are
 * already converted percentages; they are not raw socket points. The omitted
 * Lua socket curve and Buff composition are not inferred here.
 * X2GameUnit.cpp:12061..12067; X2BuffTemplet.h:893..945, pinned a8438f3.
 */
export const FINAL_OPTION_SPEED_SEMANTICS='final-option-percent-v5-half-movement-jump';
const keys=['animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier'];
const f=Math.fround;

export function resolveSpeedAttributes(attributes,semantics){
  if(semantics==null)return {stats:{...attributes},options:null};
  if(semantics!==FINAL_OPTION_SPEED_SEMANTICS)throw new TypeError('Unsupported speed attribute semantics');
  const options={};
  for(const key of keys){
    const value=attributes[key];
    if(typeof value!=='number'||!Number.isFinite(value)||value<1)
      throw new TypeError(`${key} must supply a finite, nonnegative final option bonus`);
    options[key]=value;
  }
  const stats={...attributes};
  // The original consumer uses float temporaries. Preserve the operation order
  // rather than re-associate this to 0.5 + option/2 in double precision.
  for(const key of ['moveSpeedMultiplier','jumpSpeedMultiplier']){
    const optionPercent=f(options[key]-1);
    const combined=f(1+optionPercent);
    stats[key]=f(f(f(combined-1)*f(.5))+1);
  }
  // Existing animation playback uses this final option multiplier directly.
  // Its complete controller float precision remains an independent boundary.
  return {stats,options};
}

export function sourceScaledSpeed(baseSpeed,actualMultiplier){
  if(!Number.isFinite(baseSpeed)||!Number.isFinite(actualMultiplier))throw new TypeError('Finite movement speed required');
  return f(f(baseSpeed)*f(actualMultiplier));
}
