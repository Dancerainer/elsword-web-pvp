/** Legacy Web wrapper plus recovered2016 target-delta mode below.
 * The victim shares a HIT_GAP by attacker UID and damage-effect NAME. This
 * is separate from SET_GROUP_ID / the laser group hit-list consumer. Keep
 * local collision receipts in the simulation, outside transmitted actors,
 * so replacing an observed actor/effect cannot erase a live group gap.
 */
export function retireEffectGroupHits(state){
  if(state.sourceEffectGroupClockVersion===2016)return; // Original target-delta sweeps own this mode.
  const rows=state.effectGroupHits;
  if(!rows)return;
  state.effectGroupHits=rows.filter(row=>row.until>state.time+1e-9);
}

export function claimEffectGroupHit(state,effect,attackerId,targetId,data,{attackerEpoch=0,targetEpoch=0}={}){
  if(effect?.damage?.GROUP_DAMAGE!==1&&effect?.damage?.GROUP_DAMAGE!==true)return true;
  if(state.sourceEffectGroupClockVersion===2016){
    const npcSerial=effect.sourceAddSummonSerial;
    const result=claimSourceEffectGroupHit2016(state,{ownerIdentity:npcSerial===undefined?attackerId:attackerId+':npc:'+npcSerial,ownerKind:npcSerial===undefined?0:1,targetId,name:effect.name,gap:data.HIT_GAP??0,attackerEpoch,targetEpoch});
    if(!result.supported)throw TypeError(result.reason);return result.allowed;
  }
  retireEffectGroupHits(state);
  const rows=state.effectGroupHits??=[];
  if(rows.some(row=>row.attackerId===attackerId&&row.targetId===targetId&&row.name===effect.name&&
    row.attackerEpoch===attackerEpoch&&row.targetEpoch===targetEpoch))return false;
  const gap=data.HIT_GAP??0;
  // GameUnit's group record with zero gap never blocks another collision.
  // No permanent group or effect identity is retained after its gap expires.
  // Epochs are the web room's life identities, not recovered native fields.
  // A replaced participant life must not inherit the previous life's receipt.
  if(gap>0)rows.push({attackerId,targetId,name:effect.name,attackerEpoch,targetEpoch,until:state.time+gap});
  return true;
}
/** Original target5718 shared vector. This is deliberately a second clock and
 * erase algorithm, separate from the carrier's swap/recheck hit-memory rows.
 * The caller reaches 321fb190 once with the target's actual received delta. */
export function tickSourceGroupRecords2016(rows,delta){
 if(!Array.isArray(rows)||!Number.isFinite(delta)||delta<0)throw TypeError('Invalid original shared-hit delta');
 const end=rows.length,dt=Math.fround(delta);
 for(let i=0;i<end;i++){
  const row=rows[i];if(row==null)continue;
  if(typeof row.remaining!=='number')throw TypeError('Invalid original shared-hit record');
  row.remaining=Math.fround(Math.fround(row.remaining)-dt);
  // Original move-left and end reduction, followed by unconditional iterator
  // increment. The record moved into i is deliberately skipped this call.
  if(row.remaining<=0)rows.splice(i,1);
 }
 return rows;
}
export function initializeSourceGroupMemory2016(state){
 if(state.sourceEffectGroupClockVersion===2016)return {supported:true};
 if(state.effectGroupHits?.length)return {supported:false,reason:'legacy-wall-clock-records-require-explicit-reset'};
 state.effectGroupHits=[];state.sourceEffectGroupClockVersion=2016;return {supported:true};
}
/** Host container retirement, not an original dead/UID predicate. Supply all
 * extant target objects, including dead actors and retained DYING NPCs. A
 * removed target's own native vector no longer exists; attacker rows in an
 * extant target vector continue to expire only by that target's normal TTL. */
export function retireRemovedGroupTargets2016(state,targetIds){
 if(state.sourceEffectGroupClockVersion!==2016)return;
 if(!(targetIds instanceof Set))throw TypeError('Complete target container identities required');
 state.effectGroupHits=state.effectGroupHits.filter(row=>targetIds.has(row.targetId));
}
export function tickEffectGroupHits2016(state,targetId,delta,{targetEpoch}={}){
 if(state.sourceEffectGroupClockVersion!==2016)return {supported:false,reason:'source-group-clock-not-initialized'};
 // A Web epoch replaces the target object/container. Do not let an old
 // target-life row alter the new vector's move-left/skip expiration. Old
 // attacker rows stay in this target vector and expire by their normal TTL.
 if(targetEpoch!==undefined)state.effectGroupHits=state.effectGroupHits.filter(row=>row.targetId!==targetId||row.targetEpoch===targetEpoch);
 const all=state.effectGroupHits,rows=all.filter(row=>row.targetId===targetId);
 tickSourceGroupRecords2016(rows,delta);
 const retained=new Set(rows);state.effectGroupHits=all.filter(row=>row.targetId!==targetId||retained.has(row));
 return {supported:true,remaining:rows.length};
}
/** Same original owner64bit identity + owner114 + exact effect name. Epochs
 * remain separate Web life isolation inputs; they are not native fields. */
export function claimSourceEffectGroupHit2016(state,{ownerIdentity,ownerKind,targetId,name,gap,attackerEpoch=0,targetEpoch=0}={}){
 if(state.sourceEffectGroupClockVersion!==2016)return {supported:false,reason:'source-group-clock-not-initialized'};
 if(typeof ownerIdentity!=='string'||!ownerIdentity||![0,1].includes(ownerKind)||typeof targetId!=='string'||!targetId||typeof name!=='string'||!name||typeof gap!=='number')
  return {supported:false,reason:'original-group-identity-and-gap-required'};
 const rows=state.effectGroupHits;
 const match=rows.some(row=>row.attackerId===ownerIdentity&&row.ownerKind===ownerKind&&row.targetId===targetId&&row.name===name&&
  row.attackerEpoch===attackerEpoch&&row.targetEpoch===targetEpoch&&row.remaining>0);
 if(match)return {supported:true,allowed:false};
 // Original appends before recipient/Miss result, including gap0. The >0
 // lookup gate makes a zero/unordered record nonblocking until its sweep.
 rows.push({attackerId:ownerIdentity,ownerKind,targetId,name,attackerEpoch,targetEpoch,remaining:Math.fround(gap)});
 return {supported:true,allowed:true};
}
