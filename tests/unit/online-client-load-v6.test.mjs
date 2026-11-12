import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {encodeOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';

const response=value=>({ok:true,status:200,json:async()=>value});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const packet={held:[],pressed:[],released:[]};
const encode=text=>new TextEncoder().encode(text);
const parse=value=>JSON.parse(typeof value==='string'?value:new TextDecoder().decode(value));
const simulation=await make();
const base=encodeOwnedState(simulation,'rf',{epoch:1,frameSeq:0});
function owner(frameSeq,ids=[],epoch=1){
  const report=structuredClone(base);report.frameSeq=frameSeq;report.epoch=epoch;report.actor.stateTime=frameSeq/60;
  report.actions=ids.map(id=>encodeCriticalAction(report,{id}));return report;
}
function timers(){
  let serial=0;const tasks=new Map();return {tasks,setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,ms});return id;},clearTimeout(id){tasks.delete(id);},
    run(ms){const row=[...tasks].find(([,task])=>task.ms===ms);assert.ok(row,'timer '+ms);tasks.delete(row[0]);row[1].fn();}};
}
async function fixture(run,{players=2,Peer=true,peerMode='hybrid',maximumOwnerCredits=8,legacy=false,compress=async text=>encode(text),decode=async bytes=>parse(bytes),socketCompress=async text=>encode(text),httpHold=false}={}){
  const previousInterval=globalThis.setInterval,previousClear=globalThis.clearInterval,intervals=[];
  globalThis.setInterval=fn=>{intervals.push(fn);return intervals.length;};globalThis.clearInterval=()=>{};
  let now=0;const time=timers(),peers=[],sockets=[],sources=[],requests=[],errors=[],events=[],uploads=[];
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}
    send(value){this.sent.push(value);}receive(value){this.onmessage?.({data:typeof value==='string'||ArrayBuffer.isView(value)?value:JSON.stringify(value)});}}
  class Connection{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}
    createDataChannel(label){if(legacy&&this.channels.has('input'))return this.channels.get('input');const channel=new Channel(label);this.channels.set(label,channel);return channel;}
    async createOffer(){return {type:'offer',sdp:'offer-'+peers.length};}async createAnswer(){return {type:'answer',sdp:'answer'};}
    async setLocalDescription(value){this.localDescription={toJSON:()=>value};}async setRemoteDescription(value){this.remoteDescription=value;}
    async addIceCandidate(){}close(){this.connectionState='closed';}}
  class Socket{constructor(){this.sent=[];this.bufferedAmount=0;this.readyState=1;sockets.push(this);queueMicrotask(()=>this.receive({type:'transport',data:{connected:true}}));}
    send(value){this.sent.push(parse(value));}receive(value){this.onmessage?.({data:JSON.stringify(value)});}close(){this.readyState=3;}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);queueMicrotask(()=>this.emit('open'));}addEventListener(type,fn){this.listeners.set(type,fn);}emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}close(){}}
  const match={id:'load-v6',ownership:'local-owner-v1',players:Array.from({length:players},(_,i)=>({id:String.fromCharCode(97+i)}))};
  const client=createOnlineClient({fetch:async(url,options)=>{const row={url,body:options.body?JSON.parse(options.body):null,options};requests.push(row);
      if(httpHold&&url==='/api/online/input'){const gate=deferred();uploads.push({...gate,...row});return gate.promise;}return response({accepted:true});},
    EventSource:Source,WebSocket:Socket,RTCPeerConnection:Peer?Connection:null,peerMode,maximumOwnerCredits,clock:()=>now,timers:time,
    rtcOptions:{compress,decode},socketOptions:{compress:socketCompress,decode},onError:error=>errors.push(error),
    onEvent(type,value){events.push({type,value});if(type==='owner-actions')return true;if(type==='peer-owned-state')return true;}});
  const f={client,peers,sockets,sources,requests,errors,events,uploads,time,match,intervals,
    advance(ms){now+=ms;},async flush(){await intervals[0]();await settle();},
    ack(batch,extra={}){sockets.at(-1).receive({type:'ack',data:{accepted:true,matchId:match.id,sequence:batch.sequence,...extra}});},
    handshake(peer=peers.at(-1),gzip=false){peer.channels.get('control').receive({v:1,matchId:match.id,type:'hello-ack',gzip});},
    controls(peer=peers.at(-1)){return peer.channels.get('control').sent.map(parse).filter(row=>row.type==='actions');},
    state(){sources[0].emit('state',{matchId:match.id,snapshot:{actors:match.players.map(p=>({...structuredClone(simulation.state.actors[0]),id:p.id}))},
      ownership:{actors:Object.fromEntries(match.players.map(p=>[p.id,{epoch:1}]))}});}};
  try{await client.open();await client.setMatch(match,'a');await settle();f.state();await run(f);}
  finally{client.close();for(const row of uploads)row.resolve(response({accepted:false}));await settle();globalThis.setInterval=previousInterval;globalThis.clearInterval=previousClear;}
}

