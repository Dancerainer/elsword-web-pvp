import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {resolveControllerPose} from '../../tools/assets/character/sample_pose.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
function fixture(){
  const simulation=createSimulation({profile,map:{sceneId:'retained-fixture',lines:[{lineId:0,
    start:[-100000,0,0],end:[100000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    actors:[{id:'owner',team:0,position:[0,0,0],lineId:0}],versions:{fixture:'retained-pose'}});
  return {simulation,report:()=>encodeOwnedState(simulation,'owner')};
}
const transition=()=>({serial:2,fromName:'Wait',fromTime:.25,fromLoop:true,fromSpeed:1,
  fromWeight:0,fromApplyMotionOffset:true,durationSeconds:.1,elapsedSeconds:0,enabled:true,
  retainedPose:{animationName:'Walk',animationTime:.3,animationLoop:true,presentationTransition:null}});
test('a real interrupted zero-weight transition roundtrips without changing controller output',()=>{
  const {simulation,report}=fixture(),actor=simulation.actor('owner');
  simulation.enter(actor,'RSI_WALK','retained-fixture');
  simulation.enter(actor,'RSI_JUMP_UP','retained-fixture');
  assert.equal(actor.presentationTransition.fromWeight,0);
  assert.ok(actor.presentationTransition.retainedPose);
  const before=resolveControllerPose(actor,()=>1);
  const original=structuredClone(actor.presentationTransition),expected=structuredClone(original);
  assert.equal(typeof expected.evidence,'string');
  assert.equal(typeof expected.retainedPose.presentationTransition.evidence,'string');
  delete expected.evidence;delete expected.retainedPose.presentationTransition.evidence;
  const wire=JSON.parse(JSON.stringify(report()));validateOwnedState(wire);
  assert.deepEqual(actor.presentationTransition,original,'encoding preserves local source provenance');
  assert.deepEqual(wire.actor.presentationTransition,expected,'every controller field survives except local provenance');
  assert.deepEqual(resolveControllerPose(wire.actor,()=>1),before);
});
test('retained controller container, field types and clock bounds reject before any animation consumer',()=>{
  const corruptions=[
    value=>{value.retainedPose=[];},
    value=>{value.retainedPose={weight:1,time:0,loop:true,name:'Wait'};},
    value=>{value.retainedPose.animationName=0;},
    value=>{value.retainedPose.animationTime=-1;},
    value=>{value.retainedPose.animationLoop='true';},
    value=>{value.retainedPose.presentationTransition=[];},
    value=>{value.retainedPose.presentationTransition={...transition(),fromWeight:2};},
    value=>{value.retainedPose.presentationTransition={...transition(),durationSeconds:0};},
    value=>{value.retainedPose.presentationTransition={...transition(),elapsedSeconds:NaN};},
  ];
  for(const corrupt of corruptions){
    const value=fixture().report();value.actor.presentationTransition=transition();corrupt(value.actor.presentationTransition);
    assert.throws(()=>validateOwnedState(value),/invalid-owner-actor-shape:presentationTransition/);
  }
});
test('bounded recursive retained poses survive JSON while cyclic and excessive chains reject safely',()=>{
  const value=fixture().report();value.actor.presentationTransition=transition();
  value.actor.presentationTransition.retainedPose.presentationTransition=transition();
  assert.doesNotThrow(()=>validateOwnedState(JSON.parse(JSON.stringify(value))));
  const cycle=fixture().report();cycle.actor.presentationTransition=transition();
  cycle.actor.presentationTransition.retainedPose.presentationTransition=cycle.actor.presentationTransition;
  assert.throws(()=>validateOwnedState(cycle),/invalid-owner-actor-shape:presentationTransition/);
  const excessive=fixture().report();excessive.actor.presentationTransition=transition();
  let current=excessive.actor.presentationTransition;
  for(let depth=0;depth<12;depth++){current.retainedPose.presentationTransition=transition();current=current.retainedPose.presentationTransition;}
  assert.throws(()=>validateOwnedState(JSON.parse(JSON.stringify(excessive))),/invalid-owner-actor-shape:presentationTransition/);
});
