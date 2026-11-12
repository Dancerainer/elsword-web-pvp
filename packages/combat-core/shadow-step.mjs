/** Bounded original-source callback dispatch. This module binds no old
 * passive flag or state number to target2016 automatically. */
import {originalShadowGroups} from '../native-source/skills.mjs';
import {shadowStepReturnAvailable} from './skill-availability.mjs';

export const shadowStepSourceContract=Object.freeze({
  referenceCommit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  referenceFile:'X2Lib/X2GURaven.cpp',
  referenceFileSha256:'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237',
  evidenceClass:'reference-V5-not2016',targetClientMeasured:false,targetBindingVerified:false,
  snapshotWords:48,
  symbolicSuccessors:Object.freeze(['wait','jumpDown','dash','thrust','enhancedThrust','punisher','backSlide','backSlideEnd','buster','finish']),
});

// These describe possible callback reuse only. In particular, target names
// ending in Z/X/UPGRADE do not occur in this fixed V5 registration source.
export const shadowStepTargetCandidates=Object.freeze({
  RSI_SI_A_RF_SHADOW_STEP:Object.freeze({animation:'SI_A_RF_SHADOW_STEP',
    operations:Object.freeze(['dashInit','dashStartFuture','dashStart','dashFrame','dashEvent','dashEnd']),
    targetBindingVerified:false,referenceRegistration:Object.freeze([3076,3105]),
    gaps:Object.freeze(['old passive gates do not describe target2016 direct Z/X upgrades',
      'same Lua name also registers separate EmergencyEscape and VC finish passive paths; preserve normal skill registration'])}),
  RSI_SHADOW_BACK_SLIDE_UPGRADE:Object.freeze({animation:'SI_A_RVC_SHADOW_BACK_SLIDE',
    operations:Object.freeze(['backSlideStartFuture','backSlideStart','backSlideFrame','backSlideEvent','backSlideEnd']),
    targetBindingVerified:false,gaps:Object.freeze(['target upgraded name not registered by V5',
      'target passiveSpeedX=-1000 makes original signed duration negative; do not substitute abs(speed)',
      'VC passive flags are absent from target RF six passives'])}),
  RSI_SHADOW_BACK_SLIDE_END_UPGRADE:Object.freeze({animation:'DashEnd',
    operations:Object.freeze(['backSlideEndFrame','backSlideEndEvent']),targetBindingVerified:false,
    gaps:Object.freeze(['target upgraded name not registered by V5'])}),
  RSI_SHADOW_STEP_Z:Object.freeze({animation:'SI_A_RF_THRUST',
    operations:Object.freeze(['thrustInit','thrustStart','thrustEvent']),targetBindingVerified:false,
    gaps:Object.freeze(['target Z name not registered by V5','old thrust power/passive consumer differs from target direct damage5.3'])}),
  RSI_SHADOW_STEP_Z_UPGRADE:Object.freeze({animation:'SI_A_RF_THRUST',
    operations:Object.freeze(['thrustInit','thrustStart','thrustEvent']),targetBindingVerified:false,
    gaps:Object.freeze(['target upgraded name not registered by V5','upgrade is not old BM enhancement passive'])}),
  RSI_SHADOW_STEP_X_UPGRADE:Object.freeze({animation:'SI_P_RVC_SHADOW_BUSTER',
    operations:Object.freeze(['busterInit','busterStart','busterFrame','busterEvent']),targetBindingVerified:false,
    effectSet:'EffectSet_Raven_Shadow_Buster',
    gaps:Object.freeze(['target X name not registered by V5','old VC Buster power/MP/passive consumer has not been verified against target'])}),
});

/** Return data evidence for review; this never authorizes a live state. */
export function inspectShadowStepCandidate(profile,stateName){
  const candidate=shadowStepTargetCandidates[stateName];
  if(!candidate)return {supported:false,reason:'No audited target Shadow state'};
  const state=profile?.states?.[stateName];
  const animation=state?.raw?.ANIM_NAME??state?.animName??state?.animation;
  return {supported:true,stateName,candidate,animation,animationMatches:animation===candidate.animation,
    targetBindingVerified:false};
}

/** Execute exactly one original callback. Caller owns phase order, actor
 * lifetime, common input/physics and source/target bindings. `snapshot.flags`
 * is explicit; no old passive flag is synthesized from a target skill name.
 * `successorStates` only maps symbols explicitly accepted by the integrator. */
