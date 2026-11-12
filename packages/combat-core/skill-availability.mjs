import {isElesisProfession} from '../professions/identity.mjs';
import {elesisCommandSkillCancelAllowed} from './elesis-commands.mjs';
import {elesisSwordCost,elesisSwordCooldown} from './elesis-way-of-sword.mjs';
import {createSkillTraitPolicy} from './skill-traits.mjs';
import {hasEffectiveBlackHole} from './black-hole.mjs';
import {lkCommandSkillCancelAllowed} from './lk-commands.mjs';
import {rsCommandSkillCancelAllowed} from './rs-commands.mjs';
import {wayOfSwordMpCost} from './lk-way-of-sword.mjs';
import {vcCommandSkillCancelAllowed} from './vc-commands.mjs';
import {vcAirSkillCancelAllowed,vcSkillSourceCancelAllowed} from './vc-air-skills.mjs';
import {isCommandSkillCancelAllowed} from './is-commands.mjs';
import {bmCommandSkillCancelAllowed} from './bm-commands.mjs';
import {afterCancel,referenceSkillCancelAfter} from './skill-command-cancels.mjs';
import {isAddActor,addSkillResourceCost} from './add-systems.mjs';
import {addRecastResourcePlan} from './add-recasts.mjs';
import {addCommandSkillCancelAllowed} from './add-commands.mjs';
import {addSkillCancelAllowed} from './add-skills.mjs';
import {historicalSourcePostRow,sourceCancelFields} from './source-cancel-fields-v53.mjs';
import {hasAddVoidAttackBlock} from './add-void-binding-v57.mjs';

// These are the existing RF executor's gates, not an additional original-client
// rule claim. Both the keyboard consumer and HUD read this pure query.
export const SKILL_SLOT_KEYS=Object.freeze(['A','S','D','C','Q','W','E','R']);
export const SKILL_FREE_STATES=Object.freeze(['RSI_WAIT','ESSI_SWORD_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END',
  'RSI_JUMP_READY','RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_JUMP_LANDING','RSI_DASH_JUMP',
  'RSI_DASH_JUMP_LANDING','RSI_DASH_JUMP_POWER_LANDING','ANSI_AIR_DASH','ANSI_LEVITATION_WAIT']);
const free=new Set(SKILL_FREE_STATES);
function elesisPassiveCost(actor,skill,cost){
 if(!isElesisProfession(actor.professionId))return cost;
 if(skill.skillId===28217&&actor.buffs?.some(b=>b.templateId===326))return 0;
 return skill.skillId===28219?Math.max(0,cost-(actor.passivePolicy?.elesis?.rawValues?.[28403]?.SA_MP_CONSUME_REL??0)):cost;
}
const groundTransitionStates=new Set(['RSI_WAIT','ESSI_SWORD_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END',
  'RSI_JUMP_READY','RSI_JUMP_LANDING','RSI_DASH_JUMP_LANDING','RSI_DASH_JUMP_POWER_LANDING']);

export function skillInputBlockReason(actor){
  if(actor.hp<=0||actor.deathComplete)return 'dead';
  if(actor.inputLock>0||actor.buffControls?.inputBlock)return 'input-blocked';
  if(hasAddVoidAttackBlock(actor))return 'attack-impossible';
  if(actor.hitStop>0||actor.worldStop>0)return 'time-stopped';
  // Fixed-V5 CommonSpecialAttackEventProcess21125, live effect identity.
  if(hasEffectiveBlackHole(actor))return 'black-hole-held';
  return null;
}

/** Shadow's already-paid same-key return precedes ordinary cast checks. */
export function shadowStepReturnAvailable(actor,key){
  const saved=actor.sourceShadowStep;
  return Boolean(saved&&actor.skillId===saved.skillId&&saved.key===key&&
    actor.state==='RSI_SI_A_RF_SHADOW_STEP'&&!saved.returnUsed);
}

