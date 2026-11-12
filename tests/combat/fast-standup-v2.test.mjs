import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ELSWORD_NO_DOWN_STANDUP_STATES} from '../../packages/combat-core/elsword-standup-source-v2.mjs';
import {commonRecoveryFixture,beginDown} from '../helpers/common-charge-standup-v8-fixture.mjs';
import {encodeOwnedState,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {actionAnimationSpeed} from '../../packages/combat-core/action-animation-speed.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/fast-standup-source-v2.json',import.meta.url)));
const professions=['RF','LK','VC','RS','BM','IS'];
function until(f,condition,max=180){for(let n=0;n<max&&!condition();n++)f.step();assert.ok(condition(),f.a.state+' @ '+f.a.animationTime);}

test('Elsword common fast-rise rows and clip keys match independently recorded original declarations',()=>{
  for(const [name,state]of Object.entries(ELSWORD_NO_DOWN_STANDUP_STATES)){
    assert.deepEqual(state.raw,source.originalElswordNonDown[name].raw);
    assert.deepEqual(state.clip,source.originalElswordNonDown[name].clip);
    assert.deepEqual(state.sourcePc,source.originalElswordNonDown[name].sourcePc);
  }
});

for(const profession of professions)for(const side of ['FRONT','BACK'])test(`${profession}/${side}: X runs the original 0.7-second fast pose then restores input`,async()=>{
  const f=await commonRecoveryFixture(profession,{gap:2500});beginDown(f,'RSI_DAMAGE_DOWN_'+side);
  until(f,()=>f.a.animationTime>.66);f.tap('X');f.step();until(f,()=>f.a.standupAttackNoDown);
  const definition=f.sim.profileFor(f.a).states[f.a.state],normal=f.sim.profileFor(f.a).states['RSI_STANDUP_ATTACK_'+side];
  assert.equal(definition.clip.durationSeconds,.7);assert.ok(definition.clip.durationSeconds<normal.clip.durationSeconds);
  const start=f.sim.state.time,speed=actionAnimationSpeed(f.a,definition);
  until(f,()=>f.a.state==='RSI_WAIT');
  // Preserve the shared fixedV5 SkinAnim end threshold, period-transitionTime.
  assert.ok(Math.abs((f.sim.state.time-start)-(.7-.07)/speed)<=2/60,'use authored period, existing transition threshold and item speed');
  f.tap('Z');f.step();assert.equal(f.a.state,'RSI_COMBO_Z');
  assert.equal(f.a.standupAttackNoDown,false);
});

for(const profession of professions)test(`${profession}: active fast rise survives owner packet and deterministic JSON continuation`,async()=>{
  const f=await commonRecoveryFixture(profession,{gap:2500,facing:-1});beginDown(f,'RSI_DAMAGE_DOWN_BACK');
  until(f,()=>f.a.animationTime>.66);f.tap('X');f.step();until(f,()=>f.a.standupAttackNoDown);
  const receiver=await commonRecoveryFixture(profession,{gap:2500,facing:-1});
  const packet=encodeOwnedState(f.sim,f.a.id,{frameSeq:1});validateOwnedState(packet);
  applyOwnedState(receiver.sim,receiver.a.id,JSON.parse(JSON.stringify(packet)));
  assert.equal(receiver.a.state,'RSI_STANDUP_ATTACK_BACK_NO_DOWN');
  assert.equal(receiver.a.animationName,f.a.animationName);assert.equal(receiver.a.standupAttackNoDown,true);
  receiver.sim.restore(JSON.parse(JSON.stringify(f.sim.snapshot())));
  for(let n=0;n<85;n++){f.sim.step(1/60,{}, {snapshot:false});receiver.sim.step(1/60,{}, {snapshot:false});}
  for(const key of ['state','animationTime','facing','standupAttackNoDown','forceInvincible'])assert.equal(receiver.sim.actor(f.a.id)[key],f.a[key]);
  assert.equal(f.a.facing,1);assert.equal(f.a.state,'RSI_WAIT');assert.equal(f.a.standupAttackNoDown,false);
});
