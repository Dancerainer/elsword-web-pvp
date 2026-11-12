import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/mm-browser-observers-v57.json' with {type:'json'};
import {mergeWorkbenchEvents} from '../../tools/validation/lp-de-browser-observers-v57.mjs';
import {findGeneratorMarkEvidence,followerTraceSequences,findFollowerTraceMovement} from '../../tools/validation/mm-browser-observers-v57.mjs';

test('the actual marked checkpoint precedes the RAF harvest of its acquired-mark and positive hit events',()=>{
 const x=fixture.mark;
 assert.ok(x.checkpointTime>x.checkpointLastRafSampleTime);assert.equal(x.checkpointMark.targetId,x.params.targetId);
 assert.equal(findGeneratorMarkEvidence(x.retainedBeforeCheckpoint,x.params),null);
 const merged=mergeWorkbenchEvents(x.retainedBeforeCheckpoint,x.laterRetainedTerminalRecords),found=findGeneratorMarkEvidence(merged,x.params);
 assert.equal(found.fire.eventId,x.expected.fireEventId);assert.equal(found.mark.eventId,x.expected.markEventId);assert.equal(found.hit.eventId,x.expected.positiveHitEventId);
 assert.ok(x.laterRetainedTerminalRecords.every(e=>e.time<=x.checkpointTime));
});
for(const [name,change] of [
 ['only the earlier selection hit',events=>events.filter(e=>e.type!=='hit'||e.eventId<47)],
 ['a foreign acquired-mark recipient',events=>events.map(e=>e.type==='addDroneMarkAcquired'?{...e,targetId:'foreign'}:e)],
 ['a different skill hit',events=>events.map(e=>e.type==='hit'&&e.eventId>47?{...e,origin:{...e.origin,skillId:29210}}:e)],
 ['zero damage after firing',events=>events.map(e=>e.type==='hit'&&e.eventId>47?{...e,amount:0}:e)],
])test(name+' cannot substitute for this firing contact',()=>{
 const x=fixture.mark,events=mergeWorkbenchEvents(x.retainedBeforeCheckpoint,x.laterRetainedTerminalRecords);
 assert.equal(findGeneratorMarkEvidence(change(events),x.params),null);
});

test('the actual source TRACE sequence lacks a passive parent id, but its same emitter and main model follow the selected factory',()=>{
 const x=fixture.follower,before=followerTraceSequences(x.before.sequences,x.entries),after=followerTraceSequences(x.after.sequences,x.entries),
  found=findFollowerTraceMovement(before,after,{deltaX:x.after.anchor.position[0]-x.before.anchor.position[0]});
 assert.equal(found.sequenceId,x.expected.traceSequenceId);assert.equal(found.name,x.expected.traceName);assert.equal(found.deltaX,x.expected.anchorDeltaX);
 assert.equal(before.find(e=>e.id===found.sequenceId).effectParentId,undefined);
 assert.ok(Math.abs(x.after.ownerX-x.before.ownerX)>20);
 const b=x.before.mainModels.find(s=>s.effectParentId===x.effectId),a=x.after.mainModels.find(s=>s.effectParentId===x.effectId);
 assert.ok(b&&a);assert.ok(b.meshes.some(m=>a.meshes.some(n=>n.name===m.name&&Math.abs(n.world[12]-m.world[12])>.2)));
});
for(const [name,change] of [
 ['replacement emitter identities',after=>after.map(e=>({...e,id:e.id+1000}))],
 ['foreign sequence names',after=>after.map(e=>({...e,name:'foreign'}))],
 ['a stationary original emitter',(_,before)=>structuredClone(before)],
 ['movement in the opposite direction',(_,before)=>before.map(e=>({...e,position:[e.position[0]+100,...e.position.slice(1)]}))],
])test(name+' cannot satisfy the same-sequence following proof',()=>{
 const x=fixture.follower,before=followerTraceSequences(x.before.sequences,x.entries),after=followerTraceSequences(x.after.sequences,x.entries);
 assert.equal(findFollowerTraceMovement(before,change(after,before),{deltaX:x.expected.anchorDeltaX}),null);
});
test('source names without original TRACE or TRACE_MORE do not qualify as a follower attachment',()=>{
 const x=fixture.follower,entries=x.entries.map(e=>({...e,TRACE:0,TRACE_MORE:0}));
 assert.deepEqual(followerTraceSequences(x.before.sequences,entries),[]);
});
test('evidence adapters leave the actual projected packets untouched',()=>{
 const before=structuredClone(fixture),x=fixture.follower;
 findGeneratorMarkEvidence(mergeWorkbenchEvents(fixture.mark.retainedBeforeCheckpoint,fixture.mark.laterRetainedTerminalRecords),fixture.mark.params);
 findFollowerTraceMovement(followerTraceSequences(x.before.sequences,x.entries),followerTraceSequences(x.after.sequences,x.entries),{deltaX:x.expected.anchorDeltaX});
 assert.deepEqual(fixture,before);
});