export function executeOriginalShadowStep(nativeSkills,{operation,snapshot,frame,successorStates={},paused=false}={}){
  if(!Object.hasOwn(originalShadowGroups,operation))throw new TypeError('Unknown original Shadow operation');
  if(!nativeSkills||typeof nativeSkills.evaluate!=='function')throw new TypeError('Compiled original skills bridge required');
  if(typeof paused!=='boolean')throw new TypeError('Explicit paused boolean required');
  if(!snapshot||!frame)throw new TypeError('Explicit original Shadow snapshot and frame required');
  const temporal=/Frame$|Event$/.test(operation);
  if(paused&&temporal)return {executed:false,snapshot:structuredClone(snapshot),commands:[],successorState:null,
    unsupported:[],evidenceClass:shadowStepSourceContract.evidenceClass,targetBindingVerified:false};
  const result=nativeSkills.evaluate({...frame,kind:originalShadowGroups[operation],shadowStep:snapshot});
  const symbol=result.shadowSuccessor;
  const bound=!!symbol&&Object.hasOwn(successorStates,symbol)&&typeof successorStates[symbol]==='string'&&successorStates[symbol].length>0;
  return {executed:true,snapshot:result.shadowStep,commands:result.commands,
    successorSymbol:symbol,successorState:bound?successorStates[symbol]:null,
    unsupported:symbol&&!bound?[{kind:'unboundOriginalSuccessor',symbol}]:[],
    offsetY:result.offsetY,hostBoundary:result.shadowHostBoundary,
    animationOneshotTimer:result.animationOneshotTimer,
    evidenceClass:shadowStepSourceContract.evidenceClass,targetBindingVerified:false};
}

