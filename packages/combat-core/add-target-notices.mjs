/** Recipient-owned delivery for target2016 Add resource transfers.
 * This envelope is a Web ownership adapter, not the original network protocol.
 * The peer sends identities only; resource magnitudes come from the local,
 * frozen target skill table. Historical critical-action replay must not call it.
 */
const copy=value=>structuredClone(value);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const id=value=>typeof value==='string'&&value.length>0&&value.length<=128;
const keys=(value,required)=>plain(value)&&Object.keys(value).length===required.length&&required.every(key=>Object.hasOwn(value,key));
const alive=actor=>actor?.hp>0&&!actor.pvpDead&&!actor.pvpDisconnected;
const owns=(sim,actor)=>sim.networkOwnerId==null||sim.networkOwnerId===actor.id;
const epochFor=(sim,actor)=>sim.networkEpochFor?.(actor.id)??(sim.networkOwnerId==null?0:null);
const f=Math.fround;
const localPlayback=sim=>sim.networkCombatPlaybackVersion===1;
const protectedTarget=target=>target.invincible||target.forceInvincible>0||target.invulnerable||target.hidden||target.pvpPresentation||target.pvpInvincibleRemaining>0;

/** Target PvP factor370 owns4.9s; enhanced29035 supplies the1.5 multiplier.
 * The displayed7.4 is rounded, not a replacement for the raw multiplication. */
export function addDroneMarkDuration(profile,skillId){
 const skill=profile?.skillCatalog?.find(row=>row.skillId===skillId),factor=profile?.buffFactors?.[370]?.raw;
 if(profile?.target?.unitClass!==123||![29013,29035].includes(skillId)||!skill||factor?.BUFF_TEMPLET_ID!==344||
    factor.FINALIZER?.BFT_TIME?.NORMAL_TIME?.[1]!==4.9||profile.buffTemplates?.[344]?.raw?.BUFF_TEMPLET_ID!==344)
  throw new TypeError('Missing target2016 Drone Activator declaration');
 for(const name of ['BBT_CHANGE_PHYSIC_DEFENCE','BBT_CHANGE_MAGIC_DEFENCE'])
  if(factor.BEHAVIOR?.[name]?.BUFF_CHANGE_TYPE!==3||factor.BEHAVIOR[name].PERCENT?.[1]!==.785)
   throw new TypeError('Missing target2016 Drone Activator defense factor');
 const multiplier=skillId===29035?skill.raw?.SA_EFFECTIVE_TIME?.[skill.maxLevel]:1;
 if(multiplier!==(skillId===29035?1.5:1))throw new TypeError('Missing target2016 Drone Activator enhancement');
 return f(f(4.9)*f(multiplier));
}

export function validateAddTargetNotice(notice,{owner,profile,actors}={}){
 const drone=notice?.kind==='drone-activator';
 if(!keys(notice,drone?['serial','kind','skillId','targets','remaining']:['serial','kind','skillId','targets'])||!integer(notice.serial)||notice.serial<1||
    !(drone?[29013,29035].includes(notice.skillId):notice.kind==='force-finger'&&notice.skillId===29215)||
    !Array.isArray(notice.targets)||notice.targets.length<1||notice.targets.length>1||
    drone&&(!Number.isFinite(notice.remaining)||notice.remaining<0||notice.remaining>f(f(4.9)*f(notice.skillId===29035?1.5:1))))
  throw new TypeError('Invalid Add target notice');
 const ids=new Set();
 for(const target of notice.targets){
  if(!keys(target,['id','epoch'])||!id(target.id)||!integer(target.epoch)||ids.has(target.id))throw new TypeError('Invalid Add target notice recipient');
  ids.add(target.id);
 }
 if(owner&&(owner.professionId!==(drone?'MM':'DE')||!owner.loadout?.some(slot=>slot?.skillId===notice.skillId)))throw new TypeError('Invalid Add target notice owner');
 if(profile){
  if(drone){if(notice.remaining>addDroneMarkDuration(profile,notice.skillId))throw new TypeError('Invalid Drone Activator notice duration');}
  else {const skill=profile.skillCatalog?.find(skill=>skill.skillId===29215);
  if(profile.target?.unitClass!==126||skill?.raw?.SA_MP_INTAKE_ABS?.[skill.maxLevel]!==15)
   throw new TypeError('Missing target2016 Force Finger resource declaration');
  }
 }
 if(actors&&owner)for(const recipient of notice.targets){
  const target=actors.find(actor=>actor.id===recipient.id);
  if(!target||target.id===owner.id||target.team===owner.team)throw new TypeError('Invalid Force Finger target reference');
 }
 return true;
}

