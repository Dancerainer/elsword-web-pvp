import test from 'node:test';
import assert from 'node:assert/strict';
import {makeArc} from '../helpers/archenemy-v17-fixture.mjs';

test('native Archenemy release after returning idle preserves skill and selected trait instead of the trigger action',async()=>{
 const sim=await makeArc(1),a=sim.actor('rf'),target=sim.actor('target');
 sim.configureLoadout([{skillId:24008,branchId:'memo-61'},...Array(7).fill(null)],a.id);
 sim.step(1/60,{pressed:['A']});for(let i=0;i<240;i++)sim.step(1/60,{});
 assert.equal(a.skillId,null);assert.equal(a.sourceArcEnemy.data.length,4);
 const waiting=sim.state.effects.filter(e=>e.sourceArcHandle&&e.damage);
 assert.equal(waiting.length,4);assert.ok(waiting.every(e=>e.damage.ATTACK_TIME_END===0));
 sim.acceptedSkillHit(a,target,{REACT_TYPE:1,ATTACK_TYPE:0},{kind:'character',skillId:null,impactPoint:[target.x,target.y,target.z]});
 const released=waiting.filter(e=>e.sourceArcLockOnUnitUID===2&&e.damage.ATTACK_TIME_END===9999);
 assert.ok(released.length>0,'compiled Raven callback must issue at least one damage release');
 for(const e of released){assert.equal(e.skillId,24008);assert.equal(e.traitPolicy.branchId,'memo-61');assert.equal(e.traitPolicy.targetMpBurn,10);}
 const other=await makeArc(1);other.configureLoadout([{skillId:24008,branchId:'memo-61'},...Array(7).fill(null)],'rf');
 other.restore(JSON.parse(JSON.stringify(sim.snapshot())));
 assert.deepEqual(JSON.parse(JSON.stringify(other.snapshot())),JSON.parse(JSON.stringify(sim.snapshot())));
});
