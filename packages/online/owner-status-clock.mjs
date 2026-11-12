/** Web ownership transport projection, not a change to the owner's Buffs.
 * Buff normal-time finalizers run before the unit's animation-stop gate. A
 * baseline therefore advances by source simulation frames, using the same
 * binary32 subtraction as tickBuffs. Other status changes stay exact.
 *
 * forceInvincible advances by unfrozen elapsed, and showInvincible has its
 * own swap gate. Neither is cached or predicted: every packet keeps its exact
 * current clocks. Only their protection/display start and end trigger a
 * status revision; ordinary countdown or swap changes add no status event.
 *
 * Epoch/revision acceptance belongs to the receiving ownership ledger. This
 * pure decoder cannot know that a newer end was already accepted elsewhere.
 */
export const OWNER_STATUS_CLOCK_VERSION=1;
export const MAX_OWNER_STATUS_CLOCK_FRAMES=600;
const FDT=Math.fround(1/60),TIMER_TOLERANCE=1e-6;
const STATUS_FIELDS=['buffs','invincible','superArmor','superArmorNotRed','skillSuperArmorNotRed'];
const FLAGS=new Set(['invincible','superArmor','superArmorNotRed','skillSuperArmorNotRed']);
const safe=n=>Number.isSafeInteger(n)&&n>=0;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const clone=v=>structuredClone(v);
const fail=reason=>{throw new TypeError(reason);};

export function validateSourceStatusClock(marker,reportFrameSeq){
  if(!plain(marker)||Object.keys(marker).length!==3||Object.keys(marker).some(key=>!['version','revision','frameSeq'].includes(key))||
    marker.version!==OWNER_STATUS_CLOCK_VERSION||!safe(marker.revision)||marker.revision<1||!safe(marker.frameSeq))
    fail('invalid-owner-status-clock');
  if(reportFrameSeq!==undefined&&(!safe(reportFrameSeq)||marker.frameSeq>reportFrameSeq||reportFrameSeq-marker.frameSeq>MAX_OWNER_STATUS_CLOCK_FRAMES))
    fail('invalid-owner-status-clock-frame');
  return true;
}

function status(actor){
  if(!plain(actor)||!Array.isArray(actor.buffs)||actor.buffs.length>512)fail('invalid-owner-status-actor');
  const result={};
  for(const key of STATUS_FIELDS)if(Object.hasOwn(actor,key))result[key]=clone(actor[key]);
  for(const key of FLAGS)if(Object.hasOwn(result,key)&&typeof result[key]!=='boolean')fail('invalid-owner-status-protection');
  if(Object.hasOwn(actor,'forceInvincible')&&(!Number.isFinite(actor.forceInvincible)||actor.forceInvincible<0))fail('invalid-owner-status-protection');
  const show=actor.showInvincible;
  if(Object.hasOwn(actor,'showInvincible')&&(!plain(show)||Object.keys(show).length!==3||Object.keys(show).some(key=>!['remaining','swapRemaining','white'].includes(key))||
    !Number.isFinite(show.remaining)||show.remaining<0||!Number.isFinite(show.swapRemaining)||show.swapRemaining<0||show.swapRemaining>.05||typeof show.white!=='boolean'))
    fail('invalid-owner-status-display');
  for(const buff of result.buffs){
    if(!plain(buff)||!Array.isArray(buff.behaviors)||!Array.isArray(buff.finalizers)||buff.behaviors.length>512||buff.finalizers.length>512)
      fail('invalid-owner-status-buff');
    for(const row of buff.finalizers){
      if(!plain(row)||typeof row.kind!=='string'||!Number.isFinite(row.remaining))fail('invalid-owner-status-finalizer');
      if(row.kind==='time'&&(!Number.isFinite(row.sourceDuration)||!Number.isFinite(Math.fround(row.remaining))))
        fail('invalid-owner-status-finalizer');
    }
    // Stackable resource rows retain their native kind/value/interval and
    // merge semantics. An observer never executes its resource interval, so
    // the sender's private interval accumulator supplies no contact evidence.
    for(const row of buff.behaviors){
      if(!plain(row)||typeof row.kind!=='string')fail('invalid-owner-status-behavior');
      if(buff.accumulationLimit>1&&['hpInterval','mpInterval'].includes(row.kind)){
        if(!Number.isFinite(row.sum))fail('invalid-owner-status-interval');
        row.sum=0;
      }
    }
  }
  return result;
}