test('explicit two-credit WS compatibility retains canonical events then drains oldest prefixes on exact ACK',async()=>{
  await fixture(async f=>{
    for(let i=1;i<=30;i++){f.advance(50);f.client.send(packet,owner(i*3,[i*4]));await settle();}
    assert.equal(f.sockets[0].sent.length,2);assert.equal(f.client.performance().socketAcknowledgements,2);
    assert.equal(f.client.performance().pendingActions,30);assert.equal(f.client.performance().pendingFrames,1);
    assert.equal(f.client.performance().ownerFatal,null);assert.equal(f.errors.length,0);
    const admitted=[];
    for(let index=0;index<f.sockets[0].sent.length;index++){
      const batch=f.sockets[0].sent[index];admitted.push(...batch.owner.actions.map(a=>a.id));
      f.ack(batch,{consumedActionIds:batch.owner.actions.map(a=>a.id)});await settle();
    }
    assert.deepEqual([...new Set(admitted)].sort((a,b)=>a-b),Array.from({length:30},(_,i)=>(i+1)*4));
    assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().socketAcknowledgements,0);
    assert.ok(f.sockets[0].sent.some(batch=>batch.owner.actionFrontierComplete===false));
    assert.equal(f.sockets[0].sent.at(-1).owner.actionFrontierComplete,undefined,'complete final prefix resumes the latest source pose');
    assert.ok(f.sockets[0].sent.some(batch=>batch.owner.frameSeq-batch.owner.actions[0]?.frameSeq>60),'transport sends an old event after its live-state history window');
  },{Peer:false,maximumOwnerCredits:2});
});

for(const credits of [2,8])test(`${credits}-credit upload at 300ms ACK RTT measures sustained source cadence without losing canonical identity`,async()=>{
  await fixture(async f=>{
    let sent=0,now=0;const waiting=[];
    for(let frame=1;frame<=40;frame++){
      now+=50;f.advance(50);
      for(let i=waiting.length-1;i>=0;i--)if(waiting[i].at<=now){const [{batch}]=waiting.splice(i,1);f.ack(batch,{consumedActionIds:batch.owner.actions.map(action=>action.id)});}
      await settle();f.client.send(packet,owner(frame*3));await settle();
      while(sent<f.sockets[0].sent.length)waiting.push({at:now+300,batch:f.sockets[0].sent[sent++]});
    }
    assert.ok(f.client.performance().socketAcknowledgements<=credits);
    assert.equal(f.client.performance().ownerFatal,null);
    if(credits===8)assert.equal(sent,40,'20Hz remains 20Hz despite 300ms ACK RTT');
    else assert.ok(sent<=15,'baseline two-credit transport is limited by ACKs, despite unused bandwidth');
  },{Peer:false,maximumOwnerCredits:credits});
});

