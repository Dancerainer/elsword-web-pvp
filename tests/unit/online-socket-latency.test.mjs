import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineSocket} from '../../apps/web/online-socket.mjs';

const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function fixture(t,{compress,decode}={}){
 let now=0,serial=0;const tasks=new Map(),sockets=[],events=[],inactive=[];
 const timers={setTimeout(callback,ms){const id=++serial;tasks.set(id,{callback,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}};
 class Socket{
  bufferedAmount=0;sent=[];
  constructor(){sockets.push(this);}
  send(value){this.sent.push(JSON.parse(new TextDecoder().decode(value)));}
  close(){this.closed=true;}
  message(value){this.onmessage?.({data:bytes(value).buffer});}
 }
 const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture',timers,clock:()=>now,
  compress:compress??(async text=>new TextEncoder().encode(text)),decode:decode??(async data=>JSON.parse(new TextDecoder().decode(data))),
  onInactive:()=>inactive.push(now),onEvent:(type,data)=>events.push({type,data})});
 t.after(()=>relay.close());relay.open();
 async function advance(ms){const end=now+ms;while(true){const due=[...tasks].filter(([,row])=>row.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
  if(!due)break;now=due[1].at;tasks.delete(due[0]);due[1].callback();await settle();}now=end;await settle();}
 return {relay,sockets,events,inactive,tasks,advance,async activate(){sockets.at(-1).message({type:'transport',data:{connected:true}});await settle();}};
}

test('continuous 20 Hz reports still transmit when each compression takes 75 ms',async t=>{
 const jobs=[],receipts=[],superseded=[];
 const f=fixture(t,{compress:text=>{const gate=deferred();jobs.push({gate,text});return gate.promise;}});await f.activate();
 f.relay.send({sequence:0},{onSent:()=>receipts.push(0),onSuperseded:()=>superseded.push(0)});
 for(let elapsed=25;elapsed<=1500;elapsed+=25){
  await f.advance(25);
  if(elapsed%50===0){const sequence=elapsed/50;f.relay.send({sequence},{onSent:()=>receipts.push(sequence),onSuperseded:()=>superseded.push(sequence)});}
  if(elapsed%75===0){const job=jobs[elapsed/75-1];assert.ok(job);job.gate.resolve(new TextEncoder().encode(job.text));await settle();}
 }
 assert.equal(f.sockets[0].sent.length,20,'a completed packet cannot be perpetually discarded merely because a newer sample arrived');
 const expected=[0,1,3,4,6,7,9,10,12,13,15,16,18,19,21,22,24,25,27,28];
 assert.deepEqual(f.sockets[0].sent.map(row=>row.sequence),expected);assert.deepEqual(receipts,expected);
 assert.deepEqual(superseded,[2,5,8,11,14,17,20,23,26,29]);assert.equal(f.relay.performance().maximumCompressionMs,75);
});

test('a never-resolving retired compression cannot block replacement connection uploads',async t=>{
 const old=deferred();let first=true;const f=fixture(t,{compress:async text=>{if(first){first=false;return old.promise;}return new TextEncoder().encode(text);}});
 await f.activate();f.relay.send({sequence:1});f.relay.fail();await f.advance(1000);await f.activate();f.relay.send({sequence:2});await settle();
 assert.deepEqual(f.sockets[1].sent,[{sequence:2}]);assert.deepEqual(f.sockets[0].sent,[]);
 old.resolve(bytes({sequence:1}));await settle();assert.deepEqual(f.sockets[1].sent,[{sequence:2}]);
});

test('a never-resolving retired decode cannot block replacement connection handshake',async t=>{
 const old=deferred();const f=fixture(t,{decode:async data=>{const value=JSON.parse(new TextDecoder().decode(data));return value.slow?old.promise:value;}});
 await f.activate();f.sockets[0].message({slow:true});f.relay.fail();await f.advance(1000);await f.activate();
 assert.equal(f.relay.active,true);f.relay.send({sequence:2});await settle();assert.deepEqual(f.sockets[1].sent,[{sequence:2}]);
 old.resolve({type:'event',event:'state',data:{matchId:'old'}});await settle();assert.deepEqual(f.events,[]);
});

test('clearing a match invalidates its active compression and immediately allows the next match',async t=>{
 const old=deferred(),superseded=[];let first=true;const f=fixture(t,{compress:async text=>{if(first){first=false;return old.promise;}return new TextEncoder().encode(text);}});
 await f.activate();f.relay.send({matchId:'old'},{onSuperseded:()=>superseded.push('old')});f.relay.clearPending();
 f.relay.send({matchId:'new'});await settle();assert.deepEqual(f.sockets[0].sent,[{matchId:'new'}]);assert.deepEqual(superseded,['old']);
 old.resolve(bytes({matchId:'old'}));await settle();assert.deepEqual(f.sockets[0].sent,[{matchId:'new'}]);assert.deepEqual(superseded,['old']);
});

test('hung compression retires the transport so coordinator can use its HTTP fallback',async t=>{
 const f=fixture(t,{compress:()=>new Promise(()=>{})});await f.activate();f.relay.send({sequence:1});await f.advance(1000);
 assert.equal(f.relay.active,false);assert.deepEqual(f.inactive,[1000]);assert.equal(f.relay.performance().lastFailure,'compression-timeout');
});

test('hung decoding retires the transport without waiting for another inbound message',async t=>{
 const f=fixture(t,{decode:async data=>{const value=JSON.parse(new TextDecoder().decode(data));return value.slow?new Promise(()=>{}):value;}});
 await f.activate();f.sockets[0].message({slow:true});await f.advance(1000);
 assert.equal(f.relay.active,false);assert.deepEqual(f.inactive,[1000]);assert.equal(f.relay.performance().lastFailure,'decode-timeout');
});

test('continuously replaced unsent movement cannot keep a stalled browser output alive',async t=>{
 const f=fixture(t);await f.activate();f.sockets[0].bufferedAmount=32769;f.relay.send({sequence:0});
 for(let sequence=1;sequence<=20;sequence++){await f.advance(50);f.relay.send({sequence});}
 assert.equal(f.relay.active,false);assert.deepEqual(f.inactive,[1000]);assert.equal(f.relay.performance().lastFailure,'buffered-output-timeout');
 assert.deepEqual(f.sockets[0].sent,[]);
});
