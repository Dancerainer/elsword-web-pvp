/** Production owner reports and controlled native codec completion.
 * A failed stream retires its work without clearing its durable peer inbox. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'control-retirement-v10',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const input={held:[],pressed:[],released:[]};
const encode=text=>new TextEncoder().encode(text);
const parse=data=>JSON.parse(typeof data==='string'?data:new TextDecoder().decode(data));
const response=value=>({ok:true,status:200,json:async()=>value});
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

async function fixture(t,{holdEncode=true,holdDecode=false,channelState='open',admit=()=>true}={}){
  const simulation=createSimulation({profile,map,networkOwnerId:'a',seed:2016,
    actors:[{id:'a',professionId:'RF',team:0,position:[0,0,0],lineId:0,loadout:Array(8).fill(null)},
      {id:'b',professionId:'RF',team:1,position:[1000,0,0],lineId:0,loadout:Array(8).fill(null)}]});
  const peers=[],sources=[],encodes=[],decodes=[],events=[],errors=[],intervals=[],timeouts=new Map();let now=0,timerId=0;
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{
    constructor(label){this.label=label;this.readyState=channelState;this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(value);}receive(value){this.onmessage?.({data:typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)});}
  }
  class Peer{
    constructor(){this.connectionState='connected';this.sctp={maxMessageSize:64*1024};this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'controlled'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}
  }
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}}
  const match={id:'control-retirement-v10',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,clock:()=>now,
    timers:{setTimeout(fn,ms){const id=++timerId;timeouts.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timeouts.delete(id);}},
    fetch:async()=>response({accepted:true}),onError:error=>errors.push(error),
    onEvent(type,value){events.push({type,value});if(type==='owner-actions')return admit(value);if(type==='peer-owned-state')return true;},
    rtcOptions:{compress(text){if(holdEncode&&['actions','fragment'].includes(parse(text).type)){const gate=deferred();encodes.push({...gate,text});return gate.promise;}return Promise.resolve(encode(text));},
      decode(value){if(holdDecode){const gate=deferred();decodes.push({...gate,value});return gate.promise;}return Promise.resolve(parse(value));}}});
  t.after(async()=>{client.close();for(const job of encodes)job.resolve(encode(job.text));for(const job of decodes)job.resolve(parse(job.value));await settle();});
  await client.open();await client.setMatch(match,'a');await settle();
  sources[0].emit('state',{matchId:match.id,snapshot:{actors:simulation.state.actors},ownership:{mode:'local-owner-v1',actors:{a:{epoch:1},b:{epoch:1}}}});
  const report=(frameSeq,id)=>{const value=encodeOwnedState(simulation,'a',{epoch:1,frameSeq});value.actions=[encodeCriticalAction(value,{id})];return validateOwnedState(value);};
  return {client,peers,encodes,decodes,events,errors,match,report,
    async tick(ms=0){now+=ms;for(const [id,row]of [...timeouts])if(row.at<=now&&timeouts.delete(id))row.fn();await settle();},
    scheduled(){return timeouts.size;},
    handshake(peer=peers.at(-1)){peer.channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip:true});},
    actions(peer=peers.at(-1)){return peer.channels.get('control').sent.map(parse).filter(value=>value.type==='actions');},
    async send(frame=3,id=3){client.send(input,report(frame,id));await settle();},
    async advance(ms,{deadlines=true}={}){now+=ms;if(deadlines)for(const [id,row]of [...timeouts])if(row.at<=now&&timeouts.delete(id))row.fn();void intervals[0]();await settle();},
  };
}

test('protocol failure retires an unresolved control encode and its queued tail before late completion can send',async t=>{
  const f=await fixture(t);f.handshake();await f.send();await f.send(6,6);
  assert.equal(f.encodes.length,1);assert.equal(f.client.performance().peerControls.b.wire.outboundPending,1);
  f.peers[0].channels.get('control').receive({v:1,matchId:f.match.id,type:'actions',sequence:1,report:{epoch:1,frameSeq:3,actions:[]}});
  await settle();const failed=f.client.performance();assert.equal(failed.peerControls.b.failed,true);
  assert.equal(failed.peerControls.b.wire.outboundPending,0);assert.equal(failed.peerControls.b.wire.encodeAgeMs,0);
  assert.equal(failed.controlCompression.cachedTexts,0);assert.equal(failed.peerActionLedgers.b.pending,2);
  f.peers[0].channels.get('control').receive(new Uint8Array([1,2,3]));await settle();
  assert.equal(f.client.performance().peerControls.b.wire.inboundPending,0,'failed adapter rows cannot refill');
  f.encodes[0].resolve(encode(f.encodes[0].text));await settle();assert.equal(f.actions().length,0);
  assert.equal(f.client.performance().peerActionLedgers.b.pending,2);
});

test('opening a channel twenty milliseconds after failed attach hello sends immediately without polling',async t=>{
  const f=await fixture(t,{channelState:'connecting'}),control=f.peers[0].channels.get('control');
  assert.deepEqual(control.sent,[]);await f.tick(20);control.readyState='open';control.onopen();
  assert.equal(control.sent.map(parse).filter(value=>value.type==='hello').length,1);
});

test('completed encoding waits at send-time high water and low water sends the identical row exactly once',async t=>{
  const f=await fixture(t);f.handshake();await f.send(3,3);await f.send(6,6);
  const channel=f.peers[0].channels.get('control');assert.equal(channel.bufferedAmountLowThreshold,64*1024);
  channel.bufferedAmount=128*1024+1;const first=f.encodes[0],bytes=encode(first.text);first.resolve(bytes);await settle();
  let wire=f.client.performance().peerControls.b.wire;
  assert.equal(f.actions().length,0);assert.equal(wire.outboundRetained,2);assert.equal(wire.sendBlocked,true);assert.equal(wire.encodeAgeMs,0);
  assert.equal(f.encodes.length,1);assert.equal(f.client.performance().peerActionLedgers.b.pending,2);
  const timers=f.scheduled();await settle();assert.equal(f.scheduled(),timers,'blocked completion does not create an encode retry loop');
  channel.bufferedAmount=0;channel.onbufferedamountlow();channel.onbufferedamountlow();
  assert.equal(f.scheduled(),timers,'low-water wake does not rely on a background-throttled timer');await settle();
  assert.equal(channel.sent.includes(bytes),true,'resume reuses the exact completed buffer');
  assert.deepEqual(f.actions().map(value=>value.report.actions[0].id),[3]);assert.equal(f.encodes.length,2);
  f.encodes[1].resolve(encode(f.encodes[1].text));await settle();
  assert.deepEqual(f.actions().map(value=>value.report.actions[0].id),[3,6]);
  wire=f.client.performance().peerControls.b.wire;assert.equal(wire.lowWaterWakes,1);assert.equal(wire.outboundRetained,0);
  assert.equal(f.client.performance().peerActionLedgers.b.pending,2,'wire send alone never fabricates admission ACK');
  channel.onbufferedamountlow();await f.tick();assert.equal(f.actions().length,2);
});

test('retiring a blocked encoded head clears its pending wake and late low-water callback cannot send',async t=>{
  const f=await fixture(t);f.handshake();await f.send();const channel=f.peers[0].channels.get('control'),late=channel.onbufferedamountlow;
  channel.bufferedAmount=128*1024+1;f.encodes[0].resolve(encode(f.encodes[0].text));await settle();
  channel.bufferedAmount=0;late();f.client.clearMatch();late();await f.tick();
  assert.equal(f.actions().length,0);assert.deepEqual(f.client.performance().peerControls,{});
});

test('encoded high-water retention still obeys the existing control admission deadline',async t=>{
  const f=await fixture(t);f.handshake();await f.send();const channel=f.peers[0].channels.get('control');
  channel.bufferedAmount=128*1024+1;f.encodes[0].resolve(encode(f.encodes[0].text));await settle();
  await f.advance(1501);const control=f.client.performance().peerControls.b;
  assert.equal(control.failed,true);assert.equal(control.wire.lastFault,'control-ack-timeout');assert.equal(control.wire.outboundRetained,0);
  channel.bufferedAmount=0;channel.onbufferedamountlow?.();await f.tick();assert.equal(f.actions().length,0);
  assert.equal(f.client.performance().peerActionLedgers.b.pending,1);
});

test('client capacity notification admits a blocked action immediately and leaves idle peers untouched',async t=>{
  let permit=false;const f=await fixture(t,{admit:()=>permit});f.handshake();const channel=f.peers[0].channels.get('control');
  channel.receive({v:1,matchId:f.match.id,type:'actions',sequence:1,report:f.report(3,77)});await settle();
  assert.equal(f.client.performance().peerControls.b.admissionBlocked,true);assert.equal(channel.sent.map(parse).some(value=>value.type==='ack'),false);
  permit=true;assert.equal(f.client.notifyOwnerCapacity('b'),true);
  assert.equal(channel.sent.map(parse).filter(value=>value.type==='ack').at(-1).sequence,1);
  assert.equal(f.client.notifyOwnerCapacity(),false);assert.equal(f.client.notifyOwnerCapacity('missing'),false);
  assert.equal(f.client.performance().peerControls.b.admissionWakes,1);
});

test('a rebuilt control stream restages durable events using a new codec job instead of a retired unresolved cache',async t=>{
  const f=await fixture(t);f.handshake();await f.send();const oldPeer=f.peers[0];
  await f.advance(1000);assert.equal(f.client.performance().peerControls.b.failed,true);
  assert.equal(f.client.performance().peerControls.b.wire.encodeTimeouts,1);
  await f.advance(5000);assert.equal(f.peers.length,2);f.handshake();await settle();
  assert.equal(f.encodes.length,2,'a retired unresolved cache cannot poison the replacement stream');
  f.encodes[1].resolve(encode(f.encodes[1].text));await settle();assert.equal(f.actions().length,1);
  assert.deepEqual(f.actions()[0].report.actions.map(action=>action.id),[3]);
  f.peers[1].channels.get('control').receive({v:1,matchId:f.match.id,type:'ack',epoch:1,sequence:1});
  assert.equal(f.client.performance().peerActionLedgers.b.pending,0);
  f.encodes[0].resolve(encode(f.encodes[0].text));await settle();assert.equal(f.actions(oldPeer).length,0);assert.equal(f.actions().length,1);
});

test('control ACK timeout retires an in-progress decode without admitting its late result',async t=>{
  const f=await fixture(t,{holdEncode:false,holdDecode:true});f.handshake();await f.send();
  const incoming={v:1,matchId:f.match.id,type:'actions',sequence:1,report:f.report(3,99)};
  f.peers[0].channels.get('control').receive(encode(JSON.stringify(incoming)));await settle();assert.equal(f.decodes.length,1);
  await f.advance(1600,{deadlines:false});assert.equal(f.client.performance().peerControls.b.failed,true);
  const admittedBefore=f.events.filter(event=>event.type==='owner-actions').length;
  f.decodes[0].resolve(incoming);await settle();
  assert.equal(f.events.filter(event=>event.type==='owner-actions').length,admittedBefore);
  assert.equal(f.client.performance().peerControls.b.wire.decodeAgeMs,0);assert.equal(f.client.performance().peerControls.b.wire.inboundPending,0);
});
