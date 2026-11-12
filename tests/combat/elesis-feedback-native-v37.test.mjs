/** Native poses/WASM/map checks for the v37 execution fixes.
 * Original declarations set these assertions; motion checks remain Web
 * adapter evidence rather than original-client trajectories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
function step(f,held=[],pressed=[]){f.sim.step(dt,{elesis:{held,pressed,sampledDevice:true}},{snapshot:false});}
function wait(f,predicate,max=180){for(let i=0;i<max&&!predicate();i++)step(f);assert.ok(predicate(),f.a.state+' '+f.a.animationTime);}
for(const facing of [-1,1])for(const dash of [false,true])test(`GM Native Leap ${facing} dash=${dash}: recovered launch meets real landing`,()=>{
  const f=elesisFixture('GM',{skillId:28204,passives:[],gap:5000,facing});
  if(dash)f.sim.enter(f.a,'RSI_DASH','original-run-entry');
  step(f,['A'],['A']);wait(f,()=>f.a.state==='ESI_SI_A_EL_LEAP_CRASH_JUMP');
  // v45 exact2016 StartFuture replaces the v37 guessed class jump impulse.
  const speed=dash?2700:2200;assert.equal(f.a.passiveSpeed.x,-1);assert.equal(f.a.vx,speed*facing);assert.equal(f.a.vy,1000);
  wait(f,()=>f.a.animationTime>.4);const late=f.a.x;
  wait(f,()=>f.a.state==='ESI_SI_A_EL_LEAP_CRASH_JUMP_LANDING');
  assert.ok((f.a.x-late)*facing>30,'Native collision preserves the requested forward continuation');
  assert.equal(f.a.passiveSpeed.x,-1);validateOwnedState(encodeOwnedState(f.sim,f.a.id));
});
for(const facing of [-1,1])test(`CA Native 668ZX ${facing}: source .3 release, falling projectile and finite lifetime`,()=>{
  const f=elesisFixture('CA',{skillId:28221,passives:[],position:[-600,3400,0],gap:500,facing});
  f.a.grounded=false;f.a.lineId=null;f.a.skillId=null;f.b.y=3080;f.b.grounded=true;f.b.lineId=2;
  f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SDK_ZX_FIRE','independent-original-fire-phase');
  const name='DamageEffect_SDK_Dash_Jump_Combo_ZX';
  step(f);
  const pending=f.sim.state.effects.find(e=>e.name===name);assert.ok(pending);assert.equal(pending.clock,'animation');
  assert.ok(f.a.animationTime-pending.setStartAnimation<.3);assert.equal(pending.active,false);
  let previousClock=f.a.animationTime-pending.setStartAnimation;
  // The original set has ESTT_ANIM (default0), so .3 is an owner-animation
  // interval. Original action/attribute speeds may cross it before14/60 wall
  // seconds; a fixed wall-frame count is not an independent source oracle.
  for(let i=0;i<120&&!pending.active;i++){
    previousClock=f.a.animationTime-pending.setStartAnimation;assert.ok(previousClock<.3);
    step(f);
  }
  assert.equal(pending.active,true);assert.ok(previousClock<.3);
  assert.ok(f.a.animationTime-pending.setStartAnimation>=.3);
  const e=f.sim.state.effects.find(e=>e.name===name&&e.active);
  assert.equal(e.start,.3);assert.equal(e.mainEffectName,'SDK_Combo_Projectile');
  assert.equal(e.templateFields.LifeTime,.5);assert.deepEqual(e.initialVelocity,[2000,-1000,0]);
  const first=[e.x,e.y,e.z];for(let i=0;i<8;i++)step(f);
  const moving=f.sim.state.effects.find(v=>v.id===e.id);assert.ok(moving);
  assert.ok((moving.x-first[0])*facing>150);assert.ok(moving.y<first[1]-70);
  validateOwnedState(encodeOwnedState(f.sim,f.a.id));
  for(let i=0;i<80;i++)step(f);
  assert.ok(!f.sim.state.effects.some(v=>v.name===name&&!v.dead),'original half-second carrier has ended');
  assert.ok(f.sim.state.events.some(v=>v.type==='effectEnded'&&v.effectId===e.id));
});
test('CA original animation-timer projectile gate is closed before .3 and inclusive at .3',()=>{
  // Independent boundary fixture only: sample a requested owner animation
  // clock with a zero-time effect pass. Do not transplant these clocks into
  // the actual advancing Native trajectory above or fabricate hit receipts.
  for(const [label,at,expected]of [['before',.3-.000001,false],['equal',.3,true],['after',.3+.000001,true]]){
    const f=elesisFixture('CA',{skillId:28221,passives:[],position:[-600,6000,0],gap:5000});
    f.sim.enter(f.a,'ESI_DASH_JUMP_COMBO_SDK_ZX_FIRE','independent-original-set-boundary');
    assert.equal(f.profile.enums.EFFECT_SET_TIMER_TYPE.ESTT_ANIM,0);
    const raw=f.profile.effectSets.EffectSet_SDK_Dash_Jump_Combo_ZX.raw;
    assert.equal(raw.EVENT_TIMER_TYPE,undefined);assert.equal(raw.EFFECT0.START_TIME,.3);
    f.sim.spawnSet(f.a,'EffectSet_SDK_Dash_Jump_Combo_ZX');
    const e=f.sim.state.effects.find(e=>e.name==='DamageEffect_SDK_Dash_Jump_Combo_ZX');
    assert.equal(e.clock,'animation');assert.equal(e.setStartAnimation,0);
    f.a.animationTime=at;f.sim.tickEffects(0);
    assert.equal(e.active,expected,label+' source animation-clock boundary');
  }
});