function advance(base,frames){
  const result=clone(base);
  // The negotiated checkpoint bound also bounds decoding work. Do not
  // approximate float32 finalizers with one large double subtraction.
  for(let frame=0;frame<frames;frame++){
    for(const buff of result.buffs)for(const row of buff.finalizers)if(row.kind==='time')row.remaining=Math.fround(row.remaining-FDT);
  }
  return result;
}
function equal(a,b){
  if(Object.is(a,b))return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
  if(!plain(a)||!plain(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
}
function sameStatus(actual,predicted){
  const comparable=clone(actual);
  for(let index=0;index<comparable.buffs.length;index++){
    const buff=comparable.buffs[index],old=predicted.buffs[index];
    if(!old||buff.finalizers.length!==old.finalizers.length)continue;
    for(let at=0;at<buff.finalizers.length;at++){
      const row=buff.finalizers[at],expected=old.finalizers[at];
      if(row.kind==='time'&&expected.kind==='time'&&Math.abs(row.remaining-expected.remaining)<=TIMER_TOLERANCE)
        row.remaining=expected.remaining;
    }
  }
  // Only predicted timers use tolerance. Stat/rate/counter/identity changes
  // retain exact comparison even when their difference is below 1e-6.
  return equal(comparable,predicted);
}
function replaceStatus(actor,value,marker){
  const result={...actor};for(const key of STATUS_FIELDS)delete result[key];
  if(Object.hasOwn(actor,'showInvincible'))result.showInvincible=clone(actor.showInvincible);
  return {...result,...clone(value),sourceStatusClock:{...marker}};
}

export function createOwnerStatusClock({checkpointFrames=30}={}){
  if(!safe(checkpointFrames)||checkpointFrames<1||checkpointFrames>MAX_OWNER_STATUS_CLOCK_FRAMES)fail('invalid-owner-status-checkpoint');
  let row=null,revision=0;
  return {
    encode(actorWire,epoch,frameSeq){
      if(!safe(epoch)||!safe(frameSeq))fail('invalid-owner-status-source-frame');
      if(Object.hasOwn(actorWire??{},'sourceStatusClock'))fail('owner-status-clock-already-encoded');
      const current=status(actorWire);
      const activity={forceInvincible:actorWire.forceInvincible>0,showInvincible:actorWire.showInvincible?.remaining>0};
      if(row&&(epoch<row.epoch||epoch===row.epoch&&frameSeq<row.lastFrame))fail('old-owner-status-source-frame');
      const newLife=!row||row.epoch!==epoch;
      const overdue=!newLife&&frameSeq-row.frameSeq>MAX_OWNER_STATUS_CLOCK_FRAMES;
      // Keep the reliable wire base unchanged, but advance a separate local
      // prediction only since the previous source call. A steady 60 Hz sender
      // executes one timer step instead of replaying 1..30 steps each time.
      const predicted=newLife||overdue?null:advance(row.predicted,frameSeq-row.lastFrame);
      const changed=newLife||overdue||!equal(activity,row.activity)||!sameStatus(current,predicted);
      const checkpoint=newLife||frameSeq-row.frameSeq>=checkpointFrames;
      if(changed||checkpoint){
        if(revision===Number.MAX_SAFE_INTEGER)fail('owner-status-revision-overflow');
        revision++;row={epoch,frameSeq,lastFrame:frameSeq,value:current,predicted:clone(current),activity,revision};
      }else {row.lastFrame=frameSeq;row.predicted=predicted;}
      const marker={version:OWNER_STATUS_CLOCK_VERSION,revision:row.revision,frameSeq:row.frameSeq};
      return {actor:replaceStatus(actorWire,row.value,marker),changed,checkpoint};
    },
    clear(){row=null;},
  };
}

export function decodeOwnerStatusClock(actorWire,reportFrameSeq){
  if(!plain(actorWire))fail('invalid-owner-status-actor');
  if(!Object.hasOwn(actorWire,'sourceStatusClock'))return clone(actorWire);
  const marker=actorWire.sourceStatusClock;
  validateSourceStatusClock(marker,reportFrameSeq);
  if(!safe(reportFrameSeq))fail('invalid-owner-status-clock-frame');
  return replaceStatus(actorWire,advance(status(actorWire),reportFrameSeq-marker.frameSeq),marker);
}
