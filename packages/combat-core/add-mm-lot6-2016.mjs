import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {orientLiteralMesh} from './shadow-mesh.mjs';
import {ADD_PULSE_PROJECTILE,addPulseSteeringAllowed2016,validateAddPulseFront2016} from './add-pulse-cannon-2016.mjs';
const f=Math.fround;
export const ADD_MM_LOT6_NAMES=new Set(['DamageEffect_AMM_Countdown_Bomb_Projectile','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation','DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub',ADD_PULSE_PROJECTILE]);
export const ADD_PHANTOM_LOT8='DamageEffect_AAT_Phantom_Seeker_Projectile_Sub';
const automaticNames=new Set([...ADD_MM_LOT6_NAMES,ADD_PHANTOM_LOT8]);
function state(e){const raw=e.damage?.LOCK_ON_DATA;return e.sourceAddLot6??={history:[],targetId:null,npcTargetId:null,started:f(raw.TIME_UNLOCK_FROM_START??0),activeRemaining:f(raw.TIME_UNLOCK_AFTER_START??9999),retargetRemaining:0,attackGate:(raw.UNLOCK_START_AFTER_ATTACK??-1)>0,contactSerial:0,processedSerial:0,stoppedSpeed:null};}
/** 320a6130: strict range endpoints, ordered collection, nearer-only replace.
 * On failure clear history once according to mode, without same-call retry. */
export function selectAddMmLot6(sim,e,a,position,{scaleRange=false}={}){
 const s=state(e),raw=e.damage.LOCK_ON_DATA,range=raw.PVP_TARGET_RANGE_MIN_MAX??{'1':150,'2':300},scale=scaleRange&&raw.TARGET_RANGE>0?raw.TARGET_RANGE:1;let target=null,best=Infinity;
 for(const b of sim.state.actors){const d=Math.hypot(b.x-position[0],b.y-position[1],b.z-position[2]);
  if(b.id===a.id||b.team===a.team||b.hp<=0||b.invincible||b.forceInvincible>0||b.pvpDead||b.pvpDisconnected||s.history.includes(b.id)||!(d>range['1']*scale&&d<range['2']*scale))continue;
  if(d<best){best=d;target=b;}
 }
 if(!target&&(raw.NOT_TARGET_PRE_LOCK_ON_TARGET===1||raw.NOT_TARGET_PRE_LOCK_ON_TARGET===3&&s.history.length>1))s.history=[];
 return target;
}
/** Target320a7ed0: vector-order pool, max inclusive (min is unread), then
 * exactly one CRT word %100 %N. The Web RNG supplies the explicit word.
 * Current actors are the host's User objects; NPC node/vptr inputs remain a
 * separate typed domain, never guessed from a generic actor center. */
export function selectAddPhantomLot8(sim,e,a,position){
 const s=state(e),raw=e.damage.LOCK_ON_DATA,max=raw.PVP_TARGET_RANGE_MIN_MAX?.['2'];
 if(!Number.isFinite(max))throw new TypeError('Original Phantom target range required');
 const candidates=sim.state.actors.filter(b=>{
  if(b.id===a.id||b.team===a.team||b.hp<=0||b.invincible||b.forceInvincible>0||b.invulnerable||b.pvpDead||b.pvpDisconnected||s.history.includes(b.id))return false;
  const d=[b.x-position[0],b.y-position[1],b.z-position[2]].map(f);
  if(!(f(d.reduce((sum,n)=>sum+n*n,0))<=max*max))return false;
  const ownerMax=raw.LOCK_ON_RANGE_FROM_OWNER?.AT_PVP;
  return ownerMax===undefined||Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)<=ownerMax;
 });
 if(!candidates.length){if(raw.NOT_TARGET_PRE_LOCK_ON_TARGET===1)s.history=[];return null;}
 if(typeof sim.rng!=='function')throw new TypeError('Phantom requires explicit snapshot-owned Web RNG');
 const random=sim.rng();if(!Number.isFinite(random)||random<0||random>=1)throw new TypeError('Invalid Phantom RNG');
 return candidates[(Math.floor(random*32768)%100)%candidates.length];
}
// The out-type byte starts0. A failed selector returns-1 without writing that
// byte, so it clears the NPC slot only. It must not erase a retained User UID.
function storeSearch(s,target){if(target)s.targetId=target.id;else s.npcTargetId=null;}
function steer(sim,e,a,point,dt){
 if(e.name===ADD_PULSE_PROJECTILE&&!addPulseSteeringAllowed2016(sim,e,a,point))return;
 const mesh=e.sourceShadowMesh,bridge=sim.skillsFor?.(a)??sim.nativeSkills;if(!bridge?.vectorLockOn)return;
 const initial=(mesh.basis?.[0]??[a.facing,0,0]).map(n=>f(n*57.29577951308232));
 const old=e.sourceAddLockOn?.manualDirDegree??initial;
 const direction=bridge.vectorLockOn({position:mesh.position,manualDirDegree:old,targetPosition:point,curveSpeed:e.damage.LOCK_ON_DATA.CURVE_SPEED,dt}).manualDirDegree;
 // This separate public transform carries the resolved User identity. A
// failed initial search only turns forward and does not invent a target UID.
 const id=e.sourceAddLot6.targetId;if(id)e.sourceAddLockOn={targetId:id,manualDirDegree:direction,useManualDir:true};
 orientLiteralMesh(mesh,direction.map(n=>f(n*f(Math.PI/180))));
}
export function addMmLot6Contact(e,target){
 if(!e||!automaticNames.has(e.name)||e.sourceAddMarkedDrone||e.name===ADD_PULSE_PROJECTILE)return false;
 const s=state(e);if(!s.history.includes(target.id))s.history.push(target.id);s.contactSerial++;return true;
}
/** Called after mesh movement. Ordinary Rushing/Fission LOT0 do not enter.
 * Activator's explicit LOT4 override remains owned by its separate bridge. */
