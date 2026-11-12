/** Target2016 Add declarations + explicitly qualified fixed-V5/2026 consumer
 * candidate. Raw DP uses 20 units per displayed point. No renderer, timer,
 * network singleton or random source is owned by this module. */
import {recoverAddMindCircle2016} from './add-mind-passives-2016.mjs';
import {addCoreAwakeningMutation2016,reduceAddTimeControlSlots2016} from './add-core-passives-v56.mjs';
export const ADD_SYSTEMS_VERSION='add-systems-target2016-candidate-v1';
export const ADD_DP_MAX=8000;
export const ADD_MUTATION_MAX=6;
export const ADD_DP_DISPLAY_SCALE=20;
// User-corrected revival rule; raw 2000 is exactly 100 displayed DP.
// The acquired ReInit reference supports retaining mutation, but the matching
// target2016 executable's leader-DP setter remains unverified.
export const ADD_LEADING_REVIVAL_DP=100*ADD_DP_DISPLAY_SCALE;
export const ADD_FORMATION_SENTINEL=99999;
export const ADD_SYSTEMS_EVIDENCE='target2016-data+fixed-a8438f3-reconstructed-consumer; target-client-unmeasured';
const f=Math.fround,clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const number=(v,name,min=0,max=Infinity)=>{
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new TypeError('Invalid Add '+name);
  return v;
};
const integer=(v,name,min,max)=>{number(v,name,min,max);if(!Number.isSafeInteger(v))throw new TypeError('Invalid Add '+name);return v;};
export const isAddActor=actor=>['LP','MM','DE'].includes(actor?.professionId?.toUpperCase());
const rawSkill=skill=>skill?.raw??{};
const levelValue=(skill,field,level=1)=>{
  const v=rawSkill(skill)[field];return typeof v==='number'?v:v?.[String(level)];
};
const passive=(actor,profile,id,field)=>{
  const level=actor.passivePolicy?.skillLevels?.[id];
  if(!level)return undefined;
  return levelValue(profile?.skillCatalog?.find(s=>s.skillId===id),field,level);
};
const component=(profile,key)=>number(profile?.components?.[key],key);
const emit=(callback,type,actor,details={})=>callback?.(type,actor.id,{...details,evidence:ADD_SYSTEMS_EVIDENCE});

/** Validate rather than silently clamping peer state. No injected options or
 * passive levels are accepted in the serialized resource object. */
export function validateAddState(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==ADD_SYSTEMS_VERSION)throw new TypeError('Invalid Add state version');
  const allowed=new Set(['version','dp','mutation','formation','formationPending','switchCooldown','generator','lastHitStep','lastReceivedStep']);
  if(Object.keys(value).some(k=>!allowed.has(k)))throw new TypeError('Unknown Add state field');
  number(value.dp,'DP',0,ADD_DP_MAX);integer(value.mutation,'mutation',0,ADD_MUTATION_MAX);
  if(typeof value.formation!=='boolean'||typeof value.formationPending!=='boolean'||value.formation&&value.formationPending)throw new TypeError('Invalid Add formation flag');
  number(value.switchCooldown,'switch cooldown',0,99999);
  integer(value.lastHitStep,'last hit step',-1,Number.MAX_SAFE_INTEGER);
  integer(value.lastReceivedStep,'last received step',-1,Number.MAX_SAFE_INTEGER);
  if(value.generator!==null){
    const g=value.generator;
    if(!g||Object.keys(g).some(k=>!['skillId','phase','generation','remaining'].includes(k)))throw new TypeError('Invalid generator fields');
    if(![29013,29035,29016,29017,29018].includes(g.skillId)||!['ready','firing'].includes(g.phase))throw new TypeError('Invalid generator selection');
    integer(g.generation,'generator generation',1,Number.MAX_SAFE_INTEGER);number(g.remaining,'generator remaining',0,45);
  }
  return true;
}
export function initializeAddSystems(actor,{source,preset={}}={}){
  if(!isAddActor(actor))return null;
  const initial=source??{version:ADD_SYSTEMS_VERSION,dp:preset.initialDp??0,mutation:preset.initialMutation??0,formation:false,formationPending:false,switchCooldown:0,generator:null,lastHitStep:-1,lastReceivedStep:-1};
  validateAddState(initial);actor.sourceAdd=structuredClone(initial);syncAddAwakening(actor);return actor.sourceAdd;
}
export function syncAddAwakening(actor){
  if(!isAddActor(actor)||!actor.sourceAdd)return;
  // The reference itself uses this sentinel. It is a compatibility mirror,
  // never a duration estimate and never decremented by the generic timer.
  actor.awakening??={};
  Object.assign(actor.awakening,{remaining:actor.sourceAdd.formation||actor.sourceAdd.formationPending?ADD_FORMATION_SENTINEL:0,
    orbs:0,gauge:0,full:false,pendingOrbs:0,pendingAvailableOrbs:0,reawakening:false});
}
/** Equipment percentages are the user's final +50%/-50% options. Missing
 * options mean neutral, not another profession's duration/charge defaults. */
