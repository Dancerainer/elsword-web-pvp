/** Actual browser upload coordinator with production RF owner reports.
 * Transport loss/capabilities are controlled; this is not WAN evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'owner-upload-client-v9',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const input={held:[],pressed:[],released:[]};
const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}

async function fixture(t,{capability=1,credits=1,decode}={}){
  const sim=createSimulation({profile,map,networkOwnerId:'a',seed:2016,
    actors:[{id:'a',professionId:'RF',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'b',professionId:'RF',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const sockets=[],uploads=[],errors=[],intervals=[],timeouts=new Map();let now=0,timerId=0;
  t.mock.method(globalThis,'setInterval',callback=>{intervals.push(callback);return intervals.length;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  class Source{addEventListener(type,callback){if(type==='open')queueMicrotask(()=>callback({type:'open'}));}close(){}}
  class Socket{
    constructor(){
      this.bufferedAmount=0;this.sent=[];this.attempted=[];this.failNext=false;this.decoder=createOwnerUploadDelta();sockets.push(this);
      queueMicrotask(()=>this.receive({type:'transport',data:{connected:true,...(capability===null?{}:{ownerUploadDelta:capability})}}));
    }
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
    send(bytes){
      const batch=JSON.parse(new TextDecoder().decode(bytes));this.attempted.push(batch);
      if(this.failNext){this.failNext=false;throw Error('controlled compact socket send failure');}
      this.sent.push(batch);
    }
    decode(batch){
      if(batch.owner)return validateOwnedState(batch.owner);
      const candidate=this.decoder.decode(batch.ownerUpload);candidate.commit();return candidate.report;
    }
    disconnect(){this.onclose?.({code:1006,wasClean:false});}
    close(){}
  }
  const match={id:'owner-upload-client-v9',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:Socket,RTCPeerConnection:null,maximumOwnerCredits:credits,
    clock:()=>now,onError:error=>errors.push(error),
    timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    socketOptions:{compress:async text=>new TextEncoder().encode(text),...(decode?{decode}:{})},
    fetch:async(url,options)=>{
      if(url!=='/api/online/input')return response({accepted:true});
      const gate=deferred();uploads.push({...gate,body:JSON.parse(options.body)});return gate.promise;
    }});
  t.after(async()=>{client.close();for(const upload of uploads)upload.resolve(response({accepted:false}));await settle();});
  await client.open();await client.setMatch(match,'a');await settle();
  return {client,sockets,uploads,errors,
    report(frameSeq,epoch=1,{actions=[],hits=[]}={}){
      const report=encodeOwnedState(sim,'a',{epoch,frameSeq});report.actor.x=frameSeq;
      report.actions=actions.map(id=>encodeCriticalAction(report,{id}));
      report.hits=hits.map(id=>({id,attackerId:'b',damage:10}));
      return validateOwnedState(report);
    },
    async send(report){const frame=client.send(input,report);await settle();return frame;},
    ack(batch,extra={}){sockets.at(-1).receive({type:'ack',data:{accepted:true,matchId:match.id,sequence:batch.sequence,...extra}});},
    exactAck(batch,extra={}){const pose=batch.ownerUpload?.pose??batch.owner;
      this.ack(batch,{ownerReceipt:{epoch:pose.epoch,frameSeq:pose.frameSeq},...extra});},
    async runTimeouts(ms){
      now+=ms;const due=[...timeouts].filter(([,row])=>row.ms===ms);
      for(const [id,row]of due)if(timeouts.delete(id))row.fn();await settle();
    },
    async flush(){void intervals[0]();await settle();},
  };
}

test('an older coordinator without upload capability continues to receive full legacy owners',async t=>{
  const f=await fixture(t,{capability:null}),owner=f.report(3);
  await f.send(owner);const socket=f.sockets[0],batch=socket.sent[0];
  assert.equal(f.client.performance().relay.ownerUploadDelta,false);
  assert.equal(batch.ownerUpload,undefined);assert.deepEqual(socket.decode(batch),owner);
  f.exactAck(batch);await settle();await f.send(f.report(6));
  assert.ok(socket.sent[1].owner);assert.equal(socket.sent[1].ownerUpload,undefined);
  assert.equal(f.client.performance().ownerUpload.acceptedBaselines,0);assert.deepEqual(f.errors,[]);
});

test('negotiated upload capability sends a production-valid full first pose and advertises no legacy owner',async t=>{
  const f=await fixture(t),owner=f.report(3);await f.send(owner);const socket=f.sockets[0],batch=socket.sent[0];
  assert.equal(f.client.performance().relay.ownerUploadDelta,true);
  assert.equal(batch.owner,undefined);assert.equal(batch.ownerUpload.v,1);assert.equal(batch.ownerUpload.pose.full,true);
  assert.deepEqual(socket.decode(batch),owner);assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);
  assert.deepEqual(f.errors,[]);
});

for(const receipt of ['absent','wrong-epoch','wrong-frame'])test(`accepted transport ACK with ${receipt} owner receipt cannot promote a raw upload baseline`,async t=>{
  const f=await fixture(t);await f.send(f.report(3));const socket=f.sockets[0],first=socket.sent[0];socket.decode(first);
  const exact={epoch:first.ownerUpload.pose.epoch,frameSeq:first.ownerUpload.pose.frameSeq};
  const ownerReceipt=receipt==='absent'?undefined:receipt==='wrong-epoch'?{...exact,epoch:exact.epoch+1}:{...exact,frameSeq:exact.frameSeq+1};
  f.ack(first,ownerReceipt?{ownerReceipt}:{});await settle();
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);
  const next=f.report(6);await f.send(next);const second=socket.sent[1];
  assert.equal(second.ownerUpload.pose.full,true);assert.deepEqual(socket.decode(second),next);
  assert.deepEqual(f.errors,[]);
});

test('only an exact accepted owner clock enables a lossless subsequent delta',async t=>{
  const f=await fixture(t);await f.send(f.report(3));const socket=f.sockets[0],first=socket.sent[0];socket.decode(first);
  f.exactAck(first);await settle();
  assert.equal(f.client.performance().ownerUpload.acknowledgedEpoch,1);
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,3);
  const next=f.report(6);await f.send(next);const second=socket.sent[1];
  assert.equal(second.owner,undefined);assert.equal(second.ownerUpload.pose.full,false);assert.equal(second.ownerUpload.pose.base,3);
  assert.deepEqual(socket.decode(second),next);assert.deepEqual(f.errors,[]);
});

test('compact upload retains sparse canonical actions and victim hits until their exact consumed identities arrive',async t=>{
  const f=await fixture(t),socket=f.sockets[0];await f.send(f.report(3,1,{actions:[11,13],hits:[21,22]}));
  const first=socket.sent[0],decodedFirst=socket.decode(first);
  assert.deepEqual(decodedFirst.actions.map(a=>a.id),[11,13]);assert.deepEqual(decodedFirst.hits.map(h=>h.id),[21,22]);
  const newest=f.report(6,1,{actions:[14],hits:[23]});await f.send(newest);
  assert.equal(socket.sent.length,1,'newest pose waits behind the existing transport credit');
  assert.equal(f.client.performance().pendingActions,3);assert.equal(f.client.performance().pendingHits,3);
  f.exactAck(first,{consumedActionIds:[11],consumedHitIds:[21]});await settle();
  const second=socket.sent[1],restored=socket.decode(second);
  assert.equal(second.ownerUpload.pose.full,false);assert.equal(restored.frameSeq,6);
  assert.deepEqual(restored.actions,[decodedFirst.actions[1],{...newest.actions[0],frameSeq:6}]);
  assert.deepEqual(restored.hits,[decodedFirst.hits[1],newest.hits[0]]);
  assert.equal(f.client.performance().pendingActions,2);assert.equal(f.client.performance().pendingHits,2);
  f.exactAck(first,{consumedActionIds:[13,14],consumedHitIds:[22,23]});await settle();
  assert.equal(f.client.performance().pendingActions,2,'duplicate old batch receipt cannot consume a newer canonical prefix');
  assert.equal(f.client.performance().pendingHits,2);
  f.exactAck(second,{consumedActionIds:[13,14],consumedHitIds:[22,23]});await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
  assert.deepEqual(f.errors,[]);
});

test('physical socket loss clears upload baselines and a new negotiated connection starts with full',async t=>{
  const f=await fixture(t);await f.send(f.report(3));const old=f.sockets[0],first=old.sent[0];old.decode(first);
  f.exactAck(first);await settle();await f.send(f.report(6));const second=old.sent[1];
  assert.equal(second.ownerUpload.pose.full,false);old.decode(second);f.exactAck(second);await settle();
  old.disconnect();await settle();
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);
  assert.equal(f.client.performance().relay.ownerUploadDelta,false);
  assert.equal(f.uploads.length,1,'latest raw owner remains available for HTTP recovery');
  assert.ok(f.uploads[0].body.owner);assert.equal(f.uploads[0].body.ownerUpload,undefined);
  f.uploads[0].resolve(response({accepted:true,consumedActionIds:[],consumedHitIds:[]}));await settle();
  await f.runTimeouts(1000);assert.equal(f.sockets.length,2);
  const next=f.report(9);await f.send(next);const fresh=f.sockets[1],batch=fresh.sent[0];
  assert.equal(batch.ownerUpload.pose.full,true);assert.deepEqual(fresh.decode(batch),next);
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);assert.deepEqual(f.errors,[]);
});

test('new owner life rejects old receipts and starts a fresh full base even when event IDs repeat',async t=>{
  const f=await fixture(t);await f.send(f.report(3));const socket=f.sockets[0],first=socket.sent[0];socket.decode(first);
  f.exactAck(first);await settle();
  const fresh=f.report(1,2,{actions:[1],hits:[7]}),sentFrame=await f.send(fresh),second=socket.sent[1];
  assert.equal(second.ownerUpload.pose.full,true);assert.equal(second.ownerUpload.pose.epoch,2);
  assert.equal(second.ownerUpload.pose.frameSeq,sentFrame);
  const restored=socket.decode(second);
  assert.equal(restored.epoch,2);assert.equal(restored.frameSeq,sentFrame);
  assert.deepEqual(restored.actions.map(a=>a.id),[1]);assert.deepEqual(restored.hits.map(h=>h.id),[7]);
  assert.equal(f.client.performance().ownerUpload.acknowledgedEpoch,null);
  f.exactAck(first,{consumedActionIds:[1],consumedHitIds:[7]});await settle();
  assert.equal(f.client.performance().ownerUpload.acknowledgedEpoch,null);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  f.exactAck(second,{consumedActionIds:[1],consumedHitIds:[7]});await settle();
  assert.equal(f.client.performance().ownerUpload.acknowledgedEpoch,2);
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
  assert.deepEqual(f.errors,[]);
});

test('independent exact ACK releases upload credit during held event decoding without accepting foreign identities',async t=>{
  const held=deferred(),f=await fixture(t,{decode:()=>held.promise}),socket=f.sockets[0];
  t.after(()=>held.resolve({type:'event',event:'fixture',data:{}}));
  await f.send(f.report(3,1,{actions:[11],hits:[21]}));const first=socket.sent[0];socket.decode(first);
  socket.onmessage({data:new Uint8Array([1]).buffer});
  await f.send(f.report(6,1,{actions:[12],hits:[22]}));assert.equal(socket.sent.length,1);
  f.exactAck(first,{sequence:first.sequence+100,consumedActionIds:[11,12],consumedHitIds:[21,22]});await settle();
  f.exactAck(first,{matchId:'another-match',consumedActionIds:[11,12],consumedHitIds:[21,22]});await settle();
  assert.equal(socket.sent.length,1);assert.equal(f.client.performance().pendingActions,2);
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);
  f.exactAck(first,{consumedActionIds:[11],consumedHitIds:[21]});await settle();
  assert.equal(socket.sent.length,2,'valid receipt releases credit before the unrelated decoder resolves');
  const restored=socket.decode(socket.sent[1]);assert.equal(restored.frameSeq,6);
  assert.deepEqual(restored.actions.map(x=>x.id),[12]);assert.deepEqual(restored.hits.map(x=>x.id),[22]);
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,3);
  assert.equal(f.client.performance().relay.independentAckBypasses,3);assert.deepEqual(f.errors,[]);
  held.resolve({type:'event',event:'fixture',data:{}});await settle();assert.equal(socket.sent.length,2);
});

test('compact physical send failure recovers by HTTP full owner without losing canonical events',async t=>{
  const f=await fixture(t),socket=f.sockets[0];await f.send(f.report(3));socket.decode(socket.sent[0]);
  f.exactAck(socket.sent[0]);await settle();socket.failNext=true;
  const next=f.report(6,1,{actions:[31],hits:[41]});await f.send(next);
  assert.equal(socket.attempted.at(-1).ownerUpload.pose.full,false,'exercise failure of a compact delta send');
  assert.equal(f.client.performance().relay.active,false);assert.equal(f.client.performance().relay.lastFailure,'compression-or-send-failed');
  assert.equal(f.client.performance().ownerUpload.acknowledgedFrame,-1);
  assert.equal(f.uploads.length,1);const fallback=f.uploads[0].body;
  assert.equal(fallback.ownerUpload,undefined);const restored=validateOwnedState(fallback.owner);
  assert.equal(restored.frameSeq,6);assert.deepEqual(restored.actions,[{...next.actions[0],frameSeq:6}]);assert.deepEqual(restored.hits,next.hits);
  assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingHits,1);
  assert.equal(f.client.performance().ownerFatal,null);
  f.uploads[0].resolve(response({accepted:true,consumedActionIds:[31],consumedHitIds:[41]}));await settle();
  assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().pendingHits,0);
  assert.deepEqual(f.errors,[]);
});
