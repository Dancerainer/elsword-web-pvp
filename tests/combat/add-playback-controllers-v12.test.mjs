/** Production Add controllers with source WASM/value tables and real posed
 * assets. Callback setup is explicit; these are not WAN or client2016 traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {startMaximumStrike,tickMaximumStrike,maximumStrikeAcceptedHit,fireMaximumStrike,endMaximumStrike,
  MAXIMUM_STRIKE_ORB,MAXIMUM_STRIKE_SHOT} from '../../packages/combat-core/add-maximum-strike.mjs';
import {addFantasyTracerAcceptedHit,tickAddFantasyTracer} from '../../packages/combat-core/add-fantasy-tracer.mjs';
function maximum(version){
  const f=originalAddFixture('DE',{skillId:29022,networkOwnerId:'target'});
  f.sim.networkCombatPlaybackVersion=version;f.sim.networkEpochFor=()=>1;
  f.a.skillId=29022;f.a.sourceAdd.formation=true;f.a.sourceAdd.mutation=5;f.a.skillContext={addMutationSpent:2};return f;
}
test('legacy remote MaximumStrike retains its gate; playback starts and advances the real six-orb controller without spending either owner resources',()=>{
  const old=maximum(0);startMaximumStrike(old.sim,old.a);assert.equal(old.a.sourceAddCombat.maximumStrike,undefined);
  const f=maximum(1),beforeTarget=structuredClone(f.b),beforeSource={mp:f.a.mp,add:structuredClone(f.a.sourceAdd)};
  startMaximumStrike(f.sim,f.a);const control=f.a.sourceAddCombat.maximumStrike;
  assert.ok(control);assert.equal(f.sim.state.effects.filter(e=>e.name===MAXIMUM_STRIKE_ORB&&!e.dead).length,6);
  assert.equal(control.remaining,60,'The original consumer changes damage by 10% per mutation point; holding duration stays 60s');
  const lifetime=control.remaining;tickMaximumStrike(f.sim,f.a,.25);assert.ok(control.remaining<lifetime);
  assert.deepEqual(f.b,beforeTarget);assert.deepEqual({mp:f.a.mp,add:f.a.sourceAdd},beforeSource);
});
test('remote MaximumStrike current accepted-contact callback selects a posed shot and local death/expiry never grants a foreign refund',()=>{
  const f=maximum(1);startMaximumStrike(f.sim,f.a);const before=structuredClone(f.b),sourceMp=f.a.mp,sourceDp=f.a.sourceAdd.dp;
  maximumStrikeAcceptedHit(f.sim,f.a,f.b,{NO_DAMAGE:0},{skillId:29027});assert.equal(f.a.sourceAddCombat.maximumStrike.targetId,f.b.id);
  assert.equal(fireMaximumStrike(f.sim,f.a),true);assert.equal(f.sim.state.effects.filter(e=>e.name===MAXIMUM_STRIKE_SHOT&&!e.dead).length,1);
  assert.equal(f.sim.state.effects.filter(e=>e.name===MAXIMUM_STRIKE_ORB&&!e.dead).length,5);
  endMaximumStrike(f.sim,f.a,{refund:true,reason:'test-end'});
  assert.equal(f.a.sourceAddCombat.maximumStrike,undefined);assert.equal(f.a.mp,sourceMp);assert.equal(f.a.sourceAdd.dp,sourceDp);
  assert.deepEqual(f.b,before,'Native controller playback does not itself settle damage/resources');
});
test('recipient-local FantasyTracer records and expires only its own accepted contact intent, while legacy/observation gates still reject it',()=>{
  for(const [version,observation,expected]of [[0,false,false],[1,true,false],[1,false,true]]){
    const f=originalAddFixture('LP',{skillId:29201,passives:[29404],networkOwnerId:'target'});
    f.sim.networkCombatPlaybackVersion=version;f.sim.observationOnly=observation;f.sim.networkEpochFor=()=>1;f.a.sourceAdd.formation=true;
    assert.ok(f.a.passivePolicy.skillLevels[29404]>0);const before=structuredClone(f.b),resources=structuredClone(f.a.sourceAdd);
    assert.equal(addFantasyTracerAcceptedHit(f.sim,f.a,f.b,{USED_SKILL_ID:29201}),expected);
    if(expected){assert.equal(f.a.sourceAddFantasyTracer.targets[0].targetId,f.b.id);tickAddFantasyTracer(f.a,.5);
      assert.ok(f.a.sourceAddFantasyTracer.targets[0].remaining<3);}
    assert.deepEqual(f.a.sourceAdd,resources);assert.deepEqual(f.b,before);
  }
});