export function addDpModifiers(actor,profile,{skillUse=false}={}){
  const options=actor.equipmentAttributes??actor.stats??{};
  const gain=number(options.addDpGainBonus??0,'DP gain option');
  const reduction=number(options.addDpConsumptionReduction??0,'DP consume option',0,1);
  const deReduction=passive(actor,profile,29411,'SA_DP_USE_REL');
  // Target BF357 is BCT_PERCENT, composed by AdditionalHyperCharge after
  // final socket conversion. Basic0 is temporarily1 then restored to0;
  // GetEffectiveIncreaseDPValue is added to1 by the DP consumer.
  const buffGain=(actor.buffs??[]).flatMap(b=>b.behaviors??[]).filter(row=>row.kind==='addDpGain')
    .reduce((n,row)=>f(n*number(row.value,'DP gain Buff percentage')),1);
  // V61 project rule: all three Add professions ignore the equipment DP
  // consumption option when using skills. Authored profession passives remain
  // separate; formation switching and non-skill DP keep their existing path.
  return {gain:f(f(1+gain)*buffGain),consume:clamp(1-(skillUse?0:reduction)-(deReduction===undefined?0:1-deReduction),0,1)};
}
export function changeAddDp(actor,delta,{profile,emit:callback,reason='explicit',gainBonus=0,skillUse=false}={}){
  if(!isAddActor(actor)||!actor.sourceAdd)return 0;
  number(delta,'DP delta',-Infinity);const s=actor.sourceAdd,mods=addDpModifiers(actor,profile,{skillUse}),before=s.dp;
  number(gainBonus,'DP gain bonus');
  s.dp=clamp(f(s.dp+f(delta*(delta>=0?mods.gain+gainBonus:mods.consume))),0,ADD_DP_MAX);
  if(s.formation&&s.dp<=0)stopAddFormation(actor,{profile,emit:callback,reason:'dp-empty',force:true});
  if(before!==s.dp)emit(callback,'addDpChanged',actor,{before,dp:s.dp,delta:s.dp-before,reason});
  return s.dp-before;
}
export function addFormationAvailability(actor,profile){
  if(!isAddActor(actor)||!actor.sourceAdd)return {available:false,reason:'not-add'};
  if(actor.sourceAdd.formationPending)return {available:false,reason:'formation-pending'};
  if(actor.sourceAdd.formation)return {available:true,mode:'release'};
  if(actor.sourceAdd.switchCooldown>0)return {available:false,reason:'formation-cooldown'};
  if(actor.sourceAdd.dp<component(profile,'USE_DP_BY_ENABLE_FORMATION_MODE'))return {available:false,reason:'insufficient-dp'};
  return {available:true,mode:'activate'};
}
export function beginAddFormation(actor,{profile,emit:callback,passiveSample}={}){
  const gate=addFormationAvailability(actor,profile);if(!gate.available||gate.mode!=='activate')return false;
  const lpScale=passive(actor,profile,29400,'SA_DP_USE_REL')??1;
  const charge=component(profile,'USE_DP_BY_FORMATION_MODE')*lpScale;
  const paid=-changeAddDp(actor,-charge,{profile,emit:callback,reason:'formation-enter'});
  const tracer=actor.professionId.toUpperCase()==='LP'?passive(actor,profile,29404,'SA_EFFECTIVE_RATE'):undefined;
  if(tracer!==undefined){
    const amount=f(Math.max(paid,0)*tracer/ADD_DP_DISPLAY_SCALE),before=actor.mp;
    actor.mp=clamp(actor.mp+amount,0,actor.mpMax);
    emit(callback,'addFantasyTracerMpRecovered',actor,{amount:actor.mp-before,declaredAmount:amount,resource:'MP',
      position:[actor.x,actor.y+50,actor.z]});
  }
  actor.sourceAdd.formationPending=true;
  gainAddMutation(actor,1,{profile,emit:callback});syncAddAwakening(actor);
  const extra=addCoreAwakeningMutation2016(actor,profile,passiveSample);
  if(extra.supported&&extra.count)gainAddMutation(actor,extra.count,{profile,emit:callback});
  else if(!extra.supported)emit(callback,'addCorePassiveUnsupported',actor,{reason:extra.reason});
  emit(callback,'addFormationPending',actor,{dp:actor.sourceAdd.dp,mutation:actor.sourceAdd.mutation});return true;
}
export function activateAddFormation(actor,{profile,emit:callback}={}){
  if(!actor.sourceAdd?.formationPending||actor.hp<=0)return false;
  actor.sourceAdd.formationPending=false;actor.sourceAdd.formation=true;
  actor.sourceAdd.switchCooldown=component(profile,'CHANGE_FORMATION_MODE_COOL_TIME');syncAddAwakening(actor);
  emit(callback,'addFormationStarted',actor,{dp:actor.sourceAdd.dp,mutation:actor.sourceAdd.mutation});return true;
}
/** Atomic convenience for independent logic tests/tools. The normal state
 * machine calls begin at StateStart, activate at the .46 source event. */
