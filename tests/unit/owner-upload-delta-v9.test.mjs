import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {createOnlineSocket} from '../../apps/web/online-socket.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const sim=createSimulation({profile,map:{sceneId:'upload-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
  actors:[{id:'a',team:0,position:[0,0,0]},{id:'b',team:1,position:[1000,0,0]}],seed:2016});
const report=(frameSeq=1,epoch=1)=>encodeOwnedState(sim,'a',{epoch,frameSeq});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function accept(sender,receiver,owner){const carrier=sender.encode(owner),candidate=receiver.decode(carrier);
  assert.deepEqual(candidate.report,owner);candidate.commit();assert.equal(sender.acknowledge(candidate.ownerReceipt),true);return carrier;}

test('confirmed raw pose compresses uploads while exact canonical histories and frontier remain separate',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta(),first=report();first.actions=[encodeCriticalAction(first,{id:1})];
  first.hits=[{id:4,attackerId:'b',damage:10}];assert.equal(accept(sender,receiver,first).pose.full,true);
  const second=report(4);second.actor.x+=10;second.actions=[...first.actions,encodeCriticalAction(second,{id:4})];
  second.hits=[...first.hits,{id:5,attackerId:'b',damage:20}];second.actionFrontierComplete=false;
  const carrier=sender.encode(second),candidate=receiver.decode(carrier);
  assert.equal(carrier.pose.full,false);assert.deepEqual(carrier.actions,second.actions);assert.deepEqual(carrier.hits,second.hits);
  assert.equal(carrier.actionFrontierComplete,false);assert.deepEqual(candidate.report,second);
  assert.ok(JSON.stringify(carrier).length<JSON.stringify(second).length);
  const expected=structuredClone(second);carrier.actions[0].actor.x+=123;carrier.hits[0].damage+=123;
  assert.deepEqual(second,expected,'wire canonical arrays are detached from the producer');
  assert.deepEqual(candidate.report,expected,'validated decoded canonical arrays are detached from the wire');
});

test('server corrections cannot replace the immutable raw baseline',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta(),first=report();first.actor.x=42;
  const candidate=receiver.decode(sender.encode(first));candidate.report.actor.x=999;candidate.report.actor.hp=0;candidate.commit();sender.acknowledge(candidate.ownerReceipt);
  candidate.report.actor.x=1234;
  const next={...structuredClone(first),frameSeq:4};const restored=receiver.decode(sender.encode(next)).report;
  assert.equal(restored.actor.x,42);assert.equal(restored.actor.hp,first.actor.hp);assert.deepEqual(restored,next);
});

test('unacknowledged, replaced and lost uploads never become the next baseline',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta();accept(sender,receiver,report());
  const lost=report(4);lost.actor.x=100;sender.encode(lost);
  const latest=report(7);latest.actor.x=200;const carrier=sender.encode(latest);
  assert.equal(carrier.pose.base,1);assert.deepEqual(receiver.decode(carrier).report,latest);
});

test('decode without accepted commit cannot seed dependent packets',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta(),first=report();const candidate=receiver.decode(sender.encode(first));
  sender.acknowledge(candidate.ownerReceipt);assert.throws(()=>receiver.decode(sender.encode(report(4))),/base/);
});

test('an accepted old-life candidate finishing late cannot reset the new cache, while new old-life decode still rejects',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta();
  const old=receiver.decode(sender.encode(report(3))),next=receiver.decode(sender.encode(report(6,2)));
  assert.equal(next.commit(),true);assert.equal(old.commit(),false);sender.acknowledge(next.ownerReceipt);
  assert.deepEqual(receiver.decode(sender.encode(report(9,2))).report,report(9,2));
  const retired=createOwnerUploadDelta().encode(report(12,1));assert.throws(()=>receiver.decode(retired),/old-life/);
});

