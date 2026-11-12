import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineService} from '../../packages/online/service.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';

function fixture(t,ownership=OWNERSHIP_PROTOCOL){
  let now=0;const matches=[];
  const factory=Object.assign(({match})=>{matches.push(match);return {stop(){},ready(){},submitInput(){return {accepted:true};},snapshot(){return null;}};},{ownership});
  const online=createOnlineService({driverFactory:factory,accountStore:{recordMatch:async()=>({})},versions:{fixture:'v10'},now:()=>now,random:()=>.5});
  t.after(()=>online.close());
  const join=(id,capabilities)=>online.join(id,'player',{loadout:Array(8).fill(null),branchChoices:{}},'2v2',capabilities);
  return {online,matches,join,start:async()=>{now=11000;await online.tick();assert.equal(matches.length,1);assert.ok(online.status('a').match);return matches[0];}};
}

test('continuous aura freezes version 1 only when every selected owner supports it',async t=>{
  const f=fixture(t);
  for(const id of ['a','b','c','d'])await f.join(id,{continuousAuraVersion:1});
  const match=await f.start();assert.equal(match.continuousAuraVersion,1);
  assert.equal(f.online.status('a').match.continuousAuraVersion,1);
  assert.ok(match.players.every(player=>!Object.hasOwn(player,'continuousAuraVersion')),'capability is room metadata, never actor configuration');
});

test('one old client leaves the whole room on the legacy capture path',async t=>{
  const f=fixture(t);
  for(const id of ['a','b','c'])await f.join(id,{continuousAuraVersion:1});
  await f.join('d');const match=await f.start();
  assert.equal(match.continuousAuraVersion,undefined);assert.equal(f.online.status('a').match.continuousAuraVersion,undefined);
});

test('repeated queue requests cannot upgrade an already frozen queue entry',async t=>{
  const f=fixture(t);await f.join('a');await f.join('a',{continuousAuraVersion:1});
  for(const id of ['b','c','d'])await f.join(id,{continuousAuraVersion:1});
  assert.equal((await f.start()).continuousAuraVersion,undefined);
});

test('server-authoritative rooms keep their legacy protocol regardless of client capability',async t=>{
  const f=fixture(t,'server-authoritative');
  for(const id of ['a','b','c','d'])await f.join(id,{continuousAuraVersion:1});
  assert.equal((await f.start()).continuousAuraVersion,undefined);
});

test('unknown versions and capability keys never enter the matchmaking queue',async t=>{
  const f=fixture(t);
  for(const value of [null,[],{continuousAuraVersion:3},{continuousAuraVersion:'1'},{continuousAuraVersion:true},{continuousAuraVersion:1,actor:{hp:1}}]){
    await assert.rejects(f.join('a',value),/invalid-queue-request/);assert.equal(f.online.status('a').queued,false);
  }
  await f.join('a',{continuousAuraVersion:0});assert.equal(f.online.status('a').queued,true);
});