export function startAddFormation(actor,options={}){
  return beginAddFormation(actor,options)&&activateAddFormation(actor,options);
}
export function stopAddFormation(actor,{profile,emit:callback,reason='manual',force=false}={}){
  if(!actor.sourceAdd?.formation&&!actor.sourceAdd?.formationPending)return false;
  actor.sourceAdd.formation=false;actor.sourceAdd.formationPending=false;
  syncAddAwakening(actor);emit(callback,'addFormationEnded',actor,{reason,dp:actor.sourceAdd.dp});return true;
}
export function gainAddMutation(actor,count,{profile,emit:callback}={}){
  if(!actor.sourceAdd)return 0;integer(count,'mutation gain',0,ADD_MUTATION_MAX);
  const before=actor.sourceAdd.mutation;actor.sourceAdd.mutation=clamp(before+count,0,ADD_MUTATION_MAX);
  const added=actor.sourceAdd.mutation-before;
  const mpPer=passive(actor,profile,29405,'SA_MP_RETAKE_ABS');
  const rewardCap=passive(actor,profile,29405,'SA_EFFECTIVE_COUNT');
  // 32744ac0 rewards an in-range positive request once, including +2.
  // Overflowing6 is a separate branch even when the last point was added.
  const mpBefore=actor.mp;
  if(count>0&&before+count<=ADD_MUTATION_MAX&&actor.sourceAdd.mutation<=rewardCap&&mpPer>0)
    actor.mp=clamp(f(actor.mp+mpPer),0,actor.mpMax);
  const recovered=actor.mp-mpBefore;
  if(recovered>0)emit(callback,'addMutationMpRecovered',actor,{amount:recovered,resource:'MP',position:[actor.x,actor.y+50,actor.z],mutation:actor.sourceAdd.mutation});
  if(added)emit(callback,'addMutationGained',actor,{count:added,mutation:actor.sourceAdd.mutation});return added;
}
export function consumeAddMutation(actor,max,{profile,emit:callback,allowDissolution=false}={}){
  integer(max,'mutation spend limit',0,ADD_MUTATION_MAX);
  if(!actor.sourceAdd||(!actor.sourceAdd.formation&&!allowDissolution))return 0;
  const used=Math.min(max,actor.sourceAdd.mutation);
  return requestAddMutation2016(actor,-used,{profile,emit:callback});
}
/** Selected nonpositive32744ac0 branch. Callers with an actual source request
 * use it directly; max-consume callers above still request their own min count.
 * Recovery sees the requested delta and OLD points before the final store. */
export function requestAddMutation2016(actor,delta,{profile,emit:callback}={}){
  integer(delta,'nonpositive mutation request',-2147483648,0);
  if(!actor.sourceAdd)return 0;
  const before=clamp(actor.sourceAdd.mutation,0,ADD_MUTATION_MAX),next=clamp(before+delta,0,ADD_MUTATION_MAX);
  recoverAddMindCircle2016(actor,delta,{profile,changeDp:changeAddDp,emit:callback});
  actor.sourceAdd.mutation=next;
  if(before!==next)emit(callback,'addMutationConsumed',actor,{used:before-next,mutation:next});
  return before-next;
}
export const isAddGeneratorSkill=skill=>/SI_SA_(?:AAT|AMM)_INSTALLATION_/.test(rawSkill(skill).m_wstrIconTexturePieceName??'');

/** Pure query shared by UI and cast execution. The caller supplies trait-adjusted
 * MP/CD once. The returned plan must only be committed for an accepted cast. */