function applyDroneMark(sim,caster,target,recipient,notice,presentationAge=0){
 if(!owns(sim,target)||!alive(target)||target.team===caster.team||target.id===caster.id||epochFor(sim,target)!==recipient.epoch)return false;
 if(localPlayback(sim)&&protectedTarget(target))return false;
 const profile=sim.profileFor(caster),duration=addDroneMarkDuration(profile,notice.skillId);
 const remaining=Math.min(duration,Math.max(0,f(notice.remaining-presentationAge)));if(!(remaining>0))return false;
 // Only the existing scoped buff-duration adapter changes the local source
 // table. Peer-supplied defense percentages/buff IDs are never accepted.
 const buff=sim.grantBuff(caster,target,370,1,{buffDurationMultiplier:remaining/4.9,buffStrengthMultiplier:1});
 if(!buff)return false;
 sim.emit?.('addDroneMarkRecipient',target.id,{sourceActorId:caster.id,skillId:notice.skillId,remaining});return true;
}

/** Called only after the original marking projectile's first accepted contact. */
export function emitAddDroneMarkNotice(sim,caster,target,skillId){
 if(!owns(sim,caster))return false;
 // The source still owns its immediate acquisition/visual/attack benefits.
 // Its observation is no longer a command to install the recipient Debuff.
 if(localPlayback(sim))return true;
 const recipient={id:target.id,epoch:epochFor(sim,target)};
 if(!integer(recipient.epoch)){sim.note?.('add-drone-mark-recipient-epoch','Recipient life epoch unavailable; mark notice omitted',caster);return false;}
 const notice={serial:(caster.sourceAddTargetNotice?.serial??0)+1,kind:'drone-activator',skillId,targets:[recipient],remaining:addDroneMarkDuration(sim.profileFor(caster),skillId)};
 validateAddTargetNotice(notice,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors});caster.sourceAddTargetNotice=notice;
 applyDroneMark(sim,caster,target,recipient,notice);return true;
}

/** In negotiated playback, only a real current receiving-owner projectile
 * contact installs its own defense Debuff. No source claim supplies a hit. */
export function applyLocalDroneMarkContact(sim,caster,target,skillId){
 if(!localPlayback(sim)||!owns(sim,target)||!alive(target)||protectedTarget(target)||target.team===caster.team||target.id===caster.id)return false;
 const recipient={id:target.id,epoch:epochFor(sim,target)};
 if(!integer(recipient.epoch))return false;
 return applyDroneMark(sim,caster,target,recipient,{skillId,remaining:addDroneMarkDuration(sim.profileFor(caster),skillId)});
}

/** The retained notice is an aged event, not a refreshed buff on every packet. */
export function tickAddTargetNotice(caster,dt){
 if(caster.sourceAddTargetNotice?.kind==='drone-activator'&&dt>0)
  caster.sourceAddTargetNotice.remaining=Math.max(0,f(caster.sourceAddTargetNotice.remaining-f(dt)));
}

function applyDrain(sim,caster,target,recipient){
 if(!owns(sim,target)||!alive(target)||target.team===caster.team||target.id===caster.id||epochFor(sim,target)!==recipient.epoch)return false;
 if(localPlayback(sim)&&protectedTarget(target))return false;
 const skill=sim.profileFor(caster).skillCatalog.find(skill=>skill.skillId===29215);
 const drain=skill.raw.SA_MP_INTAKE_ABS[skill.maxLevel],before=target.mp;
 target.mp=Math.max(0,before-drain);
 sim.emit?.('addForceFingerRecipient',target.id,{sourceActorId:caster.id,drain:before-target.mp,requestedDrain:drain,
  position:[target.x,target.y+50,target.z]});
 return true;
}

