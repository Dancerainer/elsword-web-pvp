import test from 'node:test';
import assert from 'node:assert/strict';
import {appendSourceHitMemory2016,sourceHitMemoryContains2016,tickSourceHitMemory2016} from '../../packages/combat-core/hit-gap-memory.mjs';
import {tickSourceGroupRecords2016,initializeSourceGroupMemory2016,tickEffectGroupHits2016,claimSourceEffectGroupHit2016,claimEffectGroupHit,retireEffectGroupHits} from '../../packages/combat-core/effect-group-damage.mjs';
const f=Math.fround,row=(targetId,remaining)=>({targetId,remaining:f(remaining)});
// Source31f07d10 and target321fb190 have different positive erase algorithms.
// These cases distinguish them; a stable filter or a shared erase-while fails.
test('carrier list swaps last into expired slot and rechecks it with one delta per original record',()=>{
 const rows=[row('expired',.01),row('middle',.3),row('tail',.2)];
 tickSourceHitMemory2016(rows,.1,{repeat:1});
 assert.deepEqual(rows.map(r=>r.targetId),['tail','middle']);
 assert.equal(rows[0].remaining,f(f(.2)-f(.1)));assert.equal(rows[1].remaining,f(f(.3)-f(.1)));
 const both=[row('one',.01),row('two',.02)];tickSourceHitMemory2016(both,.1,{repeat:1});assert.deepEqual(both,[]);
});
test('carrier identity check ignores TTL and cached-valid byte until actual sweep; invalid control does not erase',()=>{
 const rows=[];appendSourceHitMemory2016(rows,'target',0);rows[0].valid=false;
 assert.equal(sourceHitMemoryContains2016(rows,'target'),true);
 assert.equal(sourceHitMemoryContains2016(rows,'target',{resolveTarget:()=>null}),false);assert.equal(rows.length,1);
 tickSourceHitMemory2016(rows,0,{repeat:0});assert.equal(rows.length,1);
 tickSourceHitMemory2016(rows,0,{repeat:1});assert.equal(rows.length,0);
 const nan=[row('unordered',NaN)];tickSourceHitMemory2016(nan,1,{repeat:true});assert.equal(nan.length,1);assert.ok(Number.isNaN(nan[0].remaining));
});
test('target shared list erases by move-left and unconditionally advances, so moved-in record skips this frame',()=>{
 const rows=[row('one',.01),row('two',.02),row('three',.3)];tickSourceGroupRecords2016(rows,.1);
 assert.deepEqual(rows.map(r=>r.targetId),['two','three']);assert.equal(rows[0].remaining,f(.02));assert.equal(rows[1].remaining,f(f(.3)-f(.1)));
 tickSourceGroupRecords2016(rows,.1);assert.deepEqual(rows.map(r=>r.targetId),['three']);assert.equal(rows[0].remaining,f(f(.3)-f(.1)),'second moved record skips the second sweep');
});
test('source shared group claims match owner identity/kind/exact name, append before acceptance, and never tick during lookup',()=>{
 const state={time:0};assert.equal(initializeSourceGroupMemory2016(state).supported,true);
 const input={ownerIdentity:'owner-64',ownerKind:0,targetId:'target',name:'fire',gap:.2};
 assert.equal(claimSourceEffectGroupHit2016(state,input).allowed,true);
 assert.equal(claimSourceEffectGroupHit2016(state,input).allowed,false);
 assert.equal(claimSourceEffectGroupHit2016(state,{...input,name:'different-fire'}).allowed,true);
 assert.equal(claimSourceEffectGroupHit2016(state,{...input,ownerKind:1}).allowed,true);
 state.time=999;retireEffectGroupHits(state);assert.equal(state.effectGroupHits.length,3);
 assert.equal(claimEffectGroupHit(state,{name:'fire',damage:{GROUP_DAMAGE:1}},'owner-64','target',{HIT_GAP:.2}),false);
 assert.equal(state.effectGroupHits[0].remaining,f(.2));
});
test('target delta is independent across participants and rows moved in a target vector do not inherit global interleaving',()=>{
 const state={time:0};initializeSourceGroupMemory2016(state);
 for(const [targetId,name,gap]of [['a','one',.01],['b','other',.3],['a','two',.02],['a','three',.3]])
  claimSourceEffectGroupHit2016(state,{ownerIdentity:'owner',ownerKind:0,targetId,name,gap});
 tickEffectGroupHits2016(state,'a',.1);
 assert.deepEqual(state.effectGroupHits.map(r=>[r.targetId,r.name]),[['b','other'],['a','two'],['a','three']]);
 assert.equal(state.effectGroupHits[0].remaining,f(.3));assert.equal(state.effectGroupHits[1].remaining,f(.02));
 const restored=structuredClone(state);tickEffectGroupHits2016(restored,'a',.1);assert.equal(restored.effectGroupHits[1].name,'three');
 assert.equal(restored.effectGroupHits[1].remaining,f(f(.3)-f(.1)));assert.equal(state.effectGroupHits.length,3);
});
test('source gap zero appends but does not block; source initialization rejects silent migration of wall clocks',()=>{
 const state={time:0};initializeSourceGroupMemory2016(state);
 const input={ownerIdentity:'owner',ownerKind:0,targetId:'target',name:'zero',gap:0};
 assert.equal(claimSourceEffectGroupHit2016(state,input).allowed,true);assert.equal(claimSourceEffectGroupHit2016(state,input).allowed,true);
 assert.equal(state.effectGroupHits.length,2);tickEffectGroupHits2016(state,'target',0);assert.equal(state.effectGroupHits.length,1,'the moved zero record is intentionally skipped');
 tickEffectGroupHits2016(state,'target',0);assert.equal(state.effectGroupHits.length,0);
 assert.equal(initializeSourceGroupMemory2016({effectGroupHits:[{until:1}]}).supported,false);
 assert.equal(claimSourceEffectGroupHit2016({},input).supported,false);
});

test('new target life owns a new vector; old attacker entries remain until their normal sweep',()=>{
 const state={time:0};initializeSourceGroupMemory2016(state);
 const input={ownerIdentity:'owner',ownerKind:0,targetId:'target',name:'one',gap:.01};
 claimSourceEffectGroupHit2016(state,{...input,targetEpoch:1});
 claimSourceEffectGroupHit2016(state,{...input,name:'new-life',gap:.2,targetEpoch:2});
 tickEffectGroupHits2016(state,'target',.1,{targetEpoch:2});
 assert.equal(state.effectGroupHits.length,1);assert.equal(state.effectGroupHits[0].remaining,f(f(.2)-f(.1)));
 state.effectGroupHits=[]; // Independent vector: isolate attacker-life retention.
 claimSourceEffectGroupHit2016(state,{...input,name:'old-attacker',gap:.01,targetEpoch:2,attackerEpoch:1});
 claimSourceEffectGroupHit2016(state,{...input,name:'new-attacker',gap:.2,targetEpoch:2,attackerEpoch:2});
 tickEffectGroupHits2016(state,'target',.1,{targetEpoch:2});
 assert.ok(state.effectGroupHits.some(row=>row.name==='new-attacker'&&row.remaining===f(.2)),'old attacker entries keep original erase/skip order');
});
