/** These are executable source-resource checks, not original-client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
for(const facing of [-1,1])for(const position of [[0,3080,0],[2023,2840,0]])test(`LK original helpers and real Garpai ${position} facing ${facing} accept Z→Z2→Z3 after actual hits`,async()=>{
  const {sim,actor,target,profile}=await lkCommandFixture({facing,position,lineId:position[0]===0?2:6,gap:85}),input=createInputBuffer();
  const state=()=>profile.states[actor.state].sourceState;
  const step=()=>sim.step(1/60,{lk:input.consume(sim.state.time+1/60)},{snapshot:false});
  const tap=key=>{input.tap(key,sim.state.time+.001);step();};
  const until=(predicate,max=180)=>{for(let i=0;i<max&&!predicate();i++)step();assert.ok(predicate(),state());};
  tap('Z');until(()=>actor.animationTime>.12);tap('Z');until(()=>state()==='ESSI_COMBO_Z2');tap('Z');until(()=>state()==='ESSI_COMBO_Z3');
  until(()=>actor.animationTime>.22);tap('X');until(()=>state()==='ESSI_COMBO_Z4a');
  for(let i=0;i<100;i++)step();
  const hits=sim.state.events.filter(e=>e.type==='hit'&&e.actorId==='lk');
  assert.ok(hits.length>=1,'actual original helper must hit a near target');assert.ok(target.hp<target.hpMax);
  assert.ok(sim.state.events.some(e=>e.type==='stateChanged'&&e.state==='RSI_COMBO_ZZ'));
  assert.ok(!sim.state.events.some(e=>e.type==='unsupported'&&/No target declaration/.test(e.reason)));
  assert.ok([actor.x,actor.y,target.x,target.y].every(Number.isFinite));
});