test('acknowledgements must identify an encoded current-life clock and reset retires all bases',()=>{
  const sender=createOwnerUploadDelta();assert.equal(sender.acknowledge({epoch:1,frameSeq:1}),false);sender.encode(report());
  for(const receipt of [{epoch:2,frameSeq:1},{epoch:1,frameSeq:99},{epoch:1,frameSeq:1.5},{epoch:1,frameSeq:1,accepted:true}])assert.equal(sender.acknowledge(receipt),false);
  assert.equal(sender.acknowledge({epoch:1,frameSeq:1}),true);assert.equal(sender.acknowledge({epoch:1,frameSeq:1}),false);
  sender.encode(report(7));assert.equal(sender.acknowledge({epoch:1,frameSeq:4}),false,'an unencoded intermediate clock is not delivery proof');
  assert.equal(sender.encode(report(4,2)).pose.full,true);assert.equal(sender.acknowledge({epoch:1,frameSeq:1}),false);
  sender.reset();assert.equal(sender.encode(report(7,2)).pose.full,true);assert.equal(sender.performance().acknowledgedFrame,-1);
});

test('missing optional actions remains missing and an explicit frontier is restored exactly',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta();const first=report();assert.equal(Object.hasOwn(first,'actions'),false);accept(sender,receiver,first);
  const next=report(4);next.actionFrontierComplete=true;const candidate=receiver.decode(sender.encode(next));
  assert.deepEqual(candidate.report,next);assert.equal(Object.hasOwn(candidate.report,'actions'),false);
});

test('unknown carrier fields and malformed canonical identities retain the original validation boundary',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta(),carrier=sender.encode(report());
  assert.throws(()=>receiver.decode({...carrier,approved:true}),/invalid-owner-upload/);
  assert.throws(()=>receiver.decode({...carrier,hits:[{id:-1,attackerId:'b',damage:10}]}),/owner/);
  const action=encodeCriticalAction(report(),{id:1});assert.throws(()=>receiver.decode({...carrier,actions:[{...action,frameSeq:999}]}),/owner/);
  assert.throws(()=>receiver.decode({...carrier,actionFrontierComplete:null}),/invalid-owner-upload/);
});

test('invalid restored large action history cannot bypass the 96 KiB owner limit',()=>{
  const sender=createOwnerUploadDelta(),receiver=createOwnerUploadDelta(),first=report();accept(sender,receiver,first);
  const carrier=sender.encode(report(4)),action=encodeCriticalAction(report(4),{id:1});
  // Shape-valid clocks still cannot authorize a large reconstructed tree.
  action.effects=Array.from({length:96},(_,id)=>({id,name:'large-'+id,fixtureText:'x'.repeat(500),x:0,y:0,z:0}));
  carrier.actions=[action,{...structuredClone(action),id:2}];
  assert.throws(()=>receiver.decode(carrier),/owner-state-too-large/);
});

test('socket explicitly negotiates upload capability and clears it before inactive fallback',async t=>{
  const sockets=[],active=[],inactive=[],tasks=new Map();let serial=0;
  class Socket{constructor(url){this.url=url;this.bufferedAmount=0;sockets.push(this);}send(){}close(){}
    receive(data){this.onmessage?.({data:JSON.stringify(data)});}}
  const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture/api/online/socket?pageInitToken=page-v9#anchor',
    timers:{setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,ms});return id;},clearTimeout(id){tasks.delete(id);}},
    onActive:hello=>active.push({hello,capability:relay.performance().ownerUploadDelta}),onInactive:()=>inactive.push(relay.performance().ownerUploadDelta)});
  t.after(()=>relay.close());relay.open();assert.equal(new URL(sockets[0].url).searchParams.get('ownerUploadDelta'),'1');
  assert.equal(new URL(sockets[0].url).searchParams.get('pageInitToken'),'page-v9');assert.equal(new URL(sockets[0].url).hash,'#anchor');
  assert.equal(relay.performance().ownerUploadDelta,false);sockets[0].receive({type:'transport',data:{connected:true,ownerUploadDelta:1}});await settle();
  assert.equal(active[0].capability,true);relay.fail();assert.deepEqual(inactive,[false]);assert.equal(relay.performance().ownerUploadDelta,false);
});

test('old-server hello keeps full-owner compatibility despite an advertised query',async t=>{
  let socket;class Socket{constructor(){socket=this;this.bufferedAmount=0;}send(){}close(){}}
  const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture'});t.after(()=>relay.close());relay.open();
  socket.onmessage({data:JSON.stringify({type:'transport',data:{connected:true}})});await settle();
  assert.equal(relay.active,true);assert.equal(relay.performance().ownerUploadDelta,false);
});
