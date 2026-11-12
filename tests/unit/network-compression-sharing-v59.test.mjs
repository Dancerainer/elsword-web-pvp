import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createBinaryCompressionCache} from '../../packages/online/binary-compression-cache.mjs';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {decodeNetworkBinary,NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {readFileSync} from 'node:fs';
const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const packed=bytes=>{const out=new Uint8Array(gzipSync(bytes));return out.length<bytes.length?out:bytes;};

test('identical independent inputs share native compression and retain an immutable input',async()=>{
 const held=gate();let jobs=0;const cache=createBinaryCompressionCache({compress:async bytes=>{jobs++;await held.promise;return packed(bytes);}});
 const input=Uint8Array.from({length:2048},(_,i)=>i%7),expected=input.slice();
 const a=cache.encode(input),b=cache.encode(input.slice());assert.equal(a,b);input.fill(255);
 await settle();assert.equal(jobs,1);held.resolve();const [first,second]=await Promise.all([a,b]);
 assert.equal(first,second);assert.deepEqual(new Uint8Array(gunzipSync(first)),expected);assert.equal(cache.performance().shared,1);
});

test('bounded cache evicts pending records without cancelling existing consumers or confusing new entries',async()=>{
 const held=gate();let jobs=0;const cache=createBinaryCompressionCache({maximumEntries:1,maximumBytes:32,compress:async bytes=>{jobs++;await held.promise;return bytes;}});
 const a=cache.encode(new Uint8Array([1,2])),b=cache.encode(new Uint8Array([1,3]));
 assert.equal(cache.performance().entries,1);assert.ok(cache.performance().reservedBytes<=32);
 cache.discardPending(a);assert.equal(cache.performance().entries,1);cache.clear();
 const c=cache.encode(new Uint8Array([1,2]));assert.notEqual(c,a);held.resolve();
 assert.deepEqual(await a,new Uint8Array([1,2]));assert.deepEqual(await b,new Uint8Array([1,3]));assert.deepEqual(await c,new Uint8Array([1,2]));assert.equal(jobs,3);
});

test('failed encodes are removed and oversized retained results are rejected',async()=>{
 let fail=true;const cache=createBinaryCompressionCache({compress:async bytes=>{if(fail)throw Error('fixture');return bytes;}});
 await assert.rejects(cache.encode(new Uint8Array([1])),/fixture/);assert.equal(cache.performance().entries,0);
 fail=false;assert.deepEqual(await cache.encode(new Uint8Array([1])),new Uint8Array([1]));
 const bad=createBinaryCompressionCache({compress:async()=>new Uint8Array(2)});
 await assert.rejects(bad.encode(new Uint8Array(1)),/cache-result/);assert.equal(bad.performance().entries,0);
});

test('one current action broadcast to three peers compresses once and preserves each recipient sequence',async t=>{
 t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});
 const peers=[],sources=[],errors=[],jobs=[];
 class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
  send(value){this.sent.push(value);}receive(value){this.onmessage?.({data:JSON.stringify(value)});}}
 class Peer{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
  createDataChannel(label){const c=new Channel(label);this.channels.set(label,c);return c;}
  async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}close(){}}
 class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}close(){}}
 const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
 const match={id:'sharing-v59',ownership:'local-owner-v1',continuousAuraVersion:2,combatPlaybackVersion:1,ownerStatusVersion:1,players:['a','b','c','d'].map((id,i)=>({id,team:i%2}))};
 const sim=createSimulation({profile,map:{sceneId:'sharing-v59',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
  networkOwnerId:'a',actors:match.players.map((p,i)=>({...p,position:[i*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
 const held=gate();t.after(()=>held.resolve());
 const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,clock:()=>0,
  fetch:async()=>({ok:true,json:async()=>({accepted:true})}),onError:e=>errors.push(e),onEvent:()=>true,
  rtcOptions:{compressBytes:async bytes=>{jobs.push(bytes.slice());await held.promise;return packed(bytes);}}});
 t.after(()=>client.close());await client.open();await client.setMatch(match,'a');
 sources[0].emit('state',{matchId:match.id,snapshot:sim.snapshot(),ownership:{actors:Object.fromEntries(match.players.map(p=>[p.id,{epoch:1}]))}});await settle();
 for(const peer of peers)peer.channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip:true,controlDelta:1,networkBinaryVersion:NETWORK_BINARY_VERSION});
 const report=encodeOwnedState(sim,'a',{epoch:1,frameSeq:1});report.actor.sourceStatusClock={version:1,revision:1,frameSeq:1};
 report.actions=[{...encodeCriticalAction(report,{id:1}),playback:{version:1,start:true,held:[]}}];
 client.send({held:[],pressed:[],released:[]},report);await settle();
 assert.equal(jobs.length,1);assert.equal(client.performance().controlCompression.binary.shared,2);
 held.resolve();await settle();const deliveries=[];
 for(const peer of peers){const sent=peer.channels.get('control').sent.filter(x=>typeof x!=='string');assert.equal(sent.length,1);
  const value=decodeNetworkBinary(sent[0][0]===0x45?sent[0]:new Uint8Array(gunzipSync(sent[0])));deliveries.push(value);
  assert.equal(value.sequence,1);assert.equal(createPeerControlDelta().decode(value.report).actions[0].id,1);}
 assert.deepEqual(deliveries[0],deliveries[1]);assert.deepEqual(deliveries[1],deliveries[2]);assert.deepEqual(errors,[]);
 console.log('V59_SHARED_CONTROL',JSON.stringify({recipients:3,nativeCompressions:jobs.length,shared:2,packets:deliveries.length,inputBytes:jobs[0].length}));
});
