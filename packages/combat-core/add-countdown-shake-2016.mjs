const SET='EffectSet_Countdown_Bomb_Trace';
export function bindAddCountdownShake(effects,target){
 const group=effects[0]?.id;if(!group)return;
 for(const e of effects)if(e.setName===SET)e.sourceAddCountdownShake={group,count:0,targetId:target.id};
}
/** Source321d05c0 checks threshold before this prune's increment. It compares
 * applied-state previous facing against current facing, once per group. */
export function tickAddCountdownShake(sim){
 const groups=new Map();for(const e of sim.state.effects)if(!e.dead&&e.sourceAddCountdownShake){const key=e.ownerId+':'+e.sourceAddCountdownShake.group;(groups.get(key)??(groups.set(key,[]),groups.get(key))).push(e);}
 for(const entries of groups.values()){
  const s=entries[0].sourceAddCountdownShake;
  const owner=sim.state.actors.find(b=>b.id===entries[0].ownerId),target=sim.state.actors.find(b=>b.id===s.targetId);
  if(owner?.pvpDisconnected||target?.pvpDisconnected){for(const e of entries){e.dead=true;e.suppressSecondaryDamage=true;e.endReason='network-disconnected';}continue;}
  if(s.count>=10){for(const e of entries){e.dead=true;e.suppressSecondaryDamage=true;e.endReason='target2016-countdown-shaken-off';}continue;}
  if(target&&target.sourceFacingHistory?.previous!==undefined&&target.sourceFacingHistory.previous!==target.facing)for(const e of entries)e.sourceAddCountdownShake.count++;
 }
}
export function validateAddCountdownShake(e){
 const s=e.sourceAddCountdownShake;if(s===undefined)return true;
 if(e.setName!==SET||!s||typeof s!=='object'||Object.keys(s).length!==3||!Number.isSafeInteger(s.group)||s.group<1||!Number.isInteger(s.count)||s.count<0||s.count>10||typeof s.targetId!=='string'||!s.targetId||s.targetId.length>128||e.traceActorId!==s.targetId)throw new TypeError('Invalid Countdown shake control');return true;
}
