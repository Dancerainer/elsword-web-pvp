/** Reverse Stigma: target2016 values/description with qualified .1 callbacks.
 * Exact saved XYZ submission is a Web geometry adapter; the fixed reference's
 * later SetPositionOnLine test-macro replacement is deliberately not imported.
 */
const f=Math.fround,copy=value=>structuredClone(value);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const point=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);
const keys=(v,names)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k));
const alive=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
const invincible=a=>a.invincible||a.forceInvincible>0;
const owns=(sim,a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const epochFor=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);
const localPlayback=sim=>sim.networkCombatPlaybackVersion===1;
const recipientPlayback=(sim,caster)=>localPlayback(sim)&&sim.networkOwnerId!=null&&sim.networkOwnerId!==caster.id;
const currentProtected=(sim,a)=>invincible(a)||localPlayback(sim)&&(a.hidden||a.pvpPresentation||a.pvpInvincibleRemaining>0||a.invulnerable);
function playbackRow(sim,caster,create=false){
 if(!recipientPlayback(sim,caster))return null;
 const epoch=epochFor(sim,caster);if(!integer(epoch))return null;
 const ledger=sim.state.localOwnerAddPlaybackStigma??(create?(sim.state.localOwnerAddPlaybackStigma={version:1,owners:[]}):null);
 if(!ledger)return null;
 let row=ledger.owners.find(row=>row.playerId===caster.id);
 if(row&&row.epoch!==epoch){if(!create)return null;row.epoch=epoch;row.mark=null;}
 if(!row&&create){row={playerId:caster.id,epoch,mark:null};ledger.owners.push(row);}
 return row??null;
}
// This receiver-local saved point is never sourced from actor/source packets.
const currentMark=(sim,caster)=>recipientPlayback(sim,caster)?playbackRow(sim,caster)?.mark:caster.sourceAddStigma;
const stateKeys=['skillId','targetId','targetEpoch','position','lineId','remaining','group'];
const noticeKeys=['serial','action',...stateKeys];
const usableLine=line=>line&&[line.enabled,line.ENABLE,line.nativeFields?.ENABLE].every(flag=>flag!==false&&flag!==0&&flag?.symbol!=='FALSE'&&flag?.$symbol!=='FALSE');
const lineExists=(sim,lineId)=>sim.map.lines.some(line=>line.lineId===lineId&&usableLine(line));

function validatePayload(value,{owner,profile,actors,map}={},notice=false){
 if(!keys(value,notice?noticeKeys:stateKeys)||value.skillId!==29025||!id(value.targetId)||!integer(value.targetEpoch)||
  !point(value.position)||!integer(value.lineId)||!integer(value.group)||!Number.isFinite(value.remaining)||value.remaining<0||value.remaining>6)
  throw new TypeError('Invalid Reverse Stigma payload');
 if(notice&&(!integer(value.serial)||value.serial<1||!['mark','return','clear'].includes(value.action)||value.action!=='mark'&&value.remaining!==0))
  throw new TypeError('Invalid Reverse Stigma notice');
 if(owner&&(owner.professionId!=='DE'||!owner.loadout?.some(slot=>slot?.skillId===29025)))throw new TypeError('Invalid Reverse Stigma owner');
 if(profile){const skill=profile.skillCatalog?.find(skill=>skill.skillId===29025);
  if(profile.target?.unitClass!==126||skill?.raw?.SA_EFFECTIVE_TIME?.[skill.maxLevel]!==6)throw new TypeError('Missing target2016 Reverse Stigma declaration');}
 if(map&&!map.lines.some(line=>line.lineId===value.lineId&&usableLine(line)))throw new TypeError('Unknown or disabled Reverse Stigma saved line');
 if(actors&&owner){const target=actors.find(a=>a.id===value.targetId);
  if(!target||target.id===owner.id||target.team===owner.team)throw new TypeError('Invalid Reverse Stigma target');}
 return true;
}
export function validateAddStigmaState(value,context={}){return value===null||validatePayload(value,context);}
export function validateAddStigmaNotice(value,context={}){return validatePayload(value,context,true);}