test('server disconnect retires RTC and delayed packets permanently for this match, then new match can connect',async()=>{
  await fixture(async f=>{
    f.handshake();await settle();
    const stalePose=f.peers[0].channels.get('input').onmessage;
    f.sources[0].emit('disconnect',{matchId:f.match.id,playerId:'b',reason:'logout'});await settle();
    assert.equal(f.client.connectivity().length,0);assert.deepEqual(f.client.performance().disconnectedPlayers,['b']);
    const start=f.events.length;
    stalePose({data:JSON.stringify({matchId:f.match.id,sequence:99,packet:{held:['RIGHT']},owner:owner(99)})});await settle();
    assert.equal(f.events.slice(start).filter(row=>row.type==='peer-owned-state').length,0);
    f.sources[0].emit('owned-state',{matchId:f.match.id,playerId:'b',report:owner(102)});await settle();
    assert.equal(f.events.slice(start).filter(row=>row.type==='peer-owned-state').length,0);
    await f.client.setMatch(f.match,'a');await settle();assert.equal(f.client.connectivity().length,0);
    f.sources[0].emit('signal',{matchId:f.match.id,from:'b',type:'offer',payload:{sdp:'late'}});await settle();
    assert.equal(f.client.connectivity().length,0);
    await f.client.setMatch({...f.match,id:'next-match'},'a');await settle();assert.equal(f.client.connectivity().length,1);
    assert.deepEqual(f.client.performance().disconnectedPlayers,[]);
  });
});

test('healthy low-latency ACK credit leaves the ordinary twenty owner samples per second unchanged',async()=>{
  await fixture(async f=>{
    for(let i=1;i<=20;i++){f.advance(50);f.client.send(packet,owner(i*3));await settle();f.ack(f.sockets[0].sent.at(-1),{consumedActionIds:[]});await settle();}
    assert.equal(f.sockets[0].sent.length,20);assert.equal(f.client.performance().socketAcknowledgements,0);assert.equal(f.errors.length,0);
  },{Peer:false});
});

for(const [name,options]of [
  ['explicit relay-only mode',{peerMode:'relay'}],
  ['unavailable RTC constructor',{Peer:false}],
])test(name+' delivers more than the peer ledger cap through exact server ACKs without retaining an unused P2P inbox',async()=>{
  await fixture(async f=>{
    const delivered=[];
    for(let index=1;index<=160;index++){
      const actionId=index*4,hitId=index*7,report=owner(index*3,[actionId]);
      report.hits=[{id:hitId,attackerId:'b',damage:1}];
      f.advance(50);f.client.send(packet,report);await settle();
      const batch=f.sockets[0].sent.at(-1);
      assert.deepEqual(batch.owner.actions.map(action=>action.id),[actionId]);
      assert.deepEqual(batch.owner.hits.map(hit=>hit.id),[hitId]);
      delivered.push(...batch.owner.actions.map(action=>action.id));
      f.ack(batch,{consumedActionIds:[actionId],consumedHitIds:[hitId]});await settle();
    }
    assert.deepEqual(delivered,Array.from({length:160},(_,index)=>(index+1)*4));
    const performance=f.client.performance();
    assert.equal(f.sockets[0].sent.length,160);
    assert.equal(performance.pendingActions,0);assert.equal(performance.pendingHits,0);
    assert.equal(performance.socketAcknowledgements,0);assert.equal(performance.ownerFatal,null);
    assert.equal(performance.relay.active,true);assert.deepEqual(performance.peerActionLedgers,{});
    assert.deepEqual(performance.peerControls,{});assert.equal(performance.controlCompression.compressions,0);
    assert.equal(f.peers.length,0);assert.deepEqual(f.client.connectivity(),[]);
    assert.equal(f.requests.some(request=>request.url==='/api/online/signal'),false);
    assert.deepEqual(f.errors,[]);
  },{players:4,...options});
});

