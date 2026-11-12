/** BF475/BT437: source2016 declaration/saved-position registration and
 * qualified fixed-V5 input-mask consumer. Timed Buff identity owns the
 * lifetime; release of the source field never resets or erases this timer. */
const blocked=new Set(['Z','X','A','S','D','C','Q','W','E','R']);
const active=buff=>{for(const row of buff.finalizers??[])if(row.remaining<=0)return false;return true;};
export function hasAddVoidAttackBlock(actor){
  for(const buff of actor.buffs??[])if(buff.templateId===437&&buff.factorId===475&&active(buff))
    for(const row of buff.behaviors)if(row.kind==='attackBlock')return true;
  return false;
}
export function filterAddVoidAttackInput(actor,keys){
  if(!hasAddVoidAttackBlock(actor))return;
  for(const name of ['held','pressed','released'])for(const key of blocked)keys[name]?.delete(key);
  if(keys.edges)keys.edges=keys.edges.filter(edge=>!blocked.has(edge.key));
  if(keys.ordered)keys.ordered=keys.ordered.filter(key=>!blocked.has(typeof key==='string'?key:key.key));
  for(const key of blocked)for(const prefix of ['oneDouble','pureDouble'])if(Object.hasOwn(keys,prefix+key))keys[prefix+key]=false;
}
export function restoreAddVoidBoundPosition(actor){
  // Same-template reapply retains the existing behavior object and its saved
  // position. Use the final active identity, as the original vector.back().
  const buffs=actor.buffs;if(!buffs?.length)return false;
  for(let i=buffs.length-1;i>=0;i--){const buff=buffs[i];
    if(buff.templateId!==437||buff.factorId!==475||!active(buff))continue;
    for(let j=buff.behaviors.length-1;j>=0;j--){const row=buff.behaviors[j];
      if(row.kind!=='neverMove'||row.identityCleared)continue;
      actor.x=row.position[0];actor.z=row.position[2];if(!row.gravity)actor.y=row.position[1];
      return true;
    }
  }
  return false;
}
/** Original31f5d110→31fbe000 clears the39a4 registration container. It
 * does not expire or refresh the Buff's separate normal-time finalizer. */
export function clearAddVoidBoundPosition(actor){
  for(const buff of actor.buffs??[])if(buff.templateId===437&&buff.factorId===475)
    for(const row of buff.behaviors)if(row.kind==='neverMove')row.identityCleared=true;
}