export function addSkillResourceCost(actor,skill,{profile,mpCost=skill?.mpCost??0,cooldown=skill?.cooldown??0,level=skill?.maxLevel??1}={}){
  if(!isAddActor(actor)||!actor.sourceAdd)return {mpCost,dpCost:0,mutationCost:0,cooldown,mode:'cast'};
  const s=actor.sourceAdd,raw=rawSkill(skill),mods=addDpModifiers(actor,profile,{skillUse:true}),id=skill.skillId;
  let dpCost=0,mode='cast',mp=number(mpCost,'skill MP cost'),cd=number(cooldown,'skill cooldown');
  const dpMode=levelValue(skill,'SA_USE_DP_REL_AT_FORMATION_MODE',level);
  if(dpMode!==undefined)number(dpMode,'skill DP multiplier');
  if(s.formation&&dpMode>0){dpCost=mp*dpMode*ADD_DP_DISPLAY_SCALE;mp=0;}
  else if(!s.formation)dpCost=number(raw.m_usFPConsumtion??0,'skill DP declaration');
  if(actor.professionId.toUpperCase()==='MM'&&isAddGeneratorSkill(skill)){
    if(s.generator?.skillId===id){
      mode='generator-fire';dpCost=0;
      mp=number(levelValue(skill,'SA_MP_CONSUMPTION',level),'generator MP declaration')*(passive(actor,profile,29407,'SA_MP_CONSUMPTION')??1);
    }else{
      mode=s.generator?'generator-switch':'generator-select';mp=0;
      cd=Math.max(0,3-(passive(actor,profile,29407,'SA_EFFECTIVE_TIME')??0));
    }
  }
  // Target32753a90: timer alone gates these eight exact IDs. Validation of
  // the marked target is a separate consumer, never Activator's own cost.
  if(actor.professionId==='MM'&&actor.sourceAddDroneMark?.remaining>0&&[29203,29205,29208,29209,29210,29211,29218,29219].includes(id))mp*=.5;
  if(actor.professionId.toUpperCase()==='DE'&&s.formation&&[7,14,15,16].includes(skill.type)){
    const factor=passive(actor,profile,29410,'SA_COOLTIME_1');if(factor!==undefined)cd*=factor;
  }
  dpCost=f(dpCost*mods.consume);
  const mutationCost=integer(raw.m_usCBConsumption??0,'required mutation',0,ADD_MUTATION_MAX);
  return {mpCost:f(mp),dpCost,mutationCost,cooldown:f(cd),mode,skillId:id,formation:s.formation,
    resourceMpInsufficient:actor.mp<mp,resourceDpInsufficient:s.dp<dpCost,resourceMutationInsufficient:s.mutation<mutationCost};
}
export function commitAddSkillResources(actor,skill,plan,{profile,emit:callback}={}){
  if(!isAddActor(actor)||!actor.sourceAdd)return null;
  const s=actor.sourceAdd;
  if(plan.skillId!==skill.skillId||plan.formation!==s.formation||s.dp<plan.dpCost||s.mutation<plan.mutationCost)throw new TypeError('Stale or unaffordable Add skill plan');
  // Core already subtracted MP. The plan owns the complete DP skill cost;
  // the V61 equipment-option exception must not be scaled again at commit.
  s.dp=f(s.dp-plan.dpCost);s.mutation-=plan.mutationCost;
  // A source second activation spends only its explicitly queried MP. It
  // neither repeats the initial special-active DP gain nor Overlimit recovery.
  if(['phase-return','quicksilver-back','stasis-release','stigma-return','fantasy-tracer'].includes(plan.mode)){
    if(s.formation&&s.dp<=0)stopAddFormation(actor,{profile,emit:callback,reason:'dp-empty',force:true});
    emit(callback,'addSkillResourcesCommitted',actor,{skillId:skill.skillId,mpCost:plan.mpCost,dpCost:plan.dpCost,mutationCost:plan.mutationCost,mode:plan.mode});
    return plan;
  }
  if(plan.mode==='generator-select'||plan.mode==='generator-switch'){
    const generation=(s.generator?.generation??0)+1;
    const duration=skill.skillId===29035?45:30; // explicit target2016 descriptions + BFI366
    s.generator={skillId:skill.skillId,phase:'ready',generation,remaining:duration};
    if(plan.mode==='generator-switch')gainAddMutation(actor,1,{profile,emit:callback});
    emit(callback,'addGeneratorSelected',actor,{...s.generator,mode:plan.mode});
  }else if(plan.mode==='generator-fire'){
    s.generator.phase='firing';emit(callback,'addGeneratorFired',actor,{...s.generator});
  }
  // The 2016 descriptions/fields explicitly bind these numeric enhancements.
  // Other mutation payloads are consumed by their individual skill executor;
  // missing projectile/size/debuff consumers must never spend a point for no effect.
  const base=rawSkill(skill).m_DeleteSkillIDByUpgrade??skill.skillId;
  if(s.formation&&base===29208&&actor.skillContext)
    actor.skillContext.addMutationSpent=consumeAddMutation(actor,1,{profile,emit:callback});
  const numericMutation={29001:[2,.15],29002:[levelValue(skill,'SA_MUTATION_CONSUME_MAX_COUNT',actor.skillContext?.level??1),.1],
    29005:[2,.1],29012:[3,.1],29015:[3,.1]}[base];
  if(s.formation&&numericMutation&&Number.isInteger(numericMutation[0])){
    const used=consumeAddMutation(actor,numericMutation[0],{profile,emit:callback});
    if(actor.skillContext)actor.skillContext.addMutationSpent=used;
    actor.skillScale=(actor.skillScale??1)*(1+numericMutation[1]*used);
    if(base===29005&&used===2)actor.mp=clamp(actor.mp+25,0,actor.mpMax);
  }
  // Psychic Storm's executor consumes the target duration/size payload, not
  // a damage multiplier. Commit only with the cast context that carries it.
  if(s.formation&&base===29009&&actor.skillContext&&['SA_EFFECTIVE_TIME','SA_EFFECTIVE_TIME_HYPER','SA_PROJECTILE_SIZE']
    .every(key=>Number.isFinite(levelValue(skill,key,actor.skillContext.level??1))))
    actor.skillContext.addMutationSpent=consumeAddMutation(actor,3,{profile,emit:callback});
  // Target2016 Overlimit descriptors explicitly recover 20% of the listed
  // base MP cost in formation. This target adapter is separate from the old
  // reference's different cost-recovery passive.
  if(actor.professionId.toUpperCase()==='DE'&&s.formation&&[7,14,15,16].includes(skill.type)&&
    levelValue(skill,'SA_USE_DP_REL_AT_FORMATION_MODE',actor.skillContext?.level??1)>0){
    const listed=levelValue(skill,'m_MPConsumption',actor.skillContext?.level??1);
    if(Number.isFinite(listed)){
      const before=actor.mp;actor.mp=clamp(actor.mp+listed*.2,0,actor.mpMax);
      if(actor.mp>before)emit(callback,'addOverlimitResourceRecovered',actor,{skillId:skill.skillId,amount:actor.mp-before,resource:'MP',position:[actor.x,actor.y+50,actor.z]});
    }
  }
  if(!s.formation&&[7,14,15,16].includes(skill.type)&&(rawSkill(skill).m_usFPConsumtion??0)<=0){
    const recovered=changeAddDp(actor,plan.mpCost*component(profile,'DP_RATE_BY_FORMATION_MODE_USE_MP'),{profile,emit:callback,reason:'skill-mp-use'});
    if(actor.professionId==='DE'&&actor.passivePolicy?.skillLevels?.[29410]&&recovered>0)
      emit(callback,'addOverlimitResourceRecovered',actor,{skillId:skill.skillId,amount:recovered/ADD_DP_DISPLAY_SCALE,rawAmount:recovered,resource:'DP',position:[actor.x,actor.y+50,actor.z]});
  }
  if(s.formation&&s.dp<=0)stopAddFormation(actor,{profile,emit:callback,reason:'dp-empty',force:true});
  emit(callback,'addSkillResourcesCommitted',actor,{skillId:skill.skillId,mpCost:plan.mpCost,dpCost:plan.dpCost,mutationCost:plan.mutationCost,mode:plan.mode});
  return plan;
}
/** Call for accepted owner hits independently of the MP frame gate. Unknown DPR types
 * (including unresolved DPRT_SPECIAL symbols in original declarations) do not
 * become commands. Damage ratios are raw coefficients, not final PvP HP loss. */
