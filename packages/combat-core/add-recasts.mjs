/** Add second activations. Target values stay separate from pinned callback
 * timing/teleport consumers; all positions use original line geometry. */
import {arcLineBasis} from './archenemy-mesh.mjs';
import {addStigmaRecastPlan,returnAddStigma,tickAddStigma} from './add-stigma.mjs';
import {addFantasyTracerPlan} from './add-fantasy-tracer.mjs';
import {maximumStrikeRecastPlan} from './add-maximum-strike.mjs';
import {tickAddVoidHold} from './add-persistent-skills.mjs';
import {tickAddMoonlight} from './add-moonlight-v45.mjs';
import {tickAddSpaceCrack} from './add-space-crack-2016.mjs';
import {tickAddPrismEndpoints} from './add-prism-endpoints-2016.mjs';
import {addQuicksilverWallImpactPosition} from './add-quicksilver-wall-v61.mjs';
const phaseIds=new Set([29201,29216]);
const f=Math.fround;
const phaseEffect=(sim,a,s)=>sim.state.effects.find(e=>e.ownerId===a.id&&e.ownerStateSerial===s?.group&&e.name==='DamageEffect_Add_Phase_Shift'&&!e.dead);
const memo=a=>(a.sourceAddCombat??={pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1});
function baseAddRecastResourcePlan(actor,skill,plan,{profile}={}){
 if(!['LP','MM','DE'].includes(actor.professionId))return plan;
 const maximum=maximumStrikeRecastPlan(actor,skill,plan);if(maximum!==plan)return maximum;
 const stigma=addStigmaRecastPlan(actor,skill,plan,{profile});if(stigma!==plan)return stigma;
 const summon=actor.sourceAddSummon;
 if(actor.professionId==='MM'&&[29601,29604].includes(skill.skillId)&&summon?.kind==='apocalypse'&&
   !['APOCALYPSE_FINISH_ATTACK','APOCALYPSE_DIE_ATTACK'].includes(summon.state))
  return {...plan,mode:'apocalypse-finish',mpCost:0,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,allowStateCancel:true,allowAir:true,
   resourceMpInsufficient:false,resourceDpInsufficient:false,resourceMutationInsufficient:false};
 const phase=actor.sourceAddCombat?.phase,airPhase=phaseIds.has(skill.skillId)&&actor.professionId==='DE'&&!!actor.passivePolicy?.skillLevels?.[29414];
 if(phaseIds.has(skill.skillId)&&phase?.remaining>0){const mp=skill.raw.SA_MP_BURN_ABS[skill.maxLevel];
  return {...plan,mode:'phase-return',recastState:'ANSI_A_AN_PHASE_SHIFT_BLINK',mpCost:mp,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,allowAir:airPhase,
   resourceMpInsufficient:actor.mp<mp,resourceDpInsufficient:false,resourceMutationInsufficient:false};}
 if(skill.skillId===29011&&profile?.states[actor.state]?.sourceState==='ANSI_SA_ALP_QUICKSILVER_ACCEL'){
  const w=profile.states[actor.state].raw.EVENT_PROCESS_TIME1,t=f(actor.animationTime);
  if(t>f(w['1'])&&t<=f(w['2']))return {...plan,mode:'quicksilver-back',recastState:'ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK',mpCost:10,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,allowStateCancel:true,
   resourceMpInsufficient:actor.mp<10,resourceDpInsufficient:false,resourceMutationInsufficient:false};
 }
 if(skill.skillId===29007&&actor.professionId==='LP'&&actor.sourceAddCombat?.stasis?.remaining>0)return {...plan,mode:'stasis-release',recastState:'ANSI_SA_APT_STASIS_FIELD_ACTIVE',mpCost:0,dpCost:0,mutationCost:0,cooldown:0,ignoreCooldown:true,
  resourceMpInsufficient:false,resourceDpInsufficient:false,resourceMutationInsufficient:false};
 return airPhase?{...plan,allowAir:true}:plan;
}
export function addRecastResourcePlan(actor,skill,plan,options={}){
 return addFantasyTracerPlan(actor,skill,baseAddRecastResourcePlan(actor,skill,plan,options),options);
}
export function addRecastEvents(sim,a,before,after,{consumeMutation}={}){
 const profile=sim.profileFor(a),name=profile.states[a.state]?.sourceState;
 if(name==='ANSI_SA_ADE_REVERSE_STIGMA_RETURN')sim.fire(a,'add-recast:stigma-return',.1,before,after,()=>returnAddStigma(sim,a));
 if(name==='ANSI_SA_APT_STASIS_FIELD')sim.fire(a,'add-recast:stasis-loop',.1,before,after,()=>sim.spawnSet(a,'EffectSet_SA_APT_STASIS_FIELD_Loop'));
 if(name==='ANSI_SA_APT_STASIS_FIELD_ACTIVE'){
  let firstBranch=false;
  sim.fire(a,'add-recast:stasis-release-fx',.001,before,after,()=>{
   firstBranch=true;const saved=memo(a).stasis,M=saved?.powerMultiplier/(a.skillScale||1)||1,size=Math.min(M,1.5),first=sim.state.nextEffectId;
   sim.spawnSet(a,'EffectSet_SA_APT_Stasis_Field_Activate');
   for(const e of sim.state.effects)if(e.ownerId===a.id&&e.id>=first){e.sourceAddStasisSize=size;for(const axis of ['X','Y','Z'])e.definition['SCALE_'+axis]=(e.definition['SCALE_'+axis]??1)*size;}
  });
  // Original32758740 exits after the first branch. A large packet crossing
  // both thresholds cannot execute the second event in that same callback.
  if(firstBranch)return;
  sim.fire(a,'add-recast:stasis-release-hit',.3,before,after,()=>{
   const saved=memo(a).stasis,power=saved?.powerMultiplier??a.skillScale,M=power/(a.skillScale||1),size=Math.min(M,1.5);
   const e=sim.createEffect({...a,skillScale:power},{NAME:'DamageEffect_APT_Stasis_Field_Activate',SCALE_X:size,SCALE_Y:size,SCALE_Z:size},{birthAnchor:{position:[a.x,a.y,a.z],facing:a.facing,rotation:arcLineBasis(a,sim.map.lines).rotation}});
   if(e)e.sourceAddStasisSize=size;
   stopStasisDisplay(sim,a);memo(a).stasis=null;
  });
 }
 if(name==='ANSI_A_AN_PHASE_SHIFT')sim.fire(a,'add-recast:phase-place',.1,before,after,()=>{
  const skill=profile.skillCatalog.find(s=>s.skillId===a.skillId),old=memo(a).phase,oldEffect=phaseEffect(sim,a,old);
  if(oldEffect){oldEffect.lifeTimeSeconds=Math.min(oldEffect.lifeTimeSeconds,(oldEffect.meshLifetimeElapsed??oldEffect.elapsed)+.1);oldEffect.damage.DAMAGE_DATA.USED_SKILL_ID=0;}
  const e=sim.createEffect(a,{NAME:'DamageEffect_Add_Phase_Shift'},{birthAnchor:{position:[a.x,a.y,a.z],facing:a.facing,rotation:arcLineBasis(a,sim.map.lines).rotation}});
  if(e){const remaining=skill.raw.SA_EFFECTIVE_TIME[skill.maxLevel];e.lifeTimeSeconds=remaining;memo(a).phase={position:[a.x,a.y,a.z],remaining,group:a.stateSerial,skillId:a.skillId};}
 });
 if(name==='ANSI_SA_ALP_QUICKSILVER_ACCEL'||name==='ANSI_SA_ALP_QUICKSILVER_ACCEL_BACK'){
  const back=name.endsWith('_BACK');
  sim.fire(a,'add-recast:quicksilver-impact',back?.596:.8,before,after,()=>{
   const anchor=sim.effectAnchorSampler?.({definition:{BONE_NAME:'Bip01'}},a);if(!anchor){sim.note('add-quicksilver-bone','Original Bip01 required for impact',a);return;}
   let basis;try{basis=arcLineBasis(a,sim.map.lines);}catch{sim.note('add-quicksilver-basis','Original line direction required for impact',a);return;}
   const position=addQuicksilverWallImpactPosition(sim,a,anchor.position.map((v,i)=>v+basis.direction[i]*(back?100:250)*a.facing+(i===1?(back?30:50):0)));
   let stun=false;
   if(a.sourceAdd?.formation&&a.sourceAdd.mutation>0){
    if(consumeMutation)stun=consumeMutation(a,1,{profile,emit:(...args)=>sim.emit(...args)})===1;
    else sim.note('add-quicksilver-mutation-hook','Mutation consumer unavailable; base impact retained without spending',a);
   }
   sim.createEffect(a,{NAME:'DamageEffect_ALP_Quicksilver_Accel_Impact'+(stun?'_Stun':'')},{birthAnchor:{position,facing:a.facing,rotation:basis.rotation}});
  });
 }
}
export function addRecastStateStart(sim,a){
 const profile=sim.profileFor(a),state=profile.states[a.state]?.sourceState,s=a.sourceAddCombat?.phase;
 if(state==='ANSI_SA_APT_STASIS_FIELD')memo(a).stasis={remaining:15,hitValue:0,damageValue:0,group:a.stateSerial,skillId:29007,powerMultiplier:a.skillScale};
 if(state==='ANSI_SA_APT_STASIS_FIELD_ACTIVE'){
  const saved=memo(a).stasis;if(saved){saved.remaining=0;saved.powerMultiplier=f((a.skillScale??1)*addStasisMultiplier(saved,a.hpMax));}
 }
 if(state!=='ANSI_A_AN_PHASE_SHIFT_BLINK'||!s)return;
 const effect=phaseEffect(sim,a,s);if(!effect){memo(a).phase=null;return;}
 if(!sim.nativeGeometry?.nearest){sim.note('add-phase-nearest','Original GetNearest required for Phase Shift return',a);return;}
 const point=sim.nativeGeometry.nearest({position:s.position});if(!point?.found){sim.note('add-phase-nearest','Original map did not resolve stored Phase Shift point',a);return;}
 const old=[a.x,a.y,a.z];effect.currentAnchor={...(effect.currentAnchor??effect.birthAnchor),position:old};[effect.x,effect.y,effect.z]=old;
 // landPosition remains a required owner-state vector while airborne. Keep
 // the previous valid sample until the ordinary support solver updates it.
 [a.x,a.y,a.z]=point.point;a.grounded=false;a.lineId=null;memo(a).phase=null;
 sim.emit('addPhaseShiftReturned',a.id,{from:old,position:[...point.point]});
}
/** Call before actor input so a destroyed dummy cannot authorize a stale return. */
export function tickAddRecasts(sim,a,dt){
 if(a.sourceAddPrismEndpoints)tickAddPrismEndpoints(sim,a,dt);
 tickAddSpaceCrack(sim,a,dt);
 tickAddVoidHold(sim,a,dt);
 tickAddMoonlight(sim,a,dt);
 tickAddStigma(sim,a,dt);
 const stasis=a.sourceAddCombat?.stasis;
 if(stasis&&stasis.remaining>0){
  if(a.hp<=0){stopStasisDisplay(sim,a);a.sourceAddCombat.stasis=null;}
  else{
   const previous=stasis.remaining;stasis.remaining=Math.max(0,f(previous-dt));
   if(previous>5&&stasis.remaining<=5)sim.spawnSet(a,'EffectSet_SA_APT_STASIS_FIELD_Count_Down');
   if(stasis.remaining<=0){
    const slot=a.loadout?.findIndex(s=>s?.skillId===29007),cost=slot>=0?sim.skillAvailability(a.id,slot).mpCost:null;
    if(Number.isFinite(cost)){
     const declaredAmount=addStasisRefund(stasis,a.hpMax,cost),before=a.mp;
     a.mp=Math.min(a.mpMax,a.mp+declaredAmount);
     sim.emit('addStasisMpRecovered',a.id,{amount:a.mp-before,declaredAmount,resource:'MP',position:[a.x,a.y+50,a.z]});
    }
    stopStasisDisplay(sim,a);a.sourceAddCombat.stasis=null;
    sim.emit('sound',a.id,{name:'AddVoice_Stasis_Field03.ogg',field:'add-stasis-timeout'});sim.emit('sound',a.id,{name:'Add_StasisField2.ogg',field:'add-stasis-timeout'});
   }
  }
 }
 const s=a.sourceAddCombat?.phase;if(!s)return;
 if(a.hp<=0||!phaseEffect(sim,a,s)){a.sourceAddCombat.phase=null;return;}
 s.remaining=Math.max(0,f(s.remaining-dt));if(s.remaining<=0)a.sourceAddCombat.phase=null;
}
function stopStasisDisplay(sim,a){for(const e of sim.state.effects)if(e.ownerId===a.id&&['EffectSet_SA_APT_STASIS_FIELD_Loop','EffectSet_SA_APT_STASIS_FIELD_Count_Down'].includes(e.setName)&&!e.dead){e.dead=true;e.endEmitted=true;sim.emit('effectEnded',a.id,{effectId:e.id,reason:'add-stasis-storage-ended'});}}
/** Record accepted HP damage independently of the unresolved amplification
 * formula. The original reference counted both; target prose names inflicted. */
export function addStasisDamageObserved(actor,amount,{received=false}={}){const s=actor.sourceAddCombat?.stasis;if(s?.remaining>0&&Number.isFinite(amount)&&amount>0){const key=received?'damageValue':'hitValue';s[key]=f(s[key]+amount*(received?5:1));}}
export function addStasisMultiplier(s,maxHp){return f(1+Math.min(s.hitValue/maxHp,.5)+Math.min(s.damageValue/maxHp,.5));}
export function addStasisRefund(s,maxHp,currentMpCost){const c=.3333333432674408;return f(currentMpCost*(Math.min(s.hitValue/maxHp,c)+Math.min(s.damageValue/maxHp,c)+c));}
