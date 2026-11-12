import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {createBladeMasterCommands} from '../../packages/combat-core/bm-commands.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
const keys=(pressed=[],held=[])=>({pressed:new Set(pressed),held:new Set(held)});
test('BM dashZ uses target exclusive0..0.5 input window with strict0.4 change threshold',()=>{
  const {sim,a,native}=bmFixture({gap:4000}),commands=createBladeMasterCommands(sim,native.commands);
  sim.enter(a,'RSI_DASH_COMBO_Z','source-window');a.animationTime=.45;
  const buffered=commands.runEvent(a,keys(['Z']),bmProfile);assert.equal(buffered.state,null);assert.equal(buffered.flags,1);
  a.sourceCommandFlags=buffered.flags;a.animationTime=.46;assert.equal(commands.runEvent(a,keys(),bmProfile).state,'RSI_DASH_COMBO_ZZ');
  a.sourceCommandFlags=0;a.animationTime=.5;assert.equal(commands.runEvent(a,keys(['Z']),bmProfile).flags,0);
});
test('BM XXZZ8 follows original five complete PLAY_TYPE0 periods, never early IsAnimationEnd',()=>{
  const {sim,a,native}=bmFixture({gap:4000}),commands=createBladeMasterCommands(sim,native.commands),name='RSI_SOUL_TAKER_COMBO_XXZZ8';
  sim.enter(a,name,'source-loop');const duration=bmProfile.states[name].clip.durationSeconds;
  for(let i=0;i<5;i++){
    a.animationTime=duration*.95;assert.equal(commands.runEvent(a,keys(),bmProfile).state,null);
    a.animationTime=duration;const result=commands.runEvent(a,keys(),bmProfile);
    assert.equal(result.state,i===4?'RSI_SOUL_TAKER_COMBO_XXZZ8Z':name);
  }
});
test('BM thirdZ pure double direction cancels before buffered follow-up flags',()=>{
  const {sim,a,native}=bmFixture({gap:4000}),commands=createBladeMasterCommands(sim,native.commands);
  sim.enter(a,'RSI_COMBO_ZZZ','source-order');a.animationTime=.6;a.sourceCommandFlags=2;
  assert.equal(commands.runEvent(a,{...keys(),pureDoubleRight:true},bmProfile).state,'DASH_REQUEST');
});
for(const facing of [-1,1])test(`BM ${facing}: source blackhole follow-up flips exactly once on every state end`,()=>{
  const {sim,a}=bmFixture({facing,gap:4000});
  assert.equal(bmProfile.states.RBM_COMBO_ZZZXZ.raw.FLIP_DIR_END,1);
  sim.enter(a,'RBM_COMBO_ZZZXZ','source-turn');assert.equal(a.facing,facing);
  sim.enter(a,'RBM_COMBO_ZZZXZ','source-repeat-turn');assert.equal(a.facing,-facing);
  sim.enter(a,'RBM_COMBO_ZZZX_EXPLOSION','source-finish-turn');assert.equal(a.facing,facing);
});
for(const facing of [-1,1])test(`BM ${facing}: sampled XZZZ branches and returns, with actual command damage`,()=>{
  const {sim,a}=bmFixture({gap:150,facing}),input=createInputBuffer();
  const step=()=>sim.step(1/60,{bm:input.consume(sim.state.time+1/60)});
  const tap=k=>{input.tap(k,sim.state.time+.001);step();};
  const wait=name=>{for(let i=0;i<240&&a.state!==name;i++)step();assert.equal(a.state,name);};
  tap('X');assert.equal(a.state,'RSI_COMBO_X');tap('Z');wait('RBM_COMBO_XZ');tap('Z');wait('RBM_COMBO_XZZ');tap('Z');wait('RBM_COMBO_XZZZ');wait('RSI_WAIT');
  assert.ok(sim.state.events.some(e=>e.type==='hit'&&e.actorId==='bm'&&e.amount>0));
  assert.ok(!sim.state.unsupported.some(n=>n.id.startsWith('damage:')));
});
for(const facing of [-1,1])test(`BM ${facing}: sampled XXZZZ performs exactly five whirl periods before finisher`,()=>{
  const {sim,a}=bmFixture({gap:4000,facing}),input=createInputBuffer();
  const step=()=>sim.step(1/60,{bm:input.consume(sim.state.time+1/60)});
  const tap=k=>{input.tap(k,sim.state.time+.001);step();};
  const wait=name=>{for(let i=0;i<480&&a.state!==name;i++)step();assert.equal(a.state,name);};
  tap('X');tap('X');wait('RSI_COMBO_XX');tap('Z');wait('RSI_SOUL_TAKER_COMBO_XXZ');tap('Z');tap('Z');
  wait('RSI_SOUL_TAKER_COMBO_XXZZ8');wait('RSI_SOUL_TAKER_COMBO_XXZZ8Z');wait('RSI_WAIT');
  assert.equal(sim.state.events.filter(e=>e.type==='stateChanged'&&e.state==='RSI_SOUL_TAKER_COMBO_XXZZ8').length,5);
});
for(const facing of [-1,1])test(`BM ${facing}: sampled ZZZX invokes original blackhole and bounded explosion`,()=>{
  const {sim,a}=bmFixture({gap:4000,facing}),input=createInputBuffer();
  const step=()=>sim.step(1/60,{bm:input.consume(sim.state.time+1/60)});
  const tap=k=>{input.tap(k,sim.state.time+.001);step();};
  const wait=name=>{for(let i=0;i<360&&a.state!==name;i++)step();assert.equal(a.state,name);};
  tap('Z');tap('Z');wait('RSI_COMBO_ZZ');tap('Z');wait('RSI_COMBO_ZZZ');tap('X');wait('RBM_COMBO_ZZZX');wait('RBM_COMBO_ZZZX_EXPLOSION');wait('RSI_WAIT');
  assert.ok(sim.state.events.some(e=>e.type==='effectSet'&&e.name==='EffectSet_RBM_BLACKHOLE'));
});
