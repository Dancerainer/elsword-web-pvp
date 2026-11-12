import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {make,frames} from '../helpers/rf-passive-fixture-v12.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {onAwakening,awakeningDurationPlan} from '../../packages/combat-core/passives.mjs';

const dt=1/60,seconds=30*Math.fround(.7);
const original=JSON.parse(readFileSync(new URL('../../reports/rf-initial-core-independent-source-v18.json',import.meta.url)));
function ctrl(s,input){
  input.down('Control',s.state.time+.002);input.up('Control',s.state.time+.004);
  s.step(dt,input.consume(s.state.time+dt),{snapshot:false});frames(s,90);
}

test('independent original reference gives2/2/2 initial stages and separates three-bead electric field',async()=>{
  assert.equal(original.assertionsPassed,21);assert.equal(original.targetClientMeasured,false);
  assert.equal(original.matching2016ConsumerVerified,false);
  for(const row of original.cases.filter(c=>c.initialGauge===0)){
    const s=await make({passives:[24405]}),a=s.actor('rf');
    a.awakening.orbs=row.available;const input=createInputBuffer();ctrl(s,input);
    const e=s.state.events.find(e=>e.type==='awakeningStarted');assert.ok(e);
    assert.equal(e.coreGauge,row.gauge);assert.equal(a.core.level,row.level);
    assert.equal(e.full,row.full);assert.equal(a.awakening.orbs,row.beadsLeft);
    assert.equal(e.addedSeconds,seconds*row.available);
  }
});

test('three successive device reawakenings each spend1/add one-bead time, preserve electric field and cap core',async()=>{
  for(const facing of [-1,1]){
    const s=await make({passives:[24405]}),a=s.actor('rf'),input=createInputBuffer();
    a.facing=facing;Object.assign(a.awakening,{orbs:3,remaining:5,full:false});a.core.gauge=0;
    const started=s.state.time;
    for(const beforeOrbs of [3,2,1]){
      ctrl(s,input);
      const events=s.state.events.filter(e=>e.type==='reawakenCoreRefill'),last=events.at(-1);
      assert.equal(events.length,4-beforeOrbs);assert.equal(last.availableOrbs,beforeOrbs);
      assert.equal(last.orbs,1);assert.equal(last.addedSeconds,seconds);
      assert.equal(a.awakening.orbs,beforeOrbs-1);assert.equal(last.full,true);
      assert.equal(last.coreGauge,[100,80,40][beforeOrbs-1]);
    }
    assert.ok(Math.abs(a.awakening.remaining-(5+3*seconds-(s.state.time-started)))<1e-8);
    assert.equal(s.state.events.filter(e=>e.type==='coreAuraStarted').length,1);
    const count=s.state.events.filter(e=>e.type==='reawakenCoreRefill').length;ctrl(s,input);
    assert.equal(s.state.events.filter(e=>e.type==='reawakenCoreRefill').length,count,'zero beads cannot add time');
  }
});

test('available count controls mode only, while the duration adapter and onAwakening both add one-bead time',async()=>{
  const s=await make({passives:[24405]}),policy=s.actor('rf').passivePolicy;
  for(const orbs of [1,2,3]){
    assert.equal(awakeningDurationPlan(policy,{alreadyAwakened:true,orbs:1,availableOrbs:orbs,baseSeconds:30}).addedSeconds,seconds);
    assert.equal(onAwakening(policy,{alreadyAwakened:true,orbs}).addedSeconds,seconds);
    assert.equal(awakeningDurationPlan(policy,{orbs,baseSeconds:30}).addedSeconds,seconds*orbs);
  }
  assert.equal(onAwakening(policy,{alreadyAwakened:true,orbs:0}).allowed,false);
});