export function addStigmaRecastPlan(actor,skill,plan){
 if(actor.professionId!=='DE'||skill.skillId!==29025||!(actor.sourceAddStigma?.remaining>0))return plan;
 // Target32753a90 queries20 MP and3276b920 guards it. Marker selection
 //3275c670 requests226 through3275e610 without calling+650 payment32762300.
 // The query remains MP in formation; the initial cast keeps its own price.
 return {...plan,mode:'stigma-return',recastState:'ANSI_SA_ADE_REVERSE_STIGMA_RETURN',mpCost:0,mpRequirement:20,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,
  resourceMpInsufficient:actor.mp<20,resourceDpInsufficient:false,resourceMutationInsufficient:false};
}

function removeDisplay(sim,caster,targetId){
 const ledger=sim.state.localOwnerAddStigmaDisplays??[];
 const saved=ledger.filter(row=>row.ownerId===caster.id&&row.targetId===targetId);
 const ended=new Set();
 for(const e of sim.state.effects)if(e.ownerId===caster.id&&e.setName==='EffectSetI_SA_ADE_REVERSE_STIGMA_Debuff'&&e.traceActorId===targetId&&!e.dead){
  e.dead=true;e.endReason='add-stigma-mark-ended';ended.add(e.id);
 }
 // The presentation-only record may already have retired from the collision
 // list. Its native emitter is intentionally unbounded until the mark's
 // explicit release, so retaining its local handle is essential. This ledger
 // is receiver-local simulation state, never accepted from owner packets.
 for(const row of saved)for(const effectId of row.effectIds)ended.add(effectId);
 for(const effectId of ended)sim.emit?.('effectEnded',caster.id,{effectId,reason:'add-stigma-mark-ended'});
 sim.state.localOwnerAddStigmaDisplays=ledger.filter(row=>row.ownerId!==caster.id||row.targetId!==targetId);
}
function removeBuff(sim,caster,target){
 if(!target||!owns(sim,target))return;
 // A different DE's surviving mark owns the same native singleton template.
 if(sim.state.actors.some(a=>{const mark=currentMark(sim,a);return a.id!==caster.id&&mark?.remaining>0&&mark.targetId===target.id&&mark.targetEpoch===epochFor(sim,target);}))return;
 target.buffs=(target.buffs??[]).filter(buff=>buff.templateId!==440);
 for(const e of sim.state.effects)if(e.ownerId===target.id&&e.buffTemplateId===440){e.dead=true;e.endReason='add-stigma-mark-ended';}
}
function grantMarkBuff(sim,caster,target,remaining){
 if(!owns(sim,target)||!(remaining>0)||!alive(target)||currentProtected(sim,target))return false;
 const skill=sim.profileFor(caster).skillCatalog.find(skill=>skill.skillId===29025);
 const buff=sim.grantBuff?.(caster,target,478,skill.maxLevel,null);
 for(const end of buff?.finalizers??[])if(end.kind==='time')end.remaining=Math.min(end.remaining,remaining);
 return true;
}
function submitPosition(sim,caster,target,state){
 if(!owns(sim,target)||!alive(target)||currentProtected(sim,target)||epochFor(sim,target)!==state.targetEpoch||!lineExists(sim,state.lineId))return false;
 const from=[target.x,target.y,target.z];
 [target.x,target.y,target.z]=state.position;
 // The ordinary authored-map support solver decides subsequent landing.
 // Do not guess a ground snap, velocity reset or old current-line projection.
 // landPosition is a required wire vector even while airborne. Retain its
 // existing valid value until the ordinary solver recomputes it next tick.
 target.lastTouchLineId=state.lineId;target.lineId=null;target.grounded=false;
 sim.emit?.('addStigmaReturned',caster.id,{targetId:target.id,from,position:[...state.position],evidence:'target2016 description; Web exact-position adapter, native movement unmeasured'});
 return true;
}
function publish(sim,caster,action,state){
 if(localPlayback(sim))return null;
 const notice={serial:(caster.sourceAddStigmaNotice?.serial??0)+1,action,...copy(state),remaining:action==='mark'?state.remaining:0};
 validateAddStigmaNotice(notice,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors,map:sim.map});
 caster.sourceAddStigmaNotice=notice;return notice;
}
function clear(sim,caster,{publishNotice=true}={}){
 const s=currentMark(sim,caster);if(!s){
  for(const row of [...(sim.state.localOwnerAddStigmaDisplays??[])])if(row.ownerId===caster.id)removeDisplay(sim,caster,row.targetId);
  return;
 }
 removeDisplay(sim,caster,s.targetId);
 if(recipientPlayback(sim,caster))playbackRow(sim,caster).mark=null;else caster.sourceAddStigma=null;
 const target=sim.state.actors.find(a=>a.id===s.targetId);removeBuff(sim,caster,target);
 if(publishNotice&&owns(sim,caster)){
  if(target&&lineExists(sim,s.lineId))publish(sim,caster,'clear',s);
  else delete caster.sourceAddStigmaNotice;
 }
}

