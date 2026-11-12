import test from 'node:test';import assert from 'node:assert/strict';
import {commonRecoveryFixture} from '../helpers/common-charge-standup-v8-fixture.mjs';
import {preparePracticeTarget,restorePracticeResources,PRACTICE_TARGET_HP} from '../../apps/web/practice-resources.mjs';
for(const c of ['RF','LK','VC','RS','BM','IS'])test(`${c} practice target survives buff stat refresh at exact user HP and resources recover without resetting battle state`,async()=>{
 const {sim,a,b}=await commonRecoveryFixture(c),ownHp=a.hpMax;preparePracticeTarget(sim);
 assert.equal(b.hpMax,PRACTICE_TARGET_HP);assert.equal(a.hpMax,ownHp);
 sim.step(1/60,{});assert.equal(b.hpMax,9999999);assert.equal(b.hp,9999999);
 a.mp=0;b.mp=1;a.cooldowns={21000:12,24600:180};b.cooldowns={21000:10};b.hp-=100;
 const time=sim.state.time,state=a.state,serial=a.stateSerial;restorePracticeResources(sim);
 assert.equal(a.mp,a.mpMax);assert.equal(b.mp,b.mpMax);assert.ok([...Object.values(a.cooldowns),...Object.values(b.cooldowns)].every(n=>n===0));
 assert.equal(sim.state.time,time);assert.equal(a.state,state);assert.equal(a.stateSerial,serial);assert.equal(b.hp,9999899);
 const snapshot=JSON.parse(JSON.stringify(sim.snapshot()));sim.restore(snapshot);sim.step(1/60,{});assert.equal(b.hpMax,9999999);
});