export function advanceAddMmLot6(sim,e,a,dt){
 if(!automaticNames.has(e.name)||e.sourceAddMarkedDrone||a.professionId!==(e.name===ADD_PULSE_PROJECTILE?'LP':'MM'))return false;
 if(!e.sourceShadowMesh||!(dt>0))return true;
 const s=state(e),raw=e.damage.LOCK_ON_DATA,mesh=e.sourceShadowMesh,phantom=e.name===ADD_PHANTOM_LOT8;
 const select=phantom?selectAddPhantomLot8:selectAddMmLot6;
 const search=(position,options)=>{if(phantom){s.targetId=null;s.npcTargetId=null;}storeSearch(s,select(sim,e,a,position,options));};
 if(s.started>0){s.started=f(s.started-dt);return true;}
 if(s.activeRemaining>0)s.activeRemaining=f(s.activeRemaining-dt);
 if(s.activeRemaining<=0)return true;
 // 754 is the effect attack counter, not history size. Contact insertion and
// accepted/Miss counting are independent host operations.
 const count=Number.isSafeInteger(e.hitCount)?e.hitCount:s.contactSerial;
 if(s.attackGate){if(count<(raw.UNLOCK_START_AFTER_ATTACK??1))return true;s.attackGate=false;}
 if(s.retargetRemaining>0){s.retargetRemaining=f(s.retargetRemaining-dt);return true;}
 const local=sim.networkOwnerId==null||sim.networkOwnerId===a.id;
 const target=sim.state.actors.find(b=>b.id===(s.targetId??s.npcTargetId)&&!b.pvpDisconnected);
 if(target){
  if(s.stoppedSpeed!==null){mesh.dirSpeed=s.stoppedSpeed;s.stoppedSpeed=null;}
  const point=phantom?[target.x,target.y+100,target.z]:nearestLockOnPoint(sim.defenderSampler?.(target,{profile:sim.profileFor(target),role:'defender'}),[a.x,a.y,a.z],[target.x,target.y+(e.name===ADD_PULSE_PROJECTILE?100:0),target.z]);
  steer(sim,e,a,point,dt);
  if(count>s.processedSerial&&local){s.processedSerial=count;s.retargetRemaining=f(raw.RETARGET_COOLTIME_AFTER_ATTACK??-1);search(point);}
  // The original tests the old resolved target after the hit-triggered search.
// A dead target explicitly clears all slots before the second mesh search.
  if(target.hp<=0&&local){s.targetId=null;s.npcTargetId=null;search(mesh.position,{scaleRange:true});}
  return true;
 }
 if(!local||(e.damage.DAMAGE_TIME??1)<count||count<s.processedSerial)return true;
 search(mesh.position,{scaleRange:true});
 if(raw.NOT_FIND_TARGET_MOVE_STOP===1&&s.stoppedSpeed===null&&s.targetId===null&&s.npcTargetId===null){s.stoppedSpeed=mesh.dirSpeed;mesh.dirSpeed=0;}
 // Modes2/3/4 compensate the next steering direction after this search, even
// when it just found a target. This does not translate the mesh a second time.
 if([2,3,4].includes(raw.NOT_TARGET_PRE_LOCK_ON_TARGET)){
  const forward=mesh.basis?.[0]??[a.facing,0,0];
  steer(sim,e,a,[f(mesh.position[0]+mesh.dirSpeed*forward[0]),mesh.position[1],f(mesh.position[2]+mesh.dirSpeed*forward[2])],dt);
 }
 return true;
}
export function validateAddMmLot6(e){
 validateAddPulseFront2016(e);
 const s=e.sourceAddLot6;if(s===undefined)return true;
 const id=n=>n===null||typeof n==='string'&&n.length>0&&n.length<=128;
 if(!automaticNames.has(e.name)||!s||typeof s!=='object'||Object.keys(s).length!==10||!Array.isArray(s.history)||s.history.length>16||new Set(s.history).size!==s.history.length||!s.history.every(n=>n!==null&&id(n))||!id(s.targetId)||!id(s.npcTargetId)||!Number.isFinite(s.started)||s.started< -60||s.started>f(.3)||!Number.isFinite(s.activeRemaining)||s.activeRemaining< -60||s.activeRemaining>9999||!Number.isFinite(s.retargetRemaining)||s.retargetRemaining< -60||s.retargetRemaining>9999||typeof s.attackGate!=='boolean'||!Number.isInteger(s.contactSerial)||s.contactSerial<0||!Number.isInteger(s.processedSerial)||s.processedSerial<0||s.processedSerial>Math.max(s.contactSerial,e.hitCount??0)||!(s.stoppedSpeed===null||Number.isFinite(s.stoppedSpeed)&&s.stoppedSpeed>=0))throw new TypeError('Invalid MM automatic lock-on state');return true;
}
