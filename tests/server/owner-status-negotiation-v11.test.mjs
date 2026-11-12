import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineService} from '../../packages/online/service.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';
function fixture(t,ownership=OWNERSHIP_PROTOCOL){
  let now=0;const matches=[];
  const factory=Object.assign(({match})=>{matches.push(match);return {stop(){},ready(){},submitInput(){return {accepted:true};},snapshot(){return null;}};},{ownership});
  const online=createOnlineService({driverFactory:factory,accountStore:{recordMatch:async()=>({})},versions:{fixture:'v11'},now:()=>now,random:()=>.5});t.after(()=>online.close());
  return {online,join:(id,cap)=>online.join(id,'player',{loadout:Array(8).fill(null),branchChoices:{}},'2v2',cap),
    start:async()=>{now=11000;await online.tick();assert.equal(matches.length,1);return matches[0];}};
}
test('all selected owners independently freeze aura v2 and status v1',async t=>{
  const f=fixture(t);for(const id of ['a','b','c','d'])await f.join(id,{continuousAuraVersion:2,ownerStatusVersion:1});
  const match=await f.start();assert.equal(match.continuousAuraVersion,2);assert.equal(match.ownerStatusVersion,1);
  assert.ok(match.players.every(player=>!Object.hasOwn(player,'ownerStatusVersion')));
});
test('mixed v1/v2 aura selects the supported minimum while status independently remains v1',async t=>{
  const f=fixture(t);for(const [index,id]of ['a','b','c','d'].entries())await f.join(id,{continuousAuraVersion:index===0?1:2,ownerStatusVersion:1});
  const match=await f.start();assert.equal(match.continuousAuraVersion,1);assert.equal(match.ownerStatusVersion,1);
});
test('a status-legacy owner freezes status off without downgrading its independent aura capability',async t=>{
  const f=fixture(t);for(const [index,id]of ['a','b','c','d'].entries())await f.join(id,{continuousAuraVersion:2,...(index?{ownerStatusVersion:1}:{})});
  const match=await f.start();assert.equal(match.continuousAuraVersion,2);assert.equal(Object.hasOwn(match,'ownerStatusVersion'),false);
});
test('repeated queue requests cannot upgrade the first frozen capability entry',async t=>{
  const f=fixture(t);await f.join('a');await f.join('a',{continuousAuraVersion:2,ownerStatusVersion:1});
  for(const id of ['b','c','d'])await f.join(id,{continuousAuraVersion:2,ownerStatusVersion:1});
  const match=await f.start();assert.equal(Object.hasOwn(match,'continuousAuraVersion'),false);assert.equal(Object.hasOwn(match,'ownerStatusVersion'),false);
});
test('authoritative rooms do not adopt either local-owner capability',async t=>{
  const f=fixture(t,'server-authoritative');for(const id of ['a','b','c','d'])await f.join(id,{continuousAuraVersion:2,ownerStatusVersion:1});
  const match=await f.start();assert.equal(Object.hasOwn(match,'continuousAuraVersion'),false);assert.equal(Object.hasOwn(match,'ownerStatusVersion'),false);
});
test('queue capabilities retain exact types and no actor-controlled extra keys',async t=>{
  const f=fixture(t);for(const cap of [{ownerStatusVersion:2},{ownerStatusVersion:true},{ownerStatusVersion:'1'},{continuousAuraVersion:3},{continuousAuraVersion:2,ownerStatusVersion:1,actor:{}}])
    await assert.rejects(f.join('a',cap),/invalid-queue-request/);
  await f.join('a',{ownerStatusVersion:0,continuousAuraVersion:0});assert.equal(f.online.status('a').queued,true);
});