test('WS loss switches the same durable history to HTTP and exact HTTP action receipts drain oldest prefixes without a newer pose',async()=>{
  await fixture(async f=>{
    for(let i=1;i<=24;i++)f.client.send(packet,owner(i*3,[i*4]));await settle();
    f.sockets[0].onclose({code:1006,wasClean:false});await settle();assert.equal(f.uploads.length,1);
    const first=f.uploads[0];assert.deepEqual(first.body.owner.actions.map(a=>a.id),Array.from({length:16},(_,i)=>(i+1)*4));
    assert.equal(first.body.owner.actionFrontierComplete,false);
    first.resolve(response({accepted:true,consumedActionIds:first.body.owner.actions.map(a=>a.id),consumedHitIds:[]}));await settle();
    assert.equal(f.uploads.length,2);const second=f.uploads[1];assert.equal(second.body.owner.frameSeq,72);
    assert.deepEqual(second.body.owner.actions.map(a=>a.id),Array.from({length:8},(_,i)=>(i+17)*4));assert.equal(second.body.owner.actionFrontierComplete,undefined);
    second.resolve(response({accepted:true,consumedActionIds:second.body.owner.actions.map(a=>a.id),consumedHitIds:[]}));await settle();
    assert.equal(f.client.performance().pendingActions,0);
    f.time.run(1000);await settle();assert.equal(f.sockets.length,2);assert.equal(f.client.performance().relay.active,true);
  },{Peer:false,httpHold:true});
});

test('WS credit includes an unresolved compression reservation and ACK immediately resumes the newest source pose',async()=>{
  const jobs=[];await fixture(async f=>{
    for(let i=1;i<=20;i++)f.client.send(packet,owner(i*3,[i]));await settle();
    assert.equal(jobs.length,1);assert.equal(f.client.performance().socketAcknowledgements,2);assert.equal(f.sockets[0].sent.length,0);
    jobs[0].gate.resolve(encode(jobs[0].text));await settle();assert.equal(jobs.length,2);assert.equal(f.sockets[0].sent.length,1);
    f.ack(f.sockets[0].sent[0],{consumedActionIds:[1]});await settle();
    jobs[1].gate.resolve(encode(jobs[1].text));await settle();assert.equal(jobs.length,3);
    jobs[2].gate.resolve(encode(jobs[2].text));await settle();
    assert.equal(f.sockets[0].sent.at(-1).owner.frameSeq,60);assert.equal(f.client.performance().socketAcknowledgements,2);
    assert.equal(f.client.performance().pendingActions,19);
  },{Peer:false,socketCompress:text=>{const gate=deferred();jobs.push({text,gate});return gate.promise;}});
  for(const job of jobs)job.gate.resolve(encode(job.text));
});

test('explicit empty and partial action receipts preserve unconsumed sparse IDs, including old-state compatibility and hits',async()=>{
  await fixture(async f=>{
    const report=owner(3,[1,4,10]);report.hits=[{id:7,attackerId:'b',damage:1}];f.client.send(packet,report);await settle();
    f.ack(f.sockets[0].sent[0],{ignored:'old-state',consumedActionIds:[]});await settle();
    assert.equal(f.client.performance().pendingActions,3);assert.equal(f.client.performance().pendingHits,1);
    f.client.send(packet,owner(70));await settle();f.ack(f.sockets[0].sent.at(-1),{consumedActionIds:[4],consumedHitIds:[7]});await settle();
    assert.equal(f.client.performance().pendingActions,2);assert.equal(f.client.performance().pendingHits,0);
    const batch=f.sockets[0].sent.at(-1);assert.deepEqual(batch.owner.actions.map(a=>a.id),[1,10]);
    f.ack(batch,{ignored:'room-locked'});await settle();assert.equal(f.client.performance().pendingActions,2);
  },{Peer:false});
});

test('source count overflow explicitly faults while keeping all older unacknowledged canonical events',async()=>{
  await fixture(async f=>{
    for(let i=1;i<=129;i++)f.client.send(packet,owner(i*3,[i]));await settle();
    assert.equal(f.client.performance().pendingActions,128);assert.equal(f.client.performance().ownerFatal,'owner-action-history-overflow');
    assert.equal(f.errors.filter(e=>e.fatal).length,1);assert.equal(f.sockets[0].sent.length,2);
    f.ack(f.sockets[0].sent[0],{consumedActionIds:[1]});await settle();
    assert.equal(f.client.performance().pendingActions,127);assert.equal(f.sockets[0].sent.at(-1).owner.actions[0].id,2);
  },{Peer:false});
});

