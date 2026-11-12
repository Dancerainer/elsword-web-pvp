import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineSocket,packOnlineBinary,decodeOnlineGzip,encodeOnlineEnvelope} from '../../apps/web/online-socket.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {NETWORK_BINARY_VERSION,encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,networkJsonByteLength} from '../../packages/online/network-binary.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState} from '../../packages/online/owned-state.mjs';
import {readFileSync} from 'node:fs';
const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('timeout');};
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
function sample(frame=1){const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},actors:[{id:'source',position:[0,0,0],lineId:0}]});
 const report=encodeOwnedState(sim,'source',{epoch:1,frameSeq:frame});report.actions=[encodeCriticalAction(report,{id:frame})];return validateOwnedState(report);}

test('binary uses original compress-only-if-smaller policy and small updates do not schedule gzip',async()=>{
 let calls=0;const raw=encodeNetworkBinary({frameSeq:3,x:1.5});
 assert.equal(await packOnlineBinary(raw,{compress:()=>{calls++;throw Error('should not run');}}),raw);assert.equal(calls,0);
 const boundary=new Uint8Array(512);assert.equal(await packOnlineBinary(boundary,{compress:()=>{calls++;throw Error('should not run');}}),boundary);
 const above=new Uint8Array(513);assert.equal(await packOnlineBinary(above,{compress:async value=>{calls++;return value;}}),above);assert.equal(calls,1);
 const large=encodeNetworkBinary({value:'x'.repeat(5000)}),packed=await packOnlineBinary(large);
 assert.ok(packed.length<large.length);assert.equal(isNetworkBinary(packed),false);
 assert.deepEqual(await decodeOnlineGzip(packed,{allowBinary:true}),{value:'x'.repeat(5000)});
 assert.equal(await packOnlineBinary(large,{compress:async value=>new Uint8Array(value.length+1)}),large);
 await assert.rejects(decodeOnlineGzip(raw),/not-negotiated/);
 await assert.rejects(decodeOnlineGzip(packed),/not-negotiated/);
 await assert.rejects(decodeOnlineGzip(packed,{allowBinary:true,maximumDecodedBytes:128}));
 const decoded=await decodeOnlineGzip(raw,{allowBinary:true,returnMetadata:true});
 assert.equal(decoded.decodedBytes,Buffer.byteLength(JSON.stringify(decoded.value)));
});

test('WS explicitly negotiates binary, snapshots queued objects, and falls back after reconnect',async t=>{
 const sockets=[],received=[],timers={setTimeout(){return 1;},clearTimeout(){}};
 class Socket{constructor(url){this.url=url;this.bufferedAmount=0;this.sent=[];sockets.push(this);}send(value){this.sent.push(value);}close(){}message(value){this.onmessage({data:typeof value==='string'?value:JSON.stringify(value)});}}
 const client=createOnlineSocket({WebSocket:Socket,url:'ws://fixture/api/online/socket',timers,onAcknowledgement:value=>received.push(value)});t.after(()=>client.close());client.open();
 const socket=sockets[0];assert.equal(new URL(socket.url).searchParams.get('networkBinaryVersion'),String(NETWORK_BINARY_VERSION));
 socket.message({type:'transport',data:{connected:true,networkBinaryVersion:NETWORK_BINARY_VERSION}});await wait(()=>client.active);
 const source={sequence:1,frames:[{held:['LEFT'],frameSeq:1}]};client.send(source);source.frames[0].held.push('RIGHT');
 await wait(()=>socket.sent.length===1);assert.ok(isNetworkBinary(socket.sent[0]));
 assert.deepEqual(decodeNetworkBinary(socket.sent[0]).frames[0].held,['LEFT']);
 socket.onmessage({data:encodeNetworkBinary({type:'ack',data:{accepted:true,sequence:1}})});await wait(()=>received.length===1);
 assert.equal(client.performance().binaryMessages,1);assert.equal(client.performance().networkBinaryVersion,NETWORK_BINARY_VERSION);
 client.fail();assert.equal(client.performance().networkBinaryVersion,0);client.open();
 sockets[1].message({type:'transport',data:{connected:true}});await wait(()=>client.active);client.send({sequence:2});
 await wait(()=>sockets[1].sent.length===1);assert.equal(isNetworkBinary(sockets[1].sent[0]),false);
 assert.deepEqual(await decodeOnlineGzip(sockets[1].sent[0]),{sequence:2});
});