export function addHitResources(actor,data,{profile,kind='hit',damage=0,powerMultiplier=1,step,emit:callback}={}){
  if(!isAddActor(actor)||!actor.sourceAdd)return 0;
  if(!['hit','received'].includes(kind))throw new TypeError('Unknown Add resource hit kind');
  if(step!==undefined){
    integer(step,'resource step',0,Number.MAX_SAFE_INTEGER);
    const field=kind==='hit'?'lastHitStep':'lastReceivedStep';
    if(actor.sourceAdd[field]===step)return 0;
    actor.sourceAdd[field]=step;
  }
  if(kind==='received'){
    if(data.NO_DAMAGE||!(damage>0)||!(actor.hpMax>0))return 0;
    return changeAddDp(actor,Math.min(1,damage/actor.hpMax)*component(profile,'DP_RATE_BY_FORMATION_MODE_HIT'),{profile,emit:callback,reason:'received'});
  }
  const type=data.DYNAMO_PARTICLE_RATE_TYPE;
  if(!Number.isInteger(type)||type<0||type>3)return 0;
  if(type===3&&!actor.sourceAdd.formation)return 0;
  const keys=['DP_RATE_BY_SPECIAL_ACTIVE','DP_RATE_BY_ACTIVE','DP_RATE_BY_COMMAND','DP_RATE_BY_NASOD_ARMOR'];
  const damageType=data.DAMAGE_TYPE,ratio=damageType===0?data.DAMAGE?.PHYSIC:damageType===1?data.DAMAGE?.MAGIC:undefined;
  // DT_MIX source repeats PHYSIC twice; leave this anomalous unverified branch unsupported.
  if(!Number.isFinite(ratio))return 0;
  const amount=number(powerMultiplier,'power multiplier')*ratio*component(profile,keys[type])*
    component(profile,actor.sourceAdd.formation?'DP_RATE_BY_FORMATION_MODE_ATTACK':'DP_RATE_BY_NO_FORMATION_MODE_ATTACK');
  const overlimit=actor.professionId.toUpperCase()==='DE'&&!actor.sourceAdd.formation?
    passive(actor,profile,29410,'SA_DP_GAIN_REL'):undefined;
  return changeAddDp(actor,amount*(actor.sourceAdd.formation?-1:1),{profile,emit:callback,reason:'hit',
    // V61 final project rule also covers the original ACTIVE/SPECIAL_ACTIVE
    // on-contact skill spend; command/armor and received remain independent.
    skillUse:type===0||type===1,gainBonus:overlimit===undefined?0:Math.max(0,overlimit-1)});
}
/** Target2016 Overlimit separates formed MP recovery from dissolution attack
 * DP recovery. Called after the normal MP eligibility/frame gate, once. */
