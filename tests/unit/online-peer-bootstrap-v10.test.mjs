/** Cold owner packets use real profile actors and schema/reference validators.
 * The enlarged bounded hit cache is a transport-capacity fixture, not a claim
 * about a normally generated MM gameplay trace or a real WAN connection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences} from '../../packages/online/owned-state.mjs';
import {createOwnerPoseDelta,OWNER_POSE_DELTA_VERSION} from '../../packages/online/owner-pose-delta.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const profiles=Object.fromEntries(['RF','MM'].map(id=>[id,JSON.parse(readFileSync(new URL(`../../packages/combat-core/${id.toLowerCase()}-profile.json`,import.meta.url)))]));
const map={sceneId:'peer-bootstrap-v10',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const input={held:['RIGHT'],pressed:['RIGHT'],released:[]},codec='rtc-owner-gzip-v1';
const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const parse=value=>JSON.parse(typeof value==='string'?value:gunzipSync(value).toString('utf8'));
function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}

async function fixture(t,{profession='RF',limit=4096,cacheEntries=80,gzip=true,legacy=false,holdCompression=false}={}){
  const profile=profiles[profession],simulation=createSimulation({profile,map,networkOwnerId:'a',seed:2016,
    actors:[{id:'a',professionId:profession,team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'b',professionId:profession,team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const peers=[],sources=[],events=[],errors=[],compressions=[],intervals=[],timeouts=new Map();let now=0,timerId=0;
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{
    constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){assert.ok((typeof value==='string'?new TextEncoder().encode(value).length:value.byteLength)<=limit,'physical SCTP single-message limit');this.sent.push(value);}
    receive(value){this.onmessage?.({data:typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)});}
  }
  class Peer{
    constructor(){this.connectionState='connected';this.sctp=limit===64*1024?null:{maxMessageSize:limit};this.channels=new Map();peers.push(this);}
    createDataChannel(label){if(legacy&&this.channels.has('input'))return this.channels.get('input');const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'controlled'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}
  }
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}}
  const match={id:'peer-bootstrap-v10',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,clock:()=>now,
    timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    fetch:async()=>response({accepted:true}),onError:error=>errors.push(error),
    onEvent(type,value){events.push({type,value});if(type==='owner-actions')return true;if(type==='peer-owned-state')return {validated:true,applied:true,playerId:value.playerId,epoch:value.report.epoch,frameSeq:value.report.frameSeq};},
    rtcOptions:{enabled:gzip,compress(text){const row={text,...(holdCompression?deferred():{})};compressions.push(row);return holdCompression?row.promise:Promise.resolve(new Uint8Array(gzipSync(text)));},
      decode:async value=>parse(value)}});
  t.after(async()=>{client.close();for(const job of compressions)job.resolve?.(new Uint8Array(gzipSync(job.text)));await settle();});
  await client.open();await client.setMatch(match,'a');await settle();
  sources[0].emit('state',{matchId:match.id,snapshot:{actors:simulation.state.actors},ownership:{mode:'local-owner-v1',actors:{a:{epoch:1},b:{epoch:1}}}});
  const report=(frameSeq,{entries=cacheEntries}={})=>{
    const value=encodeOwnedState(simulation,'a',{epoch:1,frameSeq});
    // Full owner actor caches have the same bounded dictionary/key/value
    // contract as normal hit receipts; no opaque padding or extra fields.
    for(let i=0;i<entries;i++)value.actor.hits[`contact-${String(i).padStart(3,'0')}-${'h'.repeat(112)}`]=i/60;
    const checked=validateOwnedState(value);validateOwnedReferences(checked,simulation.actor('a'),profile,map,{actors:simulation.state.actors});return checked;
  };
  return {client,peers,events,errors,compressions,match,report,
    handshake(peer=peers.at(-1)){if(!legacy)peer.channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip});},
    capability(peer=peers.at(-1)){peer.channels.get('input').receive({matchId:match.id,sequence:0,packet:{held:[],pressed:[],released:[]},poseDelta:OWNER_POSE_DELTA_VERSION,codec});},
    async send(frameSeq,options){client.send(input,report(frameSeq,options));await settle();},
    async advance(ms){now+=ms;void intervals[0]();await settle();},
  };
}

function assertCapability(value,matchId){
  assert.equal(value.matchId,matchId);assert.equal(value.codec,codec);assert.equal(value.poseDelta,2);
  assert.deepEqual(value.packet.held,['RIGHT']);assert.equal(value.owner,undefined);assert.equal(value.ownerDelta,undefined);
  assert.equal(value.actions,undefined);assert.equal(value.hits,undefined);assert.equal(value.controlSequence,undefined);
}
function restoredPose(value){const codec=createOwnerPoseDelta();return value.owner??codec.decode(value.ownerDelta).report;}

test('a cold full owner above a small negotiated SCTP limit advertises one valid small capability without claiming pose delivery',async t=>{
  const f=await fixture(t);f.handshake();assert.ok(bytes(f.report(3))>4096);
  await f.send(3);const inputChannel=f.peers[0].channels.get('input');assert.equal(inputChannel.sent.length,1);
  assertCapability(parse(inputChannel.sent[0]),f.match.id);assert.ok(bytes(parse(inputChannel.sent[0]))<512);
  assert.equal(f.client.performance().peerTransports.b.capabilityMessages,1);assert.deepEqual(f.client.performance().peerReceipts,[]);
  assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,0);
  assert.equal(f.peers[0].channels.get('control').sent.map(parse).filter(value=>value.type==='pose-ack').length,0);
  f.capability();assert.deepEqual(f.client.performance().peerReceipts,[],'a remote capability alone cannot suppress the server relay');
  await f.send(6);assert.equal(inputChannel.sent.length,2);assert.ok(inputChannel.sent[1] instanceof Uint8Array);
  const decoded=restoredPose(parse(inputChannel.sent[1]));assert.equal(decoded.frameSeq,6);assert.equal(Object.keys(decoded.actor.hits).length,80);
  validateOwnedState(decoded);assert.equal(f.client.performance().peerTransports.b.compressedMessages,1);
  await f.send(9);assert.equal(inputChannel.sent.length,3);assert.equal(f.client.performance().peerTransports.b.capabilityMessages,1);
  assert.deepEqual(f.errors,[]);
});

test('a reference-valid MM full owner above the default 64 KiB ceiling can bootstrap and then use a compressed full pose',async t=>{
  const f=await fixture(t,{profession:'MM',limit:64*1024,cacheEntries:512});f.handshake();
  const owner=f.report(3);assert.ok(bytes(owner)>64*1024);assert.ok(bytes(owner)<=96*1024);
  await f.send(3);const channel=f.peers[0].channels.get('input');assert.equal(channel.sent.length,1);assertCapability(parse(channel.sent[0]),f.match.id);
  f.capability();await f.send(6);assert.ok(channel.sent[1] instanceof Uint8Array);
  const value=parse(channel.sent[1]);assert.equal(value.ownerDelta.full,true);
  const decoded=restoredPose(value);assert.equal(decoded.frameSeq,6);assert.equal(Object.keys(decoded.actor.hits).length,512);validateOwnedState(decoded);
  assert.equal(f.client.performance().peerTransports.b.capabilityMessages,1);assert.deepEqual(f.errors,[]);
});

test('rebuilding a peer with an already large MM state restarts capability negotiation and uses a fresh full pose base',async t=>{
  const f=await fixture(t,{profession:'MM',limit:64*1024,cacheEntries:512});f.handshake();await f.send(3);f.capability();await f.send(6);
  const old=f.peers[0];old.connectionState='failed';await f.advance(6000);assert.equal(f.peers.length,2);f.handshake();
  await f.send(9);const next=f.peers[1].channels.get('input');assert.equal(next.sent.length,1);assertCapability(parse(next.sent[0]),f.match.id);
  f.capability();await f.send(12);const wire=parse(next.sent[1]);assert.equal(wire.ownerDelta.full,true);assert.equal(restoredPose(wire).frameSeq,12);
  assert.equal(f.client.performance().peerTransports.b.capabilityMessages,1);assert.equal(old.channels.get('input').sent.length,2);assert.deepEqual(f.errors,[]);
});

test('an ordinary legacy small first report retains its one JSON owner send without an extra capability packet',async t=>{
  const f=await fixture(t,{legacy:true,limit:64*1024,cacheEntries:0});await f.send(3);
  const channel=f.peers[0].channels.get('input');assert.equal(channel.sent.length,1);assert.equal(typeof channel.sent[0],'string');
  assert.ok(parse(channel.sent[0]).owner);assert.equal(f.client.performance().peerTransports.b.capabilityMessages,0);
});

test('a legacy peer that never advertises gzip gets no repeated empty capability loop',async t=>{
  const f=await fixture(t,{legacy:true});await f.send(3);await f.send(6);await f.send(9);
  const channel=f.peers[0].channels.get('input');assert.equal(channel.sent.length,1);assertCapability(parse(channel.sent[0]),f.match.id);
  assert.equal(f.client.performance().peerTransports.b.capabilityMessages,1);assert.equal(f.client.performance().peerTransports.b.compressedMessages,0);
});

test('gzip-disabled oversized owners never start an empty capability loop',async t=>{
  const f=await fixture(t,{gzip:false});f.handshake();await f.send(3);await f.send(6);
  assert.equal(f.peers[0].channels.get('input').sent.length,0);assert.equal(f.client.performance().peerTransports.b.capabilityMessages,0);
  assert.equal(f.compressions.length,0);
});

test('retiring the room during a bootstrapped pose encode prevents its late completion from sending',async t=>{
  const f=await fixture(t,{holdCompression:true});f.handshake();await f.send(3);f.capability();await f.send(6);
  assert.equal(f.compressions.length,1);const old=f.peers[0].channels.get('input');assert.equal(old.sent.length,1);
  f.client.clearMatch();f.compressions[0].resolve(new Uint8Array(gzipSync(f.compressions[0].text)));await settle();
  assert.equal(old.sent.length,1);assert.deepEqual(f.client.performance().peerReceipts,[]);assert.deepEqual(f.errors,[]);
});
