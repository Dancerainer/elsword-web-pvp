/** Web owner-domain adaptation of the fixed source's game-global LOT6 set.
 * Offline and the local network owner retain the original shared history.
 * Remote prediction uses a separate mirror for each owner; its packets never
 * overwrite this browser's authoritative selections or another owner's mirror.
 * See contracts/bh-blaze-wing-owner-history-v1.json for the source boundary.
 */
const DAMAGE_NAME='DamageEffect_SBH_Blaze_Wing_Sub';
const own=(object,key)=>object&&Object.hasOwn(object,key)?object[key]:undefined;
const sequence=value=>Number.isSafeInteger(value)&&value>=0;
const rosterActor=(sim,ownerId)=>sim.state.actors.find(actor=>actor.id===ownerId);
const remote=(sim,ownerId)=>sim.networkOwnerId!=null&&ownerId!==sim.networkOwnerId;
// Define an own property even for unusual roster IDs such as '__proto__'.
function put(object,key,value){Object.defineProperty(object,key,{value,writable:true,enumerable:true,configurable:true});return value;}
function mirrorFor(sim,ownerId){
  if(!rosterActor(sim,ownerId))throw new RangeError('Unknown Blaze Wing history owner');
  const mirrors=sim.state.sourceBlazeWingMirrors??={};
  return own(mirrors,ownerId)??put(mirrors,ownerId,{history:[],serial:0});
}
/** Mutable exclusion set for this simulation's owner domain. */
export function blazeWingHistoryFor(sim,ownerId){
  return remote(sim,ownerId)?mirrorFor(sim,ownerId).history:(sim.state.sourceBlazeWingPreviousTargets??=[]);
}
export function blazeWingSelectionSerialFor(sim,ownerId){
  return remote(sim,ownerId)?mirrorFor(sim,ownerId).serial:(sim.state.sourceBlazeWingSelectionSerial??0);
}
/** A decision includes an unsuccessful search that clears the exclusion set. */
export function recordBlazeWingSelection(sim,ownerId){
  const current=blazeWingSelectionSerialFor(sim,ownerId);
  if(!sequence(current)||current===Number.MAX_SAFE_INTEGER)throw new RangeError('Invalid Blaze Wing selection serial');
  const next=current+1;
  if(remote(sim,ownerId))mirrorFor(sim,ownerId).serial=next;else sim.state.sourceBlazeWingSelectionSerial=next;
  return next;
}
function validHistory(history,actors){
  return Array.isArray(history)&&history.length<=actors.length&&new Set(history).size===history.length&&
    history.every(id=>typeof id==='string'&&actors.some(actor=>actor.id===id));
}
/** Call only after an accepted, complete owner report has restored its effects.
 * Returns true when a history was applied. An accepted report with no live
 * LOT6 history advances the receipt watermark but preserves the previous set.
 * Receipts live in snapshot state, so rollback restores their watermarks too.
 * Partial critical-action/collision samples must pass endMissing:false.
 */
export function receiveBlazeWingHistory(sim,ownerId,report,{endMissing=true}={}){
  if(!endMissing||!remote(sim,ownerId)||!rosterActor(sim,ownerId)||
    !sequence(report?.epoch)||!sequence(report?.frameSeq)||!Array.isArray(report.effects))return false;
  const expectedEpoch=sim.networkEpochFor?.(ownerId);
  if(expectedEpoch!==undefined&&report.epoch!==expectedEpoch)return false;
  const previous=own(sim.state.localBlazeWingHistoryReceipts,ownerId);
  if(previous&&(report.epoch<previous.epoch||report.epoch===previous.epoch&&report.frameSeq<=previous.frameSeq))return false;
  let latest=null;
  for(const effect of report.effects){
    if(effect?.name!==DAMAGE_NAME||effect.sourceBlazeWingLockOn===undefined)continue;
    if(effect.ownerId!==undefined&&effect.ownerId!==ownerId)return false;
    const control=effect.sourceBlazeWingLockOn;
    if(!control||!sequence(control.selectionSerial)||!validHistory(control.historySnapshot,sim.state.actors))return false;
    if(!latest||control.selectionSerial>latest.selectionSerial)latest=control;
    else if(control.selectionSerial===latest.selectionSerial&&
      (control.historySnapshot.length!==latest.historySnapshot.length||control.historySnapshot.some((id,i)=>id!==latest.historySnapshot[i])))return false;
  }
  const receipts=sim.state.localBlazeWingHistoryReceipts??={};
  put(receipts,ownerId,{epoch:report.epoch,frameSeq:report.frameSeq});
  if(!latest)return false;
  // A newer authoritative frame may correct prediction to a lower serial.
  // Epoch/frame, never a serial from another owner or local prediction, orders
  // receipts. Serial only chooses the latest history within this one report.
  const mirror=mirrorFor(sim,ownerId);
  mirror.history=[...latest.historySnapshot];mirror.serial=latest.selectionSerial;
  return true;
}
