/** Independent integration review cases. Actual client/codec/stream execute;
 * only transport scheduling and socket I/O are controlled fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createOnlineSocket} from '../../apps/web/online-socket.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {createWebSocketStream} from '../../apps/server/websocket-stream.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
class ManualTimers{
  serial=0;tasks=new Map();
  setTimeout(callback,ms){const id=++this.serial;this.tasks.set(id,{callback,ms});return id;}
  clearTimeout(id){this.tasks.delete(id);}
  run(ms){const row=[...this.tasks].find(([,task])=>task.ms===ms);assert.ok(row,'expected timeout '+ms);this.tasks.delete(row[0]);row[1].callback();}
}
function isolatedSocket(t,{compress,decode}={}){
  const sockets=[],events=[],timers=new ManualTimers();
  class Socket{bufferedAmount=0;sent=[];constructor(){sockets.push(this);}send(bytes){this.sent.push(JSON.parse(new TextDecoder().decode(bytes)));}close(){}message(value){this.onmessage?.({data:new TextEncoder().encode(JSON.stringify(value)).buffer});}}
  const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture',timers,onEvent:(type,data)=>events.push({type,data}),
    compress:compress??(async text=>new TextEncoder().encode(text)),decode:decode??(async bytes=>JSON.parse(new TextDecoder().decode(bytes)))});
  t.after(()=>relay.close());relay.open();return {relay,sockets,events,timers};
}
async function fixture(t){
  const sockets=[],sources=[],events=[],errors=[],posts=[];
  class Source{constructor(){this.listeners=new Map();sources.push(this);queueMicrotask(()=>this.listeners.get('open')?.({type:'open'}));}addEventListener(type,callback){this.listeners.set(type,callback);}close(){}}
  class Socket{bufferedAmount=0;sent=[];constructor(){sockets.push(this);}send(bytes){this.sent.push(JSON.parse(new TextDecoder().decode(bytes)));}close(){}message(value){this.onmessage?.({data:new TextEncoder().encode(JSON.stringify(value)).buffer});}}
  const client=createOnlineClient({EventSource:Source,WebSocket:Socket,RTCPeerConnection:null,
    fetch:async(url,options)=>{if(url==='/api/online/input')posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({available:true,accepted:true})};},onEvent:(type,data)=>events.push({type,data}),onError:error=>errors.push(error),
    socketOptions:{compress:async text=>new TextEncoder().encode(text),decode:async bytes=>JSON.parse(new TextDecoder().decode(bytes))}});
  t.after(()=>client.close());await client.open();sockets[0].message({type:'transport',data:{connected:true}});await settle();
  const match=id=>({id,ownership:'local-owner-v1',players:[{id:'me'},{id:'other'}]});await client.setMatch(match('one'),'me');
  const simulation=await make({passives:[]}),report=encodeOwnedState(simulation,'rf',{epoch:1,frameSeq:60});
  const deliver=async(matchId,value)=>{sources[0].listeners.get('owned-state')({data:JSON.stringify({matchId,...value})});await settle();};
  return {client,events,errors,report,deliver,match,sockets,sources,posts};
}
test('actual SSE downstream registers a full owned baseline before decoding the next replaceable patch',async t=>{
  const f=await fixture(t),server=createOwnedRelayDelta();await f.deliver('one',server.encode('other',f.report).value);
  const next={...f.report,frameSeq:61,actor:{...f.report.actor,x:f.report.actor.x+5}};await f.deliver('one',server.encode('other',next).value);
  const received=f.events.filter(row=>row.type==='peer-owned-state');assert.deepEqual(f.errors,[]);assert.equal(received.length,2);
  assert.equal(received[1].data.report.actor.x,next.actor.x);
});
test('a new room with the same player/life replaces old initial resource baselines before its patches',async t=>{
  const f=await fixture(t),first=createOwnedRelayDelta();await f.deliver('one',first.encode('other',f.report).value);
  await f.client.setMatch(f.match('two'),'me');
  const server=createOwnedRelayDelta(),changed={...f.report,actor:{...f.report.actor,mp:f.report.actor.mp-10}};
  await f.deliver('two',server.encode('other',changed).value);
  const next={...changed,frameSeq:61,actor:{...changed.actor,x:changed.actor.x+5}};await f.deliver('two',server.encode('other',next).value);
  const received=f.events.filter(row=>row.type==='peer-owned-state');assert.deepEqual(f.errors,[]);assert.equal(received.length,3);
  assert.equal(received[2].data.report.actor.mp,changed.actor.mp);assert.equal(received[2].data.report.actor.x,next.actor.x);
});
test('refreshing the same room preserves an already reliable baseline for subsequent patches',async t=>{
  const f=await fixture(t),server=createOwnedRelayDelta();await f.deliver('one',server.encode('other',f.report).value);
  await f.client.setMatch(f.match('one'),'me');const next={...f.report,frameSeq:61,actor:{...f.report.actor,x:f.report.actor.x+5}};
  await f.deliver('one',server.encode('other',next).value);assert.deepEqual(f.errors,[]);assert.equal(f.events.filter(row=>row.type==='peer-owned-state').length,2);
});
test('an old in-flight SSE snapshot cannot erase the current downstream room baseline',async t=>{
  const f=await fixture(t);await f.client.setMatch(f.match('two'),'me');
  const state=(matchId,actors)=>({matchId,ownership:{mode:'local-owner-v1',actors:{other:{epoch:1,frameSeq:60}}},snapshot:{actors},snapshotDelta:true});
  const full=state('two',[{id:'other',x:25,stats:{animationSpeedMultiplier:1.2}}]);
  f.sources[0].listeners.get('state')({data:JSON.stringify(full)});await settle();
  f.sources[0].listeners.get('state')({data:JSON.stringify({...state('one',[{id:'other',x:10,stats:{animationSpeedMultiplier:1}}]),snapshotDelta:false})});
  f.sources[0].listeners.get('state')({data:JSON.stringify(state('two',[{id:'other',pvpDead:false}]))});await settle();
  assert.deepEqual(f.errors,[]);const states=f.events.filter(row=>row.type==='state');assert.equal(states.length,2);
  assert.equal(states[1].data.matchId,'two');assert.equal(states[1].data.snapshot.actors[0].stats.animationSpeedMultiplier,1.2);
});
test('a prior life acknowledgement cannot delete a new life hit identity',async t=>{
  const f=await fixture(t),input={held:['Z'],pressed:['Z'],released:[]};
  // Only the client receipt ledger is exercised here; server validation of the
  // report remains in its own ownership contract tests.
  f.client.send(input,{...f.report,hits:[{id:7,attackerId:'other',damage:10}]});await settle();
  const first=f.sockets[0].sent.at(-1);assert.equal(f.client.performance().pendingHits,1);
  f.client.send(input,{...f.report,epoch:2,hits:[{id:7,attackerId:'other',damage:20}]});await settle();
  const second=f.sockets[0].sent.at(-1);
  f.sockets[0].message({type:'ack',data:{sequence:first.sequence,matchId:'one',accepted:true}});await settle();
  assert.equal(f.client.performance().pendingHits,1);
  f.sockets[0].message({type:'ack',data:{sequence:second.sequence,matchId:'different-room',accepted:true}});await settle();
  assert.equal(f.client.performance().pendingHits,1);
  f.sockets[0].message({type:'ack',data:{sequence:second.sequence,matchId:'one',accepted:true}});await settle();
  assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});
test('short socket loss resubmits unacknowledged hits and action receipts through HTTP',async t=>{
  const f=await fixture(t),input={held:['Z'],pressed:['Z'],released:[]};
  f.client.send(input,{...f.report,hits:[{id:7,attackerId:'other',damage:10}],actions:[{id:11,ageFrames:0,state:'STAND_COMBO_Z1'}]});await settle();
  assert.equal(f.client.performance().pendingHits,1);assert.equal(f.client.performance().pendingActions,1);
  f.sockets[0].onclose();await settle();
  assert.equal(f.posts.length,1);assert.deepEqual(f.posts[0].owner.hits.map(hit=>hit.id),[7]);assert.deepEqual(f.posts[0].owner.actions.map(action=>action.id),[11]);
  assert.equal(f.client.performance().pendingHits,0);assert.equal(f.client.performance().pendingActions,0);assert.deepEqual(f.errors,[]);
});
test('old asynchronous decoding cannot deliver into a replacement connection',async t=>{
  const gate=deferred(),f=isolatedSocket(t,{decode:async bytes=>{const value=JSON.parse(new TextDecoder().decode(bytes));return value.slow?gate.promise:value;}});
  f.sockets[0].message({type:'transport',data:{connected:true}});await settle();
  f.sockets[0].message({slow:true});f.relay.fail();f.timers.run(1000);
  f.sockets[1].message({type:'transport',data:{connected:true}});
  gate.resolve({type:'event',event:'state',data:{matchId:'retired'}});await settle();
  assert.equal(f.relay.active,true);assert.deepEqual(f.events,[]);assert.equal(f.relay.performance().decodePending,0);
});
test('old asynchronous compression cannot block or send through a replacement connection',async t=>{
  const gate=deferred();let first=true;const f=isolatedSocket(t,{compress:async text=>{if(first){first=false;return gate.promise;}return new TextEncoder().encode(text);}});
  f.sockets[0].message({type:'transport',data:{connected:true}});await settle();f.relay.send({sequence:1});
  f.relay.fail();f.timers.run(1000);f.sockets[1].message({type:'transport',data:{connected:true}});await settle();
  f.relay.send({sequence:2});await settle();assert.deepEqual(f.sockets[1].sent,[{sequence:2}]);
  gate.resolve(new TextEncoder().encode(JSON.stringify({sequence:1})));await settle();
  assert.deepEqual(f.sockets[0].sent,[]);assert.deepEqual(f.sockets[1].sent,[{sequence:2}]);assert.equal(f.relay.performance().pending,false);
});
test('continuously replaced movement cannot renew the age of a stalled socket write',t=>{
  class Socket extends EventEmitter{writableLength=0;writableNeedDrain=false;destroyed=false;
    write(data){this.writableLength+=data.length;this.writableNeedDrain=true;return false;}
    end(){this.emit('close');}destroy(){this.destroyed=true;this.emit('close');}}
  const socket=new Socket();let now=0;const stream=createWebSocketStream(socket,{clock:()=>now,maximumQueueAgeMs:1000});t.after(()=>stream.destroy());
  stream.sendJson({frame:0},{replaceKey:'owner:a'});
  for(let frame=1;frame<=20&&!socket.destroyed;frame++){now=frame*100;stream.sendJson({frame},{replaceKey:'owner:a'});}
  assert.equal(socket.destroyed,true,'the original write remains stalled even while newest rows replace each other');
});
test('new effect birth full rows preserve the same original actor baseline at both codec ends',()=>{
  // This isolated codec case deliberately has no combat/ownership fixture:
  // only the transport's clone/difference/baseline contract is under test.
  const producer=createOwnedRelayDelta(),consumer=createOwnedRelayDelta();
  const initial={protocol:'local-owner-v1',epoch:1,frameSeq:1,actor:{mp:10,x:0,state:'WAIT',animationSpeedOverride:1.2},effects:[],hits:[]};
  const reports=[initial,
    {...initial,frameSeq:2,actor:{...initial.actor,mp:20,state:'ATTACK',animationSpeedOverride:1.4},effects:[{id:1,name:'first',elapsed:0}]},
    {...initial,frameSeq:3,actor:{...initial.actor,mp:30,state:'HIT'},effects:[{id:1,name:'first',elapsed:.1},{id:2,name:'second',elapsed:0}]},
    {...initial,frameSeq:4,actor:{mp:10,x:1,state:'WAIT'},effects:[{id:2,name:'second',elapsed:.1}]}];
  const full=[];for(const report of reports){const row=producer.encode('other',report);full.push(row.value.full);assert.deepEqual(consumer.decode(row.value),report);}
  assert.deepEqual(full,[true,true,true,false]);
});
test('retired effect birth baselines remain bounded while the newest live baseline still decodes',()=>{
  const producer=createOwnedRelayDelta(),consumer=createOwnedRelayDelta();
  let report;for(let id=1;id<=1000;id++){
    report={protocol:'local-owner-v1',epoch:1,frameSeq:id,actor:{mp:10,x:id},effects:[{id,name:'living',elapsed:0}],hits:[]};
    const row=producer.encode('other',report);assert.equal(row.value.full,true);assert.deepEqual(consumer.decode(row.value),report);
    assert.ok(producer.baselineCount<=513);assert.ok(consumer.baselineCount<=513);
  }
  const next={...report,frameSeq:1001,actor:{mp:10,x:1001},effects:[{id:1000,name:'living',elapsed:.1}]};
  const row=producer.encode('other',next);assert.equal(row.value.full,false);assert.deepEqual(consumer.decode(row.value),next);
  assert.equal(producer.baselineCount,513);assert.equal(consumer.baselineCount,513);
});
