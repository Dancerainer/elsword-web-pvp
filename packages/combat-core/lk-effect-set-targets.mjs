/** Target2016 per-instance LK mesh/bone targets; fixed-V5 EffectSet.cpp 828/904/3825.
 * Dummy02/03 and ATTACK_SPHERE1/2 belong to the exact summoned sword or
 * attack-mesh instance. Never resolve them against another cast or the actor.
 */
export const ARMAGEDDON_SET='EffectSet_SA_ELK_ArmagedonBlade';
export const ARMAGEDDON_SWORD='ELK_ArmagedonBladeM';
import elesisTargets from '../../contracts/elesis-effect-targets-v30.json' with {type:'json'};
import addTargets from '../../contracts/add-effect-bone-targets-v31.json' with {type:'json'};
import addNativeTargets from '../../contracts/add-analysis-bone-targets-v37.json' with {type:'json'};
import addMmTargets from '../../contracts/add-mm-bone-targets-v45.json' with {type:'json'};
import addLpTargets from '../../contracts/add-lp-bone-targets-v45.json' with {type:'json'};
import {ADD_COMMON_BONE_TARGETS} from './add-prism-v45.mjs';
export {ADD_COMMON_BONE_TARGETS};
export const LK_BONE_TARGETS=Object.freeze({[ARMAGEDDON_SET]:ARMAGEDDON_SWORD,
  EffectSet_SA_Elsword_SandStorm:'DamageEffect_ELK_Sand_Storm_Main',
  ...Object.fromEntries(['preFX','FX1','FX2','FX3','Damage1','Damage2','Damage3'].map(s=>['EffectSet_ERS_Luna_Buster_'+s,'ERS_Luna_Buster_Dummy01']))});
export const ELESIS_BONE_TARGETS=Object.freeze({
  ...elesisTargets.bindings,
  ...Object.fromEntries(['START','LOOP','END'].map(s=>['EffectSet_SA_SDK_BURNING_PHANTOM_'+s,'SDK_BURNING_PHANTOM_StartDummy'])),
  ...Object.fromEntries(['FX1','FX2','FX3'].map(s=>['EffectSet_HA_SCA_FATE_SMASHER_'+s,'SCA_FATE_SMASHER_DUMMY01']))});
export const ADD_BONE_TARGETS=Object.freeze({...addTargets.bindings,...addLpTargets.bindings});
export const ADD_ANALYSIS_BONE_TARGETS=Object.freeze({...addNativeTargets.bindings,...addMmTargets.bindings,
 EffectSet_SI_SA_AAT_Panzer_Buster_Aiming_BG:'ADD_Panzer_Buster_Aiming_01'});
const meshTargets={...LK_BONE_TARGETS,...ELESIS_BONE_TARGETS,...ADD_BONE_TARGETS,...ADD_ANALYSIS_BONE_TARGETS,...ADD_COMMON_BONE_TARGETS};
export const setMeshTargetNames=name=>[meshTargets[name]].flat();
export const hasSetMeshBoneTarget=e=>Object.hasOwn(e,'sourceBoneTargetMeshId');

export function bindLKSetMeshTargets(effects){
  const names=setMeshTargetNames(effects[0]?.setName),sword=effects.find(e=>names.includes(e.name));
  if(!sword||sword.definition.BONE_TRACE_TARGET_MESH!==1||sword.setName===ARMAGEDDON_SET&&(sword.definition.TRACE_USER_TARGET_FORCE!==1||
    sword.definition.TRACE_MATRIX!==1||sword.definition.BONE_NAME!=='Dummy1_Rhand'))
    throw new TypeError('Original LK target-mesh declaration required');
  for(const e of effects){
    e.sourceBoneEffectSetId=sword.id;
    if(e!==sword&&e.definition.TRACE_USER_TARGET_FORCE!==1)e.sourceBoneTargetMeshId=sword.id;
  }
}

export function sampleSetMeshBoneAnchor(effect,effects,actor,sampleBone,sampleMatrix){
  if(!hasSetMeshBoneTarget(effect))return null;
  const sword=effects.find(e=>e.id===effect.sourceBoneTargetMeshId&&e.ownerId===effect.ownerId&&
    e.setName===effect.setName&&setMeshTargetNames(effect.setName).includes(e.name)&&e.sourceBoneEffectSetId===effect.sourceBoneEffectSetId&&e.active&&!e.dead);
  if(!sword)return effect.currentAnchor??effect.birthAnchor;
  const position=effect.definition.BONE_NAME?sampleBone?.(sword,actor,effect.definition.BONE_NAME):
    (sword.currentAnchor??sword.birthAnchor)?.position;
  if(!position)return null;
  const d=effect.definition;
  // The original GetCombineMatrix consumer uses this exact set's target
  // frame for declared TRACE_MATRIX siblings. Position-only bones and missing
  // matrix samplers keep their existing path; no actor matrix is substituted.
  const matrix=d.TRACE_MATRIX===1&&d.BONE_NAME?sampleMatrix?.(sword,actor,d.BONE_NAME):null;
  return {position:position.map((n,i)=>n+(d[['POSITION_OFFSET_X','POSITION_OFFSET_Y','POSITION_OFFSET_Z'][i]]??0)*(i===0?actor.facing:1)),
    facing:actor.facing,rotation:[d.ROTATE_X??0,(d.ROTATE_Y??0)+(actor.facing<0?180:0),d.ROTATE_Z??0],
    ...(matrix?{matrix:[...matrix]}:{}),
    evidence:'target2016 declared mesh bone + fixed-V5 per-instance EffectSet target mesh; target-client-unmeasured'};
}