/** Call at the existing initial .1 scan event. Only the caster owner writes
 * mark state. Existing normal hit creation remains in add-target-skills. */
export function markAddStigma(sim,caster,target){
 if(!owns(sim,caster)&&!(recipientPlayback(sim,caster)&&target?.id===sim.networkOwnerId))return false;
 clear(sim,caster);
 if(!alive(target)||currentProtected(sim,target))return false;
 const lineId=target.lineId??target.lastTouchLineId,epoch=epochFor(sim,target);
 if(!integer(epoch)||!integer(lineId)||!lineExists(sim,lineId)){
  sim.note?.('add-stigma-saved-line','Original target line and recipient life epoch are required for a mark',caster);return false;
 }
 const skill=sim.profileFor(caster).skillCatalog.find(skill=>skill.skillId===29025);
 const s={skillId:29025,targetId:target.id,targetEpoch:epoch,position:[target.x,target.y,target.z],lineId,
  remaining:skill.raw.SA_EFFECTIVE_TIME[skill.maxLevel],group:caster.stateSerial};
 validateAddStigmaState(s,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors,map:sim.map});
 if(recipientPlayback(sim,caster)){const row=playbackRow(sim,caster,true);if(!row)return false;row.mark=s;}
 else caster.sourceAddStigma=s;
 publish(sim,caster,'mark',s);grantMarkBuff(sim,caster,target,s.remaining);
 const first=sim.state.nextEffectId;
 sim.spawnSet?.(caster,'EffectSetI_SA_ADE_REVERSE_STIGMA_Debuff');
 const effectIds=[];
 for(const e of sim.state.effects)if(e.id>=first&&e.ownerId===caster.id){e.traceActorId=target.id;e.traceUnitDieDelete=true;effectIds.push(e.id);}
 (sim.state.localOwnerAddStigmaDisplays??=[]).push({ownerId:caster.id,targetId:target.id,effectIds});
 return true;
}

/** Called at qualified RETURN .1. Damage remains caster-owned and uses the
 * target's original Bip01 pose evaluated at the saved point; invincible targets
 * retain their current position and ordinary collision rejects their damage. */
export function returnAddStigma(sim,caster){
 if(!owns(sim,caster)&&!recipientPlayback(sim,caster))return false;
 const s=currentMark(sim,caster);if(!s)return false;
 const target=sim.state.actors.find(a=>a.id===s.targetId);
 if(!alive(target)||epochFor(sim,target)!==s.targetEpoch||!lineExists(sim,s.lineId)){clear(sim,caster);return false;}
 const movable=!currentProtected(sim,target),posed=movable?{...target,x:s.position[0],y:s.position[1],z:s.position[2],lineId:null,lastTouchLineId:s.lineId}:target;
 const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},posed,{profile:sim.profileFor(target)});
 if(movable){publish(sim,caster,'return',s);submitPosition(sim,caster,target,s);}
 else publish(sim,caster,'clear',s);
 if(anchor?.position)sim.createEffect(caster,{NAME:'DamageEffect_ADE_REVERSE_STIGMA_Return'},
  {birthAnchor:{position:[...anchor.position],facing:caster.facing,rotation:[0,caster.facing<0?180:0,0]}});
 else sim.note?.('add-stigma-return-bone','Original target Bip01 required; return damage omitted',caster);
 clear(sim,caster,{publishNotice:false});return movable;
}

