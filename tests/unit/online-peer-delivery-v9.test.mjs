import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const map={sceneId:'delivery-v9',lines:[{lineId:0,start:[-100000,0,0],end:[100000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
const versions={referenceVersion:'fixture',presetVersion:'fixture',programVersion:'fixture'},ids=['a','b'];
const make=id=>createSimulation({profile,map,versions,networkOwnerId:id,actors:ids.map((actorId,index)=>({id:actorId,team:index,
  position:[index*10000,0,0],loadout:Array(8).fill(null)}))});
const packet={held:[],pressed:[],released:[]},settle=async()=>{for(let i=0;i<32;i++)await Promise.resolve();};
const room=(sim,epoch=1)=>({matchId:'delivery-match',snapshot:sim.snapshot(),pvp:{phase:'fight',fightTime:0,
  players:ids.map(id=>({id,alive:true,connected:true,lockUntil:null,invincibleUntil:null}))},
  ownership:{mode:'local-owner-v1',actors:Object.fromEntries(ids.map(id=>[id,{epoch,frameSeq:0}]))},owners:{}});

async function fixture(t,{receiverResult='real'}={}){
  let now=0,serial=0;const tasks=new Map(),peers=[],sources=[],posts=[],events=[],errors=[];
  const sim=make('a'),sender=make('b'),sync=createLocalOwnershipSync();
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(JSON.parse(value));}receive(value){this.onmessage?.({data:JSON.stringify(value)});}}
  class Peer{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    getStats(){return Promise.resolve(new Map([
      ['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{type:'candidate-pair',state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.02}],
      ['local',{candidateType:'host',protocol:'udp'}],['remote',{candidateType:'srflx'}]]));}
    close(){this.connectionState='closed';}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}
    emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}close(){}}
  const timers={setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}};
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,clock:()=>now,timers,rtcOptions:{enabled:false},
    fetch:async(url,options)=>{if(url==='/api/online/input')posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({accepted:true})};},
    onError:error=>errors.push(error),onEvent(type,value){events.push({type,value});
      if(type==='state'){sync.reconcile(sim,value,'a');return;}
      if(type==='owner-actions')return sync.receiveActions(value.playerId,value.actions,value.epoch,value.frameSeq);
      if(type==='peer-owned-state'){
        if(receiverResult==='leave'){const result=sync.receivePeerResult(sim,value.playerId,value.report,'a');client.clearMatch();return result;}
        if(receiverResult==='false')return false;
        if(receiverResult==='mismatch')return {validated:true,applied:false,playerId:value.playerId,epoch:value.report.epoch,frameSeq:value.report.frameSeq+1};
        return sync.receivePeerResult(sim,value.playerId,value.report,'a');
      }}});
  t.after(()=>client.close());await client.open();const match={id:'delivery-match',ownership:'local-owner-v1',players:ids.map(id=>({id}))};
  await client.setMatch(match,'a');sources[0].emit('state',room(sim));await settle();
  const control=peers[0].channels.get('control'),pose=peers[0].channels.get('input');
  control.receive({v:1,matchId:match.id,type:'hello-ack',gzip:false});
  const report=(frameSeq,epoch=1)=>encodeOwnedState(sender,'b',{epoch,frameSeq});
  return {client,sim,sender,sync,posts,events,errors,peers,control,pose,match,report,
    relay(value){sources[0].emit('owned-state',{matchId:match.id,playerId:'b',report:value});},
    deliver(value,extra={}){pose.receive({matchId:match.id,sequence:value.frameSeq,packet,owner:value,...extra});},
    state(epoch=1){sources[0].emit('state',room(sim,epoch));},
    disconnect(){sources[0].emit('disconnect',{matchId:match.id,playerId:'b'});},
    async advance(ms){now+=ms;for(const [id,task]of [...tasks])if(task.at<=now){tasks.delete(id);task.fn();}await settle();},
    acks(){return control.sent.filter(value=>value.type==='pose-ack');}};
}

test('validated same-life duplicate retains the boolean application contract and does not replay actor or attack',()=>{
  const sim=make('a'),sender=make('b'),sync=createLocalOwnershipSync();sync.reconcile(sim,room(sim),'a');
  const report=encodeOwnedState(sender,'b',{epoch:1,frameSeq:100});report.actions=[encodeCriticalAction(report,{id:5})];
  assert.equal(sync.receivePeer(sim,'b',report,'a'),true);const actor=structuredClone(sim.actor('b'));
  assert.deepEqual(sync.receivePeerResult(sim,'b',report,'a'),{validated:true,applied:false,reason:'already-applied',playerId:'b',epoch:1,frameSeq:100});
  assert.equal(sync.receivePeer(sim,'b',report,'a'),false);assert.deepEqual(sim.actor('b'),actor);assert.equal(sync.actionDiagnostics.pending,1);
});

