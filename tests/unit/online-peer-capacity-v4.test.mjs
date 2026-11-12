import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createOnlineClient} from '../../apps/web/online-client.mjs';
import {createOnlineSocket,compressOnlineText,decodeOnlineGzip} from '../../apps/web/online-socket.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {encodeOwnedState} from '../../packages/online/owned-state.mjs';
import {make} from '../helpers/rf-passive-fixture-v12.mjs';

const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const input={held:['RIGHT'],pressed:['RIGHT'],released:[]},codec='rtc-owner-gzip-v1';
const wire=(value)=>JSON.parse(typeof value==='string'?value:gunzipSync(value).toString('utf8'));
async function fixture(t,{count=6,compress,decode,blockedUpload=false,acceptOwner=true}={}){
 const sources=[],peers=[],posts=[],events=[],errors=[],uploads=[],tasks=new Map();let now=0,serial=0,compressCalls=0;
 class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,callback){this.listeners.set(type,callback);}close(){}
  emit(type,data){this.listeners.get(type)?.({data:JSON.stringify(data)});}}
 class Peer{constructor(){this.connectionState='connected';this.channel={readyState:'open',bufferedAmount:0,sent:[],send(value){this.sent.push(value);}};peers.push(this);}
  createDataChannel(){return this.channel;}async createOffer(){return {type:'offer',sdp:'fixture'};}
  async setLocalDescription(value){this.localDescription={toJSON:()=>value};}close(){this.connectionState='closed';}}
 const timers={setTimeout(callback,ms){const id=++serial;tasks.set(id,{callback,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);}};
 const client=createOnlineClient({EventSource:Source,RTCPeerConnection:Peer,WebSocket:null,timers,clock:()=>now,
  rtcOptions:{compress:text=>{compressCalls++;return compress?compress(text):Promise.resolve(new Uint8Array(gzipSync(text)));},
   decode:decode??(async data=>JSON.parse(gunzipSync(new Uint8Array(data instanceof ArrayBuffer?data:data.buffer,data.byteOffset??0,data.byteLength)).toString('utf8')))},
  fetch:async(url,options)=>{if(url==='/api/online/input'){posts.push(JSON.parse(options.body));if(blockedUpload){const row=deferred();uploads.push(row);return row.promise;}}
   return {ok:true,json:async()=>({accepted:true,available:true})};},onEvent:(type,data)=>{events.push({type,data});if(type==='peer-owned-state')return acceptOwner;},onError:error=>errors.push(error)});
 t.after(()=>client.close());await client.open();const players=Array.from({length:count},(_,i)=>({id:String.fromCharCode(97+i)}));
 const match={id:'one',ownership:'local-owner-v1',players};await client.setMatch(match,'a');
 const simulation=await make({passives:[]}),report=encodeOwnedState(simulation,'rf',{epoch:1,frameSeq:60});
 function state(epoch=1){sources[0].emit('state',{matchId:match.id,snapshot:{actors:players.map(p=>({id:p.id,stats:{},...report.actor}))},
  ownership:{mode:'local-owner-v1',actors:Object.fromEntries(players.map(p=>[p.id,{epoch,frameSeq:60}]))}});}
 state();const deliver=(index,value=report,extra={})=>peers[index].channel.onmessage({data:JSON.stringify({matchId:match.id,sequence:value.frameSeq,
  packet:input,owner:value,...extra})});
 return {client,sources,peers,posts,events,errors,uploads,tasks,report,match,state,deliver,compressCalls:()=>compressCalls,
  async advance(ms){now+=ms;for(const [id,row]of tasks)if(row.at<=now){tasks.delete(id);row.callback();}await settle();}};
}