function groundTransitionBlocksSkill(actor){
  return actor.grounded&&['RSI_DASH_JUMP','RSI_JUMP_DOWN'].includes(actor.state)||
    !actor.grounded&&groundTransitionStates.has(actor.state);
}
function stateAllowsSkill(actor,definition,skill,profile){
  if(historicalSourcePostRow(actor,profile)){
    definition={...definition,raw:sourceCancelFields(actor,profile)};
    const source=definition.sourceState??actor.state;
    // These real post bodies consume their own dash/animation recovery only;
    // the declared ordinary S fields do not create an additional consumer.
    if(['ESSI_DASH_ATTACK_X','ESSI_DASH_JUMP_COMBO_Z3_LANDING'].includes(source))
      return skill?.useCondition===3||skill?.useCondition===5&&actor.grounded;
  }
  if(isElesisProfession(actor.professionId)){if([28201,28218].includes(skill?.skillId))return true;const gate=elesisCommandSkillCancelAllowed(actor,definition);if(gate!==null)return gate;}
  if(isAddActor(actor)){
    const gate=addCommandSkillCancelAllowed(actor,definition)??addSkillCancelAllowed(actor,definition);
    if(gate!==null)return gate;
  }
  if(actor.professionId==='IS'){
    const commandGate=isCommandSkillCancelAllowed(actor,definition);
    if(commandGate!==null)return commandGate;
  }
  if(actor.professionId==='RS'){
    const gate=rsCommandSkillCancelAllowed(actor,definition);if(gate!==null)return gate;
  }
  if(actor.professionId==='BM'){const gate=bmCommandSkillCancelAllowed(actor,definition);if(gate!==null)return gate;}
  if(actor.professionId==='VC'){
    const airSkillGate=vcAirSkillCancelAllowed(actor,definition);
    if(airSkillGate!==null)return airSkillGate;
    const sourceSkillGate=vcSkillSourceCancelAllowed(actor,definition);
    if(sourceSkillGate!==null)return sourceSkillGate;
    const commandGate=vcCommandSkillCancelAllowed(actor,definition);
    if(commandGate!==null)return commandGate;
  }
  if(actor.professionId==='LK'){
    // The Roll product rule keeps the strict Recovered197 gate.
    if(actor.state==='ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL')return actor.grounded&&skill?.skillId===21217&&afterCancel(actor.animationTime,definition.raw.SKILL_CANCEL_AFTER);
    if(/^ESSI_SI_P_ESK_AUTO_GUARD/.test(actor.state))return actor.grounded&&skill?.skillId===21217;
    const commandGate=lkCommandSkillCancelAllowed(actor,definition);
    if(commandGate!==null)return commandGate;
  }
  // Match processInput's early ground/drop/knockdown branches. This query is
  // about the current state; it does not simulate the next tick or eat input.
  if(groundTransitionBlocksSkill(actor))return false;
  if(['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK'].includes(actor.state))return false;
  if(actor.state==='RSI_DASH_JUMP_POWER_LANDING'&&
    actor.animationTime<=definition?.clip?.durationSeconds/6)return false;
  const literal=referenceSkillCancelAfter(actor,definition);
  if(literal!==null)return afterCancel(actor.animationTime,literal);
  return free.has(actor.state)||afterCancel(actor.animationTime,definition?.raw?.SKILL_CANCEL_AFTER)||
    (!actor.grounded&&afterCancel(actor.animationTime,definition?.raw?.SKILL_CANCEL_AFTER_FLY));
}

/** Retain legacy display metadata for existing consumers. The v17 battle HUD
 * uses resourceMpInsufficient/resourceCooldownRemaining; cast gates stay here. */
function withDisplayAvailability(result,{ignoreGroundCondition=false}={}){
  let reason=result.available?null:result.reason;
  if(ignoreGroundCondition){
    reason=result.resourceDpInsufficient?'insufficient-dp':result.resourceMutationInsufficient?'insufficient-mutation':result.resourceMpInsufficient?'insufficient-mp':
      result.cooldownRemaining>0?'cooldown':null;
  }
  const {actorMp,...publicResult}=result;
  return {...publicResult,displayUnavailable:reason!==null,displayReason:reason};
}

