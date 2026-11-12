/** Independent latest owner status. No pose, input, hit or resource authority
 * crosses this domain; current local combat remains on its owning client. */
import {MAX_OWNER_BYTES,validateOwnedStatusActor,validateOwnedBuffReferences} from './owned-state.mjs';
import {decodeOwnerStatusClock} from './owner-status-clock.mjs';
import {buffControls} from '../combat-core/buffs.mjs';
import {synchronizeBuffStats} from '../combat-core/passive-attributes-v20.mjs';
import {reconcileOwnedBuffDisplays} from './owned-buff-display.mjs';
export const OWNED_STATUS_PROTOCOL='owner-status-v1';
export const OWNED_STATUS_FIELDS=Object.freeze(['buffs','invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed','forceInvincible']);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export function captureOwnedStatusActor(actor){
  const result={};for(const key of OWNED_STATUS_FIELDS)if(actor[key]!==undefined)result[key]=structuredClone(actor[key]);return result;
}
export function validateOwnedStatus(value){
  if(!plain(value)||Object.keys(value).some(key=>!['protocol','epoch','frameSeq','actor'].includes(key))||
    value.protocol!==OWNED_STATUS_PROTOCOL||!safe(value.epoch)||!safe(value.frameSeq))throw new TypeError('invalid-owner-status');
  validateOwnedStatusActor(value.actor,value.frameSeq);
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>MAX_OWNER_BYTES)throw new TypeError('owner-status-too-large');
  return structuredClone(value);
}
export function encodeOwnedStatus(report){
  return validateOwnedStatus({protocol:OWNED_STATUS_PROTOCOL,epoch:report.epoch,frameSeq:report.frameSeq,
    actor:{...captureOwnedStatusActor(report.actor),sourceStatusClock:structuredClone(report.actor.sourceStatusClock)}});
}
export function validateOwnedStatusReferences(status,actor,profile,context={}){
  if(actor.profileId&&profile?.profileId!==actor.profileId)throw new TypeError('owner-profession-profile-mismatch');
  return validateOwnedBuffReferences(status.actor.buffs,actor,profile,context);
}
export function applyOwnedStatusActor(simulation,playerId,decodedActorStatus){
  if(typeof simulation.networkOwnerId!=='string'||playerId===simulation.networkOwnerId)throw new TypeError('owner-status-cannot-apply-local');
  const actor=simulation.state.actors.find(row=>row.id===playerId);if(!actor)throw new TypeError('missing-owner-actor');
  validateOwnedStatusActor(decodedActorStatus,undefined,{clock:false});
  for(const key of OWNED_STATUS_FIELDS){if(Object.hasOwn(decodedActorStatus,key))actor[key]=structuredClone(decodedActorStatus[key]);else delete actor[key];}
  const controls=buffControls(actor.buffs);actor.buffControls={inputBlock:controls.inputBlock,dashBlock:controls.dashBlock};
  // Stat projection may clamp resources as a convenience. A status receipt
  // has no permission to replace even the observer's separately supplied HP/MP.
  const hp=actor.hp,mp=actor.mp;
  if(actor.stats&&actor.buffBaseStats)synchronizeBuffStats(actor);
  actor.hp=hp;actor.mp=mp;reconcileOwnedBuffDisplays(simulation,actor);return actor;
}
export function applyOwnedStatus(simulation,playerId,value){
  const status=validateOwnedStatus(value),actor=simulation.state.actors.find(row=>row.id===playerId);
  if(!actor)throw new TypeError('missing-owner-actor');
  validateOwnedStatusReferences(status,actor,simulation.profileFor?.(actor)??simulation.profile,
    {profiles:simulation.profiles,actors:simulation.state.actors});
  const decoded=decodeOwnerStatusClock(status.actor,status.frameSeq);delete decoded.sourceStatusClock;
  return applyOwnedStatusActor(simulation,playerId,decoded);
}
