/** Scoped Drone Activator connection, target2016 prose and the pinned Add
 * ThirdPath_DynamoLockRetarget consumer. No unmarked nearest-target scan. */
import {addDroneMarkTarget} from './add-drone-mark.mjs';
import {ADD_FISSION_DRONE_NAMES} from './add-dynamo-effect-state.mjs';
export const ADD_FLICK_MARKED_SUB='DamageEffect_AMM_Flick_Disc_Dynamo_Damage_Sub';
export const ADD_MARKED_DRONE_NAMES=new Set(['DamageEffect_SA_APT_Magnetron_Dynamo_Projectile','DamageEffect_AAT_Rushing_Drone','DamageEffect_AMM_Countdown_Bomb_Projectile','DamageEffect_AMM_Countdown_Bomb_Projectile_Mutation',ADD_FLICK_MARKED_SUB,...ADD_FISSION_DRONE_NAMES]);
export function markAddDroneProjectile(sim,a,e){
 if(!e||a.professionId!=='MM'||!ADD_MARKED_DRONE_NAMES.has(e.name))return false;
 const target=addDroneMarkTarget(sim,a);if(!target)return false;
 //3273c4d0 overwrites LOT6's hit-to-unlock gate with its own .1 delay.
 e.sourceAddMarkedDrone={targetEpoch:a.sourceAddDroneMark.targetEpoch,unlockRemaining:Math.fround(.1)};
 e.sourceAddLockOn={targetId:target.id,manualDirDegree:[0,a.facing<0?180:0,0],useManualDir:false};
 // Flick's parent group already receives1.2 at construction. Its parsed DD
 // keeps that value; the post-factory setter changes future-child scalar.
 // This Sub has no CREATE/DIE children, so do not multiply its own DD twice.
 if(e.name!==ADD_FLICK_MARKED_SUB)e.powerMultiplier=Math.fround(e.powerMultiplier*1.2);return true;
}
export function validateAddMarkedDrone(e,profile){
 const s=e.sourceAddMarkedDrone;if(s===undefined)return;
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==2||!Number.isSafeInteger(s.targetEpoch)||s.targetEpoch<0||!Number.isFinite(s.unlockRemaining)||s.unlockRemaining<0||s.unlockRemaining>.3000001||
   !ADD_MARKED_DRONE_NAMES.has(e.name)||!e.sourceAddLockOn||!([29208,29219].includes(e.skillId)&&e.name==='DamageEffect_AAT_Rushing_Drone'||
   e.skillId===29211&&e.name.startsWith('DamageEffect_AMM_Countdown_Bomb_Projectile')||e.skillId===29210&&e.name===ADD_FLICK_MARKED_SUB||e.skillId===29209&&ADD_FISSION_DRONE_NAMES.has(e.name)||e.skillId===29205&&e.name==='DamageEffect_SA_APT_Magnetron_Dynamo_Projectile'))throw new TypeError('invalid-owner-add-marked-drone');
 if(profile&&(profile.target?.unitClass!==123||s.unlockRemaining>Math.fround(.1)+1e-7))throw new TypeError('invalid-owner-add-marked-drone-source');
 if(e.name==='DamageEffect_AAT_Rushing_Drone'&&e.sourceShadowMesh?.gravity?.some(n=>n!==0))throw new TypeError('invalid-owner-add-marked-drone-gravity');
}
/**3273ca90 sets these flags only in its unmarked branch. Keep the frozen DD
 * intact; the marked instance bypasses ordinary ground-line correction. */
export const addMarkedDroneMotionData=e=>e.name==='DamageEffect_AAT_Rushing_Drone'?
 e.sourceAddMarkedDrone?null:{...e.damage,FOLLOW_LINE:1,FOLLOW_ON_LINE:1,FOLLOW_LINE_GRAVITY:1}:e.damage;
export function initializeAddMarkedDroneMesh(e){
 if(e.sourceAddMarkedDrone&&e.name==='DamageEffect_AAT_Rushing_Drone'&&e.sourceShadowMesh)e.sourceShadowMesh.gravity=[0,0,0];
}