test('six-player peer gzip is negotiated by both ends, encoded once and reused for five peers',async t=>{
 const f=await fixture(t);f.client.send(input,f.report);await settle();
 assert.equal(f.compressCalls(),0);assert.ok(f.peers.every(p=>typeof p.channel.sent[0]==='string'));
 assert.ok(f.peers.every(p=>wire(p.channel.sent[0]).codec===codec));
 for(let i=0;i<5;i++)f.deliver(i,f.report,{codec});
 f.client.send(input,{...f.report,frameSeq:63});await settle();assert.equal(f.compressCalls(),1);
 const payload=f.peers[0].channel.sent.at(-1);assert.ok(payload instanceof Uint8Array);
 assert.ok(f.peers.every(p=>p.channel.sent.at(-1)===payload),'five sends share one completed gzip buffer');
 assert.equal(wire(payload).owner.frameSeq,63);assert.ok(payload.byteLength<new TextEncoder().encode(JSON.stringify(wire(payload))).length);
 assert.equal(f.client.performance().peerCompression.compressions,1);assert.equal(f.client.performance().peerTransports.b.compressedMessages,1);
 assert.deepEqual(f.errors,[]);
});

test('legacy peers keep JSON while negotiated peers share compression without duplicate sends',async t=>{
 const f=await fixture(t,{count:3});f.client.send(input,f.report);await settle();f.deliver(0,f.report,{codec});
 f.client.send(input,{...f.report,frameSeq:63});await settle();
 assert.ok(f.peers[0].channel.sent.at(-1) instanceof Uint8Array);assert.equal(typeof f.peers[1].channel.sent.at(-1),'string');
 assert.equal(f.peers[0].channel.sent.length,2);assert.equal(f.peers[1].channel.sent.length,2);assert.equal(f.compressCalls(),1);
});

test('only recently received validated current-life owners produce authenticated peer receipts',async t=>{
 const f=await fixture(t,{count:2});f.client.send(input,f.report);await settle();assert.deepEqual(f.posts[0].peerReceipts,[]);
 f.deliver(0,f.report);f.client.send(input,{...f.report,frameSeq:63});await settle();
 assert.deepEqual(f.posts.at(-1).peerReceipts,[{playerId:'b',epoch:1,frameSeq:60}]);
 await f.advance(351);f.client.send(input,{...f.report,frameSeq:66});await settle();assert.deepEqual(f.posts.at(-1).peerReceipts,[]);
 f.deliver(0,{...f.report,frameSeq:63});f.state(2);f.client.send(input,{...f.report,frameSeq:69});await settle();assert.deepEqual(f.posts.at(-1).peerReceipts,[]);
 f.deliver(0,{...f.report,epoch:1,frameSeq:999});assert.deepEqual(f.client.performance().peerReceipts,[]);
 f.deliver(0,{...f.report,epoch:2,frameSeq:66});f.client.send(input,{...f.report,frameSeq:72});await settle();
 assert.deepEqual(f.posts.at(-1).peerReceipts,[{playerId:'b',epoch:2,frameSeq:66}]);
 f.peers[0].channel.readyState='closed';f.client.send(input,{...f.report,frameSeq:75});await settle();assert.deepEqual(f.posts.at(-1).peerReceipts,[]);
});

test('foreign match, invalid owners and merely open RTC channels cannot claim delivery health',async t=>{
 const f=await fixture(t,{count:2});f.peers[0].channel.onmessage({data:JSON.stringify({matchId:'old',sequence:900,packet:input,owner:f.report})});
 f.deliver(0,{...f.report,actor:{...f.report.actor,x:NaN}});assert.deepEqual(f.client.performance().peerReceipts,[]);
 f.client.send(input,f.report);await settle();assert.deepEqual(f.posts.at(-1).peerReceipts,[]);
 f.deliver(0,f.report);await f.advance(100);f.deliver(0,f.report);await f.advance(251);
 assert.deepEqual(f.client.performance().peerReceipts,[],'duplicate source frames cannot extend evidence freshness');
});

