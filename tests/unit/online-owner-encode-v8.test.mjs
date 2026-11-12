import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const packet={held:[],pressed:[],released:[]};
const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
// Minimal transport reports: no combat/runtime or private resource fixture is
// needed to verify an unchanged wire budget and durable receipt identities.
const owner=(frameSeq,ids=[],epoch=1,hitIds=[])=>({protocol:'local-owner-v1',epoch,frameSeq,
  actor:{id:'a',hp:100,state:'Wait'},effects:[],hits:hitIds.map(id=>({id,attackerId:'b',damage:1})),
  actions:ids.map(id=>({id,ageFrames:0,actor:{id:'a',state:'Wait'}}))});

function encodingProbe(t){
  const counts={ownerTexts:0,ownerBytes:0,envelopeTexts:0,envelopeBytes:0};
  const stringify=JSON.stringify,encode=TextEncoder.prototype.encode;
  const kind=value=>value?.protocol==='local-owner-v1'&&value.actor?'owner':value?.owner?.protocol==='local-owner-v1'?'envelope':null;
  t.mock.method(JSON,'stringify',function(value,...args){const type=kind(value);if(type)counts[type+'Texts']++;return stringify.call(this,value,...args);});
  t.mock.method(TextEncoder.prototype,'encode',function(text,...args){
    if(typeof text==='string'&&text.includes('"protocol":"local-owner-v1"')){
      const type=kind(JSON.parse(text));if(type)counts[type+'Bytes']++;
    }
    return encode.call(this,text,...args);
  });
  return {counts,reset(){for(const key of Object.keys(counts))counts[key]=0;}};
}

async function fixture(t,{socket=true,credits=1}={}){
  const ticks=[],sockets=[],uploads=[],errors=[],timeouts=new Map();let now=0,timerId=0;
  t.mock.method(globalThis,'setInterval',callback=>{ticks.push(callback);return ticks.length;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  class Source{addEventListener(type,callback){if(type==='open')queueMicrotask(()=>callback({type:'open'}));}close(){}}
  class Socket{
    constructor(){this.bufferedAmount=0;this.sent=[];sockets.push(this);queueMicrotask(()=>this.receive({type:'transport',data:{connected:true}}));}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
    send(value){this.sent.push(JSON.parse(new TextDecoder().decode(value)));}
    close(){}
  }
  const match={id:'owner-encode-v8',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:socket?Socket:null,RTCPeerConnection:null,
    maximumOwnerCredits:credits,clock:()=>now,onError:error=>errors.push(error),
    timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    socketOptions:{compress:async text=>new TextEncoder().encode(text)},
    fetch:async(url,options)=>{
      if(url!=='/api/online/input')return response({accepted:true});
      const gate=deferred();uploads.push({...gate,body:JSON.parse(options.body)});return gate.promise;
    }});
  t.after(async()=>{client.close();for(const upload of uploads)upload.resolve(response({accepted:false}));await settle();});
  await client.open();await client.setMatch(match,'a');await settle();
  return {client,sockets,uploads,errors,match,advance(ms){now+=ms;},async flush(){void ticks[0]();await settle();},
    ack(batch,extra={}){sockets.at(-1).receive({type:'ack',data:{accepted:true,matchId:match.id,sequence:batch.sequence,...extra}});}};
}

for(const socket of [true,false])test(`${socket?'WS':'HTTP'} measures one owner tree and serializes one transport envelope per available upload`,async t=>{
  const f=await fixture(t,{socket}),probe=encodingProbe(t);
  f.client.send(packet,owner(3,[1],1,[7]));await settle();
  assert.deepEqual(probe.counts,{ownerTexts:1,ownerBytes:1,envelopeTexts:1,envelopeBytes:1});
  const batch=socket?f.sockets[0].sent[0]:f.uploads[0].body;
  assert.equal(batch.owner.frameSeq,3);assert.deepEqual(batch.owner.actions.map(a=>a.id),[1]);assert.deepEqual(batch.owner.hits.map(h=>h.id),[7]);
  assert.deepEqual(f.errors,[]);
});

test('exhausted ACK credit skips tree encoding but preserves newest pose and exact sparse action/hit receipts',async t=>{
  const f=await fixture(t),probe=encodingProbe(t);
  f.client.send(packet,owner(3,[1,4],1,[11]));await settle();const first=f.sockets[0].sent[0];
  probe.reset();f.client.send(packet,owner(6,[7],1,[22]));await f.flush();
  assert.deepEqual(probe.counts,{ownerTexts:0,ownerBytes:0,envelopeTexts:0,envelopeBytes:0});
  assert.equal(f.client.performance().pendingActions,3);assert.equal(f.client.performance().pendingHits,2);
  f.ack(first,{consumedActionIds:[1],consumedHitIds:[11]});await settle();
  const second=f.sockets[0].sent[1];assert.equal(second.owner.frameSeq,6);
  assert.deepEqual(second.owner.actions.map(a=>a.id),[4,7]);assert.deepEqual(second.owner.hits.map(h=>h.id),[22]);
  assert.deepEqual(probe.counts,{ownerTexts:1,ownerBytes:1,envelopeTexts:1,envelopeBytes:1});
  f.ack(first,{consumedActionIds:[4,7],consumedHitIds:[22]});await settle();
  assert.equal(f.client.performance().pendingActions,2,'duplicate old receipt cannot acknowledge a newer batch');
  f.ack(second,{consumedActionIds:[4,7],consumedHitIds:[22]});await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);assert.deepEqual(f.errors,[]);
});

