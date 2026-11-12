import {isAddActor} from './add-systems.mjs';
export const MAGNETRON_ORBIT='DamageEffect_SA_APT_Magnetron_Dynamo_Start';
export const MAGNETRON_PROJECTILE='DamageEffect_SA_APT_Magnetron_Dynamo_Projectile';
export const MAGNETRON_EXPLOSION='DamageEffect_APT_Magnetron_Dynamo_Explosion';
const f=Math.fround;
export const isMagnetronOrbit=(a,e)=>isAddActor(a)&&e.name===MAGNETRON_ORBIT;
function remove(sim,a,e,reason){e.dead=true;e.suppressSecondaryDamage=true;e.endReason=reason;}
export function startAddMagnetron(sim,a){
 for(const e of sim.state.effects)if(e.ownerId===a.id&&isMagnetronOrbit(a,e))remove(sim,a,e,'magnetron-replaced');
 const point=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:sim.profileFor(a)})?.position;
 if(!point){sim.note('add-magnetron-bone','Original Bip01 required for Magnetron orbit',a);return;}
 const saved=a.sourceAddCombat;saved.magnetron={power:a.skillScale??1,ready:0};
 for(let i=0;i<3;i++)sim.createEffect(a,{NAME:MAGNETRON_ORBIT},{birthAnchor:{position:[...point],facing:a.facing,rotation:[0,(a.facing<0?180:0)+120*i,0]}});
 const mark=a.sourceAddDroneMark,target=mark&&sim.state.actors.find(b=>b.id===mark.targetId&&b.hp>0&&!b.invincible&&!(b.forceInvincible>0));
 if(target)fireAddMagnetronAll(sim,a,target);
 sim.emit('addMagnetronCreated',a.id,{count:3,evidence:'original declaration plus qualified fixed Add callback: three120-degree orbits'});
}
export function tickAddMagnetron(sim,a,dt){
 if(!isAddActor(a)||!a.sourceAddCombat?.magnetron)return;
 const s=a.sourceAddCombat.magnetron;s.ready=Math.max(0,f(s.ready-dt));
 for(const e of sim.state.effects)if(e.ownerId===a.id&&!e.dead&&isMagnetronOrbit(a,e)){
  if(a.hp<=0||a.pvpDead||a.pvpDisconnected){remove(sim,a,e,'magnetron-owner-ended');continue;}
  const point=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a,{profile:sim.profileFor(a)})?.position;
  if(point){e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position:[...point]};[e.x,e.y,e.z]=point;}
 }
}
export function addMagnetronAcceptedHit(sim,a,b,data,origin){
 const s=a.sourceAddCombat?.magnetron;
 if(!isAddActor(a)||!s||s.ready>0||data.ATTACK_TYPE===1||data.REACT_TYPE===7||origin.sourceAddSummonSerial!==undefined)return;
 const source=origin.kind==='effect'?sim.state.effects.find(e=>e.id===origin.id):null;
 if(source?.name===MAGNETRON_EXPLOSION)return;
 const orbit=sim.state.effects.find(e=>e.ownerId===a.id&&!e.dead&&isMagnetronOrbit(a,e));if(!orbit)return;
 const point=sim.effectBoneSampler?.(orbit,a,'Dummy02');
 if(!point){sim.note('add-magnetron-muzzle','Original orbit Dummy02 required; no guessed muzzle',a);return;}
 const effect=sim.createEffect({...a,skillId:29205,skillScale:s.power},{NAME:MAGNETRON_PROJECTILE},{birthAnchor:{position:[...point],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
 if(effect)effect.sourceAddLockOn={targetId:b.id,manualDirDegree:[0,a.facing<0?180:0,0],useManualDir:false};
 remove(sim,a,orbit,'magnetron-command-hit-consumed');s.ready=.3;
 sim.emit('addMagnetronFired',a.id,{targetId:b.id,effectId:effect?.id??null,evidence:'qualified fixed Add accepted ordinary hit, original Dummy02, consume first orbit, .3 cooldown'});
}
/** Original32760390: marker release bypasses ordinary .3 feedback throttle
 * and releases all holders. It never rewrites projectiles already in flight. */
export function fireAddMagnetronAll(sim,a,target){
 const saved=a.sourceAddCombat?.magnetron;if(!saved||!target)return false;
 for(const orbit of sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&isMagnetronOrbit(a,e))){
  const point=sim.effectBoneSampler?.(orbit,a,'Dummy02');if(!point){sim.note('add-magnetron-muzzle','Original Dummy02 required for marked release',a);continue;}
  const e=sim.createEffect({...a,skillId:29205,skillScale:saved.power},{NAME:MAGNETRON_PROJECTILE},{birthAnchor:{position:[...point],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
  if(e){e.sourceAddLockOn={targetId:target.id,manualDirDegree:[0,a.facing<0?180:0,0],useManualDir:false};e.sourceAddMarkedDrone={targetEpoch:a.sourceAddDroneMark?.targetEpoch??0,unlockRemaining:Math.fround(.1)};e.powerMultiplier=Math.fround(e.powerMultiplier*1.2000000476837158);if(e.sourceShadowMesh)e.sourceShadowMesh.dirSpeed=1250;}
  remove(sim,a,orbit,'magnetron-marked-release');
 }
 saved.ready=0;return true;
}
