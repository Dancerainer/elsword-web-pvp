/** Target2016 Blaze Wing LOT6 + bounded fixed-V5 target/mesh consumers.
 * Y_DIR_INIT and LOCK_ON_RANGE_FROM_OWNER have no implemented consumer in
 * the pinned source. They remain unsupported, never inferred from other jobs.
 */
import {rotateNative} from '../effect-runtime/index.mjs';
import {nearestLockOnPoint} from './archenemy-mesh.mjs';
import {blazeWingHistoryFor,blazeWingSelectionSerialFor,recordBlazeWingSelection} from './bh-blaze-wing-history.mjs';
const f=Math.fround,DEG=Math.PI/180;
export const BLAZE_WING_LOCK_ON_DAMAGE='DamageEffect_SBH_Blaze_Wing_Sub';
export function isBlazeWingLockOn(effect,profile){
  return profile?.target?.unitClass===121&&effect.name===BLAZE_WING_LOCK_ON_DAMAGE&&effect.damage?.LOCK_ON_DATA?.LOCK_ON_TYPE===6;
}
/** X2Game11993: stable unit order, strict distance endpoints, alive enemy and
 * invincibility filters. No eligible target clears the shared exclusion set.
 */
export function selectBlazeWingTarget(actors,owner,position,range,previousTargets){
  let target=null,best=f(range[1]);
  for(const actor of actors){
    if(actor.team===owner.team||actor.hp<=0||actor.invincible||actor.forceInvincible>0||previousTargets.includes(actor.id))continue;
    const distance=f(Math.hypot(...[actor.x,actor.y,actor.z].map((value,i)=>f(value-position[i]))));
    if(distance<best&&distance>range[0]){target=actor;best=distance;}
  }
  if(target)previousTargets.push(target.id);else previousTargets.length=0;
  return target;
}
export function advanceBlazeWingLockOn(sim,e,a,dt){
  if(!isBlazeWingLockOn(e,sim.profileFor(a)))return false;
  // Historical hit sampling executes a zero-time effect pass. It must not
  // advance the live projectile's target history or native steering state.
  if(!(dt>0))return true;
  const previous=e.currentAnchor??e.birthAnchor;if(!previous)return true;
  const raw=e.damage.LOCK_ON_DATA,range=raw.PVP_TARGET_RANGE_MIN_MAX;
  if(!range||![range['1'],range['2'],raw.CURVE_SPEED,raw.TIME_UNLOCK_FROM_START,e.initialDirSpeed].every(Number.isFinite)){
    sim.note('bh-blaze-wing-lock-on-fields','Blaze Wing requires its explicit target2016 range, curve, delay and speed',a);return true;
  }
  const control=e.sourceBlazeWingLockOn??={targetId:null,previousHitCount:0,unlockRemaining:f(raw.TIME_UNLOCK_FROM_START),
    // Mesh constructor1276 initializes manual degrees from its actual angle.
    manualDirDegree:[...(e.birthAnchor?.rotation??[0,0,0])],useManualDir:false};
  const history=blazeWingHistoryFor(sim,a.id);
  // A mirror receives effect state, not arbitrary simulation-global keys.
  // The receiver may restore this exact source decision state; packet policy
  // and cross-owner ordering remain the host's separately validated concern.
  control.historySnapshot=[...history];control.selectionSerial=blazeWingSelectionSerialFor(sim,a.id);
  const direction=control.useManualDir?control.manualDirDegree.map(value=>f(value*f(DEG))):rotateNative([1,0,0],previous.rotation??[0,a.facing<0?180:0,0]);
  const position=previous.position.map((value,i)=>f(value+f(f(direction[i]*f(e.initialDirSpeed))*f(dt))));
  let rotation=previous.rotation;
  const length=Math.hypot(...direction),horizontal=Math.hypot(direction[0],direction[2]);
  if(control.useManualDir&&length>0&&horizontal>0)rotation=[0,Math.atan2(-direction[2],direction[0])/DEG,
    Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))/DEG];
  e.currentAnchor={...previous,position,rotation};[e.x,e.y,e.z]=position;
  // Global mesh movement precedes DamageEffect steering for the next packet.
  if(control.unlockRemaining>0){control.unlockRemaining=f(control.unlockRemaining-f(dt));return true;}
  const select=origin=>{
    const id=selectBlazeWingTarget(sim.state.actors,a,origin,[range['1'],range['2']],history)?.id??null;
    control.historySnapshot=[...history];control.selectionSerial=recordBlazeWingSelection(sim,a.id);
    return id;
  };
  const target=sim.state.actors.find(actor=>actor.id===control.targetId);
  if(target){
    const point=nearestLockOnPoint(sim.defenderSampler?.(target,{profile:sim.profileFor(target),role:'defender'}),
      [a.x,a.y,a.z],[target.x,target.y+100,target.z]);
    const bridge=sim.skillsFor?.(a)??sim.nativeSkills;
    if(!bridge?.vectorLockOn)sim.note('bh-blaze-wing-native-lock-on','Original VectorLockOn bridge required',a);
    else{
      control.manualDirDegree=bridge.vectorLockOn({position,manualDirDegree:control.manualDirDegree,
        targetPosition:point,curveSpeed:raw.CURVE_SPEED,dt}).manualDirDegree;
      control.useManualDir=true;
    }
    if(e.hitCount>control.previousHitCount){control.previousHitCount=e.hitCount;control.targetId=select(point);}
    if(target.hp<=0)control.targetId=select(position);
  }else if((e.damage.DAMAGE_TIME??1)>=e.hitCount&&e.hitCount>=control.previousHitCount)control.targetId=select(position);
  for(const key of ['Y_DIR_INIT','LOCK_ON_RANGE_FROM_OWNER'])if(Object.hasOwn(raw,key))
    sim.note('bh-blaze-wing-lock-on:'+key,'Original field retained; pinned source loads it but contains no consumer',a);
  return true;
}