test('new epoch retained during credit pause cannot be consumed by the old epoch ACK',async t=>{
  const f=await fixture(t),probe=encodingProbe(t);
  f.client.send(packet,owner(3,[1],1,[7]));await settle();const first=f.sockets[0].sent[0];
  probe.reset();f.client.send(packet,owner(1,[1],2,[7]));await f.flush();
  assert.equal(probe.counts.ownerTexts,0);assert.equal(f.client.performance().pendingActions,1);
  f.ack(first,{consumedActionIds:[1],consumedHitIds:[7]});await settle();
  const next=f.sockets[0].sent[1];assert.equal(next.owner.epoch,2);assert.equal(next.owner.frameSeq,4);
  assert.deepEqual(next.owner.actions.map(a=>a.id),[1]);assert.deepEqual(next.owner.hits.map(h=>h.id),[7]);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  f.ack(next,{consumedActionIds:[1],consumedHitIds:[7]});await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
});

test('HTTP retry pacing skips encoding and retries the newest source with retained canonical events',async t=>{
  const f=await fixture(t,{socket:false}),probe=encodingProbe(t);
  f.client.send(packet,owner(3,[1],1,[7]));await settle();
  f.uploads[0].resolve(response({accepted:false}));await settle();probe.reset();
  f.client.send(packet,owner(6,[4],1,[10]));await f.flush();
  assert.deepEqual(probe.counts,{ownerTexts:0,ownerBytes:0,envelopeTexts:0,envelopeBytes:0});assert.equal(f.uploads.length,1);
  f.advance(49);await f.flush();assert.equal(probe.counts.ownerTexts,0);
  f.advance(1);await f.flush();assert.equal(f.uploads.length,2);
  const next=f.uploads[1].body;assert.equal(next.owner.frameSeq,6);assert.deepEqual(next.owner.actions.map(a=>a.id),[1,4]);assert.deepEqual(next.owner.hits.map(h=>h.id),[7,10]);
  assert.deepEqual(probe.counts,{ownerTexts:1,ownerBytes:1,envelopeTexts:1,envelopeBytes:1});
  f.uploads[1].resolve(response({accepted:true,consumedActionIds:[1,4],consumedHitIds:[7,10]}));await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
});

test('expired ACK still retires the WS before encoding and immediately sends durable history by HTTP',async t=>{
  const f=await fixture(t),probe=encodingProbe(t);
  f.client.send(packet,owner(3,[1],1,[7]));await settle();probe.reset();f.advance(2001);
  f.client.send(packet,owner(6,[4],1,[10]));await settle();
  assert.equal(f.client.performance().relay.active,false);assert.equal(f.uploads.length,1);
  assert.equal(f.client.performance().relay.lastFailure,'coordinator-fallback');
  assert.deepEqual(f.uploads[0].body.owner.actions.map(a=>a.id),[1,4]);assert.deepEqual(f.uploads[0].body.owner.hits.map(h=>h.id),[7,10]);
  assert.deepEqual(probe.counts,{ownerTexts:1,ownerBytes:1,envelopeTexts:1,envelopeBytes:1});
});

test('the unchanged 96 KiB UTF-8 owner limit keeps the oldest prefix and faults a single oversize event after credit resumes',async t=>{
  const f=await fixture(t),report=owner(3,[1,4]);
  for(const action of report.actions)action.actor.payload='\uad0d'.repeat(17000);
  f.client.send(packet,report);await settle();const first=f.sockets[0].sent[0];
  assert.deepEqual(first.owner.actions.map(a=>a.id),[1]);assert.equal(first.owner.actionFrontierComplete,false);
  assert.ok(new TextEncoder().encode(JSON.stringify(first.owner)).length<=96*1024);
  f.ack(first,{consumedActionIds:[1]});await settle();const second=f.sockets[0].sent[1];
  assert.deepEqual(second.owner.actions.map(a=>a.id),[4]);assert.equal(second.owner.actionFrontierComplete,undefined);
  const oversized=owner(6,[9]);oversized.actions[0].actor.payload='\uad0d'.repeat(34000);
  f.client.send(packet,oversized);await settle();assert.equal(f.client.performance().ownerFatal,null,'blocked transport defers its wire sizing until a slot opens');
  f.ack(second,{consumedActionIds:[4]});await settle();
  assert.equal(f.client.performance().ownerFatal,'owner-action-message-too-large');assert.equal(f.client.performance().pendingActions,1);
  assert.equal(f.sockets[0].sent.length,2);assert.equal(f.errors.filter(error=>error.fatal).length,1);
});
