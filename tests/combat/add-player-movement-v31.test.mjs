import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture,tick} from '../helpers/add-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';

for(const id of ['LP','MM','DE']){
 test(`${id} airborne second Up uses original levitation and a further Up resumes jump`,()=>{
  const {sim,a}=addFixture(id);a.mp=a.mpMax;
  sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});tick(sim,.12);
  assert.equal(a.grounded,false);
  sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});
  assert.equal(a.state,'ANSI_LEVITATION_WAIT');
  const y=a.y;tick(sim,.3);assert.ok(Math.abs(a.y-y)<.01);
  assert.equal(a.sourceAddMovement.levitationAvailable,false);
  sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});
  assert.equal(a.state,'RSI_JUMP_UP');assert.ok(a.vy>0);
  tick(sim,.05);sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});
  assert.notEqual(a.state,'ANSI_LEVITATION_WAIT','hover charge is not renewable before landing');
 });
 test(`${id} airborne double direction uses one original skateboard dash per landing`,()=>{
  const {sim,a}=addFixture(id);
  sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});tick(sim,.12);
  sim.step(1/60,{add:{held:['RIGHT'],pressed:['RIGHT']}});
  sim.step(1/60,{add:{held:[],released:['RIGHT']}});tick(sim,.03);
  sim.step(1/60,{add:{held:['RIGHT'],pressed:['RIGHT']}});
  assert.equal(a.state,'ANSI_AIR_DASH');assert.equal(a.sourceAddMovement.airDashAvailable,false);
  const x=a.x;tick(sim,.15,{add:{held:['RIGHT']}});assert.ok(a.x>x);
  tick(sim,.35,{add:{held:['RIGHT']}});assert.notEqual(a.state,'ANSI_AIR_DASH');
  assert.equal(a.jumpOnLanding,false,'Raven hop-on-landing flag is not an Add callback');
 });
}

test('real Add levitation owner state preserves consumed charges through full and critical transport',()=>{
 const {sim,a,profile}=addFixture('DE');
 sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});tick(sim,.12);
 sim.step(1/60,{add:{held:['UP'],pressed:['UP']}});
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:12})));
 const report=validateOwnedState(raw);validateOwnedReferences(report,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 applyOwnedState(sim,a.id,report);assert.equal(a.sourceAddMovement.levitationAvailable,false);
 const action=encodeCriticalAction(report,{seq:1});
 assert.equal(action.actor.sourceAddMovement.levitationAvailable,false);
 for(const mutation of [null,{airDashAvailable:true,levitationAvailable:1},{airDashAvailable:true,levitationAvailable:false,extra:true}]){
  const bad=structuredClone(raw);bad.actor.sourceAddMovement=mutation;assert.throws(()=>validateOwnedState(bad),/owner-actor-shape|owner-state/);
 }
});