test('SSE-first legal direct duplicate ACKs delivery and restores the direct checkpoint health',async t=>{
  const f=await fixture(t);f.client.send(packet,encodeOwnedState(f.sim,'a',{epoch:1,frameSeq:100}));await settle();
  const report=f.report(100);f.relay(report);const before=structuredClone(f.sim.actor('b'));await f.advance(5);f.deliver(report);
  assert.deepEqual(f.sim.actor('b'),before);assert.deepEqual(f.acks().map(value=>value.frameSeq),[100]);
  assert.deepEqual(f.client.performance().peerReceipts,[{playerId:'b',epoch:1,frameSeq:100}]);
  f.control.receive({v:1,matchId:f.match.id,type:'pose-ack',epoch:1,frameSeq:100});const count=f.posts.length;
  await f.advance(45);f.client.send(packet,encodeOwnedState(f.sim,'a',{epoch:1,frameSeq:103}));await settle();
  assert.equal(f.posts.length,count);assert.equal(f.client.performance().directCheckpointsDeferred,1);
  const arrival=f.client.performance().peerTransports.b.pathArrival;
  assert.equal(arrival.pairedSamples,1);assert.equal(arrival.relativeArrivalMedianMs,5);assert.equal(arrival.relayPreferred,false);assert.deepEqual(f.errors,[]);
});

test('shape-valid but invalid state references cannot create ACK, receipt or arrival comparison',async t=>{
  const f=await fixture(t),report=f.report(100);report.actor.state='not-a-real-state';f.deliver(report);
  assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);
  assert.equal(f.client.performance().peerTransports.b.pathArrival.pairedSamples,0);
});

for(const receiverResult of ['false','mismatch'])test(`${receiverResult} receiver result is not promoted into a validated duplicate`,async t=>{
  const f=await fixture(t,{receiverResult});f.deliver(f.report(100));assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);
});

test('old-life state cannot ACK or be paired after room respawn',async t=>{
  const f=await fixture(t);f.state(2);f.deliver(f.report(100,1));assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);
  assert.equal(f.sync.receivePeerResult(f.sim,'b',f.report(100,1),'a').validated,false);
});

test('a retired match callback cannot ACK or populate a replacement room',async t=>{
  const f=await fixture(t),late=f.pose.onmessage;f.client.clearMatch();late({data:JSON.stringify({matchId:f.match.id,sequence:100,packet,owner:f.report(100)})});
  assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);assert.deepEqual(f.client.connectivity(),[]);
});

test('leaving inside the receiver callback cannot confirm an otherwise legal delivery afterward',async t=>{
  const f=await fixture(t,{receiverResult:'leave'});f.deliver(f.report(100));
  assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);assert.deepEqual(f.client.connectivity(),[]);
});

test('disconnect retires direct receipt and a delayed valid report cannot revive it',async t=>{
  const f=await fixture(t);f.deliver(f.report(100));assert.equal(f.acks().length,1);const late=f.pose.onmessage;f.disconnect();
  late({data:JSON.stringify({matchId:f.match.id,sequence:103,packet,owner:f.report(103)})});
  assert.equal(f.acks().length,1);assert.deepEqual(f.client.performance().peerReceipts,[]);assert.deepEqual(f.client.connectivity(),[]);
});

test('slower RTC remains ACKed but does not suppress the faster relay after matched arrivals',async t=>{
  const f=await fixture(t);
  for(const frame of [100,103,106]){const report=f.report(frame);f.relay(report);await f.advance(30);f.deliver(report);}
  assert.deepEqual(f.acks().map(value=>value.frameSeq),[100,103,106]);assert.deepEqual(f.client.performance().peerReceipts,[]);
  const arrival=f.client.performance().peerTransports.b.pathArrival;
  assert.equal(arrival.relayPreferred,true);assert.equal(arrival.relativeArrivalMedianMs,30);assert.equal(arrival.pairedSamples,3);
});

test('matched faster RTC deliveries can restore relay suppression and compare only one arrival per path',async t=>{
  const f=await fixture(t);
  for(const frame of [100,103,106]){const report=f.report(frame);f.relay(report);await f.advance(30);f.deliver(report);}
  for(const frame of [109,112,115,118,121]){const report=f.report(frame);f.deliver(report);await f.advance(10);f.relay(report);f.relay(report);}
  const arrival=f.client.performance().peerTransports.b.pathArrival;
  assert.equal(arrival.relayPreferred,false);assert.equal(arrival.relativeArrivalMedianMs,-10);assert.equal(arrival.pairedSamples,8);
  assert.deepEqual(f.client.performance().peerReceipts,[{playerId:'b',epoch:1,frameSeq:121}]);
});

test('arrival comparison memory is bounded and repeats cannot renew direct receipt freshness',async t=>{
  const f=await fixture(t);
  for(let frame=1;frame<=200;frame++){const report=f.report(frame);f.deliver(report);f.relay(report);}
  const arrival=f.client.performance().peerTransports.b.pathArrival;
  assert.equal(arrival.retainedFrames,128);assert.equal(arrival.pairedSamples,8);assert.equal(arrival.rtcArrivals,200);assert.equal(arrival.relayArrivals,200);
  await f.advance(100);f.deliver(f.report(200));await f.advance(251);assert.deepEqual(f.client.performance().peerReceipts,[]);
});

