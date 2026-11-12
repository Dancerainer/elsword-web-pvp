/** Independent Buff mutation/repair stream. The source simulation clock is
 * explicit; no receiver frame counter or browser FPS enters timer recovery.
 * static analysis bit23/0x1b/0x395 motivate this Web protocol, not wire compatibility. */
import {createOwnerStatusClock,decodeOwnerStatusClock,MAX_OWNER_STATUS_CLOCK_FRAMES} from './owner-status-clock.mjs';
import {validateOwnedStatus} from './owned-status.mjs';

// v2 binds every auxiliary message to both owner and requester. v1 peers
// keep the full owner-status fallback instead of guessing identity roles.
export const OWNER_BUFF_SYNC_VERSION=2;
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const clone=v=>structuredClone(v);
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const exact=(v,keys)=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const fail=()=>{throw new TypeError('invalid-owner-buff-sync');};

export function decodeOwnerBuffProtection(value){
  if(!exact(value,['protocol','epoch','frameSeq','buffRevision','actor'])||value.protocol!=='owner-buff-status-v1'||!safe(value.epoch)||!safe(value.frameSeq)||!safe(value.buffRevision)||value.buffRevision<1||!plain(value.actor)||Object.hasOwn(value.actor,'buffs'))fail();
  return validateOwnedStatus({protocol:'owner-status-v1',epoch:value.epoch,frameSeq:value.frameSeq,actor:{...clone(value.actor),buffs:[]}});
}
export function validateOwnerBuffSnapshot(value){
  if(!exact(value,['version','epoch','revision','frameSeq','buffs'])||value.version!==1||!safe(value.epoch)||!safe(value.revision)||value.revision<1||!safe(value.frameSeq))fail();
  validateOwnedStatus({protocol:'owner-status-v1',epoch:value.epoch,frameSeq:value.frameSeq,actor:{buffs:value.buffs,
    invincible:false,superArmor:false,superArmorNotRed:false,sourceStatusClock:{version:1,revision:1,frameSeq:value.frameSeq}}});
  return true;
}

export function createOwnerBuffSender(){
  const mutationClock=createOwnerStatusClock({checkpointFrames:MAX_OWNER_STATUS_CLOCK_FRAMES});
  let latest=null,revision=0,epoch=null,anchor=null;
  return {
    capture(value){
      const status=validateOwnedStatus(value),decoded=decodeOwnerStatusClock(status.actor,status.frameSeq);
      const life=epoch!==status.epoch;
      const projected=mutationClock.encode({buffs:decoded.buffs,invincible:false,superArmor:false,superArmorNotRed:false},status.epoch,status.frameSeq);
      if(life||projected.changed){revision++;if(!safe(revision))fail();}
      const refresh=life||projected.changed||!anchor||status.frameSeq-anchor.frameSeq>=300;
      epoch=status.epoch;latest=status;
      if(refresh)anchor={version:1,epoch,revision,frameSeq:status.frameSeq,buffs:clone(decoded.buffs)};
      return {epoch,revision,frameSeq:anchor.frameSeq,changed:life||projected.changed,refresh};
    },
    snapshot(){return anchor?clone(anchor):null;},
    compact(){
      if(!latest)return null;
      const actor=decodeOwnerStatusClock(latest.actor,latest.frameSeq);delete actor.buffs;
      // Buff snapshot and protection clock can have different anchors. Both
      // are materialized at this source frame before the existing v1 consumer.
      actor.sourceStatusClock={...actor.sourceStatusClock,frameSeq:latest.frameSeq};
      return {protocol:'owner-buff-status-v1',epoch,frameSeq:latest.frameSeq,buffRevision:revision,actor};
    },
    clear(){mutationClock.clear();latest=null;epoch=null;anchor=null;revision=0;},
  };
}

export function createOwnerBuffReceiver(){
  let snapshot=null,previous=null;
  const metrics={snapshots:0,stale:0,recovered:0,missing:0};
  return {
    install(value){
      // Reuse the complete strict Buff runtime schema, including counter and
      // behavior parameters; a repair is never trusted merely for its marker.
      validateOwnerBuffSnapshot(value);
      if(snapshot&&(value.epoch<snapshot.epoch||value.epoch===snapshot.epoch&&(value.revision<snapshot.revision||value.revision===snapshot.revision&&value.frameSeq<snapshot.frameSeq))){metrics.stale++;return false;}
      if(snapshot&&value.epoch===snapshot.epoch&&value.revision===snapshot.revision&&value.frameSeq>snapshot.frameSeq)previous=snapshot;
      else if(!snapshot||value.epoch!==snapshot.epoch||value.revision!==snapshot.revision)previous=null;
      snapshot=clone(value);metrics.snapshots++;return true;
    },
    decode(value){
      decodeOwnerBuffProtection(value);
      const base=[snapshot,previous].find(row=>row&&row.epoch===value.epoch&&row.revision===value.buffRevision&&value.frameSeq>=row.frameSeq&&value.frameSeq-row.frameSeq<=MAX_OWNER_STATUS_CLOCK_FRAMES);
      if(!base){metrics.missing++;return null;}
      const actor={...clone(value.actor),buffs:clone(base.buffs),sourceStatusClock:{version:1,revision:1,frameSeq:base.frameSeq}};
      const buffs=decodeOwnerStatusClock(actor,value.frameSeq).buffs;
      const result=validateOwnedStatus({protocol:'owner-status-v1',epoch:value.epoch,frameSeq:value.frameSeq,actor:{...clone(value.actor),buffs}});
      metrics.recovered++;return result;
    },
    clear(){snapshot=null;previous=null;},
    performance(){return {...metrics,epoch:snapshot?.epoch??null,revision:snapshot?.revision??null,frameSeq:snapshot?.frameSeq??null};},
  };
}