test('negotiated reliable binary controls preserve exact canonical events and backpressure',()=>{
 const ab=[],ba=[],accepted=[],binary=[];let blocked=true;
 const a=createPeerControl({matchId:'binary-room',reliableTransport:true,networkBinary:true,
  send:text=>{ab.push(text);return true;},sendValue:(value,meta)=>{if(blocked)return false;const bytes=encodeNetworkBinary(value);binary.push({bytes,meta});ab.push(bytes);return true;}});
 const b=createPeerControl({matchId:'binary-room',reliableTransport:true,networkBinary:true,sendValue:()=>true,
  send:text=>{ba.push(text);return true;},apply:value=>{accepted.push(validateOwnedState(value));return true;}});
 const transfer=(queue,receiver)=>{while(queue.length){const value=queue.shift();if(typeof value==='string')receiver.receiveText(value);else{const parsed=decodeNetworkBinary(value);receiver.receiveParsed(parsed,{decodedBytes:networkJsonByteLength(parsed)});}}};
 a.pump();transfer(ab,b);transfer(ba,a);assert.equal(a.performance().networkBinaryVersion,NETWORK_BINARY_VERSION);
 a.stage(sample(1));assert.equal(binary.length,0);assert.equal(a.performance().pendingUnsentPackets,1);
 blocked=false;a.pump();transfer(ab,b);transfer(ba,a);assert.equal(accepted.length,1);assert.deepEqual(accepted[0].actions,sample(1).actions);
 assert.equal(a.performance().pendingPackets,0);assert.equal(binary.length,1);assert.equal(a.performance().failed,false);
});

test('large binary controls fall back to bounded reliable fragments without duplicate events',()=>{
 const ab=[],ba=[],accepted=[],sent=[];let attempted=0;
 const a=createPeerControl({matchId:'fragments',reliableTransport:true,networkBinary:true,controlDelta:false,send:text=>{ab.push(text);sent.push(JSON.parse(text));return true;},sendValue:()=>{attempted++;return null;}});
 const b=createPeerControl({matchId:'fragments',reliableTransport:true,networkBinary:true,sendValue:()=>null,send:text=>{ba.push(text);return true;},apply:report=>{accepted.push(report);return true;}});
 const flush=()=>{while(ab.length)b.receiveText(ab.shift());while(ba.length)a.receiveText(ba.shift());};a.pump();flush();
 const report=sample(2);report.actions=Array.from({length:16},(_,index)=>({...structuredClone(report.actions[0]),id:index+1}));
 a.stage(report);flush();assert.equal(attempted,1);assert.ok(sent.some(value=>value.type==='fragment'));assert.equal(accepted.length,1);assert.deepEqual(accepted[0].actions,report.actions);assert.equal(a.performance().pendingPackets,0);
});

test('legal numeric owner reports fall back to immutable JSON when binary exceeds its budget',async t=>{
 const report=sample();report.actions=[];
 report.effects=Array.from({length:40},(_,index)=>({id:index+1,name:'visual',values:Array(512).fill(.1)}));
 const batch={sequence:1,frames:[{held:[],frameSeq:1}],owner:validateOwnedState(report)};
 assert.ok(Buffer.byteLength(JSON.stringify(batch))<96*1024);
 assert.ok(encodeNetworkBinary(batch).byteLength>128*1024);
 const envelope=encodeOnlineEnvelope(batch,{binary:true});assert.equal(envelope.binary,undefined);
 assert.deepEqual(JSON.parse(envelope.text),batch);
 const sockets=[];class Socket{constructor(){this.sent=[];this.bufferedAmount=0;sockets.push(this);}send(v){this.sent.push(v);}close(){}}
 const client=createOnlineSocket({WebSocket:Socket,url:'ws://fixture/socket',timers:{setTimeout(){return 1;},clearTimeout(){}}});t.after(()=>client.close());client.open();
 sockets[0].onmessage({data:JSON.stringify({type:'transport',data:{connected:true,networkBinaryVersion:NETWORK_BINARY_VERSION}})});
 assert.equal(client.send(batch),true);batch.owner.effects[0].values[0]=9;
 await wait(()=>sockets[0].sent.length===1);
 const decoded=await decodeOnlineGzip(sockets[0].sent[0],{allowBinary:true});assert.equal(decoded.owner.effects[0].values[0],.1);
 assert.equal(client.performance().failures,0);assert.equal(client.active,true);
});

test('disabled binary removes stale URL capabilities',()=>{
 let address;class Socket{constructor(url){address=url;}close(){}}
 const client=createOnlineSocket({WebSocket:Socket,url:'ws://fixture/socket?networkBinaryVersion=1',networkBinary:false,timers:{setTimeout(){return 1;},clearTimeout(){}}});
 client.open();assert.equal(new URL(address).searchParams.has('networkBinaryVersion'),false);client.close();
});
