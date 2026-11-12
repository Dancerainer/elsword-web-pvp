/** Bounded target2016 Apocalypse A/B LOT6 consumer. Native VectorLockOn owns
 * the direction interpolation. Fixed Game/Effect source supplies selection
 * and callback order; target executable timing remains unmeasured. */
import {rotateNative} from '../effect-runtime/index.mjs';
import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {npcHitTargets} from './add-summons.mjs';
const f=Math.fround,DEG=Math.PI/180;
const names=new Set(['DamageEffect_AMM_APOCALYPSE_Attack_A_Projectile_PVP','DamageEffect_AMM_APOCALYPSE_Attack_B_Projectile_PVP']);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e7);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
export const isAddSummonProjectile=e=>names.has(e?.name)&&[29601,29604].includes(e.skillId);
function units(sim){return [...sim.state.actors.map(actor=>({actor,spheres:null})),...npcHitTargets(sim).map(row=>({actor:row.actor,spheres:row.spheres}))];}
function nearest(sim,owner,point,min,max){
 let best=null,distance=max;
 for(const row of units(sim)){
  const a=row.actor;if(a.team===owner.team||a.invincible||a.forceInvincible>0||a.hp<=0||a.pvpDead||a.pvpDisconnected)continue;
  const d=Math.hypot(a.x-point[0],a.y-point[1],a.z-point[2]);
  if(d>min&&d<distance){best=row;distance=d;}
 }
 return best;
}
export function validateAddSummonProjectileState(e,{profile,owner,actors=[]}={}){
 const s=e.sourceAddProjectile;if(s===undefined)return true;
 if(!s||Object.keys(s).some(k=>!['targetId','manualDirDegree','hasManual','delay','previousHits'].includes(k))||
  !(s.targetId===null||typeof s.targetId==='string'&&s.targetId.length>0&&s.targetId.length<=256)||!vector(s.manualDirDegree)||
  typeof s.hasManual!=='boolean'||!Number.isFinite(s.delay)||s.delay<0||s.delay>.5||!integer(s.previousHits)||
  !isAddSummonProjectile(e)||!Number.isSafeInteger(e.sourceAddSummonSerial)||e.sourceAddSummonSerial<1)
  throw new TypeError('invalid-owner-add-projectile');
 if(profile){
  const raw=profile.damageEffects?.[e.name]?.raw;
  if(profile.target?.unitClass!==123||raw?.LOCK_ON_DATA?.LOCK_ON_TYPE!==6||s.delay>(raw.LOCK_ON_DATA.TIME_UNLOCK_FROM_START??0))
   throw new TypeError('invalid-owner-add-projectile-source');
 }
 if(owner&&s.targetId!==null){
  const a=actors.find(a=>a.id===s.targetId)||actors.find(a=>s.targetId.startsWith(a.id+':apocalypse:')&&
   /^[1-9]\d*$/.test(s.targetId.slice((a.id+':apocalypse:').length))&&a.professionId==='MM');
  if(!a||a.team===owner.team)throw new TypeError('invalid-owner-add-projectile-target');
 }
 return true;
}
/** Call before generic moveEffect translation. Movement uses the direction
 * retained from the PREVIOUS lock callback, then selects/steers for next tick.
 * Returning true means the original scoped projectile path handled movement. */
export function moveAddSummonProjectile(sim,e,owner,dt){
 if(!isAddSummonProjectile(e)||e.sourceAddSummonSerial===undefined)return false;
 const raw=e.damage?.LOCK_ON_DATA,template=sim.profileFor(owner).effectTemplates[e.mainEffectName];
 if(raw?.LOCK_ON_TYPE!==6||!Number.isFinite(raw.CURVE_SPEED)||!template||
   !Number.isFinite(e.initialDirSpeed)||template.initialVelocity?.some(n=>n!==0)||
   template.events?.some(ev=>ev.start>0&&['Velocity','DirSpeed'].includes(ev.property))){
  sim.note?.('add-apocalypse-projectile-source','Scoped original projectile declarations are incomplete or changed',owner);return false;
 }
 const previous=e.currentAnchor??e.birthAnchor;if(!previous?.position)return true;
 // MeshPlayer constructor stores its creation angle, not a normalized forward
 // vector. DirSpeed!=0 leaves it untouched until the first VectorLockOn.
 // Birth rotation here is the shared qualified EffectSet rotation adapter.
 const s=e.sourceAddProjectile??={targetId:null,manualDirDegree:[...(e.birthAnchor.rotation??[0,0,0])],hasManual:false,
  delay:raw.TIME_UNLOCK_FROM_START??0,previousHits:0};
 const direction=s.hasManual?s.manualDirDegree.map(n=>f(n*f(DEG))):rotateNative([1,0,0],previous.rotation??[0,0,0]);
 const position=previous.position.map((n,i)=>f(n+f(f(direction[i]*f(e.initialDirSpeed))*f(dt))));
 const length=Math.hypot(...direction),horizontal=Math.hypot(direction[0],direction[2]);
 const rotation=s.hasManual&&length&&horizontal?[0,Math.atan2(-direction[2],direction[0])/DEG,
  Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))/DEG]:previous.rotation;
 e.currentAnchor={...previous,position,rotation};[e.x,e.y,e.z]=position;
 if(s.delay>0){s.delay=Math.max(0,f(s.delay-f(dt)));return true;}
 const range=raw.PVP_TARGET_RANGE_MIN_MAX;if(!range||!Number.isFinite(range['1'])||!Number.isFinite(range['2']))return true;
 let target=units(sim).find(row=>row.actor.id===s.targetId);
 if(!target){s.targetId=nearest(sim,owner,position,range['1'],range['2'])?.actor.id??null;return true;}
 const bridge=sim.skillsFor?.(owner)??sim.nativeSkills;
 if(!bridge?.vectorLockOn){sim.note?.('add-apocalypse-projectile-native','Original VectorLockOn ABI required',owner);return true;}
 const npc=owner.sourceAddSummon,ownerPosition=npc?.serial===e.sourceAddSummonSerial?npc.position:[owner.x,owner.y,owner.z];
 const shapes=target.spheres??sim.defenderSampler?.(target.actor,{profile:sim.profileFor(target.actor),role:'defender'});
 if(!shapes?.some(s=>vector(s.start??s.center))){sim.note?.('add-apocalypse-projectile-target-pose','Original target collision bones required for lock point',owner);return true;}
 const point=nearestLockOnPoint(shapes,ownerPosition,null);
 s.manualDirDegree=bridge.vectorLockOn({position,manualDirDegree:s.manualDirDegree,targetPosition:point,curveSpeed:raw.CURVE_SPEED,dt}).manualDirDegree;s.hasManual=true;
 if((e.hitCount??0)>s.previousHits){s.previousHits=e.hitCount;s.targetId=nearest(sim,owner,point,range['1'],range['2'])?.actor.id??null;}
 if(target.actor.hp<=0)s.targetId=nearest(sim,owner,position,range['1'],range['2'])?.actor.id??null;
 return true;
}