// Explicit live target adapter. This does not enable the V5 BM/VC/RF passive
// flags above: 2016 gives direct Z/X states and enhanced-Z protection instead.
const dash='RSI_SI_A_RF_SHADOW_STEP',back='RSI_SHADOW_BACK_SLIDE_UPGRADE';
const shadowAttack=new Set(['RSI_SHADOW_STEP_Z','RSI_SHADOW_STEP_Z_UPGRADE','RSI_SHADOW_STEP_X_UPGRADE']);
export function initializeShadowStepCandidate(actor,skill){
  const range=skill?.raw.SA_TELEPORT_RANGE_ABS?.[String(skill.maxLevel)];
  if(typeof range!=='number'||range<=0)throw new TypeError('Original Shadow range required');
  actor.sourceShadowStep={range:range*100,remaining:range*100,lastX:actor.x,lastZ:actor.z,
    key:actor.skillContext.key,skillId:skill.skillId,enhanced:skill.skillId===24217,
    returnUsed:false,stage:'forward',stageElapsed:0,
    evidenceClass:'2016-direct-state adapter with fixed-V5 .2 input and range consumers; target-client-unverified'};
}
export function shadowStepCandidateInput(actor,input){
  const saved=actor.sourceShadowStep;
  if(!saved||actor.skillId!==saved.skillId||![dash,back].includes(actor.state))return null;
  // Source SetShadowStepAttackSkill requires strictly greater than .2.
  if(input.pressed.has('Z')&&actor.stateTime>.2)return saved.enhanced?'RSI_SHADOW_STEP_Z_UPGRADE':'RSI_SHADOW_STEP_Z';
  if(input.pressed.has('X')&&actor.stateTime>.2&&saved.enhanced)return 'RSI_SHADOW_STEP_X_UPGRADE';
  if(input.pressed.has(saved.key)&&shadowStepReturnAvailable(actor,saved.key)){
    saved.returnUsed=true;saved.stage='return';saved.remaining=saved.range;saved.lastX=actor.x;saved.lastZ=actor.z;saved.stageElapsed=0;
    return back;
  }
  return null;
}
export function advanceShadowStepCandidate(actor,nativeSkills,{dt,profile}){
  const saved=actor.sourceShadowStep;if(!saved||![dash,back].includes(actor.state))return null;
  // Target return is authored with -1000; the old signed quotient would end
  // instantly. Track authored travel distance for this explicit 2016 candidate,
  // preserving -1000 motion rather than changing the Lua speed to positive.
  saved.remaining=Math.max(0,saved.remaining-Math.hypot(actor.x-saved.lastX,actor.z-(saved.lastZ??actor.z)));saved.lastX=actor.x;saved.lastZ=actor.z;
  saved.stageElapsed+=dt;
  // The source duration is range / passive speed. Preserve its magnitude as a
  // finite wall-bound stop for the signed 2016 return state candidate as well.
  const speed=Math.abs(profile.states[actor.state].raw.PASSIVE_SPEED_X);
  if(saved.remaining>0&&saved.stageElapsed<saved.range/speed)return null;
  if(!actor.grounded)return 'RSI_JUMP_DOWN';
  return actor.state===back?'RSI_SHADOW_BACK_SLIDE_END_UPGRADE':'RSI_WAIT';
}
function targetShadowSnapshot(actor){
  return {stepTimeLeft:0,backSlideTimeLeft:0,teleportRange:6,skillCooldown:7,skillLevel:1,
    passiveSpeedX:actor.passiveSpeed.x,mp:actor.mp,stateTime:actor.stateTime,stepCooldown:0,backSlideLevel:0,comboLoopCount:0,
    thrustPower:1,enhancedThrustPower:1,punisherPower:1,busterPower:1,afterImage:false,alpha:1,alphaBlend:false,
    alphaObject:false,gageAlpha:255,damagePhysical:0,damageMagic:0,damagePerSecond:0,statePower:actor.skillScale,randomRoll:0,
    dashSuccessor:'wait',requestedAttack:'thrust',reactionRequest:'none',
    flags:{frameStop:false,hasEquippedSkill:true,hasUnit:true,enableThrust:false,enableThrustEnhance:false,
      enablePunisher:false,enableBackSlide:false,activeCombo:false,skillIcon:true,memo6:false,memo7:false,
      specialAttackAccepted:false,isMyUnit:true,hasGageUI:true,hasAfterImage:true}};
}
function evaluateTargetShadow(actor,nativeSkills,kind,{dt,ended=false,inputMask=0}){
  return nativeSkills.evaluate({kind,time:actor.animationTime,before:actor.animationBeforeTime??0,oneshot:actor.animationOneshotTimer??0,
    dt,ended,inputMask,hp:actor.hp,hpMax:actor.hpMax,grounded:actor.grounded,power:actor.skillScale,awakening:actor.awakening.remaining,
    position:[actor.x,actor.y,actor.z],rotation:[0,0,0],direction:[1,0,0],landY:actor.landPosition?.[1]??actor.y,
    isRight:actor.facing>0,memo:false,shadowStep:targetShadowSnapshot(actor)});
}
export function shadowStepCandidateFrame(actor,nativeSkills,{profile,dt}){
  if(!nativeSkills||actor.state!=='RSI_SHADOW_STEP_X_UPGRADE')return null;
  // Three target bullets are authored in this set. Execute the original Buster
  // Now .01 oneshot without activating old VC passive MP/power/cooldown flags.
  return evaluateTargetShadow(actor,nativeSkills,46,{dt});
}
export function shadowStepCandidateEvent(actor,nativeSkills,{profile,dt,input}){
  if(!nativeSkills||!actor.sourceShadowStep)return null;
  const kind=actor.state==='RSI_SHADOW_BACK_SLIDE_END_UPGRADE'?43:
    actor.state==='RSI_SHADOW_STEP_X_UPGRADE'?47:shadowAttack.has(actor.state)?36:null;
  if(!kind)return null;
  const period=profile.states[actor.state].clip?.durationSeconds;
  const ended=Boolean(actor.animationStopped||period>0&&actor.animationTime>period-Math.max(period/10,.03));
  const keys=['UP','DOWN','RIGHT','LEFT','Z','X','A','S','D','C','Q','W','E','R','AWAKEN'];
  const inputMask=keys.reduce((mask,key,i)=>mask|(input.held.has(key)?1<<i:0),0);
  const result=evaluateTargetShadow(actor,nativeSkills,kind,{dt,ended,inputMask});
  const state=result.shadowSuccessor==='wait'?'RSI_WAIT':result.shadowSuccessor==='jumpDown'?'RSI_JUMP_DOWN':null;
  if(result.shadowSuccessor&&!state)throw new RangeError('Unbound original Shadow ending successor');
  return {...result,state,ended};
}
export function shadowStepCandidateEnd(actor,nextState){
  if(!actor.sourceShadowStep)return;
  if(![dash,back,'RSI_SHADOW_BACK_SLIDE_END_UPGRADE',...shadowAttack].includes(nextState))delete actor.sourceShadowStep;
}
