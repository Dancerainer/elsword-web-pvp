/** Target2016 declarations and bounded static analysis control consumers.
 * No original-client dynamic combat trace is claimed. */
import {consumeAddMutation,ADD_DP_MAX,ADD_DP_DISPLAY_SCALE} from './add-systems.mjs';
import {createSkillTraitPolicy} from './skill-traits.mjs';
import {validateMaximumStrikeOrbit} from './add-maximum-strike-orbit.mjs';
export const MAXIMUM_STRIKE_ORB='DamageEffect_ATT_Maximum_Strike_Bullet_Projectile';
export const MAXIMUM_STRIKE_SHOT='DamageEffect_ATT_Maximum_Strike_Bullet_Attack';
const f=Math.fround, saved=a=>a.sourceAddCombat?.maximumStrike;
const mine=(sim,a)=>sim.networkOwnerId===null||sim.networkOwnerId===a.id;
const plays=(sim,a)=>mine(sim,a)||sim.networkCombatPlaybackVersion===1&&!sim.observationOnly;
const orbs=(sim,a,s=saved(a))=>sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&e.name===MAXIMUM_STRIKE_ORB&&e.sourceAddMaximumStrike?.group===s?.group);
function end(sim,a,e,reason){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason});}
export function endMaximumStrike(sim,a,{refund=false,reason='expired',formation=a.sourceAdd?.formation}={}){
 const s=saved(a);if(!s)return;
 const pending=orbs(sim,a);for(const e of pending)end(sim,a,e,'maximum-strike-'+reason);
 delete a.sourceAddCombat.maximumStrike;
 if(!refund||!pending.length||!mine(sim,a))return;
 const resource=formation?'DP':'MP',amount=pending.length*25,before=formation?a.sourceAdd.dp/ADD_DP_DISPLAY_SCALE:a.mp;
 // ThirdPath_RecoverMPorDP uses SetDPValue, not the hit/DP-gain consumer.
 // Applying Overlimit's gain bonus here would incorrectly refund37.5 per orb.
 if(formation){const dpBefore=a.sourceAdd.dp;a.sourceAdd.dp=f(Math.min(ADD_DP_MAX,dpBefore+amount*ADD_DP_DISPLAY_SCALE));
   if(dpBefore!==a.sourceAdd.dp)sim.emit('addDpChanged',a.id,{before:dpBefore,dp:a.sourceAdd.dp,delta:a.sourceAdd.dp-dpBefore,reason:'maximum-strike-refund'});}
 else a.mp=f(Math.min(a.mpMax,a.mp+amount));
 const restored=f((formation?a.sourceAdd.dp/ADD_DP_DISPLAY_SCALE:a.mp)-before);
 sim.emit('addMaximumStrikeRefund',a.id,{resource,amount,restored,unused:pending.length,reason});
}
export function startMaximumStrike(sim,a){
 if(a.professionId!=='DE'||!plays(sim,a))return;
 endMaximumStrike(sim,a,{reason:'replaced'});
 const declared=a.skillContext?.addMutationSpent;
 const remoteUsed=Number.isSafeInteger(declared)&&declared>=0&&declared<=3?declared:0;
 const skill=sim.skill(29022,a),used=a.sourceAdd.formation?(mine(sim,a)?consumeAddMutation(a,3,{profile:sim.profileFor(a),emit:(...args)=>sim.emit(...args)}):remoteUsed):0;
 const remaining=f(Math.max(60,skill.raw.SA_EFFECTIVE_TIME[skill.maxLevel]));
 const trait=a.skillContext?.traitPolicy??createSkillTraitPolicy(skill,a.loadout?.find(s=>s?.skillId===29022)?.branchId??'none');
 const passiveLevel=a.passivePolicy?.skillLevels?.[29410],overlimit=a.sourceAdd.formation&&passiveLevel?sim.profileFor(a).skillCatalog.find(s=>s.skillId===29410).raw.SA_COOLTIME_1[passiveLevel]:1;
 const cooldownBase=f(skill.raw.m_SkillCoolTime[skill.maxLevel]*trait.cooldownMultiplier*overlimit);
 const s={remaining,ready:0,lastHitAgo:skill.raw.SA_CHARGING_TIME[skill.maxLevel]+1,targetId:null,power:f(a.skillScale*(1+used*0.10000000149011612)),group:a.stateSerial,formationAtLastLiveStep:a.sourceAdd.formation,totalLifetime:remaining,cooldownBase};
 a.sourceAddCombat.maximumStrike=s;
 const position=[a.x,f(a.y+150),a.z];
 // The qualified callback supplies +150 Y and six 60-degree rotations. M02
 // supplies the radial displacement/animation; do not fabricate a circle.
 for(let index=0;index<6;index++){
  const e=sim.createEffect(a,{NAME:MAXIMUM_STRIKE_ORB},{birthAnchor:{position:[...position],facing:a.facing,rotation:[0,index*60,0]}});
  if(e){e.lifeTimeSeconds=remaining;e.sourceAddMaximumStrike={index,group:s.group};}
 }
 sim.emit('addMaximumStrikePrepared',a.id,{count:orbs(sim,a).length,remaining,mutationSpent:used,damageMultiplier:f(1+used*0.10000000149011612)});
}
export function maximumStrikeAcceptedHit(sim,a,b,data,origin){
 const s=saved(a);if(!s||!plays(sim,a)||origin.sourceAddSummonSerial!==undefined)return;
 // Moonlight's original RT7 zone installs BF477 without damage. That exact
 // accepted skill contact may mark the prepared barrage for assisted pursuit;
 // unrelated NO_DAMAGE control/buff contacts remain ineligible.
 if(data.NO_DAMAGE===1){
  const contact=sim.state.effects.find(e=>e.id===origin.id&&e.ownerId===a.id);
  if(origin.skillId!==29024||contact?.name!=='DamageEffect_MOONLIGHT_RHAPSODY_Debuff'||
   data.APPLIED_SKILL_ID!==29024||data.BUFF_FACTOR_ID?.['1']!==477||data.REACT_TYPE!==7)return;
 }
 s.targetId=b.id;s.lastHitAgo=0;
}
export function maximumStrikeRecastPlan(a,skill,plan){
 const s=saved(a);if(a.professionId!=='DE'||skill.skillId!==29022||!s)return plan;
 return {...plan,mode:'maximum-strike-release',mpCost:0,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,allowAir:true,allowStateCancel:true,
   recastCooldown:s.ready,unavailableReason:s.ready>0?'maximum-strike-interval':null,resourceMpInsufficient:false,resourceDpInsufficient:false,resourceMutationInsufficient:false};
}
export function fireMaximumStrike(sim,a){
 const s=saved(a),orb=orbs(sim,a).sort((x,y)=>x.sourceAddMaximumStrike.index-y.sourceAddMaximumStrike.index)[0];
 if(!s||!orb||s.ready>0||!plays(sim,a))return false;
 const skill=sim.skill(29022,a),raw=sim.profileFor(a).damageEffects[MAXIMUM_STRIKE_SHOT].raw;
 const target=s.lastHitAgo<=skill.raw.SA_CHARGING_TIME[skill.maxLevel]&&sim.state.actors.find(b=>b.id===s.targetId&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected);
 const position=sim.effectBoneSampler?.(orb,a,'Dummy02')??(orb.currentAnchor??orb.birthAnchor)?.position;
 if(!position)return false;
 const traitPolicy=createSkillTraitPolicy(skill,a.loadout?.find(s=>s?.skillId===29022)?.branchId??'none');
 const e=sim.createEffect({...a,skillId:29022,skillScale:s.power,skillContext:{...a.skillContext,traitPolicy}},{NAME:MAXIMUM_STRIKE_SHOT},{birthAnchor:{position:[...position],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
 if(!e)return false;
 // Existing target retention includes invincibility. Recovered LOT8 uses
 // direction interpolation; the old fixed-circle collision adapter is retired.
 const range=raw.LOCK_ON_DATA.PVP_TARGET_RANGE_MIN_MAX,distance=target&&Math.hypot(target.x-position[0],target.y-position[1],target.z-position[2]);
 const inRange=target&&distance>=range['1']&&distance<=range['2'];
 if(inRange)e.sourceAddLockOn={targetId:target.id,manualDirDegree:[0,a.facing<0?180:0,0],useManualDir:false};
 const count=orbs(sim,a).length,elapsed=f((s.totalLifetime??60)-s.remaining),base=s.cooldownBase??skill.raw.m_SkillCoolTime[skill.maxLevel];
 const cooldown=count>=2?.5:base>=elapsed?f(base-elapsed):base;
 end(sim,a,orb,'maximum-strike-released');s.ready=cooldown;
 a.cooldowns[29022]=cooldown;
 // The native target-transfer function consumes the temporary target record.
 s.targetId=null;s.lastHitAgo=3;
 sim.emit('addMaximumStrikeFired',a.id,{effectId:e.id,targetId:inRange?target.id:null,remaining:orbs(sim,a).length,cooldown});
 if(!orbs(sim,a).length)delete a.sourceAddCombat.maximumStrike;
 return true;
}
export function tickMaximumStrike(sim,a,dt){
 const s=saved(a);if(!s||!plays(sim,a))return;
 if(a.hp<=0||a.pvpDead){endMaximumStrike(sim,a,{refund:true,reason:'death',formation:s.formationAtLastLiveStep});return;}
 if(a.pvpDisconnected){endMaximumStrike(sim,a,{reason:'disconnected'});return;}
 s.formationAtLastLiveStep=a.sourceAdd.formation;s.remaining=Math.max(0,f(s.remaining-dt));s.ready=Math.max(0,f(s.ready-dt));s.lastHitAgo=Math.min(3,f(s.lastHitAgo+dt));
 if(s.remaining<=0){endMaximumStrike(sim,a,{refund:true});return;}
 for(const e of orbs(sim,a))updateMaximumStrikeOrb(sim,e,a);
}
export function updateMaximumStrikeOrb(sim,e,a){
 if(!e.sourceAddMaximumStrike)return;
 const position=[a.x,f(a.y+150),a.z];
 e.currentAnchor={...(e.currentAnchor??e.birthAnchor),position};[e.x,e.y,e.z]=position;
 if(e.sourceShadowMesh)e.sourceShadowMesh.position=[...position];
}
export function validateMaximumStrikeActor(s){
 if(s===undefined)return true;
 return s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).length===9&&Number.isFinite(s.remaining)&&s.remaining>=0&&s.remaining<=61&&
   Number.isFinite(s.ready)&&s.ready>=0&&s.ready<=.500001&&Number.isFinite(s.lastHitAgo)&&s.lastHitAgo>=0&&s.lastHitAgo<=3&&
   (s.targetId===null||typeof s.targetId==='string'&&s.targetId.length>0&&s.targetId.length<=128)&&Number.isFinite(s.power)&&s.power>=0&&Number.isInteger(s.group)&&s.group>=0&&typeof s.formationAtLastLiveStep==='boolean'&&Number.isFinite(s.totalLifetime)&&s.totalLifetime>=60&&s.totalLifetime<=61&&
   Number.isFinite(s.cooldownBase)&&s.cooldownBase>=0&&s.cooldownBase<=100&&s.remaining<=s.totalLifetime;
}
export function validateMaximumStrikeEffect(e,owner,profile){
 validateMaximumStrikeOrbit(e,owner,profile);
 const s=e.sourceAddMaximumStrike;if(s===undefined)return;
 const ownerGroup=owner?.sourceAddCombat?.maximumStrike?.group;
 // Final release/death removes the owner's live group before its original
 // orbs' terminal events are encoded. A different live group is never valid.
 const releasedTerminal=e.dead===true&&e.endEmitted===true&&ownerGroup===undefined;
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==2||!Number.isInteger(s.index)||s.index<0||s.index>5||!Number.isInteger(s.group)||s.group<0||
   e.name!==MAXIMUM_STRIKE_ORB||e.skillId!==29022||owner&&(owner.professionId!=='DE'||ownerGroup!==s.group&&!releasedTerminal))throw new TypeError('invalid-owner-maximum-strike-orb');
}
