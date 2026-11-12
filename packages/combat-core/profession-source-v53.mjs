/** Selected target2016 consumers. See contracts/profession-consumers-v53.json.
 * Input actors/deltas are the current simulation's instances, never captured
 * original matches. Keep the source float storage points explicit. */
const f=Math.fround;
const dashStates=new Set(['RSI_DASH','RSI_DASH_END','RSI_DASH_JUMP','RSI_DASH_JUMP_LANDING']);
export function advanceElesisDashAccumulator(actor,dt){
 const s=actor.sourceElesisSkills;
 if(!s)return;
 if(dashStates.has(actor.state))s.dashAccumulator=f(f(s.dashAccumulator??0)+f(dt));
 else if(actor.skillId!==28204)s.dashAccumulator=0;
}
export const windmillExtraMp=dt=>f((f(dt)*100)/2.799999952316284);
export function windmillEndReason({elapsed,base,mp,delta,held}){
 if(elapsed>base+2.799999952316284)return 'lk-windmill-extension-limit';
 if(elapsed>base){if(!held)return 'lk-windmill-key-released';
  if(mp<windmillExtraMp(delta))return 'lk-windmill-extra-mp-insufficient';}
 return null;
}
export function caDashWaveLifetime(charge){
 if(!Number.isFinite(charge)||charge<0||charge>3)throw new TypeError('Invalid original CA charge');
 return f(f(.3)*f(1+f(charge)*.3330000042915344));
}
/** DD force-down loading uses the original additive percentage channel;
 * positive and negative DD values have distinct direction channels. This
 * caller supplies the single selected passive's ratio. */
export function ravenForceDownValue(value,ratio){
 const delta=f(f(ratio)-1+4.999999873689376e-5),combined=f(1+delta);
 const multiplier=combined>0&&combined<=1?combined:1;
 return Math.abs(value)<=1.1920928955078125e-7?value:f(f(value)*multiplier);
}