test('started compression finishes while only newest waiting movement survives and actions stay reliable',async t=>{
 const jobs=[],f=await fixture(t,{count:2,blockedUpload:true,compress:text=>{const gate=deferred();jobs.push({text,gate});return gate.promise;}});
 f.client.send(input,f.report);f.deliver(0,f.report,{codec});
 const action={id:11,ageFrames:0,actor:f.report.actor,effects:[]};
 f.client.send(input,{...f.report,frameSeq:63,actions:[action]});
 f.client.send(input,{...f.report,frameSeq:66});f.client.send(input,{...f.report,frameSeq:69});assert.equal(jobs.length,1);
 jobs[0].gate.resolve(new Uint8Array(gzipSync(jobs[0].text)));await settle();assert.equal(jobs.length,2);
 jobs[1].gate.resolve(new Uint8Array(gzipSync(jobs[1].text)));await settle();
 assert.deepEqual(f.peers[0].channel.sent.slice(1).map(value=>wire(value).sequence),[63,69]);
 assert.deepEqual(wire(f.peers[0].channel.sent.at(-1)).owner.actions.map(a=>a.id),[11]);
 assert.equal(f.client.performance().pendingActions,1,'RTC replacement cannot acknowledge server-owned reliable history');
 f.uploads[0].resolve({ok:true,json:async()=>({accepted:true})});await settle();assert.deepEqual(f.posts.at(-1).owner.actions.map(a=>a.id),[11]);
});

test('retired asynchronous peer encoders cannot send to a replacement room',async t=>{
 const gate=deferred(),f=await fixture(t,{count:2,compress:()=>gate.promise});f.client.send(input,f.report);await settle();f.deliver(0,f.report,{codec});
 f.client.send(input,{...f.report,frameSeq:63});const old=f.peers[0];await f.client.setMatch({...f.match,id:'two'},'a');
 gate.resolve(new Uint8Array(gzipSync('{}')));await settle();assert.equal(old.channel.sent.length,1);assert.equal(f.peers[1].channel.sent.length,0);
 assert.deepEqual(f.client.performance().peerReceipts,[]);assert.equal(f.tasks.size,0);
});

test('hung shared encoder remains one native job and uses fresh JSON fallback after its deadline',async t=>{
 const f=await fixture(t,{count:2,compress:()=>new Promise(()=>{})});f.client.send(input,f.report);await settle();f.deliver(0,f.report,{codec});
 f.client.send(input,{...f.report,frameSeq:63});await f.advance(1000);
 for(let frame=66;frame<100;frame+=3){f.deliver(0,{...f.report,frameSeq:frame},{codec});f.client.send(input,{...f.report,frameSeq:frame});}
 assert.equal(f.compressCalls(),1);assert.equal(typeof f.peers[0].channel.sent.at(-1),'string');
 assert.equal(f.client.performance().peerCompression.compressionFailures,1);assert.deepEqual(f.errors,[]);
});

test('peer decoding is bounded, current-life validated and old asynchronous work cannot cross rooms',async t=>{
 const jobs=[],f=await fixture(t,{count:2,decode:data=>{const gate=deferred();jobs.push({data,gate});return gate.promise;}});
 f.client.send(input,f.report);await settle();const channel=f.peers[0].channel;
 const binary=frame=>({data:new Uint8Array(gzipSync(JSON.stringify({matchId:'one',sequence:frame,packet:input,owner:{...f.report,frameSeq:frame},codec})))});
 channel.onmessage(binary(63));channel.onmessage(binary(66));channel.onmessage(binary(69));assert.equal(jobs.length,1);
 jobs[0].gate.resolve(wire(jobs[0].data));await settle();assert.equal(jobs.length,2);
 jobs[1].gate.resolve(wire(jobs[1].data));await settle();
 assert.deepEqual(f.events.filter(e=>e.type==='peer-owned-state').map(e=>e.data.report.frameSeq),[63,69]);
 assert.deepEqual(f.client.performance().peerReceipts,[{playerId:'b',epoch:1,frameSeq:69}]);
 channel.onmessage(binary(72));await f.client.setMatch({...f.match,id:'two'},'a');jobs[2].gate.resolve(wire(jobs[2].data));await settle();
 assert.deepEqual(f.events.filter(e=>e.type==='peer-owned-state').map(e=>e.data.report.frameSeq),[63,69]);assert.equal(f.tasks.size,0);
});