test('one oversize oldest action is retained and reported rather than silently shifted out of its wire envelope',async()=>{
  await fixture(async f=>{
    const report=owner(3,[1]);report.actions[0].actor.payload='\uad0d'.repeat(34000);f.client.send(packet,report);await settle();
    assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().ownerFatal,'owner-action-message-too-large');
    assert.ok(f.errors.some(e=>e.fatal));assert.equal(f.sockets[0].sent.length,0);
  },{Peer:false});
});

test('source UTF-8 retention budget rejects an oversized new event atomically while preserving its older durable inbox',async()=>{
  await fixture(async f=>{
    f.client.send(packet,owner(3,[1]));await settle();const previous=f.client.performance().pendingActionBytes;
    const report=owner(6,[4]);report.actions[0].actor.payload='\uad0d'.repeat(700000);f.client.send(packet,report);await settle();
    assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().pendingActionBytes,previous);
    assert.equal(f.client.performance().ownerFatal,'owner-action-history-overflow');assert.equal(f.errors.filter(e=>e.fatal).length,1);
    assert.deepEqual(f.sockets[0].sent[0].owner.actions.map(a=>a.id),[1]);
  },{Peer:false});
});

test('identical per-source control envelopes share native gzip and independent ACK metadata bypasses its stalled FIFO',async()=>{
  const jobs=[];await fixture(async f=>{
    for(const peer of f.peers)f.handshake(peer,true);
    f.client.send(packet,owner(3,[1]));await settle();
    assert.equal(jobs.filter(row=>row.type==='actions').length,1);assert.equal(f.client.performance().controlCompression.shared,2);
    const first=f.peers[0],control=first.channels.get('control'),incoming=owner(3,[99]);
    control.receive({v:1,matchId:f.match.id,type:'actions',sequence:1,report:incoming});await settle();
    assert.ok(control.sent.some(row=>typeof row==='string'&&parse(row).type==='ack'),'remote admission ACK sends while local action gzip remains pending');
    const job=jobs.find(row=>row.type==='actions');job.gate.resolve(encode(job.text));await settle();
    for(const peer of f.peers){assert.equal(f.controls(peer).length,1);assert.deepEqual(f.controls(peer)[0].report.actions.map(a=>a.id),[1]);}
    f.advance(300);await f.flush();for(const peer of f.peers)assert.equal(f.controls(peer).length,1,'reliable SCTP queued event is not application-resubmitted');
  },{players:4,compress:text=>{const type=JSON.parse(text).type;if(type!=='actions')return Promise.resolve(encode(text));const gate=deferred();jobs.push({text,type,gate});return gate.promise;}});
});

test('pair application ACKs do not re-enter the recipient ledger while their server confirmation is delayed',async()=>{
  await fixture(async f=>{
    f.handshake();f.client.send(packet,owner(3,[1]));await settle();
    f.peers[0].channels.get('control').receive({v:1,matchId:f.match.id,type:'ack',epoch:1,sequence:1});
    assert.equal(f.client.performance().peerActionLedgers.b.pending,0);assert.equal(f.client.performance().pendingActions,1);
    f.client.send(packet,owner(6));await settle();assert.equal(f.client.performance().peerActionLedgers.b.pending,0);
  });
});

