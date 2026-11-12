import {isElswordProfession,isElswordProfile} from '../professions/identity.mjs';
/** LK target values consumed by explicitly qualified fixed-V5 control flow.
 * This module does not contain RF action data or supply old numeric defaults.
 * Matching target2016 executable consumers and client traces remain unavailable.
 */
const f=Math.fround;
const finite=(value,label)=>{if(!Number.isFinite(value))throw new TypeError('Missing target2016 '+label);return f(value);};
export const LK_SOURCE_REFERENCE='a8438f3ed18dd6f0944793de6c0d8bb9334e9633';
export function wayOfSwordFields(profile){return profile.referenceSemantics?.wayOfSword?.targetFields;}
export function createWayOfSword(profile){
  const fields=wayOfSwordFields(profile);
  if(!fields)return null;
  const top=finite(fields.Const_VigorStateThreshold,'vigor threshold'),bottom=finite(fields.Const_DestStateThreshold,'destruction threshold');
  if(top<=0||bottom>=0)throw new RangeError('Invalid target Way of Sword thresholds');
  return {point:0,state:0};
}
/** SwordMan7339: active vigor/destruction persists while its side remains
 * positive/negative; crossing through zero ends it. It does not downgrade to
 * the corresponding charging state after each consumed point. */
export function advanceWayOfSword(profile,resource,delta){
  const fields=wayOfSwordFields(profile);if(!fields||!resource)return null;
  const before={...resource};
  resource.point=Math.max(finite(fields.Const_DestStateThreshold,'destruction threshold'),Math.min(finite(fields.Const_VigorStateThreshold,'vigor threshold'),f(f(resource.point)+finite(delta,'Way of Sword delta'))));
  const next=resource.point>=fields.Const_VigorStateThreshold?2:resource.point<=fields.Const_DestStateThreshold?-2:Math.sign(resource.point);
  if(!(resource.state===2&&next===1||resource.state===-2&&next===-1))resource.state=next;
  return {before,after:{...resource},delta:f(resource.point-before.point),evidenceClass:'target2016 constants + fixed-V5 SwordMan7339/SetPoint candidate'};
}
export function wayOfSwordHitDelta(profile,resource,data,powerMultiplier=1){
  const fields=wayOfSwordFields(profile);if(!fields||!resource)return null;
  const type=data.WAY_OF_SWORD_TYPE;
  if(type==null)return null;
  if(!Number.isInteger(type)||type<0||type>6)return null;
  if(type===0)return 0;
  const vigor=type<=3,kind=['Command','Active','SpecialActive'][(type-1)%3];
  const suffix={[-2]:'InDestState',[-1]:'TowardDestState',[0]:'CenterState',[1]:'TowardVigorState',[2]:'InVigorState'}[resource.state];
  const skill=finite(fields['SkillTypeConst_'+(vigor?'Vigor':'Dest')+kind],'Way of Sword skill type constant');
  const condition=finite(fields['StateConst_'+(vigor?'Vigor':'Dest')+'Skill_'+suffix],'Way of Sword state constant');
  // Fixed Always.h defines BALANCE_PATCH_20120329: CalcWayOfSwordPoint uses
  // game mode factor1; the target GameModeConst_PVP_Hit remains raw evidence.
  // GetAllDamage returns physical+magic before the final HP damage formula.
  const damage=f(finite(data.DAMAGE?.PHYSIC??0,'physical multiplier')+finite(data.DAMAGE?.MAGIC??0,'magic multiplier'));
  return f(f(f(damage*finite(powerMultiplier,'power multiplier'))*skill)*condition);
}
export function wayOfSwordReceivedDelta(profile,resource,data){
  const fields=wayOfSwordFields(profile);if(!fields||!resource||data.NO_DAMAGE||[0,6,7,10].includes(data.REACT_TYPE))return null;
  const suffix={[-2]:'InDestState',[-1]:'TowrdDestState',[0]:'CenterState',[1]:'TowardVigorState',[2]:'InVigorState'}[resource.state];
  // DamageManager3158 intentionally ignores its damage amount argument.
  return f(finite(fields.SkillTypeConst_DamageReact,'received skill constant')*finite(fields['StateConst_DamageReact_'+suffix],'received state constant'));
}
/** ReInit365–415 clears points for any positive score lead. Otherwise it
 * retains points but ends active Vigor/Destruction into the charging mode.
 * This is qualified fixed-V5 source behavior, not a target-client trace. */
export function createLordKnightResourcePools(){
  const supported=actor=>isElswordProfession(actor.professionId)&&actor.wayOfSword;
  const restore=(actor,value,side)=>{
    actor.wayOfSword??={point:0,state:0};
    if(value>0||Math.sign(actor.wayOfSword.point)===side||actor.wayOfSword.point===0)actor.wayOfSword.point=value===0?0:f(side*value);
    const limits=actor.wayOfSwordLimits;
    if(!limits||!Number.isFinite(limits.vigor)||!Number.isFinite(limits.destruction))throw new TypeError('Frozen target Way of Sword limits required');
    actor.wayOfSword.state=actor.wayOfSword.point===0?0:Math.sign(actor.wayOfSword.point);
  };
  const retain=(balance,{scoreDifference})=>scoreDifference>0?0:balance;
  return [{id:'lk-vigor',read:actor=>supported(actor)?Math.max(0,actor.wayOfSword.point):null,retain,write:(actor,value)=>restore(actor,value,1)},
    {id:'lk-destruction',read:actor=>supported(actor)?Math.max(0,-actor.wayOfSword.point):null,retain,write:(actor,value)=>restore(actor,value,-1)}];
}
export function lordKnightDamageData(profile,actor,skill,data){
  if(!isElswordProfile(profile)||skill?.executor!=='Kick')return data;
  const value=skill.raw?.SA_FORCE_DOWN_ABS?.[String(actor.skillContext?.level??skill.maxLevel)];
  if(!Number.isFinite(value))return data;
  return {...data,FORCE_DOWN:-f(value)};
}
