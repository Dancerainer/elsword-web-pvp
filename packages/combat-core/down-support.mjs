/** Fixed V5 Raven.cpp:7069/7165: lost Future foot support precedes all
 * animation-end and stand-up input branches. Target2016 runtime unmeasured.
 * Caller runs this after physics has finalized its foot-support flag.
 */
export function downSupportReaction(state,{grounded,lineRadius}){
  if(!['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK'].includes(state)||grounded!==false)return null;
  if(!Number.isFinite(lineRadius)||lineRadius<=0)throw new RangeError('lineRadius must be finite and positive');
  return {state:'RSI_DAMAGE_AIR_FALL',offsetY:-Math.fround(Math.fround(lineRadius)*Math.fround(1.5))};
}
