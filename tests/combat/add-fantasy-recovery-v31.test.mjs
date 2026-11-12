import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture} from '../helpers/add-fixture.mjs';
import {addResourceFeedback} from '../../apps/web/add-hud.mjs';
for(const [level,rate]of [[1,.3],[2,.4],[3,.5]])test(`LP Fantasy Tracer level${level} recovers original ${rate*100}% of formation-entry DP as MP exactly once`,()=>{
 const {sim,a,profile}=addFixture('LP',{passives:[29404]});a.mp=0;a.sourceAdd.dp=8000;
 // Production currently equips the original maximum passive rank. Lower
 // authored ranks exercise the value consumer independently of that UI.
 a.passivePolicy.skillLevels[29404]=level;
 const charge=profile.components.USE_DP_BY_FORMATION_MODE;
 // Original32768bf0 refunds the actual payment delta. This frozen product
 // preset independently supplies50% DP consumption reduction, before refund.
 const paid=charge*(1-a.equipmentAttributes.addDpConsumptionReduction);
 assert.equal(sim.tryAwakening(a),true);assert.equal(a.sourceAdd.dp,8000-paid);assert.ok(Math.abs(a.mp-paid*rate/20)<.00001);
 const event=sim.state.events.find(e=>e.type==='addFantasyTracerMpRecovered');assert.ok(event);
 assert.deepEqual(addResourceFeedback(event),{resource:'MP',amount:Math.trunc(paid*rate/20)});
 const before=a.mp;sim.tryAwakening(a);assert.equal(a.mp,before);assert.equal(sim.state.events.filter(e=>e.type==='addFantasyTracerMpRecovered').length,1);
});
test('formation without Fantasy Tracer does not grant passive recovery; resource display uses actual clipped delta',()=>{
 const {sim,a}=addFixture('LP');a.mp=0;a.sourceAdd.dp=8000;assert.equal(sim.tryAwakening(a),true);assert.equal(a.mp,0);
 assert.equal(addResourceFeedback({type:'addForceFingerTransfer',recover:45,restored:0,resource:'DP'}),null);
 assert.deepEqual(addResourceFeedback({type:'addForceFingerTransfer',recover:45,restored:15,resource:'DP'}),{resource:'DP',amount:15});
});
