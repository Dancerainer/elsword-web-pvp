/** Full life templates plus replaceable room fields. The coordinator expands
 * these into complete snapshots before the existing game entry point. */
export function compactOwnedSocketRoom(data,epochs){
 if(data.ownership?.mode!=='local-owner-v1')return {data,critical:!!data.events?.length};
 let fullLife=false;
 const fields=['id','pvpPresentation','pvpModifiers','onlineBuffs','pvpDead','pvpDisconnected','pvpInvincibleRemaining','pvpWhiteFlash'];
 const actors=data.snapshot.actors.map(actor=>{
  const epoch=data.ownership.actors[actor.id]?.epoch;
  if(epochs.get(actor.id)!==epoch){fullLife=true;epochs.set(actor.id,epoch);return actor;}
  return Object.fromEntries(fields.filter(key=>Object.hasOwn(actor,key)).map(key=>[key,actor[key]]));
 });
 return {data:{...data,snapshot:{...data.snapshot,actors},owners:{},snapshotDelta:true},critical:fullLife||!!data.events?.length};
}