export function addHitMpMultiplier(actor,data,kind,{profile}={}){
  if(actor.professionId?.toUpperCase()!=='DE'||!actor.sourceAdd?.formation)return 1;
  if(!['hit','received'].includes(kind))throw new TypeError('Unknown Add MP hit kind');
  // Actual getters+5a4 and+5a8 both read72fc, not the separate7300 field.
  return passive(actor,profile,29410,'SA_MP_GAIN_ON_HIT_REL')??1;
}
/** Compatibility query for the retired continuous adapter. Original BF669
 * now runs through its own source interval and finalizer object instead. */
export function addNaturalMpRecoveryRate(actor,profile){
  // BF669 owns the actual interval. No description-derived continuous sum.
  return 0;
}
/** Original3273ce10/32637170: ordered sample<=chance, PvP halves the chance
 * and multiplier, then both four-slot sets multiply positive remaining time.
 * The shared source sample has an explicit, separate Web seed policy. */
export function applyAddCooldownProc(actor,skill,{profile,sample,gameMode='PVP',emit:callback}={}){
  const neutral={applied:false};
  if(actor.professionId?.toUpperCase()!=='DE'||![7,14,15,16].includes(skill?.type)||
    [900,29213].includes(skill.skillId)||!actor.passivePolicy?.skillLevels?.[29411])return neutral;
  const base=rawSkill(skill).m_DeleteSkillIDByUpgrade??skill.skillId;
  if([29022,29025,29204].includes(base)){
    const id='add-time-control-stage-unresolved-'+base;
    actor.unsupported??=[];
    if(!actor.unsupported.some(row=>row.id===id))actor.unsupported.push({id,skillId:base,
      reason:'Reference consumer requires a live barrage/mark/future-state gate that is not yet reconstructed.'});
    return {applied:false,unsupported:id};
  }
  const pvp=gameMode!=='NPC',chance=f(passive(actor,profile,29411,'SA_EFFECTIVE_RATE')*(pvp ? .5 : 1)),decrease=f(passive(actor,profile,29411,'SA_COOLTIME_1')*(pvp ? .5 : 1));
  if(!Number.isFinite(chance)||!Number.isFinite(decrease))return {applied:false,unsupported:'add-time-control-missing-source'};
  number(chance,'Time Control probability',0,1);number(decrease,'Time Control decrease',0,1);
  if(!sample?.supported)return {applied:false,unsupported:'add-time-control-source-sample-unavailable'};
  const roll=number(sample.value,'Time Control roll',0,1);
  if(!(roll<=chance))return {applied:false,roll};
  const result=reduceAddTimeControlSlots2016({slots:actor.loadout,cooldowns:actor.cooldowns,catalog:profile.skillCatalog,
    factor:decrease,ignore:actor.sourceAddCooldownIgnore??[]});
  if(!result.supported)return {applied:false,unsupported:result.reason};
  emit(callback,'addTimeControlActivated',actor,{skillId:skill.skillId,changed:result.changed,chance,factor:decrease,roll});
  return {applied:true,changed:result.changed,roll};
}
export function advanceAddSystems(actor,dt,{profile,emit:callback}={}){
  number(dt,'elapsed');
  if(actor.sourceTimeSickness>0)actor.sourceTimeSickness=Math.max(0,actor.sourceTimeSickness-dt);
  if(actor.sourceTimeRing){actor.sourceTimeRing.remaining=Math.max(0,actor.sourceTimeRing.remaining-dt);if(!actor.sourceTimeRing.remaining)actor.sourceTimeRing=null;}
  if(actor.sourceTimeRingNotice)actor.sourceTimeRingNotice.remaining=Math.max(0,actor.sourceTimeRingNotice.remaining-dt);
  if(!isAddActor(actor)||!actor.sourceAdd)return;
  const s=actor.sourceAdd;s.switchCooldown=Math.max(0,s.switchCooldown-dt);
  if(s.generator){
    s.generator.remaining=Math.max(0,s.generator.remaining-dt);
    if(!s.generator.remaining||s.dp<=0){emit(callback,'addGeneratorEnded',actor,{reason:s.dp<=0?'dp-empty':'timeout'});s.generator=null;}
    else if(s.generator.phase==='firing'&&!actor.skillId)s.generator.phase='ready';
  }
  if((s.formation||s.formationPending)&&(s.dp<=0||actor.hp<=0))stopAddFormation(actor,{profile,emit:callback,reason:actor.hp<=0?'death':'dp-empty',force:true});
  syncAddAwakening(actor);
}