/** The current local rendering of Force Finger selects its actual target.
 * Magnitudes still come from the original skill, not a network result. */
export function applyLocalForceFingerDrain(sim,caster,target){
 if(!localPlayback(sim)||!owns(sim,target)||!target||protectedTarget(target))return false;
 const recipient={id:target.id,epoch:epochFor(sim,target)};
 if(!integer(recipient.epoch))return false;
 return applyDrain(sim,caster,target,recipient);
}

/** Called once by the caster's actual .271 event, after target selection.
 * Remote animation replay may create presentation, never another transfer. */
export function emitAddForceFingerNotice(sim,caster,targets){
 if(!owns(sim,caster)||!targets.length)return false;
 if(localPlayback(sim))return false;
 const recipients=targets.map(target=>({id:target.id,epoch:epochFor(sim,target)}));
 if(recipients.some(target=>!integer(target.epoch))){
  sim.note?.('add-force-finger-recipient-epoch','Recipient life epoch is unavailable; transfer notice omitted',caster);return false;
 }
 const notice={serial:(caster.sourceAddTargetNotice?.serial??0)+1,kind:'force-finger',skillId:29215,targets:recipients};
 validateAddTargetNotice(notice,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors});
 caster.sourceAddTargetNotice=notice;
 for(const recipient of recipients)applyDrain(sim,caster,sim.state.actors.find(actor=>actor.id===recipient.id),recipient);
 return true;
}

/** Invoke only for a current, validated owner snapshot (endMissing=true).
 * Receipts belong to the local recipient, outside substituted remote actors;
 * trusted whole-simulation snapshots preserve them. A failed/dead/life-mismatched
 * delivery is consumed too, so it cannot drain a subsequently respawned player.
 */
export function receiveAddTargetNotice(sim,caster,epoch,notice,{presentationAge=0}={}){
 if(!notice||sim.networkOwnerId==null||sim.networkOwnerId===caster.id)return false;
 if(localPlayback(sim))return false;
 if(!integer(epoch))throw new TypeError('Invalid Add target notice sender epoch');
 if(!Number.isFinite(presentationAge)||presentationAge<0)throw new TypeError('Invalid Add target notice age');
 validateAddTargetNotice(notice,{owner:caster,profile:sim.profileFor(caster),actors:sim.state.actors});
 if(sim.deferAddTimeRingNotices){
  (sim.pendingAddTargetNotices??=[]).push({playerId:caster.id,epoch,notice:copy(notice),presentationAge});return false;
 }
 const target=sim.state.actors.find(actor=>actor.id===sim.networkOwnerId);if(!target)return false;
 const ledger=sim.state.localOwnerAddTargetReceipts??={version:1,owners:[]};
 const previous=ledger.owners.find(row=>row.playerId===caster.id);
 if(previous&&(epoch<previous.epoch||epoch===previous.epoch&&notice.serial<=previous.serial))return false;
 if(previous)Object.assign(previous,{epoch,serial:notice.serial});
 else ledger.owners.push({playerId:caster.id,epoch,serial:notice.serial});
 const recipient=notice.targets.find(row=>row.id===target.id);
 return !!recipient&&(notice.kind==='drone-activator'?applyDroneMark(sim,caster,target,recipient,notice,presentationAge):applyDrain(sim,caster,target,recipient));
}

/** Flush after every roster member and life epoch has been installed. */
export function flushAddTargetNotices(sim,{discard=false}={}){
 const pending=sim.pendingAddTargetNotices??[];delete sim.pendingAddTargetNotices;
 if(discard)return;
 for(const item of pending){const caster=sim.state.actors.find(actor=>actor.id===item.playerId);
  if(caster)receiveAddTargetNotice(sim,caster,item.epoch,item.notice,{presentationAge:item.presentationAge??0});
 }
}
