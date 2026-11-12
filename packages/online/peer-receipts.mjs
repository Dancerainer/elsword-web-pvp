/** Optional receiver evidence for one room/life. A control ID names a
 * canonical action, not an RTC packet sequence or an inferred watermark. */
export const MAX_PEER_CONTROL_IDS=128;
export const PEER_RECEIPT_MAXIMUM_AGE_MS=750;
const integer=value=>Number.isSafeInteger(value)&&value>=0;

export function normalizePeerReceipts(value){
 if(!Array.isArray(value)||value.length>5)throw new TypeError('invalid-peer-receipts');
 const players=new Set();return value.map(receipt=>{
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)
   ||Object.keys(receipt).some(key=>!['playerId','epoch','frameSeq','controlIds'].includes(key))
   ||typeof receipt.playerId!=='string'||!receipt.playerId.length||receipt.playerId.length>128||players.has(receipt.playerId)
   ||!integer(receipt.epoch)||!integer(receipt.frameSeq))throw new TypeError('invalid-peer-receipts');
  players.add(receipt.playerId);
  if(receipt.controlIds!==undefined){
   if(!Array.isArray(receipt.controlIds)||receipt.controlIds.length>MAX_PEER_CONTROL_IDS)throw new TypeError('invalid-peer-receipts');
   let previous=-1;for(const id of receipt.controlIds){if(!integer(id)||id<=previous)throw new TypeError('invalid-peer-receipts');previous=id;}
  }
  return {playerId:receipt.playerId,epoch:receipt.epoch,frameSeq:receipt.frameSeq,
   ...(receipt.controlIds===undefined?{}:{controlIds:[...receipt.controlIds]})};
 });
}

/** No birth/lifecycle fields are removed. The caller binds receipt identity
 * to its authenticated receiver and current match before using this helper. */
export function pruneAcknowledgedPeerActions(value,receipt,{now,maxAgeMs=PEER_RECEIPT_MAXIMUM_AGE_MS}={}){
 if(!receipt||receipt.playerId!==value.playerId||receipt.epoch!==value.epoch||!Array.isArray(receipt.controlIds)
  ||!Number.isFinite(now)||!Number.isFinite(receipt.at)||now<receipt.at||now-receipt.at>=maxAgeMs
  ||!Array.isArray(value.actions)||!value.actions.length)return {value,skipped:0};
 const acknowledged=new Set(receipt.controlIds),actions=value.actions.filter(action=>!acknowledged.has(action.id));
 const skipped=value.actions.length-actions.length;
 return {value:skipped?{...value,actions}:value,skipped};
}

/** Encoders remember these definitions before IPC reaches the coordinator.
 * Keep their first reliable delivery even when all action IDs were received
 * over RTC; independent transport dictionaries cannot seed one another. */
export function hasPeerActionBaselines(value){
 return value.actionActorBaseline!==undefined||Boolean(value.actionEffectBaselines?.length)||Boolean(value.actionBuffBaselines?.length);
}
