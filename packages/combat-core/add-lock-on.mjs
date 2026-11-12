import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {orientLiteralMesh} from './shadow-mesh.mjs';
import {MAGNETRON_PROJECTILE} from './add-magnetron.mjs';
import {MAXIMUM_STRIKE_SHOT} from './add-maximum-strike.mjs';
import {ADD_MARKED_DRONE_NAMES,validateAddMarkedDrone} from './add-drone-lock.mjs';
import {advanceMaximumStrikeLockOn} from './add-maximum-strike-native-v53.mjs';
import {rotateNative} from '../effect-runtime/index.mjs';
import {advanceAddMmLot6,validateAddMmLot6} from './add-mm-lot6-2016.mjs';
// These original declarations explicitly request automatic LOT6/8 steering;
// Conqueror's qualified native callback additionally assigns LOT4 targets.
// A stable nearest-body selector is this Web executor's declared adapter,
// not a claim about the target executable's external selector tie-break.
const automatic=new Map([
 ['DamageEffect_SA_APT_Pulse_Cannon_Projectile',{profession:'LP',skill:29006,type:6}],
 ['DamageEffect_SA_APT_Conqueror_Projectile',{profession:'LP',skill:29008,type:4}],
 ['DamageEffect_AMM_Countdown_Bomb_Projectile',{profession:'MM',skill:29211,type:6}],
 ['DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation',{profession:'MM',skill:29211,type:6}],
 ['DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub',{profession:'MM',skill:29210,type:6}],
 ['DamageEffect_AAT_Phantom_Seeker_Projectile_Sub',{profession:'MM',skill:29015,type:8}],
]);
export const ADD_UID_LOCK_ON_EFFECTS=new Set([MAGNETRON_PROJECTILE,MAXIMUM_STRIKE_SHOT,...ADD_MARKED_DRONE_NAMES,...automatic.keys()]);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateAddLockOn(e,profile,owner,actors){
 validateAddMmLot6(e);
 const s=e.sourceAddLockOn;if(s===undefined)return;
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||typeof s.targetId!=='string'||!s.targetId||s.targetId.length>128||!vector(s.manualDirDegree)||typeof s.useManualDir!=='boolean'||!ADD_UID_LOCK_ON_EFFECTS.has(e.name))throw new TypeError('invalid-owner-add-lock-on');
 const auto=automatic.get(e.name),sourceType=auto?.type??(e.name===MAXIMUM_STRIKE_SHOT?8:4);
 if(ADD_MARKED_DRONE_NAMES.has(e.name)&&e.sourceAddMarkedDrone){validateAddMarkedDrone(e,profile);}
 else if(auto){
  if(!(e.skillId===auto.skill||auto.skill===29006&&e.skillId===29034)||owner&&owner.professionId!==auto.profession||profile&&(profile.target?.unitClass!==({LP:122,MM:123})[auto.profession]||profile.damageEffects[e.name]?.raw.LOCK_ON_DATA?.LOCK_ON_TYPE!==auto.type))throw new TypeError('invalid-owner-add-auto-lock-on-source');
 }
 else if(ADD_MARKED_DRONE_NAMES.has(e.name)&&e.name!==MAGNETRON_PROJECTILE)throw new TypeError('invalid-owner-add-marked-drone');
 else if(profile&&(![122,123,126].includes(profile.target?.unitClass)||profile.damageEffects[e.name]?.raw.LOCK_ON_DATA?.LOCK_ON_TYPE!==sourceType||e.name===MAXIMUM_STRIKE_SHOT&&profile.target.unitClass!==126))throw new TypeError('invalid-owner-add-lock-on-source');
 if(owner&&(s.targetId===owner.id||actors&&!actors.some(a=>a.id===s.targetId&&a.team!==owner.team)))throw new TypeError('invalid-owner-add-lock-on-target');
}
/** Original LOT_UID_VECTOR bridge runs after global mesh movement and steers
 * the next packet. Only callbacks that explicitly set an enemy UID can use it.
 */