/** No mutation, clock advance, cached availability, or rendering dependency. */
export function evaluateSkillAvailability({actor,profile,preset={},slot,sourceMode=null}={}){
  const index=typeof slot==='string'?SKILL_SLOT_KEYS.indexOf(slot.toUpperCase()):slot;
  if(!Number.isInteger(index)||index<0||index>=SKILL_SLOT_KEYS.length)throw new RangeError('Unknown skill slot');
  const key=SKILL_SLOT_KEYS[index],equipped=actor.loadout?.[index];
  const skill=profile.skillCatalog.find(s=>s.skillId===equipped?.skillId);
  // Presentation observes MP/CD independently of the first cast rejection.
  // A pending paid return has no new resource charge, even while input is locked.
  const paidReturn=shadowStepReturnAvailable(actor,key);
  let resourcePolicy;
  try{if(skill&&!skill.passive)resourcePolicy=createSkillTraitPolicy(skill,equipped.branchId);}
  catch{/* Preserve the original early rejection / later invalid-trait error. */}
  const initialMpCost=paidReturn?0:resourcePolicy?elesisSwordCost(actor,skill,wayOfSwordMpCost(actor,skill,elesisPassiveCost(actor,skill,skill.mpCost)*resourcePolicy.mpMultiplier),preset):null;
  let resourceCooldown=resourcePolicy?elesisSwordCooldown(actor,skill,skill.cooldown*resourcePolicy.cooldownMultiplier,preset):null;
  for(const behavior of actor.buffs?.flatMap(buff=>buff.behaviors)??[])if(behavior.kind==='skillCooldown'&&behavior.skillType===skill?.type)resourceCooldown=behavior.value;
  if(isElesisProfession(actor.professionId)&&skill?.skillId===28217&&actor.buffs?.some(b=>b.templateId===326))resourceCooldown=1;
  const addResourcePlan=isAddActor(actor)&&resourcePolicy?addRecastResourcePlan(actor,skill,addSkillResourceCost(actor,skill,{profile,mpCost:initialMpCost,cooldown:resourceCooldown,level:equipped.level}),{profile}):null;
  const resourceMpCost=addResourcePlan?.mpRequirement??addResourcePlan?.mpCost??initialMpCost;
  const result={available:false,reason:null,mode:'cast',slot:index,key,
    skillId:equipped?.skillId??null,mpCost:null,cooldown:null,
    cooldownRemaining:addResourcePlan?.recastCooldown??(addResourcePlan?.ignoreCooldown?0:actor.cooldowns?.[equipped?.skillId]??0),traitPolicy:null,
    resourceMpInsufficient:resourceMpCost!==null&&actor.mp<resourceMpCost,
    ...(addResourcePlan?{resourceDpInsufficient:addResourcePlan.resourceDpInsufficient,
      resourceMutationInsufficient:addResourcePlan.resourceMutationInsufficient,addResourcePlan}:{}),
    resourceCooldownRemaining:addResourcePlan?.recastCooldown??(paidReturn||addResourcePlan?.ignoreCooldown?0:actor.cooldowns?.[equipped?.skillId]??0)};
  const block=skillInputBlockReason(actor);
  if(block)return withDisplayAvailability({...result,reason:block});
  if(shadowStepReturnAvailable(actor,key))return withDisplayAvailability({...result,available:true,mode:'shadow-return',
    skillId:actor.sourceShadowStep.skillId,mpCost:0,cooldown:0,
    cooldownRemaining:actor.cooldowns?.[actor.sourceShadowStep.skillId]??0});
  if(!equipped)return withDisplayAvailability({...result,reason:'empty-slot'});
  if(!skill||skill.passive||!skill.supported)return withDisplayAvailability({...result,reason:'unsupported-skill'});
  if(preset.bannedSkillIds?.includes(skill.skillId))return withDisplayAvailability({...result,reason:'pvp-disabled'});
  // Fixed-V5 X2GUUser.cpp:6225-6287 CheckSkillUseCondition. RF does not
  // inherit WeaponTaker's separate AirSlicer override for Flame Sword.
  const traitPolicy=resourcePolicy??createSkillTraitPolicy(skill,equipped.branchId);
  const mpCost=addResourcePlan?.mpCost??elesisSwordCost(actor,skill,wayOfSwordMpCost(actor,skill,elesisPassiveCost(actor,skill,skill.mpCost)*traitPolicy.mpMultiplier),preset);
  let cooldown=addResourcePlan?.cooldown??resourceCooldown??elesisSwordCooldown(actor,skill,skill.cooldown*traitPolicy.cooldownMultiplier,preset);
  for(const behavior of actor.buffs?.flatMap(buff=>buff.behaviors)??[])if(behavior.kind==='skillCooldown'&&behavior.skillType===skill.type)cooldown=behavior.value;
  if(isElesisProfession(actor.professionId)&&skill.skillId===28217&&actor.buffs?.some(b=>b.templateId===326))cooldown=1;
  const priced={...result,mpCost,cooldown,traitPolicy,mode:addResourcePlan?.mode??result.mode};
  if(addResourcePlan?.unavailableReason)return withDisplayAvailability({...priced,reason:addResourcePlan.unavailableReason});
  const sourceAllowed=sourceMode===1?skill.useCondition!==0&&![3,4].includes(skill.useCondition):sourceMode===2?[2,4].includes(skill.useCondition):sourceMode===3?skill.useCondition===3||skill.useCondition===5&&actor.grounded:null;
  // Source dispatch bypasses ordinary state checks, but cannot bypass this
  // user product rule or the recovered END_SMALL time/ground gate.
  const guardProductAllowed=actor.professionId!=='LK'||!/^ESSI_SI_P_ESK_AUTO_GUARD/.test(actor.state)||stateAllowsSkill(actor,profile.states[actor.state],skill,profile);
  const stateAllowed=guardProductAllowed&&(sourceAllowed??(addResourcePlan?.allowStateCancel||stateAllowsSkill(actor,profile.states[actor.state],skill,profile))),
    groundAllowed=sourceAllowed??(addResourcePlan?.allowAir||isElesisProfession(actor.professionId)&&skill.useCondition===3||(actor.grounded?[1,2,5]:[2,4]).includes(skill.useCondition)||actor.professionId==='VC'&&!actor.grounded&&!!actor.passivePolicy?.skillLevels?.[24412]&&[24218,24221].includes(skill.skillId));
  if(!stateAllowed||!groundAllowed)
    return withDisplayAvailability({...priced,reason:'state-or-ground-condition',actorMp:actor.mp},
      {ignoreGroundCondition:groundTransitionBlocksSkill(actor)||stateAllowed&&!groundAllowed});
  // Preserve the existing rejection priority when both MP and CD fail.
  if(actor.mp<(addResourcePlan?.mpRequirement??mpCost))return withDisplayAvailability({...priced,reason:'insufficient-mp'});
  if(result.resourceDpInsufficient)return withDisplayAvailability({...priced,reason:'insufficient-dp'});
  if(result.resourceMutationInsufficient)return withDisplayAvailability({...priced,reason:'insufficient-mutation'});
  if(result.cooldownRemaining>0)return withDisplayAvailability({...priced,reason:'cooldown'});
  return withDisplayAvailability({...priced,available:true});
}
