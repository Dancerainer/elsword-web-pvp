/** Web transport contracts, independent of original-client timing evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createOnlineService,validateInputBatch} from '../../packages/online/service.mjs';
import {encodeOwnedState,encodeEffectState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'capacity-contract',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function world(){return createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[
 {id:'sender',team:0,position:[0,0,0],lineId:0},{id:'receiver',team:1,position:[1000,0,0],lineId:0}]});}
function batch(){return {matchId:'room',sequence:1,frames:[{frameSeq:1,held:[]}],
 owner:encodeOwnedState(world(),'sender',{epoch:1,frameSeq:1}),peerReceipts:[{playerId:'other',epoch:1,frameSeq:0}]};}

test('peer receipts are bounded, unique, exact and detached, and cannot appear without an owner report',()=>{
 const source=batch(),verified=validateInputBatch(source);source.peerReceipts[0].frameSeq=99;
 assert.equal(verified.peerReceipts[0].frameSeq,0);
 const invalid=[null,{},Array.from({length:6},(_,i)=>({playerId:String(i),epoch:1,frameSeq:1})),
 [{playerId:'other',epoch:1,frameSeq:0},{playerId:'other',epoch:1,frameSeq:1}],
 [{playerId:'',epoch:1,frameSeq:0}],[{playerId:'other',epoch:-1,frameSeq:0}],
 [{playerId:'other',epoch:1,frameSeq:Infinity}],[{playerId:'other',epoch:1,frameSeq:0,ageMs:0}]];
 for(const peerReceipts of invalid)assert.throws(()=>validateInputBatch({...batch(),peerReceipts}),/invalid-peer-receipts/);
 const noOwner=batch();delete noOwner.owner;assert.throws(()=>validateInputBatch(noOwner),/invalid-peer-receipts/);
 assert.deepEqual(validateInputBatch({...batch(),peerReceipts:[]}).peerReceipts,[]);
});

test('owner encoding excludes unused source collision ledgers without mutating them or erasing receiving victim contacts',()=>{
 const source=world(),receiver=world(),actor=source.actor('sender');
 actor.hits={receiver:12.5};actor.hitGaps={receiver:13};actor.core.hits={receiver:14};actor.core.hitGaps={receiver:15};
 const before=structuredClone({hits:actor.hits,hitGaps:actor.hitGaps,core:actor.core});
 const report=encodeOwnedState(source,'sender',{epoch:1,frameSeq:1,events:[{type:'hit',targetId:'sender',actorId:'receiver',eventId:101,amount:50}]});
 assert.deepEqual(report.actor.hits,{});assert.equal(Object.hasOwn(report.actor,'hitGaps'),false);
 assert.equal(Object.hasOwn(report.actor.core,'hits'),false);assert.equal(Object.hasOwn(report.actor.core,'hitGaps'),false);
 assert.deepEqual({hits:actor.hits,hitGaps:actor.hitGaps,core:actor.core},before);
 assert.deepEqual(report.hits,[{id:101,attackerId:'receiver',damage:50}]);
 const remote=receiver.actor('sender');remote.hits={receiver:21};remote.hitGaps={receiver:22};
 remote.core.hits={receiver:23};remote.core.hitGaps={receiver:24};
 applyOwnedState(receiver,'sender',report);
 assert.deepEqual(remote.hits,{receiver:21});assert.deepEqual(remote.hitGaps,{receiver:22});
 assert.deepEqual(remote.core.hits,{receiver:23});assert.deepEqual(remote.core.hitGaps,{receiver:24});
 const effect={id:1,name:'fixture',ownerId:'sender',hits:{receiver:30},hitGaps:{receiver:31},hitCount:2,elapsed:.5};
 const effectBefore=structuredClone(effect),wire=encodeEffectState(effect,profile);
 assert.deepEqual(effect,effectBefore);assert.equal(Object.hasOwn(wire,'hits'),false);assert.equal(Object.hasOwn(wire,'hitGaps'),false);
 assert.equal(wire.hitCount,2);assert.equal(wire.elapsed,.5);
});

for(const shared of [false,true])test(`room fanout ${shared?'shares a synchronous read-only encoding view':'keeps detached reports by default'}`,async()=>{
 let clock=0,driverEmit;const events=[];
 const service=createOnlineService({versions:{program:'capacity-fixture'},now:()=>clock,random:()=>.5,
  ...(shared?{sharedBroadcasts:true}:{}),emit:(user,type,data)=>events.push({user,type,data}),
  accountStore:{recordMatch:async()=>{}},driverFactory:({emit})=>{driverEmit=emit;return {submitInput(){},stop(){}};}});
 try{
  for(const id of ['a','b','c','d'])await service.join(id,'gm',{loadout:Array(8).fill(null),branchChoices:{},keyBindings:{}});
  clock=11000;await service.tick();events.length=0;
  const payload={playerId:'a',report:{actor:{x:10},effects:[]}};driverEmit('owned-state',payload);
  assert.deepEqual(events.map(e=>e.user).sort(),['b','c','d']);
  for(const row of events){assert.deepEqual(row.data,payload);assert.equal(row.data===payload,shared);}
  if(!shared){events[0].data.report.actor.x=99;assert.equal(events[1].data.report.actor.x,10);assert.equal(payload.report.actor.x,10);}
 }finally{service.close();}
});
