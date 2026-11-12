import test from 'node:test';
import assert from 'node:assert/strict';
import {make,frames,profile} from '../helpers/rf-passive-fixture-v12.mjs';
import {readFileSync} from 'node:fs';
import {createAwakeningBeadController} from '../../apps/web/awakening-bead.mjs';
const beadIndex=JSON.parse(readFileSync(new URL('../../contracts/rf-awakening-bead-fx-v14.json',import.meta.url)));
const dt=1/60;
function press(s){s.step(dt,{pressed:['Control'],held:['Control']},{snapshot:false});}
function ready(s,orbs,full=false){const a=s.actor('rf');a.awakening.remaining=30;a.awakening.orbs=orbs;a.awakening.full=full;
  a.core.gauge=20;s.updateCoreLevel(a);a.core.phase='idle';s.drainEvents();return a;}

test('three available beads reawaken by spending one and activate electric field at original animation event',async()=>{
  const s=await make({passives:[24405]}),a=ready(s,3);
  const hud=createAwakeningBeadController({index:beadIndex});for(let i=0;i<12;i++)hud.step(dt,a.awakening.orbs);
  assert.ok(hud.runtime.count>0,'available third bead is aflame before spending');
  press(s);assert.equal(a.awakening.orbs,2);assert.equal(a.awakening.pendingOrbs,1);assert.equal(a.awakening.pendingAvailableOrbs,3);
  hud.step(0,a.awakening.orbs);assert.equal(hud.runtime.count,0,'UI flame follows remaining beads, not the incoming full-mode flag');
  assert.equal(a.awakening.full,false);assert.equal(a.core.gauge,20);
  frames(s,75);const event=s.state.events.find(e=>e.type==='reawakenCoreRefill');
  assert.ok(event);assert.equal(event.orbs,1);assert.equal(event.availableOrbs,3);assert.equal(event.full,true);
  assert.equal(event.coreGauge,60);assert.equal(event.coreGaugeAdded,40);assert.equal(a.awakening.pendingAvailableOrbs,0);
  assert.ok(event.time>=profile.referenceSemantics.awakening.applyAnimationTime/a.stats.animationSpeedMultiplier-dt);
  assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,1);
  assert.ok(s.state.effects.some(e=>e.ownerId==='rf'&&e.name==='RAVEN_HYPER_AURA'));
  assert.ok(event.addedSeconds>0);assert.match(event.validation,/candidate/,'unconfirmed target duration is not labelled verified');
});

test('one/two-bead reawakening keeps normal mode, while an existing electric field never downgrades or duplicates',async()=>{
  for(const full of [false,true])for(const orbs of [1,2,3]){
    const s=await make({passives:[24405]}),a=ready(s,orbs,full);
    press(s);assert.equal(a.awakening.orbs,orbs-1);frames(s,75);
    assert.equal(a.awakening.full,full||orbs===3);
    assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,!full&&orbs===3?1:0);
  }
});

test('bead count is captured before consumption, later charges do not change an in-flight activation',async()=>{
  const s=await make({passives:[24405]}),a=ready(s,2);press(s);a.awakening.orbs=3;frames(s,75);
  assert.equal(a.awakening.full,false);assert.equal(a.awakening.orbs,3);
  assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,0);
  press(s);frames(s,75);assert.equal(a.awakening.full,true);assert.equal(a.awakening.orbs,2);
  assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,1);
});

test('three-bead pending awakening survives JSON restore; expiry removes electric field and passive absence rejects reawakening',async()=>{
  const left=await make({passives:[24405]}),a=ready(left,3);press(left);frames(left,10);
  const right=await make({passives:[24405]});right.restore(JSON.parse(JSON.stringify(left.snapshot())));
  frames(left,120);frames(right,120);assert.deepEqual(left.snapshot(),right.snapshot());
  a.awakening.remaining=dt/2;frames(left,1);assert.equal(a.awakening.full,false);
  assert.equal(left.state.effects.some(e=>e.ownerId==='rf'&&e.name==='RAVEN_HYPER_AURA'),false);
  const off=await make({passives:[]}),b=ready(off,3);press(off);frames(off,75);
  assert.equal(b.awakening.orbs,3);assert.equal(b.awakening.full,false);
  assert.equal(off.state.events.some(e=>e.type==='reawakenCoreRefill'),false);
});
