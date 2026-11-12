/** Exact Particle Prism failed-AniName path, using the existing fixed-source
 * SkinAnim LOOP controller. Never rename the original requested Loop clip. */
import {advanceArcController} from './archenemy-mesh.mjs';
const keys=(v,list)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===list.length&&list.every(k=>Object.hasOwn(v,k));
const n=v=>Number.isFinite(v)&&v>=0;
const transition=v=>v===null||keys(v,['enabled','fromName','fromTime','fromSpeed','fromWeight','fromLoop','durationSeconds','elapsedSeconds'])&&
 v.enabled===true&&v.fromName==='Normal'&&n(v.fromTime)&&v.fromTime<=10&&n(v.fromSpeed)&&v.fromSpeed<=1&&n(v.fromWeight)&&v.fromWeight<=1&&
 v.fromLoop===true&&n(v.durationSeconds)&&v.durationSeconds>0&&v.durationSeconds<=1&&n(v.elapsedSeconds)&&v.elapsedSeconds<=10;
export function isAddPrismTemplate(template){
 return template?.name==='Mesh_Particle_Prism'&&template.initialAnimation?.name==='Loop'&&template.initialAnimation.playback==='XAP_LOOP'&&
  template.animationClips?.length===1&&template.animationClips[0].name==='Normal'&&n(template.animationClips[0].durationSeconds);
}
export function validateAddPrismAnimation(value,{effect,profile}={}){
 if(value==null)return true;
 if(!keys(value,['controller','pose','loopSelections']))throw new TypeError('Invalid Add Prism animation');
 const c=value.controller,p=value.pose;
 if(!keys(c,['animationName','time','maxTime','transitionTime','ramp','transition'])||![null,'Normal'].includes(c.animationName)||
  ![c.time,c.maxTime,c.transitionTime].every(n)||c.time>10||![0,Math.fround(6.666666507720947)].includes(c.maxTime)||c.transitionTime>1||!transition(c.transition)||
  !(c.ramp===null||keys(c.ramp,['elapsed','duration'])&&[c.ramp.elapsed,c.ramp.duration].every(n)&&c.ramp.elapsed<=10&&c.ramp.duration>0&&c.ramp.duration<=1)||
  !keys(p,['animationName','animationTime','animationLoop','presentationTransition'])||![null,'Normal'].includes(p.animationName)||
  !n(p.animationTime)||p.animationTime>10||p.animationLoop!==true||!transition(p.presentationTransition)||
  !Number.isSafeInteger(value.loopSelections)||value.loopSelections<0||value.loopSelections>3)
  throw new TypeError('Invalid Add Prism animation controller');
 if(effect&&(!['DamageEffect_Particle_Prism','DamageEffect_Particle_Prism_Debuff','DamageEffect_Particle_Prism_Debuff_Use_Mutation'].includes(effect.name)||
  ![29003,29029].includes(effect.skillId)||profile&&!isAddPrismTemplate(profile.effectTemplates?.Mesh_Particle_Prism)))
  throw new TypeError('Invalid Add Prism animation source');
 return true;
}
export function restoreAddPrismAnimation(effect){
 const s=effect.sourceAddPrismAnimation;if(!s)return false;
 validateAddPrismAnimation(s);effect.sourceArcController=structuredClone(s.controller);effect.sourceArcPose=structuredClone(s.pose);
 effect.sourceArcLoopSelections=s.loopSelections;return true;
}
export function advanceAddPrismAnimation(effect,dt,template){
 if(!isAddPrismTemplate(template))return false;
 if(!(dt>=0&&Number.isFinite(dt)))throw new TypeError('Invalid Add Prism frame time');
 if(effect.sourceAddPrismAnimation)restoreAddPrismAnimation(effect);
 advanceArcController(effect,dt,template);
 effect.sourceAddPrismAnimation={controller:structuredClone(effect.sourceArcController),pose:structuredClone(effect.sourceArcPose),loopSelections:effect.sourceArcLoopSelections??0};
 // Authored lifetime6.9s, sole period6.6667 with transition. A second LOOP
 // selection is valid near the end; its retained transition is handled by
 // the generic controller, and remains local until that lifecycle closes.
 return true;
}
