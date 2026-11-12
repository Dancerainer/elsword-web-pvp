/** Room-wide Web playback negotiation; not a native wire contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineService} from '../../packages/online/service.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';
const supported={continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1};
function fixture(t,ownership=OWNERSHIP_PROTOCOL){
  let now=0;const matches=[];
  const factory=Object.assign(({match})=>{matches.push(match);return {stop(){},ready(){},submitInput(){return {accepted:true};},snapshot(){return null;}};},{ownership});
  const online=createOnlineService({driverFactory:factory,accountStore:{recordMatch:async()=>({})},versions:{fixture:'playback-v12'},now:()=>now,random:()=>.5});t.after(()=>online.close());
  return {online,join:(id,cap={})=>online.join(id,'player',{loadout:Array(8).fill(null),branchChoices:{}},'2v2',cap),
    start:async()=>{now=11000;await online.tick();assert.equal(matches.length,1);return matches[0];}};
}
test('all four selected owners freeze playback v1 with status v1 and aura v2 in public room metadata',async t=>{
  const f=fixture(t);for(const id of ['a','b','c','d'])await f.join(id,supported);
  const match=await f.start();assert.equal(match.combatPlaybackVersion,1);assert.equal(match.ownerStatusVersion,1);assert.equal(match.continuousAuraVersion,2);
  for(const id of ['a','b','c','d'])assert.equal(f.online.status(id).match.combatPlaybackVersion,1);
  assert.ok(match.players.every(player=>!Object.hasOwn(player,'combatPlaybackVersion')));
});
test('one selected legacy owner freezes the whole room on legacy playback while preserving independent supported status',async t=>{
  const f=fixture(t);for(const [index,id]of ['a','b','c','d'].entries())await f.join(id,index?supported:{continuousAuraVersion:2,ownerStatusVersion:1});
  const match=await f.start();assert.equal(Object.hasOwn(match,'combatPlaybackVersion'),false);assert.equal(match.ownerStatusVersion,1);assert.equal(match.continuousAuraVersion,2);
  for(const id of ['a','b','c','d'])assert.equal(Object.hasOwn(f.online.status(id).match,'combatPlaybackVersion'),false);
});
test('a repeated queue declaration cannot silently upgrade the earlier legacy entry',async t=>{
  const f=fixture(t);await f.join('a');await f.join('a',supported);for(const id of ['b','c','d'])await f.join(id,supported);
  const match=await f.start();assert.equal(Object.hasOwn(match,'combatPlaybackVersion'),false);assert.equal(Object.hasOwn(match,'ownerStatusVersion'),false);
});
test('server-authoritative rooms never adopt the local-playback settlement contract',async t=>{
  const f=fixture(t,'server-authoritative');for(const id of ['a','b','c','d'])await f.join(id,supported);
  const match=await f.start();assert.equal(Object.hasOwn(match,'combatPlaybackVersion'),false);
});
test('playback capability requires exact version and its explicit status/aura dependencies',async t=>{
  const f=fixture(t);for(const cap of [{...supported,combatPlaybackVersion:2},{...supported,combatPlaybackVersion:true},{...supported,combatPlaybackVersion:'1'},
    {combatPlaybackVersion:1},{...supported,ownerStatusVersion:0},{...supported,continuousAuraVersion:1}])await assert.rejects(f.join('a',cap),/invalid-queue-request/);
  await f.join('a',{combatPlaybackVersion:0});assert.equal(f.online.status('a').queued,true);
});
