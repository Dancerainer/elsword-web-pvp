/** Shared Raven callback, actual VC input/map/pose. No client recording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {rfCommandFallbackEvent} from '../../packages/combat-core/rf-command-fallback.mjs';
const state='RSI_DASH_COMBO_X';
function fixture(facing){
  const f=vcFixture({skillId:24221,passives:[],position:[-facing*700,3080,0],gap:2500,facing});
  const input=createInputBuffer({sampledLevels:true});
  const step=()=>f.sim.step(1/60,{vc:input.consume(f.sim.state.time+1/60)},{snapshot:false});
  const down=key=>{input.down(key,f.sim.state.time+.001);step();};
  const up=key=>{input.up(key,f.sim.state.time+.001);step();};
  const tap=key=>{down(key);up(key);};
  const until=(condition,label)=>{for(let i=0;i<240&&!condition();i++)step();assert.ok(condition(),label+' '+f.a.state);};
  const direction=facing===1?'RIGHT':'LEFT';tap(direction);down(direction);tap('X');up(direction);
  assert.equal(f.a.state,state);
  return {...f,input,step,down,up,tap,until};
}
test('VC uses the same 2016 Raven 66X cancel field; binary32 boundary is strict',()=>{
  const def=vcProfile.states[state];assert.equal(def.sourceState,state);assert.equal(def.raw.ATTACK_CANCEL_AFTER,1.1);
  assert.equal(rfCommandFallbackEvent({state,animationTime:1.1},{held:new Set(['Z'])},def),null);
  assert.equal(rfCommandFallbackEvent({state,animationTime:1.1001},{held:new Set(['Z'])},def)?.state,'RSI_WAIT');
});
for(const facing of [-1,1])for(const key of ['Z','X'])test(`VC shared 66X held ${key}, facing ${facing}, exits then new press starts a real command`,()=>{
  const f=fixture(facing);f.until(()=>f.a.animationTime>1.07,'approach 1.1');f.down(key);
  f.until(()=>f.a.state!==state,'shared held exit');assert.equal(f.a.state,'RSI_WAIT');
  assert.equal(f.sim.state.events.findLast(e=>e.type==='stateChanged'&&e.actorId==='vc').reason,'reference-rf-command-held-skip');
  f.step();assert.equal(f.a.state,'RSI_WAIT','held key must not become a second attack edge');
  f.up(key);f.down('Z');assert.equal(f.a.state,'RSI_COMBO_Z');
});
test('VC shared 66X released tap does not create a delayed command and skill keeps priority',()=>{
  const f=fixture(1);f.until(()=>f.a.animationTime>.94,'before skip');f.tap('Z');
  f.until(()=>f.a.animationTime>1.13,'after skip');assert.equal(f.a.state,state);
  f.down('A');assert.equal(f.a.skillId,24221);assert.equal(f.a.state,'RSI_A_RWT_BARRAGE_ATTACK_STAND');
  assert.ok(!f.sim.state.events.some(e=>e.reason==='reference-rf-command-held-skip'));
});
