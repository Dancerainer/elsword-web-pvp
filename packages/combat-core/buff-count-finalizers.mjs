/** Target2016 32aea610/32aea860 and 321f8450→3220b250, static evidence.
 * Parameters are the decoded float array, not invented Lua configuration keys.
 * The Web executor stores remaining uses rather than the original byte counter
 * and threshold; accepted contact callbacks own its updates independently of HP.
 */
export function countBuffInstances(profile,unit,debuff){
  if(typeof debuff!=='boolean'||!Array.isArray(unit?.buffs))throw new TypeError('Buff count requires the supplied unit instance list');
  let count=0;
  for(const buff of unit.buffs){
    const flag=profile.buffTemplates?.[buff.templateId]?.raw?.IS_DEBUF;
    if(![0,1,false,true].includes(flag))throw new TypeError('Original IS_DEBUF declaration required for buff count');
    // Include pending-finish/world instances still present in the vector.
    // ACCUMULATION_COUNT, creator/team and lifetime do not weight this count.
    if(Boolean(flag)===debuff)count++;
  }
  return count;
}
export function buffCountFinalizerIncrement(profile,{policy,parameters,unit}={}){
  if(!Number.isSafeInteger(policy)||!Array.isArray(parameters)||parameters.length>3||
    parameters.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new TypeError('Decoded finite count-finalizer parameters required');
  const explicit=Math.fround(parameters[2]??0);
  const amount=explicit>0?explicit:policy===3||policy===4?
    countBuffInstances(profile,unit,policy===4)*Math.fround(parameters[1]??0):0;
  const count=Math.trunc(amount);
  if(!Number.isSafeInteger(count)||count<0||count>0x7fffffff)throw new TypeError('Count finalizer exceeds supported nonnegative signed range');
  return count;
}
