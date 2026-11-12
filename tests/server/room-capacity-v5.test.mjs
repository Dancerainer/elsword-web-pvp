import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineService} from '../../packages/online/service.mjs';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';

const configuration={loadout:Array(8).fill(null),branchChoices:{}};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({factory,recordMatch}={}){
  let clock=0;const rooms=[],events=[],records=[];
  const driverFactory=async args=>{
    const driver=await(factory?.(args)??{submitInput:()=>({accepted:true}),stop(){this.stopped=true;},ready:()=>({ok:true})});
    rooms.push({...args,driver});return driver;
  };
  driverFactory.ownership=OWNERSHIP_PROTOCOL;
  const online=createOnlineService({driverFactory,versions:{},now:()=>clock,random:()=>.5,
    roomCapacity:{maxActivePlayers:12,maxActiveRooms:3},emit:(username,type,data)=>events.push({username,type,data}),
    accountStore:{recordMatch:async(match,result)=>{records.push(match.id);return recordMatch?recordMatch(match,result):{recorded:true,result:{...result,finishedAt:clock}};}}});
  return {online,rooms,events,records,
    async join(prefix,count,mode){for(let index=0;index<count;index++)await online.join(`${prefix}${index}`,'player',configuration,mode);},
    async advance(ms=20000){clock+=ms;await online.tick();},
  };
}
test('two six-player rooms reserve12 seats; capacity waits preserve queue age and release only after result persistence',async t=>{
  const save=deferred(),f=fixture({recordMatch:()=>save.promise});t.after(()=>f.online.close());
  await f.join('a',18,'3v3');await f.advance();await f.advance();await f.advance();
  assert.equal(f.rooms.length,2);const waiting=Array.from({length:18},(_,i)=>`a${i}`).find(id=>f.online.status(id).queued);
  const before=f.online.status(waiting);assert.equal(before.queue.size,6);assert.equal(before.roomCapacity.waitingForCapacity,true);
  assert.equal(before.roomCapacity.activePlayers,12);assert.equal(before.queue.remainingSeconds,0);
  const settling=f.rooms[0].finish({winnerTeam:0,score:[6,0],players:[]});await f.advance();
  assert.equal(f.rooms.length,2);assert.equal(f.online.status(waiting).roomCapacity.activePlayers,12);
  save.resolve({recorded:true,result:{finishedAt:60000,winnerTeam:0,score:[6,0],players:[]}});await settling;await f.advance(0);
  assert.equal(f.rooms.length,3);assert.equal(f.online.status(waiting).queued,false);assert.equal(f.records.length,1);
  assert.equal(f.online.status(waiting).roomCapacity.activePlayers,12);
});
test('three four-player rooms fill12 seats; a fourth stays queued and worker failure releases only its own room without fake result',async t=>{
  const f=fixture();t.after(()=>f.online.close());await f.join('p',16,'2v2');
  for(let n=0;n<4;n++)await f.advance();assert.equal(f.rooms.length,3);
  const ids=new Set(f.rooms[0].match.players.map(row=>row.id)),survivor=f.rooms[1].match.players[0].id;
  f.rooms[0].emit('room-failed',{error:'room-worker-unavailable',cause:'room-worker-request-timeout',detail:'private-worker-diagnostic'});assert.equal(f.records.length,0);
  for(const id of ids){assert.equal(f.online.hasMatch(id),false);assert.equal(f.online.status(id).lastResult,null);}
  assert.doesNotMatch(JSON.stringify(f.events),/room-worker-request-timeout|private-worker-diagnostic/,'private worker cause is not forwarded in public events');
  assert.equal(f.online.hasMatch(survivor),true);await f.advance(0);assert.equal(f.rooms.length,4);
  assert.equal(f.online.status(survivor).roomCapacity.activeRooms,3);
});
test('failed asynchronous creation releases reservation and restores original queued players',async t=>{
  let attempts=0;const f=fixture({factory:()=>{if(++attempts===1)throw Error('failed-start');return {submitInput(){},stop(){}};}});
  t.after(()=>f.online.close());await f.join('r',6,'3v3');await f.advance();
  assert.equal(f.online.status('r0').roomCapacity.activePlayers,0);assert.equal(f.online.status('r0').queue.size,6);
  await f.advance(12000);assert.equal(f.rooms.length,1);assert.equal(f.online.status('r0').roomCapacity.activePlayers,6);
});
test('async owner requests reserve sequence before acknowledgement and cannot advance a retired match',async t=>{
  const requests=[],f=fixture({factory:()=>({ownership:OWNERSHIP_PROTOCOL,inputValidation:'room-worker-v1',
    submitInput(id,batch){const pending=deferred();requests.push({id,batch,...pending});return pending.promise;},stop(){}})});
  t.after(()=>f.online.close());await f.join('i',4,'2v2');await f.advance();const matchId=f.rooms[0].match.id;
  const body=sequence=>({matchId,sequence,frames:[{held:[],frameSeq:sequence}]});
  const a=f.online.submitInput('i0',body(0));assert.throws(()=>f.online.submitInput('i0',body(0)),/input-sequence-rejected/);
  const b=f.online.submitInput('i0',body(1));requests[0].resolve({accepted:true});assert.deepEqual(await a,{accepted:true,sequence:0});
  requests[1].resolve({accepted:true});assert.deepEqual(await b,{accepted:true,sequence:1});
  const c=f.online.submitInput('i0',body(2));f.online.disconnect('i0');requests[2].resolve({accepted:true});await assert.rejects(c,/match-not-active/);
});
test('capacity settings reject zero, fractional and missing limits',()=>{
  for(const roomCapacity of [{maxActivePlayers:0,maxActiveRooms:3},{maxActivePlayers:12,maxActiveRooms:1.5},{maxActivePlayers:12}])
    assert.throws(()=>createOnlineService({accountStore:{},versions:{},roomCapacity}),/invalid-room-capacity/);
});
test('relay replacements during child startup retain only the newest binding and install it before match publication',async t=>{
  const created=deferred(),entered=deferred(),bindings=[];
  const f=fixture({factory:()=>{entered.resolve();return created.promise;}});t.after(()=>f.online.close());
  await f.join('g',4,'2v2');const starting=f.advance();await entered.promise;
  f.online.bindRelay('g0',{generation:2,token:'old'});f.online.bindRelay('g0',{generation:3,token:'new'});
  f.online.bindRelay('g1',{generation:1,token:'gone'});f.online.bindRelay('g1',null);
  created.resolve({submitInput(){},stop(){},bindRelay:(...args)=>bindings.push(args)});await starting;
  assert.deepEqual(bindings,[['g0',{generation:3,token:'new'}],['g1',null]]);
});