/** Explicit Add revival policy: a leading team receives exactly 100 displayed
 * DP, regardless of its previous balance. Otherwise retain DP. Mutation remains
 * unchanged for every score gap. Active modes never survive a resource write. */
export function createAddResourcePools(){
  const supported=actor=>isAddActor(actor)&&actor.sourceAdd;
  const write=(actor,value,kind)=>{
    if(!supported(actor))return;
    number(value,'respawn resource');
    actor.sourceAdd[kind]=kind==='mutation'?Math.floor(clamp(value,0,ADD_MUTATION_MAX)):clamp(value,0,ADD_DP_MAX);
    Object.assign(actor.sourceAdd,{formation:false,formationPending:false,generator:null,switchCooldown:0,lastHitStep:-1,lastReceivedStep:-1});
    syncAddAwakening(actor);
  };
  return [{id:'add-dp',read:actor=>supported(actor)?actor.sourceAdd.dp:null,retain:(balance,{scoreDifference})=>scoreDifference>0?ADD_LEADING_REVIVAL_DP:balance,write:(actor,value)=>write(actor,value,'dp')},
    {id:'add-mutation',read:actor=>supported(actor)?actor.sourceAdd.mutation:null,retain:balance=>balance,write:(actor,value)=>write(actor,value,'mutation')}];
}

export function validateAddTimeRingState(actor){
  if(actor.sourceTimeSickness!==undefined)number(actor.sourceTimeSickness,'time sickness',0,120);
  const r=actor.sourceTimeRing;if(r==null)return true;
  if(typeof r!=='object'||Object.keys(r).some(k=>!['remaining','hp','mp','dp','mutation','wayOfSword','sourceActorId'].includes(k)))throw new TypeError('Invalid time ring fields');
  number(r.remaining,'time ring remaining',0,16.5);number(r.hp,'time ring HP');number(r.mp,'time ring MP');
  if(r.dp!==null)number(r.dp,'time ring DP',0,ADD_DP_MAX);
  if(r.mutation!==null)integer(r.mutation,'time ring mutation',0,ADD_MUTATION_MAX);
  if(r.wayOfSword!==null)number(r.wayOfSword,'time ring sword point',-Infinity);
  if(typeof r.sourceActorId!=='string'||!r.sourceActorId)throw new TypeError('Invalid time ring source');return true;
}

/** Web delivery envelope, separate from target buff data. Serial survives the
 * notice timer and is only restarted by the room's clean respawn template. */
export function validateAddTimeRingNotice(notice){
  if(!notice||typeof notice!=='object'||Array.isArray(notice)||
    Object.keys(notice).some(key=>!['serial','remaining','position','skillId'].includes(key))||notice.skillId!==29213)
    throw new TypeError('Invalid time ring notice');
  integer(notice.serial,'time ring notice serial',1,Number.MAX_SAFE_INTEGER);
  number(notice.remaining,'time ring notice remaining',0,16.5);
  if(!Array.isArray(notice.position)||notice.position.length!==3||notice.position.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))
    throw new TypeError('Invalid time ring notice position');
  return true;
}