export function advanceAddLockOn(sim,e,a,dt){
 if(!(dt>0)||!e.sourceShadowMesh)return;
 if(advanceAddMmLot6(sim,e,a,dt))return;
 const auto=automatic.get(e.name);
 if(auto&&!e.sourceAddMarkedDrone){
  if(auto.profession!==a.professionId||e.skillId!==auto.skill)return;
  const raw=e.damage?.LOCK_ON_DATA;
  if(raw?.LOCK_ON_TYPE!==auto.type||!Number.isFinite(raw.CURVE_SPEED))throw new TypeError('Missing original automatic Add lock-on declaration');
  if(e.elapsed<(raw.TIME_UNLOCK_FROM_START??0))return;
  const position=e.sourceShadowMesh.position,range=raw.PVP_TARGET_RANGE_MIN_MAX;
  const ownerRange=raw.LOCK_ON_RANGE_FROM_OWNER?.AT_PVP;
  const min=range?.['1']??0,max=range?.['2']??ownerRange;
  if(!Number.isFinite(max))return;
  const forward=rotateNative([a.facing,0,0],[0,(e.birthAnchor?.rotation?.[1]??0)-(a.facing<0?180:0),0]);
  const candidates=sim.state.actors.map((b,index)=>({b,index,distance:Math.hypot(b.x-position[0],b.y-position[1],b.z-position[2])}))
   .filter(({b,distance})=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&!b.invincible&&!(b.forceInvincible>0)&&!b.invulnerable&&
    distance>=min&&(ownerRange===undefined?distance<=max:Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<=max)&&
    (raw.ONLY_FRONT!==1||[b.x-a.x,b.y-a.y,b.z-a.z].reduce((s,n,i)=>s+n*forward[i],0)>0))
   .sort((x,y)=>x.distance-y.distance||x.index-y.index);
  const target=candidates.find(row=>row.b.id===e.sourceAddLockOn?.targetId)?.b??candidates[0]?.b;
  if(!target)return;
  const direction=rotateNative([1,0,0],e.currentAnchor?.rotation??e.birthAnchor?.rotation??[0,a.facing<0?180:0,0]);
  e.sourceAddLockOn??={targetId:target.id,manualDirDegree:direction.map(n=>Math.fround(n*180/Math.PI)),useManualDir:false};
  e.sourceAddLockOn.targetId=target.id;
 }
 if(!e.sourceAddLockOn)return;
 if(advanceMaximumStrikeLockOn(sim,e,a,dt))return;
 if(e.sourceAddMarkedDrone?.unlockRemaining>0){e.sourceAddMarkedDrone.unlockRemaining=Math.max(0,Math.fround(e.sourceAddMarkedDrone.unlockRemaining-dt));return;}
 const s=e.sourceAddLockOn,b=sim.state.actors.find(b=>b.id===s.targetId&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected);
 const bridge=sim.skillsFor(a)??sim.nativeSkills;
 if(!b||!bridge?.vectorLockOn)return;
 const p=e.sourceShadowMesh.position,point=nearestLockOnPoint(sim.defenderSampler?.(b,{profile:sim.profileFor(b),role:'defender'}),[a.x,a.y,a.z],[b.x,b.y,b.z]);
 if(e.sourceAddMarkedDrone&&sim.networkEpochFor?.(b.id)!==undefined&&sim.networkEpochFor(b.id)!==e.sourceAddMarkedDrone.targetEpoch)return;
 s.manualDirDegree=bridge.vectorLockOn({position:p,manualDirDegree:s.manualDirDegree,targetPosition:point,curveSpeed:e.sourceAddMarkedDrone?15:e.damage.LOCK_ON_DATA.CURVE_SPEED,dt}).manualDirDegree;s.useManualDir=true;
 orientLiteralMesh(e.sourceShadowMesh,s.manualDirDegree.map(n=>Math.fround(n*Math.fround(Math.PI/180))),{preserveWorldGravity:!!e.sourceAddMarkedDrone});
}
