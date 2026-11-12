/** Current V55 transport fixtures. Codec stalls are controlled local faults,
 * not an original-client or WAN measurement. Victim collision remains outside
 * this adapter: no message produced here is itself permission to deal damage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {encodeNetworkBinary,decodeNetworkBinary,NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const input={held:[],pressed:[],released:[]};
const settle=async()=>{for(let n=0;n<40;n++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const decode=data=>typeof data==='string'?JSON.parse(data):decodeNetworkBinary(data);
async function fixture(t,{compress=null,binary=true}={}){
  const sources=[],peers=[],events=[],errors=[],timers=new Map();let now=0,serial=0;
  t.mock.method(globalThis,'setInterval',()=>1);t.mock.method(globalThis,'clearInterval',()=>{});
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push({value,at:now});}receive(value){this.onmessage?.({data:typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)});}}
  class Peer{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
    createDataChannel(label){const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'fixture'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}
    close(){this.connectionState='closed';}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,callback){this.listeners.set(type,callback);}
    emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}close(){}}
  const match={id:'critical-v55',ownership:'local-owner-v1',continuousAuraVersion:2,combatPlaybackVersion:1,ownerStatusVersion:1,players:[{id:'a',team:0},{id:'b',team:1}]};
  const sim=createSimulation({profile,map:{sceneId:'critical-v55',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
    networkOwnerId:'a',actors:match.players.map((p,i)=>({...p,position:[i*2000,0,0],lineId:0,loadout:Array(8).fill(null)}))});
  const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,clock:()=>now,
    timers:{setTimeout(fn,ms){const id=++serial;timers.set(id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);}},
    rtcOptions:{networkBinary:binary,...(compress?{compressBytes:compress,compress:text=>compress(new TextEncoder().encode(text))}:{})},
    fetch:async()=>({ok:true,json:async()=>({accepted:true})}),onError:error=>errors.push(error),
    onEvent(type,data){events.push({type,data,at:now});if(type==='owner-actions')return true;
      if(type==='peer-owned-state')return {validated:true,applied:true,playerId:data.playerId,epoch:data.report.epoch,frameSeq:data.report.frameSeq};return true;}});
  t.after(()=>client.close());await client.open();await client.setMatch(match,'a');
  const state=(epoch=1)=>sources[0].emit('state',{matchId:match.id,snapshot:sim.snapshot(),ownership:{actors:{a:{epoch},b:{epoch}}}});state();await settle();
  const control=peers[0].channels.get('control'),motion=peers[0].channels.get('input');
  control.receive({v:1,matchId:match.id,type:'hello-ack',gzip:true,controlDelta:1,...(binary?{networkBinaryVersion:NETWORK_BINARY_VERSION}:{})});
  const report=(frame,{id='b',epoch=1,actions=true}={})=>{const result=encodeOwnedState(sim,id,{epoch,frameSeq:frame});
    result.actor.sourceStatusClock={version:1,revision:1,frameSeq:frame};
    if(actions){const action=encodeCriticalAction(result,{id:frame});action.playback={version:1,start:true,held:[]};result.actions=[action];}return result;};
  const action=(sequence,opts={})=>({v:1,matchId:match.id,type:'actions',sequence,report:report(sequence,opts)});
  return {client,control,motion,events,errors,sim,match,report,action,state,
    async advance(ms){now+=ms;for(const [id,row]of [...timers])if(row.at<=now){timers.delete(id);row.fn();}await settle();},
    accepted:()=>events.filter(row=>row.type==='owner-actions'),wire:()=>client.performance().peerControls.b.wire};
}
function heldDecode(t){const pending=gate();let started=0;
  t.mock.method(globalThis,'DecompressionStream',function(){return new TransformStream({async transform(chunk,controller){started++;await pending.promise;controller.enqueue(new Uint8Array(gunzipSync(chunk)));}});});
  t.after(()=>pending.resolve());return {...pending,started:()=>started};}

test('raw critical action bypasses an independent Buff native decode stall with no hit or damage message',async t=>{
  const f=await fixture(t),held=heldDecode(t);
  f.motion.receive({matchId:f.match.id,sequence:0,packet:input,buffSyncVersion:2});
  const buff={type:'buff-sync',v:2,matchId:f.match.id,ownerId:'b',requesterId:'a',kind:'snapshot',snapshot:{version:1,epoch:1,revision:1,frameSeq:0,buffs:[]}};
  f.control.receive(new Uint8Array(gzipSync(JSON.stringify(buff))));await settle();assert.equal(held.started(),1);
  await f.advance(120);
  f.control.receive(encodeNetworkBinary(f.action(1)));await settle();
  assert.deepEqual(f.accepted().map(row=>row.data.actions[0].id),[1]);
  assert.equal(f.accepted()[0].at,120);
  assert.equal(f.events.some(row=>['hit','damage','combat-hit'].includes(row.type)),false);
  assert.equal(f.wire().rawCriticalBypasses,1);
  console.log('V55_CRITICAL_RAW_RECEIVE',JSON.stringify({stalledBuffBeforeActionMs:120,rawActionArrivalMs:120,actionAdmissionMs:f.accepted()[0].at,addedActionPackets:0}));
  held.resolve();await settle();assert.equal(f.accepted().length,1);assert.deepEqual(f.errors,[]);
});

test('raw later action retains sequence and delta dependency behind a held earlier action',async t=>{
  const f=await fixture(t),held=heldDecode(t),delta=createPeerControlDelta();
  const first=f.action(1),second=f.action(2);first.report=delta.encode(first.report);second.report=delta.encode(second.report);
  f.control.receive(new Uint8Array(gzipSync(JSON.stringify(first))));await settle();
  f.control.receive(encodeNetworkBinary(second));await settle();assert.equal(f.accepted().length,0);
  assert.equal(f.client.performance().peerControls.b.pendingReceive,1);
  held.resolve();await settle();assert.deepEqual(f.accepted().map(row=>row.data.actions[0].id),[1,2]);
  f.control.receive(encodeNetworkBinary(second));assert.equal(f.accepted().length,2);assert.deepEqual(f.errors,[]);
});


test('raw action fast admission never bypasses an earlier fragmented control identity',async t=>{
  const f=await fixture(t),held=heldDecode(t),text=JSON.stringify(f.action(1)),middle=Math.floor(text.length/2);
  const fragment=part=>({v:1,matchId:f.match.id,type:'fragment',epoch:1,sequence:1,part,parts:2,text:part?text.slice(middle):text.slice(0,middle)});
  f.control.receive(new Uint8Array(gzipSync(JSON.stringify(fragment(0)))));await settle();
  f.control.receive(fragment(1));f.control.receive(encodeNetworkBinary(f.action(2)));await settle();
  assert.equal(f.accepted().length,0);assert.equal(f.client.performance().peerControls.b.pendingReceive,1);
  held.resolve();await settle();assert.deepEqual(f.accepted().map(row=>row.data.actions[0].id),[1,2]);assert.deepEqual(f.errors,[]);
});

test('raw critical fast admission retains match, life, finished-match and retired-channel gates',async t=>{
  const f=await fixture(t),first=f.action(1);
  f.control.receive({...first,matchId:'previous-match'});assert.equal(f.accepted().length,0);
  f.control.receive(first);assert.equal(f.accepted().length,1);
  f.control.receive(f.action(2,{epoch:0}));assert.equal(f.accepted().length,1);
  await f.client.refreshMatch({...f.match,status:'settling'},'a');
  f.control.receive(f.action(2));assert.equal(f.accepted().length,1);
  const stale=f.control.onmessage;f.client.clearMatch();stale({data:encodeNetworkBinary(f.action(3))});
  assert.equal(f.accepted().length,1);assert.deepEqual(f.errors,[]);
});

test('small canonical actions fall back after16ms once, preserving FIFO with only one unresolved native encoder',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='actions'){jobs.push({value,bytes});return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  const sent=()=>f.control.sent.filter(row=>typeof row.value!=='string').map(row=>({...row,packet:decode(row.value)}));
  f.client.send(input,f.report(1,{id:'a'}));await settle();assert.equal(jobs.length,1);assert.equal(sent().length,0);
  await f.advance(15);assert.equal(sent().length,0);await f.advance(1);
  assert.equal(sent().length,1);assert.equal(sent()[0].at,16);assert.ok(sent()[0].value.byteLength<=8192);
  const second=f.report(2,{id:'a'});second.actor.fired=['some-'+ 'abcdefghijklmnop'.repeat(50)];second.actions=[{...encodeCriticalAction(second,{id:2}),playback:{version:1,start:true,held:[]}}];f.client.send(input,second);await settle();assert.equal(jobs.length,1,'one unresolved encoder, not one new job per fallback');
  assert.deepEqual(sent().map(row=>row.packet.sequence),[1,2]);
  const bytes=sent().reduce((sum,row)=>sum+row.value.byteLength,0);
  assert.equal(f.wire().criticalCompressionFallbacks,2);assert.equal(f.wire().criticalRawFallbackBytes,bytes);
  held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();assert.equal(sent().length,2,'late compression never sends a duplicate');
  console.log('V55_CRITICAL_CODEC',JSON.stringify({budgetMs:16,rawLimitBytes:8192,canonicalPackets:2,actualPackets:sent().length,
    rawBytes:bytes,compressedReferenceBytes:sent().reduce((sum,row)=>sum+gzipSync(row.value).byteLength,0),firstSentAtMs:sent()[0].at,nativeJobs:jobs.length}));
  assert.deepEqual(f.errors,[]);
});

test('small action overtakes only an independent Buff encoder and respects real SCTP backpressure',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='buff-sync'){jobs.push({value,bytes});return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  f.motion.receive({matchId:f.match.id,sequence:0,packet:input,buffSyncVersion:2});
  f.sim.actor('a').buffs=Array.from({length:16},(_,i)=>({schemaVersion:1,templateId:i+1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
    behaviors:[],finalizers:[],displayer:{},sourceActorId:'a',targetActorId:'a',factorId:i+1,accumulationCount:1}));
  f.client.send(input,f.report(1,{id:'a',actions:false}));await settle();assert.equal(jobs.length,1,'bounded independent Buff compressed');
  f.control.bufferedAmount=128*1024+1;f.client.send(input,f.report(2,{id:'a'}));await settle();
  assert.equal(f.wire().criticalBuffBypasses,0);assert.equal(f.control.sent.filter(row=>typeof row.value!=='string').length,0);
  await f.advance(90);f.control.bufferedAmount=0;f.control.onbufferedamountlow();await settle();
  const actions=f.control.sent.filter(row=>typeof row.value!=='string').map(row=>({...row,packet:decode(row.value)}));
  assert.deepEqual(actions.map(row=>row.packet.type),['actions']);assert.equal(f.wire().criticalBuffBypasses,1);
  assert.ok(actions[0].value.byteLength<=8192);assert.equal(actions[0].at,90);
  held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();
  assert.equal(f.control.sent.filter(row=>typeof row.value!=='string').length,2,'one action and one repair, no extra packet');assert.deepEqual(f.errors,[]);
});

test('large action keeps compression and prevents a later small action overtaking its causal sequence',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='actions'){jobs.push({value,bytes});if(jobs.length===1)return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  const first=f.report(1,{id:'a'});first.actor.fired=Array.from({length:120},(_,i)=>`${i}-`+'abcdefghijklmnop'.repeat(6));
  first.actions=[{...encodeCriticalAction(first,{id:1}),playback:{version:1,start:true,held:[]}}];
  f.client.send(input,first);await settle();assert.ok(jobs[0].bytes.byteLength>8192);
  f.client.send(input,f.report(2,{id:'a'}));await settle();await f.advance(16);
  assert.equal(f.control.sent.filter(row=>typeof row.value!=='string').length,0);assert.equal(f.wire().criticalCompressionFallbacks,0);assert.equal(jobs.length,1);
  held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();
  const packets=f.control.sent.filter(row=>typeof row.value!=='string').map(row=>decodeNetworkBinary(row.value[0]===0x45?row.value:new Uint8Array(gunzipSync(row.value))));
  assert.deepEqual(packets.map(row=>row.sequence),[1,2]);assert.deepEqual(f.errors,[]);
});

test('expired asynchronous action cannot send an old-life control after a new authoritative life',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='actions'){jobs.push({value,bytes});return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  f.client.send(input,f.report(1,{id:'a'}));await settle();f.state(2);
  f.client.send(input,f.report(2,{id:'a',epoch:2}));await settle();await f.advance(16);
  const sent=()=>f.control.sent.filter(row=>typeof row.value!=='string').map(row=>decode(row.value));
  assert.deepEqual(sent().map(row=>[row.report.epoch,row.sequence]),[[2,1]]);
  held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();assert.equal(sent().length,1);assert.deepEqual(f.errors,[]);
});



test('raw bypass byte budget is finite and refills without increasing canonical packet count',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='buff-sync'){jobs.push({value,bytes});return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  f.motion.receive({matchId:f.match.id,sequence:0,packet:input,buffSyncVersion:2});
  f.sim.actor('a').buffs=Array.from({length:16},(_,i)=>({schemaVersion:1,templateId:i+1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
    behaviors:[],finalizers:[],displayer:{},sourceActorId:'a',targetActorId:'a',factorId:i+1,accumulationCount:1}));
  f.client.send(input,f.report(1,{id:'a',actions:false}));await settle();assert.equal(jobs.length,1);
  const sent=()=>f.control.sent.filter(row=>typeof row.value!=='string').map(row=>({...row,packet:decode(row.value)}));
  let generated=0;
  for(let frame=2;frame<20;frame++){
    const report=f.report(frame,{id:'a'});report.actor.fired=frame===2?[]:[`${frame}-`+'abcdefghijklmnop'.repeat(130)];
    report.actions=[{...encodeCriticalAction(report,{id:frame}),playback:{version:1,start:true,held:[]}}];
    const before=sent().length;f.client.send(input,report);generated++;await settle();
    if(sent().length===before)break;
    f.control.receive({v:1,matchId:f.match.id,type:'ack',epoch:1,sequence:sent().at(-1).packet.sequence});
  }
  const before=sent();assert.ok(before.length>=2);assert.equal(before.length,generated-1,'one canonical action waits after raw budget exhaustion');
  assert.ok(before.every(row=>row.value.byteLength<=8192));assert.ok(f.wire().criticalRawFallbackBytes<=32768);
  const bytesBefore=f.wire().criticalRawFallbackBytes;
  await f.advance(500);f.control.onbufferedamountlow();await settle();
  assert.equal(sent().length,generated,'16KiB/sec refill resumes the same waiting action');
  assert.ok(f.wire().criticalRawFallbackBytes<=32768+8192);
  assert.deepEqual(sent().map(row=>row.packet.sequence),Array.from({length:generated},(_,i)=>i+1));
  console.log('V55_CRITICAL_BUDGET',JSON.stringify({burstBytes:32768,refillBytesPerSecond:16384,bytesBefore,bytesAfter:f.wire().criticalRawFallbackBytes,
    generatedActions:generated,sentActions:sent().length,refillMs:500,nativeJobs:jobs.length}));
  held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();
  const final=f.control.sent.filter(row=>typeof row.value!=='string').map(row=>decodeNetworkBinary(row.value[0]===0x45?row.value:new Uint8Array(gunzipSync(row.value))));
  assert.equal(final.filter(row=>row.type==='actions').length,generated,'existing Buff repair retries never duplicate canonical actions');
  assert.deepEqual(f.errors,[]);
});


test('a failed raw priority send retains the canonical row without miscounting its later compressed retry as raw',async t=>{
  const held=gate(),jobs=[];t.after(()=>held.resolve(new Uint8Array(gzipSync(jobs[0]?.bytes??new Uint8Array()))));
  const f=await fixture(t,{compress:bytes=>{const value=decode(bytes);if(value.type==='buff-sync'){jobs.push({value,bytes});return held.promise;}return Promise.resolve(new Uint8Array(gzipSync(bytes)));}});
  f.motion.receive({matchId:f.match.id,sequence:0,packet:input,buffSyncVersion:2});
  f.sim.actor('a').buffs=Array.from({length:16},(_,i)=>({schemaVersion:1,templateId:i+1,skillLevel:1,accumulationLimit:1,resistance:0,durationMultiplier:1,
    behaviors:[],finalizers:[],displayer:{},sourceActorId:'a',targetActorId:'a',factorId:i+1,accumulationCount:1}));
  f.client.send(input,f.report(1,{id:'a',actions:false}));await settle();assert.equal(jobs.length,1);
  const original=f.control.send;let failed=false,blocked=true;f.control.send=function(value){
    if(blocked&&typeof value!=='string'&&value[0]===0x45&&decode(value).type==='actions'){failed=true;throw Error('controlled-send-pressure');}
    original.call(this,value);
  };
  f.client.send(input,f.report(2,{id:'a'}));await settle();assert.equal(failed,true);assert.equal(f.wire().criticalRawFallbackBytes,0);
  blocked=false;held.resolve(new Uint8Array(gzipSync(jobs[0].bytes)));await settle();
  const packets=f.control.sent.filter(row=>typeof row.value!=='string').map(row=>decodeNetworkBinary(row.value[0]===0x45?row.value:new Uint8Array(gunzipSync(row.value))));
  assert.equal(packets.filter(row=>row.type==='actions').length,1);assert.equal(f.wire().criticalRawFallbackBytes,0);assert.equal(f.wire().criticalBuffBypasses,0);
  assert.deepEqual(f.errors,[]);
});