test('control adapter distinguishes bounded native codec work from FIFO wait and exposes both oldest ages',async()=>{
  const encodes=[],decodes=[];await fixture(async f=>{
    f.handshake(f.peers[0],true);f.client.send(packet,owner(3,[1]));await settle();
    f.client.send(packet,owner(6,[4]));await settle();f.advance(125);
    let wire=f.client.performance().peerControls.b.wire;
    assert.equal(wire.outboundPending,1);assert.equal(wire.encodeAgeMs,125);assert.equal(wire.oldestOutboundAgeMs,125);
    const incoming=id=>({v:1,matchId:f.match.id,type:'actions',sequence:id,report:owner(id*3,[id+99])});
    const control=f.peers[0].channels.get('control');control.receive(encode(JSON.stringify(incoming(1))));await settle();
    control.receive(encode(JSON.stringify(incoming(2))));await settle();f.advance(50);
    wire=f.client.performance().peerControls.b.wire;
    assert.equal(wire.inboundPending,1);assert.equal(wire.decodeAgeMs,50);assert.equal(wire.oldestInboundAgeMs,50);
    decodes[0].gate.resolve(decodes[0].value);await settle();
    wire=f.client.performance().peerControls.b.wire;
    assert.equal(wire.lastDecodeMs,50);assert.equal(wire.maximumDecodeWaitMs,50);assert.equal(wire.inboundPending,0);
    decodes[1].gate.resolve(decodes[1].value);encodes[0].gate.resolve(encode(encodes[0].text));await settle();
    wire=f.client.performance().peerControls.b.wire;
    assert.equal(wire.maximumEncodeMs,175);assert.equal(wire.maximumEncodeWaitMs,175);
    assert.equal(wire.decodedMessages,3);assert.equal(wire.receivedMessages,3);assert.equal(wire.lastFault,null);
    assert.equal(wire.encodeTimeouts,0);assert.equal(wire.decodeTimeouts,0);
    encodes[1].gate.resolve(encode(encodes[1].text));await settle();
    assert.equal(f.client.performance().peerControls.b.wire.oldestOutboundAgeMs,0);
  },{compress:text=>{if(parse(text).type!=='actions')return Promise.resolve(encode(text));const gate=deferred();encodes.push({text,gate});return gate.promise;},
    decode:bytes=>{const gate=deferred();decodes.push({value:parse(bytes),gate});return gate.promise;}});
});

test('the unchanged one-second native control codec watchdog exposes its exact adapter fault without consuming a canonical event',async()=>{
  const gate=deferred();await fixture(async f=>{
    f.handshake(f.peers[0],true);f.client.send(packet,owner(3,[1]));await settle();
    f.peers[0].channels.get('control').receive(encode(JSON.stringify({v:1,matchId:f.match.id,type:'actions',sequence:1,report:owner(3,[99])})));await settle();
    f.advance(1000);f.time.run(1000);
    const control=f.client.performance().peerControls.b;
    assert.equal(control.failed,true);assert.equal(control.wire.decodeTimeouts,1);
    assert.equal(control.wire.lastAdapterFault,'control-decode-timeout');assert.equal(control.wire.lastFault,'control-closed');
    assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().peerActionLedgers.b.pending,1);
    gate.resolve({v:1,matchId:f.match.id,type:'actions',sequence:1,report:owner(3,[99])});await settle();
    assert.equal(f.events.some(event=>event.type==='owner-actions'&&event.value.actions.some(action=>action.id===99)),false);
  },{decode:()=>gate.promise});
});

test('actual peer retirement preserves server-ACKed but recipient-unadmitted sparse events, and rebuilt poses fence behind catch-up',async()=>{
  await fixture(async f=>{
    f.handshake();
    for(const [index,id]of [1,4,10].entries()){
      f.client.send(packet,owner((index+1)*3,[id]));await settle();const batch=f.sockets[0].sent.at(-1);
      f.ack(batch,{consumedActionIds:batch.owner.actions.map(a=>a.id)});await settle();
    }
    assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().peerActionLedgers.b.pending,3);
    const old=f.peers[0];old.channels.get('control').onclose();f.advance(6000);await f.flush();
    assert.equal(old.connectionState,'closed');assert.equal(f.peers.length,2);const fresh=f.peers[1];
    f.client.send(packet,owner(12));await settle();assert.equal(fresh.channels.get('input').sent.length,0,'unnegotiated new generation cannot send an unfenced pose');
    f.handshake(fresh);await settle();const catchup=f.controls(fresh);assert.equal(catchup.length,1);
    assert.deepEqual(catchup[0].report.actions.map(a=>a.id),[1,4,10]);
    f.client.send(packet,owner(15));await settle();const pose=parse(fresh.channels.get('input').sent.at(-1));assert.equal(pose.controlSequence,1);
    const admitted=[],visible=[];const receiver=createPeerControl({matchId:f.match.id,apply:report=>{admitted.push(...report.actions.map(a=>a.id));return true;},onPose:p=>visible.push({pose:p,admitted:[...admitted]})});
    assert.equal(receiver.fence(pose,1,pose.controlSequence),true);assert.deepEqual(visible,[]);
    receiver.receiveText(JSON.stringify(catchup[0]));assert.deepEqual(visible[0].admitted,[1,4,10]);
    fresh.channels.get('control').receive({v:1,matchId:f.match.id,type:'ack',epoch:1,sequence:1});assert.equal(f.client.performance().peerActionLedgers.b.pending,0);
  });
});

