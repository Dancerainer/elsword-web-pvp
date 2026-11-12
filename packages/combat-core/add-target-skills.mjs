/** Target damage/buff payloads with qualified Add target-selection callbacks.
 * All magnitudes come from the target tables; reference-only scan constants
 * remain explicit capability limitations rather than target measurements. */
import {arcLineBasis} from './archenemy-mesh.mjs';
import {emitAddForceFingerNotice,applyLocalForceFingerDrain} from './add-target-notices.mjs';
import {markAddStigma} from './add-stigma.mjs';
const own=sim=>(a)=>sim.networkOwnerId==null||sim.networkOwnerId===a.id;
const localPlayback=sim=>sim.networkCombatPlaybackVersion===1;
const currentProtected=a=>a.invincible||a.forceInvincible>0||a.invulnerable||a.hidden||a.pvpPresentation||a.pvpInvincibleRemaining>0;
export function addFrontalTargets(sim,a,radius,count,{lower=-90,upper=90}={}){
 let direction;try{direction=arcLineBasis(a,sim.map.lines).direction;}catch{sim.note('add-target-scan-basis','Original map direction required for frontal scan',a);return [];}
 return sim.state.actors.map((b,index)=>({b,index,d:[b.x-a.x,b.y-a.y,b.z-a.z]}))
  .filter(({b,d})=>b.id!==a.id&&b.team!==a.team&&b.hp>0&&!b.pvpDead&&!b.pvpDisconnected&&
   (d[0]*direction[0]+d[2]*direction[2])*a.facing>0&&Math.hypot(...d)<=radius&&
   Math.atan2(d[1],Math.hypot(d[0],d[2]))*180/Math.PI>=lower&&Math.atan2(d[1],Math.hypot(d[0],d[2]))*180/Math.PI<=upper)
  .sort((a,b)=>Math.hypot(...a.d)-Math.hypot(...b.d)||a.index-b.index).slice(0,count).map(x=>x.b);
}
function at(sim,a,target,name,bone){
 const point=bone?sim.effectAnchorSampler?.({definition:{BONE_NAME:bone}},target,{profile:sim.profileFor(target)})?.position:[target.x,target.y,target.z];
 if(!point){sim.note('add-target-bone:'+bone,'Original target bone unavailable; target effect omitted',a);return null;}
 return sim.createEffect(a,{NAME:name},{birthAnchor:{position:[...point],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}});
}
export function addTargetSkillEvents(sim,a,before,after){
 if(a.professionId!=='DE')return;
 const profile=sim.profileFor(a),state=profile.states[a.state].sourceState;
 const skill=profile.skillCatalog.find(s=>s.skillId===a.skillId);if(!skill)return;
 const fire=(key,time,fn)=>sim.fire(a,'add-target:'+key,time,before,after,fn);
 if(state==='ANSI_A_AN_MIND_BREAK')fire('mind-break',.271,()=>{
  const passive=profile.skillCatalog.find(s=>s.skillId===29414),level=a.passivePolicy?.skillLevels?.[29414];
  const cap=level?passive.raw.SA_EFFECTIVE_COUNT[level]:1;
  for(const target of addFrontalTargets(sim,a,500,Math.max(1,cap),{lower:-35,upper:35})){
   if(localPlayback(sim)&&currentProtected(target))continue;
   if(!localPlayback(sim)||own(sim)(target))sim.grantBuff(a,target,347,skill.maxLevel);
   at(sim,a,target,'DamageEffect_SI_A_AN_MIND_BREAK','_HEAD_BONE');
  }
 });
 if(state==='ANSI_SA_ADE_REVERSE_STIGMA')fire('stigma-initial',.1,()=>{
  const radius=skill.raw.SA_SCOPE_ABS_PVP[skill.maxLevel];
  const target=addFrontalTargets(sim,a,radius,1)[0];markAddStigma(sim,a,target);
  if(target)at(sim,a,target,'DamageEffect_ADE_REVERSE_STIGMA_Attack','Bip01');
 });
 if(state==='ANSI_A_ADE_FORCE_FINGER')fire('force-finger',.271,()=>{
  const targets=addFrontalTargets(sim,a,500,1,{lower:-35,upper:35});
  if(own(sim)(a))emitAddForceFingerNotice(sim,a,targets);
  for(const target of targets){
   if(localPlayback(sim)&&currentProtected(target))continue;
   at(sim,a,target,'DamageEffect_A_ADE_FORCE_FINGER_Explosion');
   if(localPlayback(sim))applyLocalForceFingerDrain(sim,a,target);
   const drain=skill.raw.SA_MP_INTAKE_ABS[skill.maxLevel],recover=skill.raw.SA_MP_RETAKE_ABS[skill.maxLevel];
   if(own(sim)(a)){
    const before=a.sourceAdd?.formation?a.sourceAdd.dp/20:a.mp;
    if(a.sourceAdd?.formation)a.sourceAdd.dp=Math.min(8000,a.sourceAdd.dp+recover*20);
    else a.mp=Math.min(a.mpMax,a.mp+recover);
    const restored=(a.sourceAdd?.formation?a.sourceAdd.dp/20:a.mp)-before;
    sim.emit('addForceFingerTransfer',a.id,{targetId:target.id,drain,recover,restored,resource:a.sourceAdd?.formation?'DP':'MP',
     position:[a.x,a.y+50,a.z],evidence:'target values; qualified ThirdPath_RecoverMPorDP direct SetDP bypasses equipment gain'});
   }
  }
 });
}