test('unnegotiated binary and oversized peer packets are rejected before native decoding',async t=>{
 let calls=0;const f=await fixture(t,{count:2,decode:async()=>{calls++;return {};}}),channel=f.peers[0].channel;
 channel.onmessage({data:new Uint8Array(gzipSync('{}'))});channel.onmessage({data:'x'.repeat(128*1024+1)});
 assert.equal(calls,0);assert.equal(f.client.performance().peerTransports.b.rejectedMessages,2);assert.deepEqual(f.client.performance().peerReceipts,[]);
});

test('hung peer decode cannot stack native jobs or retain stale evidence, and valid relay still arrives',async t=>{
 let calls=0;const f=await fixture(t,{count:2,decode:()=>{calls++;return new Promise(()=>{});}});f.client.send(input,f.report);await settle();f.deliver(0,f.report,{codec});
 const channel=f.peers[0].channel,binary=frame=>({data:new Uint8Array(gzipSync(JSON.stringify({matchId:'one',sequence:frame,packet:input,owner:{...f.report,frameSeq:frame}})))});
 channel.onmessage(binary(63));await f.advance(1000);for(let frame=66;frame<100;frame+=3)channel.onmessage(binary(frame));
 assert.equal(calls,1);assert.equal(f.client.performance().peerTransports.b.decodeFailures,1);assert.deepEqual(f.client.performance().peerReceipts,[]);
 // Authenticated fallback can keep advancing the actor even when one native
 // RTC decoder never settles. Its stream is independent of the peer job.
 f.sources[0].emit('owned-state',{matchId:'one',playerId:'b',report:{...f.report,frameSeq:102}});
 assert.equal(f.events.at(-1).data.report.frameSeq,102);assert.deepEqual(f.errors,[]);
});

test('a simulation reference rejection cannot suppress the healthy authenticated fallback',async t=>{
 const f=await fixture(t,{count:2,acceptOwner:false});f.deliver(0,f.report);f.client.send(input,f.report);await settle();
 assert.equal(f.events.filter(row=>row.type==='peer-owned-state').length,1);assert.deepEqual(f.posts.at(-1).peerReceipts,[]);
});

test('native gzip helper preserves JSON and rejects corrupt or decoded oversize payloads',async()=>{
 const text=JSON.stringify({message:'\uad0d\uad05',values:Array(100).fill('repeat')}),bytes=await compressOnlineText(text);
 assert.deepEqual(await decodeOnlineGzip(bytes),JSON.parse(text));
 const metadata=await decodeOnlineGzip(bytes,{returnMetadata:true});
 assert.deepEqual(metadata.value,JSON.parse(text));assert.equal(metadata.decodedBytes,new TextEncoder().encode(text).byteLength);
 await assert.rejects(decodeOnlineGzip(bytes,{maximumDecodedBytes:20}),/decoded-message-too-large/);
 await assert.rejects(decodeOnlineGzip(bytes,{maximumWireBytes:1}),/message-too-large/);
 await assert.rejects(decodeOnlineGzip(new Uint8Array([1,2,3])));
});

