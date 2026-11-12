/** Target2016 static cost/control evidence; source input rather than Web output
 * defines the20-MP query boundary and zero dedicated native226 payment. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {markAddStigma} from '../../packages/combat-core/add-stigma.mjs';
// Keep ordinary regeneration below the independent .001-MP guard distance.
// The input still goes through the real positive-dt actor and commit pipeline.
const dt=1/60000;
for(const formed of [false,true])for(const mp of [19.999,20])test(
 `Stigma actual input ${formed?'formed':'ordinary'} MP${mp}: query20, payment0`,()=>{
 const {sim,a,b}=addFixture('DE',{skillId:29025});
 a.sourceAdd.formation=formed;a.sourceAdd.dp=formed?8000:0;a.mp=mp;
 sim.enter(a,'RSI_WAIT','independent-recast-fixture');a.cooldowns[29025]=8;
 assert.equal(markAddStigma(sim,a,b),true);
 const before={mp:a.mp,dp:a.sourceAdd.dp,mutation:a.sourceAdd.mutation};
 const q=sim.skillAvailability(a.id,0);assert.equal(q.mode,'stigma-return');
 assert.equal(q.mpCost,0);assert.equal(q.addResourcePlan.mpRequirement,20);assert.equal(q.addResourcePlan.dpCost,0);
 assert.equal(q.resourceMpInsufficient,mp<20);assert.equal(q.resourceDpInsufficient,false);
 assert.equal(q.available,mp>=20);if(mp<20)assert.equal(q.reason,'insufficient-mp');
 // Normal input/commit owns the plan. No caller-provided plan enters the cast.
 sim.step(dt,{add:{pressed:['A'],held:['A']}},{snapshot:false});
 const starts=sim.state.events.filter(e=>e.type==='skillStarted'&&e.skillId===29025);
 assert.equal(starts.length,mp>=20?1:0);
 const commits=sim.state.events.filter(e=>e.type==='addSkillResourcesCommitted'&&e.mode==='stigma-return');
 assert.equal(commits.length,mp>=20?1:0);
 if(mp>=20){assert.equal(starts[0].mpCost,0);assert.equal(commits[0].mpCost,0);assert.equal(commits[0].dpCost,0);
  assert.equal(a.state,'ANSI_SA_ADE_REVERSE_STIGMA_RETURN');}
 assert.equal(a.sourceAdd.mutation,before.mutation);
 assert.ok(a.mp>=before.mp,'ordinary recovery is allowed but this return cannot debit MP');
 assert.ok(a.cooldowns[29025]<8&&a.cooldowns[29025]>7.9,'initial cooldown is not restarted');
});
test('unmarked Stigma still uses the original initial-cast MP and formation DP pricing',()=>{
 for(const formed of [false,true]){const {sim,a}=addFixture('DE',{skillId:29025});
  a.sourceAdd.formation=formed;a.sourceAdd.dp=8000;a.mp=330;
  const q=sim.skillAvailability(a.id,0);assert.equal(q.mode,'cast');assert.equal(q.addResourcePlan.mpRequirement,undefined);
  assert.equal(q.mpCost,formed?0:100);assert.equal(q.addResourcePlan.dpCost,formed?1000:0);
 }
});
