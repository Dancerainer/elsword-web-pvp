/** Actual Native cast and production death cleanup through the source-event
 * producer. No synthetic orb, damage table, animation enter or fake end count.
 * Root runs this file serially; writing it does not execute Native. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addMap} from '../helpers/add-fixture.mjs';
import {MAXIMUM_STRIKE_ORB,tickMaximumStrike,validateMaximumStrikeEffect} from '../../packages/combat-core/add-maximum-strike.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';

test('real Maximum Strike death ends six original orbs after deleting the owner group, without relaxing live or mismatched groups',()=>{
  const {sim,a,b,profile}=originalAddFixture('DE',{skillId:29022,networkOwnerId:'add'});
  sim.networkCombatPlaybackVersion=1;sim.networkEpochFor=()=>1;
  a.mp=a.mpMax;a.sourceAdd.dp=8000;b.x=1200;
  sim.step(1/60,{add:{pressed:['A'],held:['A']}});
  for(let i=0;i<104;i++)sim.step(1/60,{});
  const originals=sim.state.effects.filter(e=>e.ownerId===a.id&&e.name===MAXIMUM_STRIKE_ORB&&!e.dead);
  assert.equal(originals.length,6,'six orbs must come from the actual equipped skill callback');
  assert.ok(a.sourceAddCombat.maximumStrike);
  const producer=createCombatPlaybackProducer({version:1});
  const born=producer.capture(sim,a.id,{epoch:1,frameSeq:1});
  const live=born.effects.find(e=>e.id===originals[0].id);assert.ok(live);
  const withoutGroup=structuredClone(a);delete withoutGroup.sourceAddCombat.maximumStrike;
  assert.throws(()=>validateMaximumStrikeEffect(live,withoutGroup,profile),/maximum-strike-orb/);

  producer.beforeStep(sim,a.id);sim.drainEvents();
  const before=a.mp;a.hp=0;
  tickMaximumStrike(sim,a,1/60);
  const events=sim.drainEvents(),refund=events.find(e=>e.type==='addMaximumStrikeRefund');
  assert.equal(refund.unused,originals.length);assert.equal(refund.amount,originals.length*25);
  assert.equal(a.mp,Math.fround(Math.min(a.mpMax,before+originals.length*25)));
  assert.equal(a.sourceAddCombat.maximumStrike,undefined);
  const terminal=producer.capture(sim,a.id,{epoch:1,frameSeq:2,events});assert.ok(terminal);
  const ended=terminal.effects.filter(e=>e.name===MAXIMUM_STRIKE_ORB);
  assert.deepEqual(ended.map(e=>e.id).sort((x,y)=>x-y),originals.map(e=>e.id).sort((x,y)=>x-y));
  assert.ok(ended.every(e=>e.dead===true&&e.endEmitted===true&&e.active===false));
  assert.equal(terminal.actor.sourceAddCombat?.maximumStrike,undefined,'no retired controller is recreated to pass validation');
  const report=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:2});report.actions=[terminal];
  const validated=validateOwnedState(report);
  assert.doesNotThrow(()=>validateOwnedReferences(validated,a,profile,addMap,{actors:sim.state.actors,profiles:sim.profiles}));
  for(const e of ended){
    assert.doesNotThrow(()=>validateMaximumStrikeEffect(e,a,profile));
    for(const partial of [{...e,dead:false},{...e,endEmitted:false}])
      assert.throws(()=>validateMaximumStrikeEffect(partial,a,profile),/maximum-strike-orb/);
    const differentGroup=structuredClone(a);
    differentGroup.sourceAddCombat.maximumStrike={group:e.sourceAddMaximumStrike.group+1};
    assert.throws(()=>validateMaximumStrikeEffect(e,differentGroup,profile),/maximum-strike-orb/);
    assert.throws(()=>validateMaximumStrikeEffect(e,{...a,professionId:'MM'},profile),/maximum-strike-orb/);
  }
  assert.equal(producer.capture(sim,a.id,{epoch:1,frameSeq:3}),null,'terminal events are not repeatedly sent');
  assert.equal(producer.diagnostics.liveEffectSignatures,sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&!e.combatRetired).length,
    'the signature cache retains only the real remaining visuals, with no ended orb backlog');
});