test('same-match page generation retains both durable inboxes, but a new life clears their identities',async()=>{
  await fixture(async f=>{
    f.handshake();f.client.send(packet,owner(3,[1]));await settle();
    await f.client.setMatch(f.match,'a');await settle();assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().peerActionLedgers.b.pending,1);
    f.client.send(packet,owner(3,[1],2));await settle();assert.equal(f.client.performance().pendingActions,1);assert.equal(f.client.performance().peerActionLedgers.b.epoch,2);
    assert.equal(f.client.performance().peerActionLedgers.b.pending,1);
    f.handshake();await settle();const event=f.controls().at(-1);
    assert.equal(event.report.epoch,2);assert.deepEqual(event.report.actions.map(action=>action.id),[1],'new life restages the same numeric ID after resetting its per-PC identity');
  });
});

test('recipient ledger overflow disables only its P2P lane until the next life and cannot silently forget its oldest event',async()=>{
  await fixture(async f=>{
    f.handshake();
    for(let id=1;id<=129;id++){
      f.client.send(packet,owner(id*3,[id]));await settle();const batch=f.sockets[0].sent.at(-1);f.ack(batch,{consumedActionIds:batch.owner.actions.map(a=>a.id)});await settle();
    }
    const ledger=f.client.performance().peerActionLedgers.b;assert.equal(ledger.pending,128);assert.equal(ledger.disabled,true);
    assert.equal(ledger.reason,'peer-action-history-overflow');assert.equal(f.client.performance().ownerFatal,null);
    const count=f.peers.length;f.advance(20000);await f.flush();assert.equal(f.peers.length,count,'overflow pair does not rebuild and erase its causality guard');
    f.client.send(packet,owner(3,[1],2));await settle();assert.equal(f.client.performance().peerActionLedgers.b.disabled,false);
  });
});

test('a partially assigned rebuilt frontier cannot publish a pose when the existing control envelope backlog bound faults',async()=>{
  await fixture(async f=>{
    f.handshake();
    // Independently exercise the raw transport envelope guard: a large actor
    // plus one action fits96KiB, while two captured actions cannot merge.
    for(let id=1;id<=33;id++){
      const report=owner(id*3,[id]);report.actor.payload='x'.repeat(11000);report.actions[0].actor.payload='x'.repeat(60000);
      f.client.send(packet,report);await settle();const batch=f.sockets[0].sent.at(-1);f.ack(batch,{consumedActionIds:batch.owner.actions.map(action=>action.id)});await settle();
    }
    assert.equal(f.client.performance().pendingActions,0);assert.equal(f.client.performance().peerActionLedgers.b.pending,33);
    assert.equal(f.client.performance().peerActionLedgers.b.disabled,false);
    f.advance(6000);await f.flush();assert.equal(f.peers.length,2);const control=f.client.performance().peerControls.b;
    assert.equal(control.stagedCanonicalIds,32);assert.equal(control.frontierComplete,false);assert.equal(control.failed,true);
    assert.equal(control.wire.lastFault,'control-backlog');assert.equal(f.peers[1].channels.get('input').sent.length,0);
  });
});

test('legacy one-channel canonical prefixes cannot advance a pose or receipt, but their complete same-frame suffix can',async()=>{
  await fixture(async f=>{
    const channel=f.peers[0].channels.get('input'),prefix=owner(30,[1,4]);prefix.actionFrontierComplete=false;
    channel.receive({matchId:f.match.id,sequence:30,packet,owner:prefix});await settle();
    assert.deepEqual(f.events.filter(event=>event.type==='owner-actions').flatMap(event=>event.value.actions.map(action=>action.id)),[1,4]);
    assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,0);
    assert.equal(f.client.performance().remoteSources.b,undefined);assert.deepEqual(f.client.performance().peerReceipts,[]);
    const complete=owner(30,[10]);channel.receive({matchId:f.match.id,sequence:30,packet,owner:complete});await settle();
    assert.equal(f.events.filter(event=>event.type==='peer-owned-state').length,1);
    assert.equal(f.client.performance().remoteSources.b.frameSeq,30);assert.equal(f.client.performance().peerReceipts[0].frameSeq,30);
    assert.deepEqual(f.events.filter(event=>event.type==='owner-actions').flatMap(event=>event.value.actions.map(action=>action.id)),[1,4,10]);
  },{legacy:true});
});

