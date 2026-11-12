/** Target2016 Drone Activator values with a qualified reference contact hook.
 * Reference a8438f3 Add17607..17641 is explicitly a2026 reconstruction.
 * This module does not invent the still-unresolved automatic firing schedule.
 */
import {addDroneMarkDuration,emitAddDroneMarkNotice,tickAddTargetNotice,applyLocalDroneMarkContact} from './add-target-notices.mjs';
import {fireAddMagnetronAll} from './add-magnetron.mjs';
const f=Math.fround;
export const ADD_DRONE_MARK_PROJECTILE='DamageEffect_AAT_Dynamo_Factory_Projectile';
export const ADD_DRONE_MARK_SET='EffectSet_SI_SA_AAT_Installation_Drone_Activator_Lackon';
const skills=[29013,29035];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,list)=>plain(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const alive=a=>a?.hp>0&&!a.pvpDead&&!a.pvpDisconnected;
const epoch=(sim,a)=>sim.networkEpochFor?.(a.id)??(sim.networkOwnerId==null?0:null);

export function validateAddDroneMarkState(s,{owner,profile,actors}={}){
 if(s===undefined)return true;
 if(!keys(s,['targetId','targetEpoch','remaining','skillId'])||!id(s.targetId)||!integer(s.targetEpoch)||
    !skills.includes(s.skillId)||!Number.isFinite(s.remaining)||s.remaining<0||s.remaining>f(f(4.9)*f(s.skillId===29035?1.5:1)))
  throw new TypeError('Invalid Add Drone Activator mark');
 if(owner&&(owner.professionId!=='MM'||!owner.loadout?.some(slot=>slot?.skillId===s.skillId)))throw new TypeError('Invalid Drone Activator mark owner');
 if(profile&&s.remaining>addDroneMarkDuration(profile,s.skillId))throw new TypeError('Invalid Drone Activator mark source duration');
 if(actors&&owner&&!actors.some(a=>a.id===s.targetId&&a.id!==owner.id&&a.team!==owner.team))throw new TypeError('Invalid Drone Activator mark target');
 return true;
}

export function validateAddDroneMarkEffect(e,{owner,profile,actors}={}){
 if(e.sourceAddDroneMarkAccepted===undefined&&e.sourceAddDroneMarkVisual===undefined)return true;
 if(owner?.professionId!=='MM'&&owner||profile&&profile.target?.unitClass!==123||!skills.includes(e.skillId))
  throw new TypeError('Invalid Drone Activator effect owner');
 if(e.sourceAddDroneMarkAccepted!==undefined&&(e.sourceAddDroneMarkAccepted!==true||e.name!==ADD_DRONE_MARK_PROJECTILE||e.sourceAddDroneMarkVisual!==undefined))
  throw new TypeError('Invalid Drone Activator contact latch');
 if(e.sourceAddDroneMarkVisual!==undefined){
  if(e.sourceAddDroneMarkVisual!==true||e.setName!==ADD_DRONE_MARK_SET||!/^EFFECT[0-3]$/.test(e.definitionMember??'')||!id(e.traceActorId)||e.traceUnitDieDelete!==true)
   throw new TypeError('Invalid Drone Activator mark visual');
  const raw=profile?.effectSets?.[ADD_DRONE_MARK_SET]?.raw?.[e.definitionMember];
  if(profile&&(!raw||raw.NAME!==e.name||raw.BONE_NAME!=='Bip01'||raw.TRACE!==1))throw new TypeError('Invalid Drone Activator mark visual source');
  if(actors&&owner&&!actors.some(a=>a.id===e.traceActorId&&a.id!==owner.id&&a.team!==owner.team))throw new TypeError('Invalid Drone Activator mark visual target');
 }
 return true;
}

function endVisuals(sim,a){
 for(const e of sim.state.effects??[])if(e.ownerId===a.id&&e.sourceAddDroneMarkVisual&&!e.dead){e.dead=true;e.endReason='add-drone-mark-ended';}
}

/** Pure query: UID/HP/invincibility are the fixed reference validity gates;
 * the life epoch prevents Web player IDs from targeting a later respawn. */
export function addDroneMarkTarget(sim,a){
 const s=a.sourceAddDroneMark;if(a.professionId!=='MM'||!s||!(s.remaining>0)||!alive(a))return null;
 return sim.state.actors.find(b=>b.id===s.targetId&&b.team!==a.team&&alive(b)&&!b.invincible&&!(b.forceInvincible>0)&&!b.invulnerable&&epoch(sim,b)===s.targetEpoch)??null;
}

/** Owner-authoritative once per accepted RT11 projectile contact. The caller
 * must invoke this after createReactionEffect succeeds, never in replay-only
 * critical sampling or from the area explosion / DIE child. */
export function addDroneMarkContact(sim,a,target,e){
 const recipientPlayback=sim.networkCombatPlaybackVersion===1&&sim.networkOwnerId===target?.id;
 if(a.professionId!=='MM'||sim.observationOnly||sim.networkOwnerId!=null&&sim.networkOwnerId!==a.id&&!recipientPlayback||
    e?.name!==ADD_DRONE_MARK_PROJECTILE||!skills.includes(e.skillId)||e.ownerId!==a.id||e.sourceAddDroneMarkAccepted||
    !alive(a)||!alive(target)||target.id===a.id||target.team===a.team||target.invincible||target.forceInvincible>0||target.invulnerable)return false;
 if(recipientPlayback){
  if(!applyLocalDroneMarkContact(sim,a,target,e.skillId))return false;
  e.sourceAddDroneMarkAccepted=true;return true;
 }
 if(!emitAddDroneMarkNotice(sim,a,target,e.skillId))return false;
 e.sourceAddDroneMarkAccepted=true;endVisuals(sim,a);
 a.sourceAddDroneMark={targetId:target.id,targetEpoch:epoch(sim,target),remaining:addDroneMarkDuration(sim.profileFor(a),e.skillId),skillId:e.skillId};
 for(const slot of a.loadout??[])if([29203,29205,29208,29209,29210,29211,29218,29219].includes(slot?.skillId))a.cooldowns[slot.skillId]=0;
 fireAddMagnetronAll(sim,a,target);
 const p=sim.profileFor(a),set=p.effectSets?.[ADD_DRONE_MARK_SET]?.raw;
 // The reference visually owns this set by the target. Web keeps identities
 // on the authoritative caster while explicitly tracing the same target bone;
 // it never substitutes a caster bone or transfers offensive ownership.
 const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},target,{profile:sim.profileFor(target)});
 if(set&&anchor){for(const [member,definition]of Object.entries(set))if(/^EFFECT\d+$/.test(member)){
  const visual=sim.createEffect(a,definition,{setName:ADD_DRONE_MARK_SET,clock:'custom',birthAnchor:anchor});if(!visual)continue;
  visual.skillId=e.skillId;visual.definitionMember=member;visual.traceActorId=target.id;visual.traceUnitDieDelete=true;visual.sourceAddDroneMarkVisual=true;
 }}else sim.note?.('add-drone-mark-target-pose','Original target Bip01 sample required for mark display',a);
 sim.emit?.('addDroneMarkAcquired',a.id,{targetId:target.id,skillId:e.skillId,remaining:a.sourceAddDroneMark.remaining});return true;
}

