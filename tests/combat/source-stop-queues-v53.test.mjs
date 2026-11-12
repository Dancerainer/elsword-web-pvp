import test from 'node:test';
import assert from 'node:assert/strict';
import {requestActorStop,advanceActorStops,resetActorStopCache,validateSourceStopQueues} from '../../packages/combat-core/source-stop-queues-v53.mjs';
const actor=()=>({hitStop:0,worldStop:0});
test('original last short or zero request masks an earlier long request; expired records remain',()=>{
 const a=actor();requestActorStop(a,'hit',.5,'long');requestActorStop(a,'hit',.1,'short');
 assert.equal(a.hitStop,0,'setter appends without updating cache');
 assert.equal(advanceActorStops(a,Math.fround(.1)),Math.fround(.1));
 assert.equal(a.hitStop,0);assert.ok(a.sourceStopQueues.hit[0].remaining>.39);assert.equal(a.sourceStopQueues.hit.length,2);
 requestActorStop(a,'hit',0);assert.equal(advanceActorStops(a,.01),.01);
});
test('User resumes in the same update with the entire delta, both channels must be exhausted',()=>{
 const a=actor();requestActorStop(a,'hit',.05);requestActorStop(a,'world',.1);
 assert.equal(advanceActorStops(a,.075),0);assert.equal(advanceActorStops(a,.075),.075);
});
test('cache reset retains queues; source retirement rechecks the shifted record; capacity keeps last500',()=>{
 const a=actor();requestActorStop(a,'hit',1,'retired');requestActorStop(a,'hit',.1,'retired');requestActorStop(a,'hit',.5,'live');
 resetActorStopCache(a);assert.equal(a.sourceStopQueues.hit.length,3);
 advanceActorStops(a,.01,{sourceRetired:id=>id==='retired'});assert.deepEqual(a.sourceStopQueues.hit.map(row=>row.sourceId),['live']);
 const b=actor();for(let i=0;i<1001;i++)requestActorStop(b,'hit',i/1000);
 advanceActorStops(b,0);assert.equal(b.sourceStopQueues.hit.length,500);assert.equal(b.sourceStopQueues.hit[0].remaining,Math.fround(.501));
});
test('serialized queue restoration preserves subsequent results and malformed requests are rejected',()=>{
 const a=actor();requestActorStop(a,'hit',.3,'a');requestActorStop(a,'world',.2,'b');advanceActorStops(a,.1);
 const b=structuredClone(a);for(const delta of [.05,.1,.2]){assert.equal(advanceActorStops(a,delta),advanceActorStops(b,delta));assert.deepEqual(a,b);}
 assert.equal(validateSourceStopQueues(a.sourceStopQueues),true);
 assert.equal(validateSourceStopQueues({hit:[{remaining:NaN,sourceId:null}],world:[]}),false);
 assert.equal(validateSourceStopQueues({hit:[],world:[],extra:0}),false);
 assert.throws(()=>requestActorStop(a,'hit',Infinity),/invalid-source/);
});

test('replacing a remote STOP channel clears stale requests without erasing the other channel',async()=>{
 const {replaceActorStopProjection}=await import('../../packages/combat-core/source-stop-queues-v53.mjs');
 const a=actor();requestActorStop(a,'hit',.5);requestActorStop(a,'world',.3);advanceActorStops(a,0);
 replaceActorStopProjection(a,'hitStop',0);advanceActorStops(a,.1);
 assert.equal(a.hitStop,0);assert.ok(a.worldStop>.19);
 replaceActorStopProjection(a,'worldStop',.05);assert.equal(a.sourceStopQueues,undefined);
 assert.equal(advanceActorStops(a,.06),.06);assert.equal(a.worldStop,0);
});
