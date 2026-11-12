/** Current V54 adapter only. Controlled native decode stalls, delay and loss
 * are transport fixtures, not original-client or WAN performance evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {encodeNetworkBinary,decodeNetworkBinary,NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';

const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const input={held:[],pressed:[],released:[]};
const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const decode=value=>typeof value==='string'?JSON.parse(value):decodeNetworkBinary(value);

async function fixture(t,{count=2,binary=true,pageInitToken=null}={}){
  const sources=[],peers=[],events=[],errors=[],requests=[],tasks=new Map();let now=0,serial=0;
  t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(value);}receive(value){this.onmessage?.({data:typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)});}}
  class Peer{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,callback){this.listeners.set(type,callback);}
    emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}close(){}}
  const players=Array.from({length:count},(_,i)=>({id:String.fromCharCode(97+i),team:i%2}));
  const match={id:'transport-v54',ownership:'local-owner-v1',continuousAuraVersion:2,combatPlaybackVersion:1,ownerStatusVersion:1,players};
  const sim=createSimulation({profile,map:{sceneId:'transport-v54',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    networkOwnerId:'a',actors:players.map((p,i)=>({...p,position:[i*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,clock:()=>now,pageInitToken,
    timers:{setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}},
    rtcOptions:{enabled:false,networkBinary:binary},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({accepted:true})};},
    onError:error=>errors.push(error),onEvent(type,data){events.push({type,data,at:now});
      if(type==='owner-actions')return true;
      if(type==='peer-owned-state')return {validated:true,applied:true,playerId:data.playerId,epoch:data.report.epoch,frameSeq:data.report.frameSeq};return true;}});
  t.after(()=>client.close());await client.open();await client.setMatch(match,'a');
  sources[0].emit('state',{matchId:match.id,snapshot:sim.snapshot(),ownership:{actors:Object.fromEntries(players.map(p=>[p.id,{epoch:1,frameSeq:0}]))}});
  await settle();
  for(const peer of peers)peer.channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip:false,...(binary?{networkBinaryVersion:NETWORK_BINARY_VERSION}:{})});
  const report=(frame,{large=false,epoch=1,id='b'}={})=>{
    const value=encodeOwnedState(sim,id,{epoch,frameSeq:frame});
    value.actor.x=frame;value.actor.sourceStatusClock={version:1,revision:1,frameSeq:frame};
    // Valid wire history makes the independent EWNB packet exceed 8 KiB.
    // This exercises the transport bound, not a claim about a real skill.
    if(large)value.actor.fired=Array.from({length:120},(_,i)=>`${i}-`+'abcdefghijklmnop'.repeat(6));
    return validateOwnedState(value);
  };
  const envelope=(value,extra={})=>({matchId:match.id,sequence:value.frameSeq,packet:input,owner:value,...extra});
  return {client,peers,events,errors,requests,match,report,envelope,source:sources[0],
    channel:index=>peers[index??0].channels.get('input'),
    async advance(ms){now+=ms;for(const [id,row]of [...tasks])if(row.at<=now){tasks.delete(id);row.fn();}await settle();},
    now:()=>now,poses:()=>events.filter(row=>row.type==='peer-owned-state'),
    state(epoch){sources[0].emit('state',{matchId:match.id,snapshot:sim.snapshot(),ownership:{actors:Object.fromEntries(players.map(p=>[p.id,{epoch,frameSeq:0}]))}});}};
}

function holdNativeDecode(t){
  const gate=deferred();let started=0;
  t.mock.method(globalThis,'DecompressionStream',function(){
    return new TransformStream({async transform(chunk,controller){started++;await gate.promise;controller.enqueue(new Uint8Array(gunzipSync(chunk)));}});
  });
  return {...gate,started:()=>started};
}

test('large independent raw full pose bypasses a held gzip job; its timeout cannot revoke fresh delivery',async t=>{
  const f=await fixture(t),native=holdNativeDecode(t),channel=f.channel();
  channel.receive(new Uint8Array(gzipSync(JSON.stringify(f.envelope(f.report(1))))));await settle();assert.equal(native.started(),1);
  await f.advance(900);
  const full=encodeNetworkBinary(f.envelope(f.report(55,{large:true})));assert.ok(full.byteLength>8192);
  channel.receive(full);
  assert.deepEqual(f.poses().map(row=>row.data.report.frameSeq),[55]);
  assert.deepEqual(f.client.performance().peerReceipts,[{playerId:'b',epoch:1,frameSeq:55}]);
  await f.advance(100);
  assert.equal(f.client.performance().peerTransports.b.independentRawBypasses,1);
  assert.equal(f.client.performance().peerTransports.b.decodeFailures,1);
  assert.deepEqual(f.client.performance().peerReceipts,[{playerId:'b',epoch:1,frameSeq:55}]);
  native.resolve();await settle();assert.deepEqual(f.poses().map(row=>row.data.report.frameSeq),[55]);assert.deepEqual(f.errors,[]);
});

test('large baseline-dependent delta waits for its held full baseline and is reconstructed without loss',async t=>{
  const f=await fixture(t),native=holdNativeDecode(t),channel=f.channel(),sender=createOwnerPoseDelta();
  const first=f.report(1),firstPacket=sender.encode(first,{version:2});
  channel.receive(new Uint8Array(gzipSync(JSON.stringify({...f.envelope(first),owner:undefined,ownerDelta:firstPacket}))));await settle();
  const next=f.report(2,{large:true});next.actor.fired=Array.from({length:120},(_,i)=>`new-${i}-`+'ZYXWVUTSRQPONMLK'.repeat(6));
  const delta=sender.encode(next,{version:2,acknowledgedEpoch:1,acknowledgedFrameSeq:1});assert.equal(delta.full,false);
  const wire=encodeNetworkBinary({...f.envelope(next),owner:undefined,ownerDelta:delta});assert.ok(wire.byteLength>8192);
  channel.receive(wire);assert.equal(f.poses().length,0);native.resolve();await settle();
  assert.deepEqual(f.poses().map(row=>row.data.report.frameSeq),[1,2]);
  assert.deepEqual(f.poses()[1].data.report,next);assert.equal(f.client.performance().peerTransports.b.poseDeltaRejected,0);assert.deepEqual(f.errors,[]);
});

test('raw full bypass retains match/life/schema and control-frontier admission boundaries',async t=>{
  const f=await fixture(t),native=holdNativeDecode(t),channel=f.channel();
  channel.receive(new Uint8Array(gzipSync(JSON.stringify(f.envelope(f.report(1))))));await settle();
  const good=f.report(3,{large:true}),invalid=structuredClone(good);invalid.actor.hp='invalid';
  for(const value of [{...f.envelope(good),matchId:'old-match'},f.envelope({...good,epoch:0}),f.envelope(invalid),f.envelope(good,{controlSequence:1})])channel.receive(encodeNetworkBinary(value));
  assert.deepEqual(f.poses(),[]);assert.deepEqual(f.client.performance().peerReceipts,[]);
  assert.equal(f.client.performance().peerControls.b.pendingPoses,1);
  f.client.clearMatch();native.resolve();await settle();assert.deepEqual(f.poses(),[]);assert.deepEqual(f.errors,[]);
});

test('2v2 fanout reuses common motion/status/owner work while each peer retains its own pose baseline and current data',async t=>{
  const f=await fixture(t,{count:4});
  for(let i=0;i<3;i++)f.channel(i).receive(f.envelope(f.report(1,{id:String.fromCharCode(98+i)}),{motionVersion:1,motionMaxVersion:2,poseDelta:2}));
  const before=f.client.performance().peerCompression;
  f.client.send(input,f.report(2,{id:'a'}));await settle();
  const after=f.client.performance().peerCompression;
  for(const [built,reused]of [['motionEncodings','sharedMotionEncodings'],['statusEncodings','sharedStatusEncodings'],['ownerPreparations','sharedOwnerPreparations']]){
    assert.equal(after[built]-before[built],1,built);assert.equal(after[reused]-before[reused],2,reused);
  }
  const first=f.peers.map(peer=>peer.channels.get('input').sent.map(decode));
  for(const rows of first){assert.equal(rows.filter(row=>row.motionOnly).length,1);assert.equal(rows.filter(row=>row.statusOnly).length,1);assert.equal(rows.filter(row=>row.ownerDelta).length,1);}
  for(let i=0;i<3;i++){const raw=f.peers[i].channels.get('input').sent;assert.equal(raw[0],f.peers[0].channels.get('input').sent[0]);assert.deepEqual(first[i],first[0]);}
  f.peers[0].channels.get('control').receive({v:1,matchId:f.match.id,type:'pose-ack',epoch:1,frameSeq:2});
  f.client.send(input,f.report(3,{id:'a'}));await settle();
  const last=f.peers.map(peer=>peer.channels.get('input').sent.map(decode).findLast(row=>row.ownerDelta));
  assert.equal(last[0].ownerDelta.full,false);assert.equal(last[0].ownerDelta.base,2);
  assert.equal(last[1].ownerDelta.full,true);assert.equal(last[2].ownerDelta.full,true);
  assert.ok(last.every(row=>row.sequence===3));assert.deepEqual(f.errors,[]);
});

test('random delayed/lost independent full datagrams progress during a single stalled native job',async t=>{
  const f=await fixture(t),native=holdNativeDecode(t),channel=f.channel();
  channel.receive(new Uint8Array(gzipSync(JSON.stringify(f.envelope(f.report(1))))));await settle();
  let seed=20165417;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const arrivals=[];let lost=0,duplicate=0,totalBytes=0;
  for(let frame=2;frame<=50;frame++){
    const wire=encodeNetworkBinary(f.envelope(f.report(frame,{large:true})));totalBytes+=wire.byteLength;
    if(random()<.30){lost++;continue;}
    const at=frame*12+Math.floor(random()*120);arrivals.push({frame,wire,at});
    if(random()<.15){duplicate++;arrivals.push({frame,wire,at:at+Math.floor(random()*60)});}
  }
  arrivals.sort((a,b)=>a.at-b.at);let frontier=1,applied=0;
  for(const row of arrivals){await f.advance(row.at-f.now());const before=f.poses().length;channel.receive(row.wire);
    if(row.frame>frontier){assert.equal(f.poses().length,before+1);assert.equal(f.poses().at(-1).at,row.at);frontier=row.frame;applied++;}
    else assert.equal(f.poses().length,before);}
  assert.equal(native.started(),1);assert.ok(applied>15);assert.ok(lost>0);assert.ok(duplicate>0);
  const evidence={seed:20165417,sourcePackets:49,lost,duplicates:duplicate,deliveredPackets:arrivals.length,appliedFresh:applied,
    firstAppliedAtMs:f.poses()[0].at,lastAppliedFrame:frontier,rawSourceBytes:totalBytes,addedNetworkPackets:0,
    independentRawBypasses:f.client.performance().peerTransports.b.independentRawBypasses,
    currentFreshArrivalToCallbackMs:0,oldLargeRawFifo:'static code: waits for native job; baseline was not executed'};
  console.log('V54_TRANSPORT_RANDOM '+JSON.stringify(evidence));
  native.resolve();await settle();assert.equal(f.poses().at(-1).data.report.frameSeq,frontier);assert.deepEqual(f.errors,[]);
});

test('disconnect tombstone survives same-life metadata and a rebound match, then only a connected newer authority reopens RTC',async t=>{
  const f=await fixture(t),oldChannel=f.channel(),late=oldChannel.onmessage,base=structuredClone(f.events.find(row=>row.type==='state').data);
  f.source.emit('disconnect',{matchId:f.match.id,playerId:'b'});
  assert.deepEqual(f.client.performance().disconnectedPlayers,['b']);assert.equal(f.client.connectivity().length,0);
  await f.client.refreshMatch({...f.match,players:f.match.players.map(p=>({...p,connected:true}))},'a');
  await f.client.setMatch(f.match,'a');
  const restore=(epoch,connected=true)=>({...structuredClone(base),ownership:{actors:{a:{epoch:1,frameSeq:0},b:{epoch,frameSeq:0}}},
    pvp:{phase:'fight',players:[{id:'a',connected:true},{id:'b',connected}]}});
  f.source.emit('state',restore(1));await settle();assert.equal(f.client.connectivity().length,0);
  f.source.emit('state',restore(2,false));await settle();assert.equal(f.client.connectivity().length,0);
  f.source.emit('state',restore(2));await settle();assert.equal(f.client.connectivity().length,0,'a rejected/departed life cannot revive at its own epoch');
  f.source.emit('state',restore(3));await settle();assert.equal(f.client.connectivity().length,1);
  assert.deepEqual(f.client.performance().disconnectedPlayers,[]);assert.equal(f.peers.length,2);
  const disconnectedCallbacks=f.events.filter(row=>row.type==='disconnect').length;
  f.source.emit('state',restore(2,false));f.source.emit('disconnect',{matchId:f.match.id,playerId:'b',epoch:2});await settle();
  assert.equal(f.client.connectivity().length,1);assert.deepEqual(f.client.performance().disconnectedPlayers,[]);
  assert.equal(f.events.filter(row=>row.type==='disconnect').length,disconnectedCallbacks,'the game consumer must not see a rejected old disconnect either');
  late({data:JSON.stringify(f.envelope(f.report(99)))});assert.deepEqual(f.poses(),[]);
  const current=f.peers.at(-1);current.channels.get('control').receive({v:1,matchId:f.match.id,type:'hello-ack',gzip:false,networkBinaryVersion:NETWORK_BINARY_VERSION});
  current.channels.get('input').receive(encodeNetworkBinary(f.envelope(f.report(1,{epoch:3}))));
  assert.deepEqual(f.poses().map(row=>row.data.report.epoch),[3]);assert.deepEqual(f.errors,[]);
});

test('reconnect-ended retires peer/input state and a fresh owner life retains monotonic transport packet sequence',async t=>{
  const pageInitToken='v54-current-page-token',f=await fixture(t,{pageInitToken});
  await f.client.ready(f.match.id);await f.client.loadingProgress(f.match.id,90);
  for(const url of ['/api/online/ready','/api/online/loading-progress'])assert.equal(f.requests.find(row=>row.url===url)?.options.headers['X-RF-Page-Init'],pageInitToken);
  assert.equal(f.client.send(input,f.report(100,{id:'a'})),100);await settle();
  assert.equal(f.client.send(input,f.report(0,{id:'a',epoch:2})),101);await settle();
  f.channel().receive(f.envelope(f.report(10)));assert.equal(f.client.remoteInput('b').frameSeq,10);
  f.source.emit('reconnect-ended',{matchId:'unrelated'});assert.equal(f.client.connectivity().length,1);
  f.source.emit('reconnect-ended',{matchId:f.match.id});assert.deepEqual(f.client.connectivity(),[]);
  assert.deepEqual(f.client.remoteInput('b').held,[]);assert.equal(f.client.remoteInput('b').frameSeq,undefined);
  assert.equal(f.client.send(input,f.report(102,{id:'a'})),undefined);
  assert.equal(f.events.filter(row=>row.type==='reconnect-ended').length,1);
  f.source.emit('reconnect-ended',{matchId:f.match.id});assert.equal(f.events.filter(row=>row.type==='reconnect-ended').length,2);
  assert.deepEqual(f.errors,[]);
});