test('default bounded native gzip decoder delivers a parsed reliable control without double JSON serialization',async()=>{
  const errors=[],events=[],sources=[],peers=[];const previousInterval=globalThis.setInterval,previousClear=globalThis.clearInterval;
  globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
  class Channel{constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.sent=[];}send(v){this.sent.push(v);}}
  class Peer{constructor(){this.connectionState='connected';this.channels=new Map();peers.push(this);}createDataChannel(label){const c=new Channel(label);this.channels.set(label,c);return c;}
    async createOffer(){return {type:'offer'};}async setLocalDescription(value){this.localDescription={toJSON:()=>value};}close(){this.connectionState='closed';}}
  class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}}
  const client=createOnlineClient({fetch:async()=>response({accepted:true}),EventSource:Source,WebSocket:null,RTCPeerConnection:Peer,
    onError:e=>errors.push(e),onEvent(type,value){events.push({type,value});return true;}});
  try{
    await client.open();await client.setMatch({id:'gzip-default',ownership:'local-owner-v1',players:[{id:'a'},{id:'b'}]},'a');
    sources[0].listeners.get('state')({data:JSON.stringify({matchId:'gzip-default',snapshot:{actors:[{...structuredClone(simulation.state.actors[0]),id:'b'}]},ownership:{actors:{b:{epoch:1}}}})});
    const control=peers[0].channels.get('control');control.onmessage({data:JSON.stringify({v:1,matchId:'gzip-default',type:'hello',gzip:true})});
    const text=JSON.stringify({v:1,matchId:'gzip-default',type:'actions',sequence:1,report:owner(3,[7])});
    control.onmessage({data:new Uint8Array(gzipSync(text))});
    for(let i=0;i<30&&!events.some(e=>e.type==='owner-actions');i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(events.find(e=>e.type==='owner-actions').value.actions[0].id,7);assert.deepEqual(errors,[]);
    assert.equal(client.performance().peerControls.b.receivedBytes,encode(text).length+encode(JSON.stringify({v:1,matchId:'gzip-default',type:'hello',gzip:true})).length);
  }finally{client.close();globalThis.setInterval=previousInterval;globalThis.clearInterval=previousClear;}
});

test('disconnect removing the last queued compressed pose never downgrades surviving peers',async()=>{
  const jobs=[];
  await fixture(async f=>{
    for(const peer of f.peers){
      f.handshake(peer,true);
      peer.channels.get('input').receive({matchId:f.match.id,sequence:3,codec:'rtc-owner-gzip-v1',packet,owner:owner(3)});
    }
    await settle();
    f.client.send(packet,owner(6));await settle();
    f.client.send(packet,owner(9));await settle();
    const healthy=f.peers[1].channels.get('input');
    healthy.bufferedAmount=32768;
    f.client.send(packet,owner(12));await settle();
    healthy.bufferedAmount=0;
    assert.equal(f.client.performance().peerCompression.pending,true);
    f.sources[0].emit('disconnect',{matchId:f.match.id,playerId:'b',reason:'logout'});await settle();
    jobs[0].resolve(encode(jobs[0].text));await settle();
    assert.equal(f.client.performance().peerCompression.compressionFailures,0);
    assert.equal(f.client.performance().peerTransports.c.codec,'rtc-owner-gzip-v1');
    assert.equal(f.client.performance().peerCompression.pending,false);
    assert.deepEqual(f.errors,[]);
  },{players:3,compress:text=>{
    if(parse(text).type)return Promise.resolve(encode(text));
    const gate=deferred();jobs.push({...gate,text});return gate.promise;
  }});
});
