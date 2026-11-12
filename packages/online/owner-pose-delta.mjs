/** Lossless pose packets relative to an acknowledged raw snapshot. Every
 * unreliable packet is independently decodable; a lost birth/update never
 * becomes the next packet's prerequisite. No live simulation object is kept.
 * Buff/effect definitions travel at birth/change, clocks remain exact patches.
 */
import {validateOwnedState,MAX_OWNER_BYTES,MAX_OWNER_EFFECTS,OWNERSHIP_PROTOCOL} from './owned-state.mjs';
export const OWNER_POSE_DELTA_VERSION=1;
export const OWNER_POSE_MASK_VERSION=2;
const copy=value=>structuredClone(value),bad=new Set(['__proto__','constructor','prototype']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
// Web v2 applies the native fixed-layout change-mask idea to Web-owned fields.
// These are Web names, not inferred names for the original 24 native fields.
// Two bits per field: 0 unchanged, 1 replacement, 2 deletion, 3 nested patch.
// Each table/order is frozen for version 2. Unknown names use explicit s/d/n.
const table=text=>Object.freeze(text.split(' '));
export const OWNER_POSE_MASK_FIELDS=Object.freeze({
 actor:table('x y z vx vy vz state stateTime stateSerial animationTime animationBeforeTime animationOneshotTimer facing grounded lineId lastTouchLineId hp mp hitStop worldStop animationName animationLoop animationPlaybackSpeed animationTransitionSerial animationStopped animationSpeedRamp presentationTransition passiveSpeed canNotJumpTime canNotAttackTime reAttackZ1Time skillId skillContext skillScale awakening core cooldowns invincible showInvincible superArmor superArmorNotRed forceInvincible sourceStatusClock knockdown manaBreak flyCount lastAttackerFront downForce jumpOnLanding buffs buffControls fired hitGaps buffered tapTimes doubleHeldDirections ignoreLineId dropRemaining death deathPresentation deathAlpha deathComplete hidden downSuccessor applyMotionOffset consumeRootTranslation rootMotionEnabled motionMoveNow jumpAttackDown sourceCommandFlags reAttackZ1Right sourceDashJumpEffectHandle landPosition effectiveBlackHoleIds blackHoleDisplacement sourceBlackHoleCanPass limitCrusherCharging soundSet pendingPlatformJump pendingPressed tapReleased sourceArcEnemy sourceMegaDrill sourceMegaDrillNowSupported sourceWildCharge sourceXCrash sourceWildChargeEffectGroup sourceAwakeningAuraEffectGroup sourceCustomStateEffectGroup sourceDashJumpEffectGroup sourceCommandDirection sourceCommandHandPosition skillDisableGravity skillDownAccel skillSuperArmorNotRed animationSpeedOverride animationTargetSpeed platformAttackInput additionalDamageEffect wayOfSword destructionRageRemaining sourceWayOfSwordEffectGroup sourceLordKnight sourceRuneSlayer sourceRuneSlayerHitReceipts sourceReflectionNotice sourceVeteranCommander sourceInfinitySword sourceBladeMaster sourceElesisSkills sourceElesisCommand sourceElesisBreakCharge sourceElesisGaleHits sourceElesisComboRemaining sourceElesisEndurance sourceElesisBurst sourceAdd sourceAddMovement sourceAddCombat sourceAddSummon sourceTimeRing sourceTimeSickness sourceTimeRingNotice sourceAddTargetNotice sourceAddDroneMark sourceAddStigma sourceAddStigmaNotice sourceAddFantasyTracer downAttackChoice standupAttackNoDown mapMechanics sourceShadowStep hits'),
 effect:table('elapsed x y z vx vy vz animationTime animationBeforeTime animationPlaybackSpeed active expired id name setName birthAnchor currentAnchor sourcePosedAnchor parentEffectId remaining duration scale rotation direction alpha ownerFrame sourceFrame birthFrame hitGaps hits sourceContinuousAura sourceAddMaximumStrike sourceAddSummon sourceAddSummonPose sourceAddSummonSerial sourceAddQuicksilverLink sourceAddDroneMark sourceAddStigma sourceISSheath sourceISSheathFollowing sourcePhantomSword sourcePhantomAttackSerial sourceBlazeWingLockOn sourceInfinityLockOn sourceInfinityManualDirDegree sourceBuffFactor sourceProfessionId sourceReflection sourceReflected sourceDirSpeedSign sourceRuneLevel sourceVeteranAttachment sourceVeteranTargetId sourceShadowMesh'),
 buff:table('remaining elapsed templateId sourceFrame sourceTime revision source sourceId targetId stack stacks duration level slot behavior behaviors active value factor startFrame endFrame'),
 meta:table('protocol hits actions actionFrontierComplete'),
 nested:table('remaining elapsed x y z vx vy vz frameSeq sourceFrame frame time serial revision value count active full enabled state stateTime position direction rotation scale timer duration source target id templateId hitStop worldStop hp mp maxHp maxMp index kind level factor stack stacks startFrame endFrame')
});
const MASK_INDEX=Object.fromEntries(Object.entries(OWNER_POSE_MASK_FIELDS).map(([name,fields])=>[name,new Map(fields.map((key,index)=>[key,index]))]));
function same(value,base){
 if(Object.is(value,base))return true;
 if(Array.isArray(value)&&Array.isArray(base)){if(value.length!==base.length)return false;for(let i=0;i<value.length;i++)if(Object.hasOwn(value,i)!==Object.hasOwn(base,i)||!same(value[i],base[i]))return false;return true;}
 if(plain(value)&&plain(base)){const keys=Object.keys(value);if(keys.length!==Object.keys(base).length)return false;for(const key of keys)if(!Object.hasOwn(base,key)||!same(value[key],base[key]))return false;return true;}
 return false;
}
const maskEmpty=patch=>patch.m.length===0&&!patch.s&&!patch.d&&!patch.n;
function maskDiff(value,base,scope='nested'){
 const words=[],payload=[],operations=new Map(),sets={},deletes=[],nested={},indices=MASK_INDEX[scope];
 function changed(key,operation,item){const index=indices.get(key);if(index===undefined){if(operation===1)sets[key]=item;else if(operation===2)deletes.push(key);else nested[key]=item;}else operations.set(index,{operation,item});}
 for(const [key,item]of Object.entries(value)){
  const old=base[key];if(Object.hasOwn(base,key)&&Object.is(item,old))continue;
  if(plain(item)&&plain(old)){const patch=maskDiff(item,old);if(!maskEmpty(patch))changed(key,3,patch);}
  else if(!Object.hasOwn(base,key)||!same(item,old))changed(key,1,copy(item));
 }
 for(const key of Object.keys(base))if(!Object.hasOwn(value,key))changed(key,2);
 for(const index of [...operations.keys()].sort((a,b)=>a-b)){const {operation,item}=operations.get(index),word=Math.floor(index/16),shift=(index%16)*2;while(words.length<=word)words.push(0);words[word]=(words[word]|(operation<<shift))>>>0;if(operation!==2)payload.push(item);}
 return {m:words,v:payload,...(Object.keys(sets).length?{s:sets}:{}),...(deletes.length?{d:deletes}:{}),...(Object.keys(nested).length?{n:nested}:{})};
}
function maskRestore(patch,base,scope='nested',depth=0){
 const fields=OWNER_POSE_MASK_FIELDS[scope],indices=MASK_INDEX[scope];
 if(depth>18||!plain(base)||!plain(patch)||!Array.isArray(patch.m)||!Array.isArray(patch.v)
  ||patch.m.length>Math.ceil(fields.length/16)||patch.v.length>fields.length
  ||patch.m.some(word=>!Number.isInteger(word)||word<0||word>0xffffffff)||patch.m.length&&patch.m.at(-1)===0
  ||patch.s!==undefined&&!plain(patch.s)||patch.d!==undefined&&(!Array.isArray(patch.d)||patch.d.length>512)
  ||patch.n!==undefined&&!plain(patch.n)||Object.keys(patch).some(key=>!['m','v','s','d','n'].includes(key)))throw Error('invalid-pose-mask-patch');
 const out=copy(base),used=new Set();let offset=0;
 const check=key=>{if(typeof key!=='string'||key.length>128||bad.has(key)||used.has(key))throw Error('pose-delta-key');used.add(key);};
 for(let index=0;index<patch.m.length*16;index++){
  const operation=(patch.m[Math.floor(index/16)]>>>((index%16)*2))&3;if(!operation)continue;
  if(index>=fields.length)throw Error('invalid-pose-mask-field');const key=fields[index];check(key);
  if(operation===2){delete out[key];continue;}
  if(offset>=patch.v.length)throw Error('invalid-pose-mask-values');const item=patch.v[offset++];
  if(operation===1){safe(item);out[key]=copy(item);}else out[key]=maskRestore(item,base[key],'nested',depth+1);
 }
 if(offset!==patch.v.length)throw Error('invalid-pose-mask-values');
 for(const key of patch.d??[]){check(key);if(indices.has(key))throw Error('invalid-pose-mask-fallback');delete out[key];}
 for(const [key,item]of Object.entries(patch.s??{})){check(key);if(indices.has(key))throw Error('invalid-pose-mask-fallback');safe(item);out[key]=copy(item);}
 for(const [key,item]of Object.entries(patch.n??{})){check(key);if(indices.has(key))throw Error('invalid-pose-mask-fallback');out[key]=maskRestore(item,base[key],'nested',depth+1);}
 return out;
}
function safe(value,depth=0){
 if(depth>18)throw Error('pose-delta-depth');
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=512)return;
 if(Array.isArray(value)){if(value.length>512)throw Error('pose-delta-array');for(const item of value)safe(item,depth+1);return;}
 if(!plain(value)||Object.keys(value).length>512)throw Error('pose-delta-object');
 for(const [key,item]of Object.entries(value)){if(key.length>128||bad.has(key))throw Error('pose-delta-key');safe(item,depth+1);}
}
function diff(value,base){
 const s={},d=[],n={};
 for(const [key,item]of Object.entries(value)){
  const old=base[key];if(Object.is(item,old))continue;
  if(plain(item)&&plain(old)){const patch=diff(item,old);if(Object.keys(patch.s).length||patch.d.length||Object.keys(patch.n??{}).length)n[key]=patch;}
  else if(JSON.stringify(item)!==JSON.stringify(old))s[key]=copy(item);
 }
 for(const key of Object.keys(base))if(!Object.hasOwn(value,key))d.push(key);
 return {s,d,...(Object.keys(n).length?{n}:{})};
}
function restore(patch,base,depth=0){
 if(depth>18||!plain(base)||!plain(patch)||!plain(patch.s)||!Array.isArray(patch.d)||patch.d.length>512
  ||patch.n!==undefined&&!plain(patch.n)||Object.keys(patch).some(k=>!['s','d','n'].includes(k)))throw Error('invalid-pose-delta-patch');
 const out=copy(base),used=new Set();
 const key=k=>{if(typeof k!=='string'||k.length>128||bad.has(k)||used.has(k))throw Error('pose-delta-key');used.add(k);};
 for(const k of patch.d){key(k);delete out[k];}
 for(const [k,v]of Object.entries(patch.s)){key(k);safe(v);out[k]=copy(v);}
 for(const [k,v]of Object.entries(patch.n??{})){key(k);out[k]=restore(v,base[k],depth+1);}
 return out;
}
function listEncode(value,base,identity,version=1,scope='nested'){
 const old=new Map(base.map((item,index)=>[identity(item,index),{item,index}]));
 return value.map((item,index)=>{
  const prior=old.get(identity(item,index));if(!prior)return {v:copy(item)};
  const p=version===2?maskDiff(item,prior.item,scope):diff(item,prior.item),row={b:prior.index,p};return bytes(row)<bytes({v:item})?row:{v:copy(item)};
 });
}
function listDecode(rows,base,maximum,version=1,scope='nested'){
 if(!Array.isArray(rows)||rows.length>maximum)throw Error('pose-delta-list');
 return rows.map(row=>{
  if(!plain(row))throw Error('pose-delta-list');
  if(Object.hasOwn(row,'v')){if(Object.keys(row).length!==1)throw Error('pose-delta-list');safe(row.v);return copy(row.v);}
  if(Object.keys(row).length!==2||!Object.hasOwn(row,'p')||!integer(row.b)||row.b>=base.length)throw Error('pose-delta-list');
  return version===2?maskRestore(row.p,base[row.b],scope):restore(row.p,base[row.b]);
 });
}
function shape(report){
 if(!plain(report)||report.protocol!==OWNERSHIP_PROTOCOL||!integer(report.epoch)||!integer(report.frameSeq)||!plain(report.actor)
  ||Object.hasOwn(report.actor,'buffs')&&!Array.isArray(report.actor.buffs)
  ||!Array.isArray(report.effects)||report.effects.length>MAX_OWNER_EFFECTS||report.hits?.length||report.actions?.length)throw Error('invalid-pose-delta-report');
}
function header(report){const {epoch,frameSeq,actor,effects,...rest}=report;return rest;}
function body(actor){const {buffs,...rest}=actor;return rest;}
export function createOwnerPoseDelta({maximumSnapshots=24,maximumBytes=24*MAX_OWNER_BYTES,fullEveryFrames=60,validate=validateOwnedState}={}){
 if(!Number.isSafeInteger(maximumSnapshots)||maximumSnapshots<2||!Number.isSafeInteger(maximumBytes)||maximumBytes<MAX_OWNER_BYTES
  ||!Number.isSafeInteger(fullEveryFrames)||fullEveryFrames<1)throw Error('invalid-pose-delta-limits');
 const sent=new Map(),received=new Map();let sentBytes=0,receivedBytes=0,sentEpoch=null,receivedEpoch=null,lastFull=-Infinity;
 const counts={fullSent:0,deltaSent:0,fullReceived:0,deltaReceived:0,missingBases:0,fullFallbacks:0};
 function retain(map,report,side,size,detached=false){
  // Size comes from this encode/decode operation's bounded source, never a
  // caller-provided cache. Receiver commit retains its private frozen-in-time
  // candidate, so mutating the public report cannot invalidate accounting.
  if(size>MAX_OWNER_BYTES)throw Error('pose-delta-decoded-size');
  const prior=map.get(report.frameSeq);
  if(prior){if(JSON.stringify(prior.report)!==JSON.stringify(report))throw Error('pose-delta-conflicting-frame');return;}
  // A receiver candidate is already a private detached snapshot. Sharing it
  // with its private cache is safe; no live/public report can mutate this tree.
  map.set(report.frameSeq,{report:detached?report:copy(report),bytes:size});if(side==='sent')sentBytes+=size;else receivedBytes+=size;
  while(map.size>maximumSnapshots||(side==='sent'?sentBytes:receivedBytes)>maximumBytes){
   const first=map.keys().next().value,row=map.get(first);map.delete(first);if(side==='sent')sentBytes-=row.bytes;else receivedBytes-=row.bytes;
  }
 }
 function decode(packet){
  if(!plain(packet)||![OWNER_POSE_DELTA_VERSION,OWNER_POSE_MASK_VERSION].includes(packet.v)||typeof packet.full!=='boolean'||!integer(packet.epoch)||!integer(packet.frameSeq)
   ||Object.keys(packet).some(key=>!['v','full','epoch','frameSeq','base','report','meta','actor','buffs','effects'].includes(key)))throw Error('invalid-pose-delta-envelope');
  if(receivedEpoch!==null&&packet.epoch<receivedEpoch)throw Error('pose-delta-old-life');
  let report;
  if(packet.full){
   if(!packet.report||Object.keys(packet).length!==5)throw Error('invalid-pose-delta-full');
   report=copy(packet.report);shape(report);if(packet.v===2)safe(report);
  }else{
   if(Object.keys(packet).length!==9||!integer(packet.base)||packet.base>=packet.frameSeq||receivedEpoch!==packet.epoch)throw Error('invalid-pose-delta-base');
   const row=received.get(packet.base);if(!row){counts.missingBases++;throw Error('pose-delta-baseline-required');}
   const base=row.report,actor=packet.v===2?maskRestore(packet.actor,body(base.actor),'actor'):restore(packet.actor,body(base.actor));
   if(packet.buffs!==null)actor.buffs=listDecode(packet.buffs,base.actor.buffs??[],512,packet.v,'buff');
   report={...(packet.v===2?maskRestore(packet.meta,header(base),'meta'):restore(packet.meta,header(base))),epoch:packet.epoch,frameSeq:packet.frameSeq,actor,effects:listDecode(packet.effects,base.effects,MAX_OWNER_EFFECTS,packet.v,'effect')};
  }
  if(report.epoch!==packet.epoch||report.frameSeq!==packet.frameSeq)throw Error('pose-delta-clock');
  const checked=validate(report);shape(checked);const size=bytes(checked);if(size>MAX_OWNER_BYTES)throw Error('pose-delta-decoded-size');
  const snapshot=copy(checked);let committed=false;
  return {report:checked,commit(){
   if(committed)return;committed=true;
   if(receivedEpoch!==null&&snapshot.epoch<receivedEpoch)throw Error('pose-delta-old-life');
   if(receivedEpoch!==snapshot.epoch){received.clear();receivedBytes=0;receivedEpoch=snapshot.epoch;}
   retain(received,snapshot,'received',size,true);counts[packet.full?'fullReceived':'deltaReceived']++;
  }};
 }
 return {
  encode(report,{acknowledgedEpoch=null,acknowledgedFrameSeq=-1,version=OWNER_POSE_DELTA_VERSION}={}){
   if(![OWNER_POSE_DELTA_VERSION,OWNER_POSE_MASK_VERSION].includes(version))throw Error('invalid-pose-delta-version');
   shape(report);if(version===2)safe(report);const size=bytes(report);if(size>MAX_OWNER_BYTES)throw Error('pose-delta-decoded-size');
   if(sentEpoch!==report.epoch){if(sentEpoch!==null&&report.epoch<sentEpoch)throw Error('pose-delta-old-life');sent.clear();sentBytes=0;sentEpoch=report.epoch;lastFull=-Infinity;}
   const base=acknowledgedEpoch===report.epoch&&acknowledgedFrameSeq<report.frameSeq?sent.get(acknowledgedFrameSeq)?.report:null;
   // Compare the full size without cloning a tree that a smaller delta will
   // immediately discard. Detach the public full packet only when selected.
   let packet={v:version,full:true,epoch:report.epoch,frameSeq:report.frameSeq,report};
   if(base&&report.frameSeq-lastFull<fullEveryFrames){
    const candidate={v:version,full:false,epoch:report.epoch,frameSeq:report.frameSeq,base:base.frameSeq,meta:version===2?maskDiff(header(report),header(base),'meta'):diff(header(report),header(base)),
     actor:version===2?maskDiff(body(report.actor),body(base.actor),'actor'):diff(body(report.actor),body(base.actor)),
     // Match Buff by slot as well as template. Repeated native 97/98 identities
     // are ordered applications and must never collapse into one dictionary.
     buffs:Object.hasOwn(report.actor,'buffs')?listEncode(report.actor.buffs,base.actor.buffs??[],(buff,index)=>index+':'+buff.templateId,version,'buff'):null,
     effects:listEncode(report.effects,base.effects,effect=>effect.id,version,'effect')};
    // JSON's report value contributes exactly its own byte length. Avoid
    // serializing the full owner tree again just to compare envelope sizes.
    const fullSize=bytes({...packet,report:null})-4+size;
    if(bytes(candidate)<fullSize)packet=candidate;
   }
   if(packet.full){packet.report=copy(report);lastFull=report.frameSeq;counts.fullSent++;if(!base)counts.fullFallbacks++;}else counts.deltaSent++;
   retain(sent,report,'sent',size);return packet;
  },decode,
  reset(){sent.clear();received.clear();sentBytes=receivedBytes=0;sentEpoch=receivedEpoch=null;lastFull=-Infinity;},
  performance:()=>({...counts,sentSnapshots:sent.size,receivedSnapshots:received.size,sentBytes,receivedBytes,maximumBytes,maximumSnapshots})
 };
}
