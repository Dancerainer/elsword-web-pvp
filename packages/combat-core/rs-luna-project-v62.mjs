/** V62 explicit project rule, not the original two independent damage rows. */
export const RS_LUNA_PROJECT_VERSION='project-rs-luna-once-per-cast-target-v62';
const names=new Set(['DamageEffect_SA_ERS_LunaBlade','DamageEffect_SA_ERS_LunaBlade_ExposionFinal']);
function backingActor(sim,b){
 const id=b.sourceSummonOwnerId??b.sourcePrismOwnerId;
 return id===undefined?b:sim.state.actors.find(a=>a.id===id)??b;
}
function storage(sim,b,create=false){
 // A foreign participant is only a disposable contact observation. Keep its
 // cosmetic deduplication outside transmitted actors and authoritative HP/MP.
 const backing=backingActor(sim,b);
 if(sim.observationOnly||sim.networkOwnerId!=null&&backing.id!==sim.networkOwnerId){
  if(!create)return sim.state.localRuneLunaHitReceipts?.[b.id];
  return (sim.state.localRuneLunaHitReceipts??={})[b.id]??={};
 }
 if(create)return backing.sourceRuneSlayerHitReceipts??={};
 return backing.sourceRuneSlayerHitReceipts;
}
function receipt(sim,b,p,create=false){
 const rows=storage(sim,b,create),key=p.receiptKey??p.attackerId,r=rows?.[key];
 if(r?.epoch===p.epoch&&r.targetEpoch===p.targetEpoch)return r;
 if(!create)return null;
 return rows[key]={epoch:p.epoch,targetEpoch:p.targetEpoch,serial:0,casts:{}};
}
/** Called after invulnerability/Miss/absorb/reflect/counter gates. Resolve the
 * actual carrier's cast identity, including the existing die-child inheritance;
 * the attacker's current state may already belong to a different cast. */
export function prepareRuneLunaContact(sim,a,b,data,origin){
 const e=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null;
 if(sim.profileFor(a).target.unitClass!==101||e?.skillId!==21017||!names.has(e.name)||
  e.ownerId!==a.id||!Number.isSafeInteger(e.ownerStateSerial)||e.ownerStateSerial<0)return null;
 const p={attackerId:a.id,epoch:e.networkEpoch??sim.networkEpochFor?.(a.id)??0,
  targetEpoch:sim.networkEpochFor?.(backingActor(sim,b).id)??0,serial:e.ownerStateSerial};
 // Independent NPC pools also share the cast's one HP attempt. Their real
 // owner carries a separate namespace, not an ephemeral pose actor's fields.
 if(b.sourceSummonOwnerId!==undefined)p.receiptKey=JSON.stringify(['apocalypse',b.sourceSummonSerial,a.id]);
 else if(b.sourcePrismOwnerId!==undefined)p.receiptKey=JSON.stringify(['prism',b.sourcePrismEndpointId,a.id]);
 const prior=receipt(sim,b,p)?.casts?.[p.serial];
 // BF117 is now dispatched once for either stage at the ordinary DD factor
 // gate. Keep frozen source rows and all unrelated factors unchanged.
 const factors=Object.fromEntries(Object.entries(data.BUFF_FACTOR_ID??{}).filter(([,id])=>id!==117));
 const effective={...data};
 if(Object.keys(factors).length)effective.BUFF_FACTOR_ID=factors;else delete effective.BUFF_FACTOR_ID;
 return {...p,data:effective,allowHp:prior?.hp!==true,allowMp:prior?.mp!==true};
}
/** A legal ordinary damage settlement consumes the HP attempt even if a
 * shield reduces it to zero. The second stage must not try again through a
 * shield that expired between stages. Rejected early contacts consume neither.
 * The independent MP application follows the existing living DD-factor gate. */
export function settleRuneLunaContact(sim,a,b,p,{amount,mpAllowed,applyMp=true}={}){
 if(!p)return {mpApplied:false};
 let mpApplied=false;
 if(p.allowMp&&mpAllowed){
  mpApplied=!applyMp||!!sim.grantBuff(a,b,117,sim.skill(21017,a)?.maxLevel??1,null);
 }
 const r=receipt(sim,b,p,true),row=r.casts[p.serial]??={hp:false,mp:false};
 r.serial=Math.max(r.serial,p.serial);row.hp=true;row.mp||=mpApplied;
 return {mpApplied};
}