export function tickAddStigma(sim,caster,dt){
 const receipt=sim.state.localOwnerAddStigmaReceipts?.owners.find(row=>row.playerId===caster.id);
 if(receipt?.mark)receipt.mark.remaining=Math.max(0,f(receipt.mark.remaining-dt));
 const s=currentMark(sim,caster);if(!s){clear(sim,caster);return;}
 const target=sim.state.actors.find(a=>a.id===s.targetId);
 if(!alive(caster)||!alive(target)||epochFor(sim,target)!==s.targetEpoch||!lineExists(sim,s.lineId)){clear(sim,caster);return;}
 s.remaining=Math.max(0,f(s.remaining-dt));
 if(caster.sourceAddStigmaNotice?.action==='mark')caster.sourceAddStigmaNotice.remaining=s.remaining;
 if(s.remaining<=0)clear(sim,caster);
}

/** Recipient must previously have accepted the matching mark. A return that
 * overtook an entirely unobserved mark is rejected, never a free teleport. */
export function receiveAddStigmaNotice(sim,caster,epoch,notice,age=0){
 if(!notice||sim.networkOwnerId==null||sim.networkOwnerId===caster.id)return false;
 if(localPlayback(sim))return false;
 if(!integer(epoch)||!Number.isFinite(age)||age<0)throw new TypeError('Invalid Reverse Stigma notice timing');
 validateAddStigmaNotice(notice,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors,map:sim.map});
 if(sim.deferAddTimeRingNotices){(sim.pendingAddStigmaNotices??=[]).push({playerId:caster.id,epoch,notice:copy(notice),age});return false;}
 const ledger=sim.state.localOwnerAddStigmaReceipts??={version:1,owners:[]};
 let row=ledger.owners.find(item=>item.playerId===caster.id);
 if(row&&(epoch<row.epoch||epoch===row.epoch&&notice.serial<=row.serial))return false;
 const previousMark=row?.mark,old=row?.epoch===epoch?previousMark:null;
 if(!row){row={playerId:caster.id};ledger.owners.push(row);}Object.assign(row,{epoch,serial:notice.serial,mark:null});
 const target=sim.state.actors.find(a=>a.id===sim.networkOwnerId);
 // A following mark can overtake its intermediate clear on the latest-owner
 // snapshot channel. Remove this caster's old local marker before dropping its
 // receipt, while another DE's surviving marker still protects the singleton.
 if(previousMark&&target&&previousMark.targetEpoch===epochFor(sim,target)&&
   (notice.targetId!==target.id||notice.targetEpoch!==previousMark.targetEpoch||notice.group!==previousMark.group))
  removeBuff(sim,caster,target);
 if(!target||notice.targetId!==target.id||epochFor(sim,target)!==notice.targetEpoch)return false;
 if(notice.action==='mark'){
  const remaining=notice.remaining-age;if(!(remaining>0)||!grantMarkBuff(sim,caster,target,remaining))return false;
  row.mark={group:notice.group,targetEpoch:notice.targetEpoch,position:[...notice.position],lineId:notice.lineId,remaining};return true;
 }
 removeBuff(sim,caster,target);
 if(notice.action==='clear')return true;
 if(!old||old.remaining<=0||old.group!==notice.group||old.targetEpoch!==notice.targetEpoch||old.lineId!==notice.lineId||old.position.some((n,i)=>n!==notice.position[i]))return false;
 return submitPosition(sim,caster,target,notice);
}
export function flushAddStigmaNotices(sim,{discard=false}={}){
 const pending=sim.pendingAddStigmaNotices??[];delete sim.pendingAddStigmaNotices;if(discard)return;
 for(const item of pending){const caster=sim.state.actors.find(a=>a.id===item.playerId);
  if(caster)receiveAddStigmaNotice(sim,caster,item.epoch,item.notice,item.age);
 }
}