/** Actor timer survives skill cancellation and generator switching. It is
 * independent of the defender-owned debuff and expires on original invalid
 * target gates, owner death, target life change or its own elapsed lifetime. */
export function tickAddDroneMark(sim,a,dt){
 if(a.professionId!=='MM'||!(dt>0))return;
 tickAddTargetNotice(a,dt);
 const s=a.sourceAddDroneMark;if(!s)return;
 s.remaining=Math.max(0,f(s.remaining-f(dt)));
 const target=addDroneMarkTarget(sim,a);
 if(!target){delete a.sourceAddDroneMark;endVisuals(sim,a);sim.emit?.('addDroneMarkEnded',a.id,{targetId:s.targetId});return;}
 // These four source displays have no DAMAGE_DATA, so the shared offensive
 // effect loop deliberately does not move them. Their original target-owned
 // BIP01 attachment still advances with the recipient's actual posed bone.
 for(const e of sim.state.effects)if(e.ownerId===a.id&&e.sourceAddDroneMarkVisual&&!e.dead&&e.traceActorId===target.id){
  const anchor=sim.effectAnchorSampler?.({definition:e.definition},target,{profile:sim.profileFor(target)});
  if(!anchor){sim.note?.('add-drone-mark-target-pose','Original target Bip01 sample required for mark display',a);continue;}
  e.currentAnchor=structuredClone(anchor);[e.x,e.y,e.z]=anchor.position;
 }
}
