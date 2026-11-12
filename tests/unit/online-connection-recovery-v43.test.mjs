/** Production connection/ownership receivers with controlled RTC and clock.
 * These cases prove fallback/budget behavior, not WAN loss or RTT improvement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'connection-v43',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const packet={held:[],pressed:[],released:[]},settle=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
const make=id=>createSimulation({profile,map,networkOwnerId:id,actors:['a','b'].map((id,i)=>({id,team:i,position:[i*1000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
async function fixture(t,{validated=true,holdCompression=false}={}){
  let now=0,frame=0;const peers=[],sources=[],posts=[],errors=[],intervals=[],compressions=[];
  t.mock.method(globalThis,'setInterval',fn=>{intervals.push(fn);return intervals.length;});t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{
    constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(JSON.parse(typeof value==='string'?value:new TextDecoder().decode(value)));}receive(value){this.onmessage?.({data:JSON.stringify(value)});}
  }
  class Peer{
    constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'connection-'+peers.length};}
    async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}
  }
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}
    emit(type,value){this.listeners.get(type)?.({data:JSON.stringify(value)});}close(){}}
  const sim=make('a'),remote=make('b'),sync=createLocalOwnershipSync();
  const client=createOnlineClient({EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,clock:()=>now,
    rtcOptions:{enabled:holdCompression,...(holdCompression?{compress:text=>new Promise(resolve=>compressions.push({text,resolve}))}:{})},
    onError:error=>errors.push(error),fetch:async(url,options)=>{if(url==='/api/online/input')posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({accepted:true})};},
    onEvent(type,value){if(type==='state')sync.reconcile(sim,value,'a');
      if(type==='owner-actions')return sync.receiveActions(value.playerId,value.actions,value.epoch,value.frameSeq);
      if(type==='peer-owned-state')return validated?sync.receivePeerResult(sim,value.playerId,value.report,'a'):false;}});
  t.after(()=>{client.close();for(const row of compressions)row.resolve(new TextEncoder().encode(row.text));});await client.open();const match={id:'connection-v43',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]};
  await client.setMatch(match,'a');sources[0].emit('state',{matchId:match.id,snapshot:sim.snapshot(),pvp:{phase:'fight'},
    ownership:{mode:'local-owner-v1',actors:{a:{epoch:1,frameSeq:0},b:{epoch:1,frameSeq:0}}}});await settle();
  const current=()=>peers.at(-1),handshake=()=>current().channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip:holdCompression});
  const deliver=()=>{frame++;current().channels.get('input').receive({matchId:match.id,sequence:frame,packet,owner:encodeOwnedState(remote,'b',{epoch:1,frameSeq:frame})});};
  const flush=async()=>{await intervals[0]();await settle();};
  const advance=async ms=>{now+=ms;await flush();};
  const send=async({actions=false}={})=>{const report=encodeOwnedState(sim,'a',{epoch:1,frameSeq:++frame});
    if(actions)report.actions=[encodeCriticalAction(report,{id:frame})];client.send(packet,report);await settle();};
  handshake();await send();
  return {client,peers,posts,errors,compressions,current,handshake,deliver,advance,send,flush,elapse(ms){now+=ms;},
    async failures(count=4){for(let i=0;i<count;i++){current().connectionState='failed';await advance(5001);handshake();}},
    async healthy(ms){deliver();await flush();for(let elapsed=0;elapsed<ms;elapsed+=200){now+=Math.min(200,ms-elapsed);deliver();await flush();}}};
}

for(const state of ['failed','disconnected','closed'])test(`a ${state} RTC path immediately stops suppressing relay despite an open channel and fresh owner receipt`,async t=>{
  const f=await fixture(t);f.deliver();assert.equal(f.client.performance().peerReceipts.length,1);
  f.current().channels.get('control').receive({v:1,matchId:'connection-v43',type:'pose-ack',epoch:1,frameSeq:1});
  await f.advance(50);const posts=f.posts.length;await f.send();assert.equal(f.posts.length,posts,'the initially healthy path can defer a redundant checkpoint');
  assert.equal(f.client.performance().directCheckpointsDeferred,1);
  const peer=f.current(),poseSends=peer.channels.get('input').sent.length,controlSends=peer.channels.get('control').sent.length;
  f.current().connectionState=state;assert.deepEqual(f.client.performance().peerReceipts,[]);
  await f.send();assert.equal(f.posts.length,posts+1,'a failed path uploads its next checkpoint immediately');
  assert.equal(f.client.performance().directCheckpointsDeferred,1);assert.deepEqual(f.posts.at(-1).peerReceipts,[]);assert.deepEqual(f.errors,[]);
  await f.send({actions:true});assert.ok(f.posts.at(-1).owner.actions.length,'canonical actions continue through server fallback');
  assert.equal(peer.channels.get('input').sent.length,poseSends);assert.equal(peer.channels.get('control').sent.length,controlSends);
  assert.equal(f.client.performance().peerControls.b.wire.outboundPending,0,'known-broken RTC does not enqueue actions already retained for server delivery');
});

test('a completed native encode pauses on a disconnected path and resumes the same reliable action after recovery',async t=>{
  const f=await fixture(t,{holdCompression:true}),control=f.current().channels.get('control');await f.send({actions:true});
  assert.equal(f.compressions.length,1);const before=control.sent.length;f.current().connectionState='disconnected';
  f.compressions[0].resolve(new TextEncoder().encode(f.compressions[0].text));await settle();
  assert.equal(control.sent.length,before,'a late encode completion cannot send into the known-broken path');
  assert.equal(f.client.performance().peerControls.b.wire.outboundPending,1,'its canonical reliable row remains queued');
  f.current().connectionState='connected';await f.flush();
  const actions=control.sent.filter(row=>row.type==='actions');assert.equal(actions.length,1);assert.deepEqual(actions[0].report.actions.map(action=>action.id),[2]);
  assert.equal(f.client.performance().peerControls.b.wire.outboundPending,0);assert.deepEqual(f.errors,[]);
});

test('four recovered outages do not permanently exhaust RTC retries after ten seconds of validated, fresh direct owners',async t=>{
  const f=await fixture(t);await f.failures();assert.equal(f.peers.length,5);assert.equal(f.client.performance().peerRestarts.b,4);
  await f.healthy(10000);f.current().connectionState='failed';await f.advance(1);
  assert.equal(f.peers.length,6,'a stable restored path earns a new bounded recovery budget');
  assert.equal(f.client.performance().peerRestarts.b,5,'cumulative restart diagnostics are not erased');assert.deepEqual(f.errors,[]);
});

test('continuous negotiation-only failure remains capped at four retries',async t=>{
  const f=await fixture(t);await f.failures();await f.advance(20000);f.current().connectionState='failed';await f.advance(1);
  assert.equal(f.peers.length,5);assert.equal(f.client.performance().peerRestarts.b,4);assert.deepEqual(f.errors,[]);
});

test('a brief stream of valid owners does not renew the exhausted retry budget',async t=>{
  const f=await fixture(t);await f.failures();await f.healthy(9800);f.current().connectionState='failed';await f.advance(1);
  assert.equal(f.peers.length,5);assert.equal(f.client.performance().peerRestarts.b,4);
});

test('an owner delivery gap resets the stability window instead of accumulating disconnected time',async t=>{
  const f=await fixture(t);await f.failures();await f.healthy(6000);await f.advance(351);await f.healthy(6000);
  f.current().connectionState='failed';await f.advance(1);assert.equal(f.peers.length,5);assert.equal(f.client.performance().peerRestarts.b,4);
});

test('fresh delivery after a paused timer cannot hide the missing interval in the stability window',async t=>{
  const f=await fixture(t);await f.failures();await f.healthy(6000);f.elapse(351);await f.healthy(6000);
  f.current().connectionState='failed';await f.advance(1);assert.equal(f.peers.length,5);assert.equal(f.client.performance().peerRestarts.b,4);
});

test('shape-valid reports rejected by the ownership receiver never renew the retry budget',async t=>{
  const f=await fixture(t,{validated:false});await f.failures();await f.healthy(12000);f.current().connectionState='failed';await f.advance(1);
  assert.equal(f.peers.length,5);assert.deepEqual(f.client.performance().peerReceipts,[]);assert.equal(f.client.performance().peerRestarts.b,4);
});

test('retired pose callbacks cannot supply health evidence to the replacement recovery window',async t=>{
  const f=await fixture(t),sender=make('b');const old=f.current().channels.get('input').onmessage;await f.failures();
  for(let i=0;i<60;i++){old({data:JSON.stringify({matchId:'connection-v43',sequence:i+100,packet,owner:encodeOwnedState(sender,'b',{epoch:1,frameSeq:i+100})})});await f.advance(200);}
  f.current().connectionState='failed';await f.advance(1);assert.equal(f.peers.length,5);assert.deepEqual(f.client.performance().peerReceipts,[]);
});
