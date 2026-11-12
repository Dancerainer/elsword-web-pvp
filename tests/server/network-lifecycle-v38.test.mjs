/** Web production-path lifecycle regressions; not native 2016 packet goldens. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';

const versions={reference:'lifecycle-source',preset:'lifecycle-preset',program:'v38'};
const ids=['a','b','c','d'];
const configuration=()=>({loadout:Array(8).fill(null),branchChoices:{}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const resultFor=players=>({winnerTeam:0,reason:'score',score:[4,1],players:players.map(player=>({
  id:player.id,team:player.team,kills:player.team===0?2:0,assists:0,deaths:player.team===0?0:2}))});
async function room(t,{recordMatch,submitInput=()=>({accepted:true}),inputValidation,accountStore={}}={}){
  let clock=0,callbacks;const events=[],snapshot={sequence:12,pvp:{phase:'result',score:[4,1]},snapshot:{actors:[{id:'a',hp:1}]}},stops=[];
  const online=createOnlineService({versions,now:()=>clock,random:()=>.5,
    accountStore:{...accountStore,recordMatch:recordMatch??(async(_,result)=>({recorded:true,result:{...result,finishedAt:clock}}))},
    emit:(username,type,data)=>events.push({username,type,data}),driverFactory:args=>{callbacks=args;
      return {inputValidation,submitInput,snapshot:()=>snapshot,stop:()=>stops.push(true)};}});
  t.after(()=>online.close());for(const id of ids)await online.join(id,'player',configuration());clock=11000;await online.tick();
  return {online,callbacks,events,snapshot,stops,advance:async ms=>{clock+=ms;await online.tick();}};
}

test('first final statistics are frozen before persistence; late worker data and ACK cannot reopen combat',async t=>{
  const saved=deferred(),input=deferred(),writes=[];
  const f=await room(t,{inputValidation:'room-worker-v1',submitInput:()=>input.promise,
    recordMatch:async(match,result)=>{writes.push({matchId:match.id,result});await saved.promise;return {recorded:true,result:{...result,finishedAt:12000}};}});
  const matchId=f.callbacks.match.id,original=resultFor(f.callbacks.match.players);
  const ack=f.online.submitInput('a',{matchId,sequence:0,frames:[{held:['Z'],frameSeq:1}]});
  const rejected=assert.rejects(ack,/match-not-active/);
  const finishing=f.callbacks.finish(original);
  original.score[0]=999;original.players[0].kills=999;
  assert.equal(f.online.status('a').match.status,'settling');
  assert.equal(f.online.status('a').lastResult,null,'statistics are not a committed result ACK');
  const frozen=f.online.matchSnapshot('a');f.snapshot.pvp.phase='fight';f.snapshot.snapshot.actors[0].hp=0;
  frozen.snapshot.actors[0].hp=99;
  assert.equal(f.online.matchSnapshot('a').pvp.phase,'result');assert.equal(f.online.matchSnapshot('a').snapshot.actors[0].hp,1);
  const count=f.events.length;
  for(const type of ['state','input','owned-state','owner-status','room-failed'])f.callbacks.emit(type,{matchId,pvp:{phase:'fight'}});
  assert.equal(f.events.length,count,'queued IPC traffic cannot escape the terminal boundary');
  assert.throws(()=>f.online.submitInput('a',{matchId,sequence:1,frames:[{held:['X']}]}),/match-not-active/);
  input.resolve({accepted:true});await rejected;
  assert.equal(await f.callbacks.finish({...original,winnerTeam:1}),false);
  saved.resolve();assert.equal(await finishing,true);
  assert.deepEqual(writes[0].result.score,[4,1]);assert.notEqual(writes[0].result.players[0].kills,999);
  assert.equal(f.events.filter(event=>event.type==='result').length,4);assert.equal(f.stops.length,1);
});

test('failed write and conflicting terminal retry keep the first statistics and a detached final snapshot',async t=>{
  const writes=[];let attempt=0;
  const f=await room(t,{recordMatch:async(_,result)=>{writes.push(structuredClone(result));if(++attempt===1){result.score[0]=500;throw Error('write-failure');}
    return {recorded:true,result:{...result,finishedAt:12000}};}});
  const original=resultFor(f.callbacks.match.players);assert.equal(await f.callbacks.finish(original),false);
  original.score[0]=700;
  assert.equal(await f.callbacks.finish({...original,winnerTeam:1,score:[0,4]}),true);
  assert.deepEqual(writes.map(row=>row.score),[[4,1],[4,1]]);
  assert.equal(f.online.status('a').lastResult.result.winnerTeam,0);
  await f.advance(10000);assert.equal(writes.length,2);
});

test('committed stats survive return-value mutation, reconnect and process restart without a second award',async t=>{
  const accountRoot=await mkdtemp(path.join(os.tmpdir(),'rf-lifecycle-v38-'));
  t.after(async()=>{assert.ok(path.resolve(accountRoot).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(accountRoot,{recursive:true,force:true});});
  let store=createOnlineAccountStore({accountRoot});await store.initialize(ids.map(username=>({username})));
  const players=ids.map((id,index)=>({id,username:id,team:index<2?0:1})),match={id:'lifecycle-match-v38',players,versions:structuredClone(versions)};
  const result=resultFor(players),recording=store.recordMatch(match,result);
  // These mutations occur before the serialized write callback is entered.
  match.players[0].team=1;match.versions.program='mutated';result.score[0]=999;result.players[0].kills=999;
  const saved=await recording;assert.deepEqual(saved.result.score,[4,1]);assert.equal(saved.result.versions.program,'v38');
  saved.result.score[0]=666;saved.result.players[0].kills=666;
  assert.deepEqual(store.lastResult('a').result.score,[4,1]);assert.equal((await store.summary('a')).wins,1);
  assert.equal(store.lastResult('outsider'),null);
  const recovered=store.lastResult('a');recovered.result.score[0]=555;assert.deepEqual(store.lastResult('a').result.score,[4,1]);
  store=createOnlineAccountStore({accountRoot});await store.initialize(ids.map(username=>({username})));
  const online=createOnlineService({versions,accountStore:store});t.after(()=>online.close());
  const status=online.status('a');assert.equal(status.match,null);assert.equal(status.locked,false);
  assert.equal(status.lastResult.matchId,'lifecycle-match-v38');assert.deepEqual(status.lastResult.result.score,[4,1]);
  const duplicate=await store.recordMatch(match,result);assert.equal(duplicate.recorded,false);assert.deepEqual(duplicate.result.score,[4,1]);
  assert.equal((await store.summary('a')).games,1);assert.equal(online.status('outsider').lastResult,null);
  online.close();assert.equal(online.status('a').lastResult,null,'a retired service cannot publish recovery state');
});

for(const seed of [2016101801,2016101802,2016101803,2016101804,2016101805,2016101806,2016101807,2016101808])
test(`30% lost / duplicated / reordered terminal deliveries recover the same result (seed ${seed})`,async t=>{
  let state=seed>>>0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
  const f=await room(t),result=resultFor(f.callbacks.match.players),matchId=f.callbacks.match.id;
  await f.callbacks.finish(result);
  const delayed=f.events.filter(event=>event.type==='result').flatMap(event=>Array.from({length:1+(random()<.5?1:0)},()=>({
    ...structuredClone(event),arrival:50+Math.floor(random()*1800),lost:random()<.3}))).sort((a,b)=>a.arrival-b.arrival);
  const observed=new Map();for(const packet of delayed)if(!packet.lost)observed.set(packet.username,packet.data);
  // The real service status/reconnect recovery path closes any missed result.
  for(const id of ids){const recovery=f.online.status(id).lastResult;observed.set(id,recovery);
    assert.equal(recovery.matchId,matchId);assert.deepEqual(recovery.result.score,[4,1]);assert.equal(f.online.status(id).locked,false);}
  assert.equal(observed.size,4);assert.equal(await f.callbacks.finish({...result,score:[0,999]}),false);
  assert.equal(f.events.filter(event=>event.type==='result').length,4,'transport duplication never recalculates or republishes the result');
});