/** Recipient-owner write shared by offline cast and reliable Web delivery.
 * A late notice samples the recipient's current resources, not an invented
 * historical rollback. The original client network transaction is unmeasured. */
export function applyAddTimeRingToActor(sim,caster,actor,{position=[caster.x,caster.y,caster.z??0],remaining=16.5}={}){
  if(sim.networkOwnerId!=null&&actor.id!==sim.networkOwnerId)return false;
  if(!(remaining>0)||actor.team!==caster.team||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected||actor.sourceTimeSickness>0)return false;
  if(Math.hypot(actor.x-position[0],actor.y-position[1],(actor.z??0)-position[2])>700)return false;
  const pvp=sim.presetFor(actor).gameMode!=='NPC';
  actor.sourceTimeRing={remaining:Math.min(16.5,remaining),hp:pvp?Math.min(actor.hp,actor.hpMax*.5):actor.hp,mp:actor.mp,
    dp:actor.sourceAdd?.dp??null,mutation:actor.sourceAdd?.mutation??null,
    wayOfSword:actor.wayOfSword?.point??null,sourceActorId:caster.id};
  const catalog=sim.profileFor(actor).skillCatalog;
  for(const [id,value]of Object.entries(actor.cooldowns??{})){
    const other=catalog.find(s=>s.skillId===Number(id));
    if(other&&other.type!==13&&![900,29213].includes(other.skillId))actor.cooldowns[id]=Math.max(0,value-24);
  }
  sim.emit('addTimeRingApplied',actor.id,{sourceActorId:caster.id,remaining:actor.sourceTimeRing.remaining,evidence:ADD_SYSTEMS_EVIDENCE});
  return true;
}

/** Called at the target declaration's .342 animation event. Target2016 BFI474
 * supplies 16.5 seconds; BFI501 supplies 24 seconds. The 700 radius is a fixed
 * reference candidate. No manual rollback or teleport is implied by the ring. */
export function applyAddTimeRing(sim,caster,skill){
  if(skill?.skillId!==29213)return 0;
  // Remote animation replay cannot mutate observed teammates or reissue a
  // consumed seal. Its reliable notice is delivered by the owner adapter.
  const playback=sim.networkCombatPlaybackVersion===1;
  if(sim.networkOwnerId!=null&&caster.id!==sim.networkOwnerId&&!playback)return 0;
  if(!playback)caster.sourceTimeRingNotice={serial:(caster.sourceTimeRingNotice?.serial??0)+1,
    remaining:16.5,position:[caster.x,caster.y,caster.z??0],skillId:29213};
  let count=0;
  for(const actor of sim.state.actors){
    if(applyAddTimeRingToActor(sim,caster,actor))count++;
  }
  return count;
}
/** At accepted lethal HP loss, before death epoch/score/death effects. Caller
 * must suppress that lethal write. The ring is consumed atomically, and never
 * restores a lifeEpoch or position. Map-fall/death-rule entry is not included. */
export function tryAddTimeRingRevive(sim,actor,{damage=null}={}){
  const ring=actor.sourceTimeRing;
  if(!ring||ring.remaining<=0||actor.sourceTimeSickness>0)return false;
  if(damage!==null?damage<actor.hp:actor.hp>0)return false;
  validateAddTimeRingState(actor);
  actor.sourceTimeRing=null;actor.sourceTimeSickness=120;
  actor.hp=clamp(Math.max(1,ring.hp),1,actor.hpMax);actor.mp=clamp(ring.mp,0,actor.mpMax);
  if(actor.sourceAdd&&ring.dp!==null){
    actor.sourceAdd.dp=ring.dp;actor.sourceAdd.mutation=ring.mutation??0;
    if(ring.dp===0)stopAddFormation(actor,{reason:'time-ring-dp-empty'});
    syncAddAwakening(actor);
  }
  if(actor.wayOfSword&&ring.wayOfSword!==null){
    const before=structuredClone(actor.wayOfSword);
    actor.wayOfSword.point=ring.wayOfSword;
    const limits=actor.wayOfSwordLimits;
    actor.wayOfSword.state=limits&&ring.wayOfSword>=limits.vigor?2:limits&&ring.wayOfSword<=limits.destruction?-2:Math.sign(ring.wayOfSword);
    sim.reconcileWayOfSwordResources?.(actor,before,'time-ring-revive');
  }
  sim.emit('addTimeRingRevived',actor.id,{sourceActorId:ring.sourceActorId,hp:actor.hp,mp:actor.mp,sickness:120,evidence:ADD_SYSTEMS_EVIDENCE});
  return true;
}
