/** Bounded Nasod attack consumers transcribed from pinned V5 Raven.
 * This is a host adapter, not a matching 2016 executable measurement.
 */
import {rotateNative} from '../effect-runtime/index.mjs';
const f=Math.fround, DEG=Math.PI/180;
export const NASOD_ATTACK_SOURCE=Object.freeze({referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  targetClientMeasured:false,request:'Raven14265–14370',launch:'Raven14418–14493',timers:'Raven14547–14721',
  unlock:'DamageEffect2803–2807',helperPose:'target2016 Motion_Raven_RageMode_Nasod.x'});
export const NASOD_ATTACK_SCALE=Object.freeze([0,1,1.6,1.4,1.6,1.5]);
export function positionNasodIdle(core,owner,{direction,rotation},birth=false){
  const target=[owner.x,owner.y+126,owner.z].map((n,i)=>f(n+(i===1?0:direction[i]*owner.facing*-162)));
  const previous=[core.x,core.y,core.z];
  [core.x,core.y,core.z]=birth?target:target.map((n,i)=>f(f(n*f(.05))+f(previous[i]*f(1-f(.05)))));
  core.rotation=[...rotation];
}
export function prepareNasodAttack(core,targetId,rotation){
  if(!core.level||core.parrying||['attack','prepare','guard'].includes(core.phase))return false;
  core.phase='prepare';core.phaseTime=0;core.attackElapsed=0;core.delayElapsed=0;
  core.targetId=targetId;core.hit=false;core.hits={};core.hitGaps={};core.attackLevel=core.level;
  core.animationName=`Attack${core.level}`;core.animationTime=0;core.rotation=[...rotation];
  core.helper={scale:f(NASOD_ATTACK_SCALE[core.level]),outlineColor:[1,f(.333),f(.0745),1],
    attackTime:[0,0],source:NASOD_ATTACK_SOURCE.request};
  core.dirSpeed=0;core.unlockRemaining=0;core.manualDirDegree=[0,0,0];core.useManualDir=false;
  return true;
}
export function launchNasodAttack(core,{direction,facing}){
  // Source flips the native line direction when owner is facing right.
  const offset=facing>0?-150:150;
  [core.x,core.y,core.z]=[core.x,core.y,core.z].map((n,i)=>f(n+f(direction[i]*offset)));
  core.phase='attack';core.phaseTime=0;core.dirSpeed=f(3600);core.unlockRemaining=f(.06);
  core.attackLevel=core.level;core.helper.attackTime=[0,9999];
  // AttackN was selected at request; launch must not restart it .3s later.
}
export function advanceNasodMesh(core,dt){
  const before=[core.x,core.y,core.z];
  if(core.dirSpeed){
    const direction=core.useManualDir?core.manualDirDegree.map(n=>f(n*f(DEG))):rotateNative([1,0,0],core.rotation);
    [core.x,core.y,core.z]=before.map((n,i)=>f(n+f(f(direction[i]*core.dirSpeed)*f(dt))));
    const length=Math.hypot(...direction),horizontal=Math.hypot(direction[0],direction[2]);
    if(core.useManualDir&&length>0&&horizontal>0)core.rotation=[0,Math.atan2(-direction[2],direction[0])/DEG,
      Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))/DEG];
  }
  core.animationTime=f(core.animationTime+f(dt));
}
export function advanceNasodUnlock(core,dt){
  if(core.unlockRemaining>0)core.unlockRemaining=f(core.unlockRemaining-f(dt));
  return core.unlockRemaining>0;
}
const RF_BODY_MELEE_PROXIES=Object.freeze({
  DamageEffect_RF_COMBO_Z:'EffectSet_RF_COMBO_Z',
  DamageEffect_RF_COMBO_X:'EffectSet_RF_COMBO_X',
  DamageEffect_RF_DASH_COMBO_Z:'EffectSet_RF_DASH_COMBO_Z',
});
/** V5 unit AttackResult calls Raven::AttackResultPlayEffect; effect AttackResult
 * only forwards ProcessAttackResult (socket/MP consumers) to the owner.
 * Target2016 Z/X/dash-Z use three TRACE weapon-dummy proxies for body melee;
 * retain those as a bounded target adapter, not a general projectile callback.
 * See rf-archenemy-trigger-source-v8 for the target consumer evidence boundary.
 */
export function canTriggerArchenemy(data,origin={},effect){
  // User::AttackResult rejects no-damage/sensor, Raven also rejects dummy contact.
  if([0,7,10].includes(data.REACT_TYPE)||data.ATTACK_TYPE===1||effect?.sourceArcHandle||effect?.name==='RAVEN_HYPER_AURA')return false;
  if(origin.kind==='character')return true;
  if(origin.kind!=='effect'||origin.skillId!=null||effect?.skillId!=null)return false;
  return Object.hasOwn(RF_BODY_MELEE_PROXIES,effect?.name)&&effect.setName===RF_BODY_MELEE_PROXIES[effect.name]&&
    effect.mainEffectName==='Raven_WeaponDummy01'&&effect.definition?.TRACE_MORE===1;
}
