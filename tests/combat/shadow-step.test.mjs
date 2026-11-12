import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {instantiateNativeSkills} from '../../packages/native-source/skills.mjs';
import {executeOriginalShadowStep,inspectShadowStepCandidate,shadowStepTargetCandidates} from '../../packages/combat-core/shadow-step.mjs';
const compiled=await WebAssembly.compile(await readFile(new URL('../../.cache/native-skills-generated/skills.wasm',import.meta.url)));
const native=await instantiateNativeSkills(compiled);
const snapshot={stepTimeLeft:0,backSlideTimeLeft:0,teleportRange:6,skillCooldown:7,skillLevel:1,
  passiveSpeedX:1000,mp:50,stateTime:.3,stepCooldown:0,backSlideLevel:0,comboLoopCount:0,
  thrustPower:1,enhancedThrustPower:1,punisherPower:1,busterPower:1,
  afterImage:false,alpha:1,alphaBlend:false,alphaObject:false,gageAlpha:255,
  damagePhysical:10,damageMagic:20,damagePerSecond:30,statePower:1,randomRoll:0,
  dashSuccessor:'wait',requestedAttack:'thrust',reactionRequest:'none',
  flags:{frameStop:false,hasEquippedSkill:true,hasUnit:true,enableThrust:false,enableThrustEnhance:false,
    enablePunisher:false,enableBackSlide:false,activeCombo:false,skillIcon:true,memo6:false,memo7:false,
    specialAttackAccepted:false,isMyUnit:true,hasGageUI:true,hasAfterImage:true}};
const frame={time:.3,before:.29,dt:1/60,hp:100,hpMax:100,held:false,ended:false,grounded:true,
  position:[0,0,0],rotation:[0,0,0],direction:[1,0,0],landY:0,isRight:true,memo:false};

test('pure Shadow dispatcher executes source but never invents target successor bindings',()=>{
  const result=executeOriginalShadowStep(native,{operation:'dashEvent',snapshot,frame});
  assert.equal(result.executed,true);assert.equal(result.successorSymbol,'wait');assert.equal(result.successorState,null);
  assert.deepEqual(result.unsupported,[{kind:'unboundOriginalSuccessor',symbol:'wait'}]);
  const bound=executeOriginalShadowStep(native,{operation:'dashEvent',snapshot,frame,successorStates:{wait:'USI_WAIT'}});
  assert.equal(bound.successorState,'USI_WAIT');assert.equal(bound.targetBindingVerified,false);
});
test('pause freezes temporal callback state and commands; explicit lifecycle callbacks still execute',()=>{
  const result=executeOriginalShadowStep(native,{operation:'dashFrame',snapshot,frame,paused:true});
  assert.equal(result.executed,false);assert.deepEqual(result.snapshot,snapshot);assert.notEqual(result.snapshot,snapshot);
  assert.deepEqual(result.commands,[]);
  assert.equal(executeOriginalShadowStep(native,{operation:'dashInit',snapshot,frame,paused:true}).commands[0].name,'Raven_SI_A_RF_Shadow_Step_Mesh01.X');
});
test('six target state candidates expose animation evidence and unresolved source gates',()=>{
  assert.equal(Object.keys(shadowStepTargetCandidates).length,6);
  const profile={states:{RSI_SHADOW_STEP_X_UPGRADE:{raw:{ANIM_NAME:'SI_P_RVC_SHADOW_BUSTER'}}}};
  const result=inspectShadowStepCandidate(profile,'RSI_SHADOW_STEP_X_UPGRADE');
  assert.equal(result.animationMatches,true);assert.equal(result.targetBindingVerified,false);
  assert.equal(result.candidate.effectSet,'EffectSet_Raven_Shadow_Buster');
  assert.equal(inspectShadowStepCandidate(profile,'RSI_SI_A_RF_SHADOW_STEP').animationMatches,false);
  assert.equal(inspectShadowStepCandidate(profile,'invented').supported,false);
});
test('original Shadow dispatcher validates native implementation and names without changing caller snapshots',()=>{
  assert.throws(()=>executeOriginalShadowStep(native,{operation:'invented',snapshot,frame}),TypeError);
  assert.throws(()=>executeOriginalShadowStep(null,{operation:'dashInit',snapshot,frame}),TypeError);
  const copy=structuredClone(snapshot);
  executeOriginalShadowStep(native,{operation:'dashStart',snapshot,frame});
  assert.deepEqual(snapshot,copy);
});