test('baseline-only downstream seeds do not apply an actor before the following dynamic pose',async t=>{
 const f=await fixture(t,{count:2}),server=createOwnedRelayDelta(),parts=server.encodeSplit('b',f.report);
 assert.equal(parts.baseline.baselineOnly,true);
 // Reach the ordinary browser event handler, so null decoder results cannot
 // become an invalid owner or a spurious simulation observation.
 f.client.send(input,f.report);await settle();
 const sources=[];class Source{constructor(){this.listeners=new Map();sources.push(this);}addEventListener(type,callback){this.listeners.set(type,callback);}close(){}}
 const events=[],errors=[],receiver=createOnlineClient({EventSource:Source,RTCPeerConnection:null,WebSocket:null,fetch:async()=>({ok:true,json:async()=>({})}),
  onEvent:(type,data)=>events.push({type,data}),onError:error=>errors.push(error)});t.after(()=>receiver.close());await receiver.open();await receiver.setMatch(f.match,'a');
 const emit=value=>sources[0].listeners.get('owned-state')({data:JSON.stringify({matchId:'one',relayToken:'v4',...value})});
 emit(parts.baseline);
 assert.equal(events.filter(e=>e.type==='peer-owned-state').length,0);
 emit(parts.value);
 assert.equal(events.filter(e=>e.type==='peer-owned-state').length,1);assert.deepEqual(errors,[]);
});

test('WebSocket accepts small text acknowledgements and legacy binary confirmations without gzip duplication',async t=>{
 const sockets=[],acks=[],errors=[],events=[];let decodes=0;
 class Socket{bufferedAmount=0;constructor(){sockets.push(this);}close(){}send(){}message(data){this.onmessage({data});}}
 const relay=createOnlineSocket({WebSocket:Socket,url:'ws://fixture',onAcknowledgement:data=>acks.push(data),onEvent:(type,data)=>events.push({type,data}),
  decode:async data=>{decodes++;return wire(data);},onInactive:()=>errors.push('inactive')});t.after(()=>relay.close());relay.open();
 sockets[0].message(JSON.stringify({type:'transport',data:{connected:true}}));await settle();assert.equal(relay.active,true);assert.equal(decodes,0);
 sockets[0].message(JSON.stringify({type:'ack',data:{sequence:1,accepted:true}}));
 sockets[0].message(new Uint8Array(gzipSync(JSON.stringify({type:'ack',data:{sequence:2,accepted:true}}))).buffer);await settle();
 assert.deepEqual(acks.map(row=>row.sequence),[1,2]);assert.equal(decodes,1);assert.deepEqual(errors,[]);
 sockets[0].message('not-json');await settle();assert.equal(relay.active,false);assert.equal(relay.performance().lastFailure,'decode-failed');
});

test('text ACK and owner v3 capabilities are explicitly negotiated without losing relative URL or page identity query values',()=>{
 const urls=[],protocols=[];class Socket{bufferedAmount=0;constructor(url,protocol){urls.push(url);protocols.push(protocol);}close(){}}
 for(const url of ['/api/online/socket','/api/online/socket?pageInitToken=page-token-123&extra=a%2Bb',
  'socket?pageInitToken=relative-page-123&textAck=0&ownedDelta=1','wss://example.test/api/online/socket?pageInitToken=absolute-page-123']){
  const relay=createOnlineSocket({WebSocket:Socket,url});relay.open();relay.close();
  const address=urls.at(-1),query=new URL(address,'https://fixture.test/').searchParams;
  assert.equal(query.get('textAck'),'1');assert.equal(query.getAll('textAck').length,1);
  assert.equal(query.get('ownedDelta'),'3');assert.equal(query.getAll('ownedDelta').length,1);
  const before=new URL(url,'https://fixture.test/').searchParams;assert.equal(query.get('pageInitToken'),before.get('pageInitToken'));
  assert.equal(query.get('extra'),before.get('extra'));assert.equal(address.startsWith('socket?'),url.startsWith('socket?'));
  assert.equal(address.startsWith('wss://'),url.startsWith('wss://'));
 }
 assert.ok(protocols.every(protocol=>protocol==='rf-online-gzip-v1'),'legacy gzip protocol remains selected');
});