test('selected direct route does not imply usable battle data when control is not negotiated or failed',async t=>{
  const f=await fixture(t);f.client.send(packet,encodeOwnedState(f.sim,'a',{epoch:1,frameSeq:100}));await settle();
  f.client.connectivity();await settle();let row=f.client.connectivity()[0];assert.equal(row.directRoute,true);assert.equal(row.dataUsable,true);assert.equal(row.direct,true);
  f.control.onclose();row=f.client.connectivity()[0];assert.equal(row.route,'direct');assert.equal(row.directRoute,true);
  assert.equal(row.direct,false);assert.equal(row.controlUsable,false);assert.equal(row.dataUsable,false);assert.equal(row.unavailableReason,'control-failed');
});

test('production codec commits and ACKs an SSE-first full pose, then applies an independent acknowledged delta',async t=>{
 const f=await fixture(t),codec=createOwnerPoseDelta(),first=f.report(100);f.relay(first);
 const full=codec.encode({...first,actions:[]});f.deliver(first,{owner:undefined,ownerDelta:full,poseDelta:1,controlSequence:0});
 assert.deepEqual(f.acks().map(row=>row.frameSeq),[100]);assert.equal(f.client.performance().peerTransports.b.poseReceive.fullReceived,1);
 f.sender.step(1/60,{}, {snapshot:false});const next={...f.report(103),actions:[]};const delta=codec.encode(next,{acknowledgedEpoch:1,acknowledgedFrameSeq:100});assert.equal(delta.full,false);
 f.deliver(next,{owner:undefined,ownerDelta:delta,poseDelta:1,controlSequence:0});
 assert.deepEqual(f.acks().map(row=>row.frameSeq),[100,103]);assert.equal(f.client.performance().peerTransports.b.poseReceive.deltaReceived,1);assert.deepEqual(f.errors,[]);
});

test('outgoing pose uses the negotiated codec only after a real raw snapshot ACK and reconstructs through production validation',async t=>{
 const f=await fixture(t),remote=createOwnerPoseDelta(),incoming={...f.report(1),actions:[]};
 f.deliver(incoming,{owner:undefined,ownerDelta:remote.encode(incoming),poseDelta:1,controlSequence:0});
 f.client.send(packet,encodeOwnedState(f.sim,'a',{epoch:1,frameSeq:100}));await settle();
 const first=f.pose.sent.at(-1);assert.equal(first.ownerDelta.full,true);const observer=createOwnerPoseDelta();observer.decode(first.ownerDelta).commit();
 f.control.receive({v:1,matchId:f.match.id,type:'pose-ack',epoch:1,frameSeq:100});
 f.client.send(packet,encodeOwnedState(f.sim,'a',{epoch:1,frameSeq:103}));await settle();const next=f.pose.sent.at(-1);
 assert.equal(next.ownerDelta.full,false);assert.equal(next.ownerDelta.base,100);assert.equal(observer.decode(next.ownerDelta).report.frameSeq,103);assert.deepEqual(f.errors,[]);
});

test('fenced decoded pose releases after its raw baseline was evicted without attempting to decode against that missing baseline',async t=>{
 const f=await fixture(t),codec=createOwnerPoseDelta({maximumSnapshots:64}),first={...f.report(1),actions:[]};
 const firstWire=codec.encode(first);f.deliver(first,{owner:undefined,ownerDelta:firstWire,poseDelta:1,controlSequence:0});
 const earlier=[];for(let frame=2;frame<40;frame++){const report={...f.report(frame),actions:[]};earlier.push({report,wire:codec.encode(report)});}
 const held={...f.report(40),actions:[]},delta=codec.encode(held,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});assert.equal(delta.full,false);
 f.deliver(held,{owner:undefined,ownerDelta:delta,poseDelta:1,controlSequence:1});
 for(const {report,wire}of earlier)f.deliver(report,{owner:undefined,ownerDelta:wire,poseDelta:1,controlSequence:0});
 assert.equal(f.client.performance().peerTransports.b.poseReceive.receivedSnapshots,24);
 const actionReport=f.report(1);actionReport.actions=[encodeCriticalAction(actionReport,{id:1})];
 f.control.receive({v:1,matchId:f.match.id,type:'actions',epoch:1,sequence:1,report:actionReport});
 assert.equal(f.acks().at(-1).frameSeq,40);assert.equal(f.client.performance().peerTransports.b.poseResyncs,0);assert.deepEqual(f.errors,[]);
});

test('leaving inside the real application callback cannot commit or ACK a decoded compact candidate',async t=>{
 const f=await fixture(t,{receiverResult:'leave'}),codec=createOwnerPoseDelta(),report={...f.report(100),actions:[]};
 f.deliver(report,{owner:undefined,ownerDelta:codec.encode(report),poseDelta:1,controlSequence:0});assert.deepEqual(f.acks(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);
});
