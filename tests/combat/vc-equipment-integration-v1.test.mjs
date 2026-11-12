/** Integration of independently sourced VC Buff factors with the shared PvP
 * formula. These are simulation checks, not target-client measured answers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture} from '../helpers/vc-fixture.mjs';
import {requestActorStop} from '../../packages/combat-core/source-stop-queues-v53.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const data={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},PVP_RATE:1,REACT_TYPE:1,HIT_ADD_MP:5,FORCE_DOWN:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0};

test('VC production equipment preserves300 authored MP, composes600 capacity and recovers only unfrozen source time',()=>{
  const {sim,a,profile}=vcFixture({gap:1000});
  assert.equal(a.formulaRules.combatLevel,85);assert.equal(a.equipmentAttributes.mpMax,300);assert.equal(a.mpMax,600);
  assert.equal(profile.components.MP_CHANGE_RATE,1);a.mp=10;
  sim.step(.25,{});close(a.mp,10.25);
  requestActorStop(a,'hit',.5);sim.step(.25,{});close(a.mp,10.25);
  // The next callback exhausts the queue before the freeze gate and recovers
  // for its full delta, rather than suppressing the entire exhaustion frame.
  sim.step(.25,{});close(a.mp,10.5);
  const state=JSON.parse(JSON.stringify(sim.snapshot())),other=vcFixture({gap:1000}).sim;other.restore(state);
  for(let i=0;i<20;i++){sim.step(1/60,{});other.step(1/60,{});}
  assert.deepEqual(other.snapshot(),sim.snapshot());
});

for(const kind of ['character','effect'])test(`VC Mental Crash ${kind} hit suppression survives formula merge and owner hydration`,()=>{
  const sender=vcFixture({skillId:24214,gap:160}),receiver=vcFixture({skillId:24214,gap:160});
  for(let i=0;i<30;i++)sender.sim.step(1/60,{vc:{pressed:i===0?['A']:[]}});
  const buff=sender.b.buffs.find(b=>b.templateId===545);assert.ok(buff);
  const packet=validateOwnedState(encodeOwnedState(sender.sim,'target',{epoch:1,frameSeq:1}));
  validateOwnedReferences(packet,receiver.b,receiver.profile,receiver.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
  applyOwnedState(receiver.sim,'target',packet);
  close(receiver.b.stats.receivedMpMultiplier,.0001);
  for(const f of [sender,receiver]){
    f.a.mp=f.b.mp=0;f.a.forceInvincible=f.b.forceInvincible=0;f.a.invincible=f.b.invincible=false;
    f.sim.state.step++;const hit=f.sim.applyHit(f.b,f.a,data,{kind,powerMultiplier:1});assert.equal(hit.accepted,true);
    close(f.b.mp,5*.0001,'source attack suppression applies once in shared formula');
    close(f.a.mp,3);const mp=f.b.mp;
    f.sim.applyHit(f.b,f.a,data,{kind,powerMultiplier:1});assert.equal(f.b.mp,mp,'same source frame stays gated');
    f.sim.advanceActorBuffs(f.b,4);assert.equal(f.b.stats.receivedMpMultiplier,undefined);
    f.sim.state.step++;f.a.invincible=false;f.a.forceInvincible=0;
    f.sim.applyHit(f.b,f.a,data,{kind,powerMultiplier:1});close(f.b.mp,mp+5);
  }
});
