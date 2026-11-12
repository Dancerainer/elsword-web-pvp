import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/lp-de-browser-observers-v57.json' with {type:'json'};
import {mergeWorkbenchEvents,findAddZChargeHit,classifyVoidRetirement} from '../../tools/validation/lp-de-browser-observers-v57.mjs';

test('the recorded real normal Z uses its own effect carrier and increases Stasis storage',()=>{
 const input=structuredClone(fixture.charge),before=structuredClone(input),hit=findAddZChargeHit(input,input.params);
 assert.equal(hit.effectId,input.expected.effectId);assert.equal(hit.commandStateSerial,input.expected.commandStateSerial);assert.equal(hit.amount,input.expected.amount);
 assert.equal(input.events.some(e=>e.type==='hit'&&e.origin.kind==='character'),false);
 assert.ok(input.expected.accumulatorAfter>input.expected.accumulatorBefore);assert.deepEqual(input,before);
});
for(const [name,change] of [
 ['unrelated Stasis carrier',x=>{x.events.find(e=>e.type==='effectStarted').name='DamageEffect_SA_APT_Stasis_Field_Attack';}],
 ['foreign caster',x=>{x.events.find(e=>e.type==='effectStarted').actorId='foreign';}],
 ['different recipient',x=>{x.events.find(e=>e.type==='hit').targetId='foreign';}],
 ['stale event floor',x=>{x.params.afterEventId=66;}],
 ['missing newly sampled command serial',x=>{x.samples[0].actors[0].stateSerial=5;}],
 ['missing command transition',x=>{x.events=x.events.filter(e=>e.type!=='stateChanged');}],
 ['nonpositive damage',x=>{x.events.find(e=>e.type==='hit').amount=0;}],
])test('a '+name+' cannot satisfy the requested real Z charge',()=>{
 const input=structuredClone(fixture.charge);change(input);assert.equal(findAddZChargeHit(input,input.params),null);
});
test('a checkpoint merges terminal records without waiting for the next fifty-ms RAF harvest',()=>{
 const x=fixture.timeout,ended=events=>events.filter(e=>e.type==='effectEnded'&&e.reason==='add-stasis-storage-ended').map(e=>e.effectId);
 assert.equal(x.checkpointStorage,null);assert.ok(x.checkpointTime>x.checkpointLastRafSampleTime);
 assert.deepEqual(ended(x.retainedBeforeCheckpoint),[]);
 const merged=mergeWorkbenchEvents(x.retainedBeforeCheckpoint,x.laterRetainedTerminalRecords);
 assert.deepEqual(ended(merged),x.expectedHandles);
 assert.ok(merged.filter(e=>e.type==='effectEnded').every(e=>e.time===x.checkpointTime));
});
test('retained/current event overlap preserves unique chronological identities and leaves input packets untouched',()=>{
 const history=[{eventId:2,type:'second',time:2},{eventId:4,type:'old',time:4}],current=[{eventId:1,type:'first',time:1},{eventId:4,type:'current',time:4},{eventId:5,type:'tail',time:5}],
  frozen=structuredClone({history,current}),merged=mergeWorkbenchEvents(history,current);
 assert.deepEqual(merged.map(e=>e.eventId),[1,2,4,5]);assert.equal(merged[2].type,'current');assert.deepEqual({history,current},frozen);
});
test('the recorded DE carrier legally reaches original LT_TIME7.75 before its independent collapse threshold',()=>{
 const input=structuredClone(fixture.void),before=structuredClone(input),out=classifyVoidRetirement(input);
 assert.equal(out.eventId,input.expected.eventId);assert.equal(out.effectId,input.expected.effectId);assert.equal(out.reason,input.expected.reason);assert.equal(out.route,input.expected.route);
 assert.equal(out.lifeTimeSeconds,input.sourceTemplate.fields.LifeTime);assert.ok(out.clockUpperBound>=out.lifeTimeSeconds);
 assert.ok(input.lastCollapseSamples.at(-1).scale>.001);assert.equal(input.lastCollapseSamples.at(-1).alpha,0);
 assert.ok(input.display.atRetirement.length>0);assert.deepEqual(input.display.later,[]);assert.deepEqual(input,before);
});
for(const [name,change] of [
 ['arbitrary cancellation',x=>{x.events[0].reason='delete-condition';}],
 ['early lifetime report',x=>{x.events[0].time=x.carrierClock.observedAt+.1;}],
 ['unverified source lifetime',x=>{x.carrierClock.templateFields.LifeTime=8;}],
 ['different carrier ID',x=>{x.events[0].effectId=2;}],
 ['foreign field owner',x=>{x.events[0].actorId='foreign';}],
 ['still-live carrier',x=>{x.remainingEffects.push({id:1});}],
])test('Void '+name+' cannot be accepted as a legal source retirement',()=>{
 const input=structuredClone(fixture.void);change(input);assert.equal(classifyVoidRetirement(input),null);
});
test('the existing explicit source collapse reason remains distinct from natural template lifetime',()=>{
 const input=structuredClone(fixture.void);input.events[0].reason='original-void-field-collapse-ended';
 const out=classifyVoidRetirement(input);assert.equal(out.route,'original-collapse-threshold');assert.equal(out.reason,'original-void-field-collapse-ended');
});
