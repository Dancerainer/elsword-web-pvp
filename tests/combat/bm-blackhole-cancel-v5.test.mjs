/** Target2016 gates + pinned fixed-V5 cancellation consumers. Original-client
 * dynamic timing is unavailable; these are real production-adapter inputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bmSampledFixture,bmFixture,bmProfile} from '../helpers/bm-feedback-fixture-v4.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60,set='EffectSet_RBM_BLACKHOLE';
const members=f=>f.sim.state.effects.filter(e=>e.ownerId==='bm'&&e.setName===set&&!e.dead);
function born({facing=1,skillId=24210,derived=false,gap=4000}={}){
  const f=bmSampledFixture({facing,skillId,gap,passives:[]});
  f.zzz();f.press('X');f.wait('RBM_COMBO_ZZZX');f.at(.3);
  if(derived){f.press('Z');f.wait('RBM_COMBO_ZZZXZ');f.at(.25);}
  assert.equal(members(f).length,3);return f;
}
function assertStopped(f,ids){
  assert.equal(f.a.sourceBladeMaster.blackHoleRemaining,0);
  assert.equal(f.a.sourceBladeMaster.blackHoleCount,0);
  assert.deepEqual(f.a.sourceBladeMaster.blackHoleEffectIds,[]);
  assert.ok(!f.sim.state.effects.some(e=>ids.includes(e.id)));
  const ends=f.sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId));
  assert.equal(ends.length,3);assert.ok(ends.every(e=>e.reason==='original-stop-effect-set'));
}
test('BM cancellation evidence includes accepted SpecialAttack, movement starts, lost floor and damage reference bodies',()=>{
  const evidence=JSON.parse(readFileSync(new URL('../../contracts/bm-feedback-source-v4.json',import.meta.url)));
  assert.equal(evidence.targetNativeConsumerAvailable,false);
  assert.equal(evidence.referenceSource.sha256,'e4cd77da491835f9d07a97b56b34c36a400b27c0f64c9987b0ecc7c674b55237');
  for(const method of ['SpecialAttackEventProcess','RSI_WAIT_Start','RSI_WALK_Start','RSI_DASH_END_Start','DamageReact','RBM_COMBO_ZZZX_StateStart','RBM_COMBO_ZZZXZ_EventProcess'])
    assert.ok(evidence.referenceSource.spans.some(s=>s.method===method&&s.bytes>0&&s.sha256.length===64));
  assert.deepEqual(evidence.blackHoleTimerReference.cancelCallbacks.successfulSpecialAttack,[5975,5982]);
  assert.equal(evidence.stopSetReference.sha256,'395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440');
  assert.equal(evidence.stopSetReference.spans.length,3);
  for(const definition of Object.values(evidence.targetSets[set].raw).filter(v=>v&&typeof v==='object'))
    assert.equal(definition.DELETE_CONDITION,undefined,'no invented DELETE_STATE flag');
});
for(const facing of [-1,1])for(const derived of [false,true])for(const skill of bmProfile.skillCatalog.filter(s=>s.executor&&s.skillId!==900))
test(`BM ${facing} ${derived?'ZZZXZ':'ZZZX'} successful ${skill.executor} clears the set after acceptance`,()=>{
  const f=born({facing,skillId:skill.skillId,derived}),ids=members(f).map(e=>e.id),remaining=f.a.sourceBladeMaster.blackHoleRemaining;
  assert.equal(f.sim.skillAvailability('bm',0).available,true);
  f.press('A');assert.equal(f.a.skillId,skill.skillId);f.step();assertStopped(f,ids);
  const accepted=f.sim.state.events.find(e=>e.type==='skillStarted'&&e.skillId===skill.skillId);
  assert.ok(accepted);const ended=f.sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId));
  assert.ok(ended.every(e=>e.time>=accepted.time&&e.time-accepted.time<=dt*2+1e-9));
  assert.ok(ended.every(e=>e.time-accepted.time<remaining),'successful cancellation stops before the natural timer');
});
for(const reason of ['mp','cooldown','empty'])test(`BM failed ${reason} skill does not clear a born set`,()=>{
  const f=born(),ids=members(f).map(e=>e.id),remaining=f.a.sourceBladeMaster.blackHoleRemaining;
  if(reason==='mp')f.a.mp=0;
  if(reason==='cooldown')f.a.cooldowns[24210]=100;
  if(reason==='empty')f.a.loadout[0]=null;
  f.press('A');assert.equal(f.a.state,'RBM_COMBO_ZZZX');assert.equal(f.a.skillId,null);
  assert.ok(f.a.sourceBladeMaster.blackHoleRemaining>0&&f.a.sourceBladeMaster.blackHoleRemaining<remaining);
  assert.deepEqual(members(f).map(e=>e.id),ids);assert.ok(f.sim.state.events.some(e=>e.type==='skillRejected'));
});
for(const facing of [-1,1])test(`BM ${facing} earliest legal pre-birth skill creates no black hole`,()=>{
  const f=bmSampledFixture({facing,skillId:24210,gap:4000,passives:[]});
  f.zzz();f.press('X');f.wait('RBM_COMBO_ZZZX');f.at(.05);assert.ok(f.a.animationTime<.24);
  f.press('A');f.step(6);assert.equal(f.a.skillId,24210);assert.equal(members(f).length,0);
  assert.ok(!f.sim.state.events.some(e=>e.type==='effectSet'&&e.name===set));
});
for(const next of ['RSI_WAIT','RSI_WALK','RSI_DASH_END'])test(`BM fixed-V5 ${next} Start clears retained timer`,()=>{
  const f=born(),ids=members(f).map(e=>e.id);f.sim.enter(f.a,next,'reference-start-callback');
  f.step();assertStopped(f,ids);
});
for(const derived of [false,true])test(`BM ${derived?'ZZZXZ':'ZZZX'} actual walk cancel clears black hole`,()=>{
  const f=born({derived}),ids=members(f).map(e=>e.id);f.down('RIGHT');f.step(2);f.up('RIGHT');f.step();
  assert.ok(!f.a.state.startsWith('RBM_COMBO_ZZZX'));assertStopped(f,ids);
});
test('BM dash cancel keeps set during DASH and its DASH_END callback clears it',()=>{
  // Isolate the already-sampled device double level from the first direction
  // press, which itself correctly enters WAIT through WALK_CANCEL_AFTER.
  const g=born(),kept=members(g).map(e=>e.id);
  g.sim.step(dt,{bm:{sampledDevice:true,held:['RIGHT'],pressed:['RIGHT'],pureDouble:['RIGHT']}});
  assert.equal(g.a.state,'RSI_DASH');assert.deepEqual(members(g).map(e=>e.id),kept);
  g.sim.step(dt,{bm:{sampledDevice:true,held:[],released:['RIGHT']}});
  assert.equal(g.a.state,'RSI_DASH_END');g.sim.step(dt,{});assertStopped(g,kept);
});
for(const derived of [false,true])test(`BM ${derived?'ZZZXZ':'ZZZX'} loses floor and stops the set`,()=>{
  const f=born({derived}),ids=members(f).map(e=>e.id);
  f.a.grounded=false;f.a.lineId=null;f.a.y+=1000;f.a.vy=-10;f.step(2);
  assert.equal(f.a.state,'RSI_JUMP_DOWN');assertStopped(f,ids);
});
for(const kind of ['reaction','death'])test(`BM ${kind} retires all saved set members`,()=>{
  const f=born(),ids=members(f).map(e=>e.id);
  if(kind==='death')f.a.hp=0;else f.sim.enter(f.a,'RSI_DAMAGE_SMALL_FRONT','source-non-dummy-reaction');
  f.step(2);assertStopped(f,ids);
});
test('BM internal ZZZXZ repeat keeps exactly the same handle and renews only its source timer',()=>{
  const f=born({derived:true}),ids=members(f).map(e=>e.id);
  const serial=f.a.stateSerial;f.press('Z');f.until(()=>f.a.stateSerial>serial);
  assert.equal(f.a.state,'RBM_COMBO_ZZZXZ');assert.deepEqual(members(f).map(e=>e.id),ids);
  assert.equal(f.a.sourceBladeMaster.blackHoleCount,3);assert.ok(f.a.sourceBladeMaster.blackHoleRemaining>1);
  assert.ok(!f.sim.state.events.some(e=>e.type==='effectEnded'&&ids.includes(e.effectId)));
});
test('BM state re-entry stops old handle and births a new three-member set without leaks',()=>{
  const f=born(),old=members(f).map(e=>e.id);f.sim.enter(f.a,'RBM_COMBO_ZZZX','source-state-reentry');
  f.step();assertStopped(f,old);f.at(.3);
  assert.equal(members(f).length,3);assert.ok(members(f).every(e=>!old.includes(e.id)));
});
for(const phase of ['timer-cleared','handle-stopped'])test(`BM owned ${phase} cancel remaps/stops only the sender's set`,()=>{
  const source=born({gap:150}),receiver=bmFixture({gap:150,passives:[],skillId:24210});
  const send=()=>{
    const packet=JSON.parse(JSON.stringify(encodeOwnedState(source.sim,'bm',{epoch:1,frameSeq:source.sim.state.step})));
    validateOwnedState(packet);validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map);applyOwnedState(receiver.sim,'bm',packet);
  };
  receiver.sim.state.nextEffectId=1000;
  const foreign=receiver.sim.createEffect(receiver.b,{NAME:'RBM_BLACKHOLE'},{clock:'custom',start:1000});
  send();assert.equal(members(receiver).length,3);assert.ok(receiver.a.sourceBladeMaster.blackHoleEffectIds.every(id=>id>=1001));
  source.sim.step(dt,{bm:{pressed:['A'],held:['A']}});assert.equal(source.a.sourceBladeMaster.blackHoleRemaining,0);
  if(phase==='handle-stopped')source.sim.step(dt,{});
  send();receiver.sim.step(dt,{});
  assert.equal(members(receiver).length,0);assert.deepEqual(receiver.a.sourceBladeMaster.blackHoleEffectIds,[]);
  assert.ok(receiver.sim.state.effects.includes(foreign));assert.notEqual(foreign.dead,true);
  assert.deepEqual(receiver.b.effectiveBlackHoleIds,[]);
});
