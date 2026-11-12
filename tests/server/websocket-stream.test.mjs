import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {gzipSync,gunzipSync} from 'node:zlib';
import {websocketHandshake,createWebSocketStream,ONLINE_SOCKET_PROTOCOL} from '../../apps/server/websocket-stream.mjs';
class Socket extends EventEmitter{
 writableLength=0;writableNeedDrain=false;destroyed=false;written=[];hold=false;
 write(data){this.written.push(Buffer.from(data));if(this.hold){this.writableNeedDrain=true;this.writableLength+=data.length;return false;}return true;}
 end(data){if(data)this.written.push(Buffer.from(data));this.emit('close');}
 destroy(){this.destroyed=true;this.emit('close');}
 drain(){this.writableNeedDrain=false;this.writableLength=0;this.emit('drain');}
}
function masked(payload,{opcode=1,fin=true,mask=true,extended=null,rsv=0}={}){
 payload=Buffer.from(payload);const n=extended??(payload.length<126?payload.length:payload.length<=65535?126:127);
 const header=Buffer.alloc(n===126?4:n===127?10:2);header[0]=(fin?128:0)|rsv|opcode;header[1]=(mask?128:0)|n;
 if(n===126)header.writeUInt16BE(payload.length,2);if(n===127)header.writeBigUInt64BE(BigInt(payload.length),2);
 const key=Buffer.from([13,27,91,3]),bytes=Buffer.from(payload);if(mask)for(let i=0;i<bytes.length;i++)bytes[i]^=key[i%4];
 return Buffer.concat(mask?[header,key,bytes]:[header,bytes]);
}
function decode(frame){const len=frame[1]&127,off=len===126?4:len===127?10:2;return {opcode:frame[0]&15,bytes:frame.subarray(off)};}
function decodeJson(frame){const {opcode,bytes}=decode(frame);return JSON.parse(opcode===1?bytes.toString():gunzipSync(bytes).toString());}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('socket did not reach expected state');}
function fixture(t,options={}){const socket=new Socket(),messages=[];const stream=createWebSocketStream(socket,{onMessage:v=>messages.push(v),...options});t.after(()=>stream.destroy());return {socket,stream,messages};}
test('handshake pins version13,16byte key,Upgrade tokens and explicit application protocol',()=>{
 const req={method:'GET',headers:{upgrade:'websocket',connection:'keep-alive, Upgrade','sec-websocket-version':'13','sec-websocket-key':'dGhlIHNhbXBsZSBub25jZQ==','sec-websocket-protocol':ONLINE_SOCKET_PROTOCOL}};
 assert.equal(websocketHandshake(req),'s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
 for(const [key,value]of [['upgrade','h2c'],['connection','keep-alive'],['sec-websocket-version','12'],['sec-websocket-key','bad'],['sec-websocket-protocol','unrelated']])assert.equal(websocketHandshake({...req,headers:{...req.headers,[key]:value}}),null);
});
test('masked text/gzip and byte-at-a-time frames deliver exact objects',async t=>{
 const f=fixture(t),a={hello:'\uac2b\uac1a'},b={payload:'x'.repeat(400)};
 for(const byte of masked(JSON.stringify(a)))f.socket.emit('data',Buffer.from([byte]));
 f.socket.emit('data',masked(gzipSync(JSON.stringify(b)),{opcode:2}));await until(()=>f.messages.length===2);assert.deepEqual(f.messages,[a,b]);
});
test('fragmented multibyte UTF8 accepts interleaved ping with identical pong payload',t=>{
 const f=fixture(t),text=Buffer.from(JSON.stringify({hello:'\uac01'})),middle=text.indexOf(Buffer.from('\uac01'))+1;
 f.socket.emit('data',masked(text.subarray(0,middle),{fin:false}));f.socket.emit('data',masked('ping',{opcode:9}));
 f.socket.emit('data',masked(text.subarray(middle),{opcode:0}));assert.deepEqual(f.messages,[{hello:'\uac01'}]);
 assert.deepEqual(decode(f.socket.written[0]),{opcode:10,bytes:Buffer.from('ping')});
});
for(const [label,frame]of [['unmasked',masked('{}',{mask:false})],['RSV',masked('{}',{rsv:64})],['reservedopcode',masked('{}',{opcode:3})],
 ['orphancontinuation',masked('{}',{opcode:0})],['fragmentedcontrol',masked('ping',{opcode:9,fin:false})],['oversizedcontrol',masked('x'.repeat(126),{opcode:9})],
 ['nonminimallength',masked('{}',{extended:126})],['singlebyteclose',masked(Buffer.from([0]),{opcode:8})],['invalidUTF8',masked(Buffer.from([0xc0,0x80]))]]){
 test('rejects '+label+' without application callbacks',t=>{const f=fixture(t);f.socket.emit('data',frame);assert.equal(f.stream.closed,true);assert.deepEqual(f.messages,[]);assert.equal(decode(f.socket.written[0]).opcode,8);});
}
test('declared oversized payload is rejected before its body arrives; gzip bomb and fragmented total are bounded',async t=>{
 const a=fixture(t,{maximumMessageBytes:200});a.socket.emit('data',masked('x'.repeat(201)).subarray(0,8));assert.equal(a.stream.closed,true);
 const b=fixture(t,{maximumDecodedBytes:128});b.socket.emit('data',masked(gzipSync(JSON.stringify({x:'x'.repeat(1000)})),{opcode:2}));await until(()=>b.stream.closed);assert.deepEqual(b.messages,[]);
 const c=fixture(t,{maximumMessageBytes:200});c.socket.emit('data',masked('x'.repeat(101),{fin:false}));c.socket.emit('data',masked('x'.repeat(100),{opcode:0}));assert.equal(c.stream.closed,true);
});
test('valid close echoes status and UTF8 reason and delivers no later data',t=>{
 const f=fixture(t),bytes=Buffer.concat([Buffer.from([3,232]),Buffer.from('finished')]);f.socket.emit('data',masked(bytes,{opcode:8}));
 f.socket.emit('data',masked('{}'));assert.deepEqual(decode(f.socket.written[0]),{opcode:8,bytes});assert.deepEqual(f.messages,[]);
});
test('backpressure replaces owner clocks but preserves critical FIFO; bytes and queue age fail closed',t=>{
 let now=0;const f=fixture(t,{clock:()=>now});f.socket.hold=true;f.stream.sendJson({n:1});
 for(let i=0;i<100;i++)f.stream.sendJson({owner:i},{replaceKey:'owner:a'});
 f.stream.sendJson({hit:7});f.stream.sendJson({owner:101},{replaceKey:'owner:a'});f.stream.sendJson({result:true});
 assert.equal(f.stream.queuedEvents,3);f.socket.hold=false;f.socket.drain();
 assert.deepEqual(f.socket.written.map(decodeJson),[{n:1},{hit:7},{owner:101},{result:true}]);
 f.socket.hold=true;f.stream.sendJson({blocked:true});f.stream.sendJson({hit:8});now=1001;assert.equal(f.stream.sendJson({owner:102},{replaceKey:'owner:a'}),false);assert.equal(f.socket.destroyed,true);
 const g=fixture(t,{maximumQueuedBytes:30});g.socket.hold=true;assert.equal(g.stream.sendJson({x:'abc'.repeat(100)}),false);assert.equal(g.socket.destroyed,true);
});
test('fragment/frame flood is count bounded even for zero-length messages',t=>{
 const f=fixture(t);for(let i=0;i<241;i++)f.socket.emit('data',masked('',{opcode:i?0:1,fin:false}));assert.equal(f.stream.closed,true);assert.deepEqual(f.messages,[]);
});

test('small acknowledgements use valid text while large payloads preserve gzip binary framing',t=>{
 const f=fixture(t);f.stream.sendJson({type:'ack',data:{accepted:true,sequence:3}});f.stream.sendJson({noise:'x'.repeat(2000)});
 assert.equal(decode(f.socket.written[0]).opcode,1);assert.equal(decode(f.socket.written[1]).opcode,2);
 assert.deepEqual(f.socket.written.map(decodeJson),[{type:'ack',data:{accepted:true,sequence:3}},{noise:'x'.repeat(2000)}]);
 assert.equal(f.stream.performance().textMessages,1);assert.equal(f.stream.performance().gzipMessages,1);
});

test('one bounded async decoder keeps reliable order while ping remains responsive and late work cannot revive a closed socket',async t=>{
 const jobs=[],f=fixture(t,{decodeGzip:bytes=>new Promise(resolve=>jobs.push({bytes,resolve}))});
 f.socket.emit('data',masked(gzipSync('{"sequence":1}'),{opcode:2}));
 f.socket.emit('data',masked('{"sequence":2}'));
 f.socket.emit('data',masked(gzipSync('{"sequence":3}'),{opcode:2}));
 f.socket.emit('data',masked('alive',{opcode:9}));
 await until(()=>jobs.length===1);assert.deepEqual(f.messages,[]);assert.equal(f.stream.performance().decodeQueuedMessages,3);
 assert.deepEqual(decode(f.socket.written[0]),{opcode:10,bytes:Buffer.from('alive')});
 jobs[0].resolve(gunzipSync(jobs[0].bytes));await until(()=>jobs.length===2);
 assert.deepEqual(f.messages,[{sequence:1},{sequence:2}]);
 f.stream.destroy('test-close');jobs[1].resolve(gunzipSync(jobs[1].bytes));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.messages,[{sequence:1},{sequence:2}]);assert.equal(f.stream.performance().decodeQueuedMessages,0);
 assert.equal(f.stream.performance().closeReason,'test-close');
});

test('compressed incoming work is bounded by bytes, message count and original age',async t=>{
 const deferred=()=>new Promise(()=>{}),payload=gzipSync('{"owner":1}');
 const count=fixture(t,{decodeGzip:deferred,maximumIncomingMessages:2});
 for(let i=0;i<3;i++)count.socket.emit('data',masked(payload,{opcode:2}));
 assert.equal(count.socket.destroyed,true);assert.equal(count.stream.performance().closeReason,'decode-queue-limit');
 const bytes=fixture(t,{decodeGzip:deferred,maximumIncomingQueuedBytes:payload.length});
 bytes.socket.emit('data',masked(payload,{opcode:2}));bytes.socket.emit('data',masked(payload,{opcode:2}));assert.equal(bytes.socket.destroyed,true);
 let now=0,finish;const age=fixture(t,{clock:()=>now,decodeGzip:()=>new Promise(resolve=>{finish=resolve;})});
 age.socket.emit('data',masked(payload,{opcode:2}));await until(()=>finish);now=1001;finish(Buffer.from('{"owner":1}'));
 await until(()=>age.socket.destroyed);assert.deepEqual(age.messages,[]);assert.equal(age.stream.performance().closeReason,'decode-age');
});

test('asynchronous room consumers remain inside transport bounds and preserve FIFO across text/gzip bursts',async t=>{
 const callbacks=[],received=[],f=fixture(t,{onMessage:value=>{received.push(value.sequence);return new Promise(resolve=>callbacks.push(resolve));}});
 f.socket.emit('data',masked('{"sequence":1}'));
 f.socket.emit('data',masked(gzipSync('{"sequence":2}'),{opcode:2}));
 f.socket.emit('data',masked('{"sequence":3}'));
 f.socket.emit('data',masked('alive',{opcode:9}));
 assert.deepEqual(received,[1]);assert.equal(f.stream.performance().decodeQueuedMessages,3);
 assert.ok(f.stream.performance().decodeQueuedBytes>0);assert.deepEqual(decode(f.socket.written[0]),{opcode:10,bytes:Buffer.from('alive')});
 callbacks[0]();await until(()=>received.length===2);assert.deepEqual(received,[1,2]);assert.equal(f.stream.performance().decodeQueuedMessages,2);
 callbacks[1]();await until(()=>received.length===3);assert.deepEqual(received,[1,2,3]);callbacks[2]();
 await until(()=>f.stream.performance().decodeQueuedMessages===0);assert.equal(f.stream.performance().decodeQueuedBytes,0);
});
test('pending application consumption cannot evade incoming message/byte bounds or original message age',async t=>{
 const pending=()=>new Promise(()=>{}),body='{"sequence":1}';
 const count=fixture(t,{onMessage:pending,maximumIncomingMessages:2});
 for(let n=0;n<3;n++)count.socket.emit('data',masked(body));assert.equal(count.stream.performance().closeReason,'decode-queue-limit');
 const bytes=fixture(t,{onMessage:pending,maximumIncomingQueuedBytes:Buffer.byteLength(body)});
 bytes.socket.emit('data',masked(body));bytes.socket.emit('data',masked(body));assert.equal(bytes.stream.performance().closeReason,'decode-queue-limit');
 let clock=0,resolve;const age=fixture(t,{clock:()=>clock,onMessage:()=>new Promise(done=>{resolve=done;})});
 age.socket.emit('data',masked(body));clock=1001;resolve();await until(()=>age.stream.closed);assert.equal(age.stream.performance().closeReason,'decode-age');
});
test('asynchronous consumer failure closes explicitly, and closing during consumption never starts another queued callback',async t=>{
 let reject;const failure=fixture(t,{onMessage:()=>new Promise((resolve,decline)=>{reject=decline;})});
 failure.socket.emit('data',masked('{}'));reject(Error('worker failed'));await until(()=>failure.stream.closed);
 assert.equal(failure.stream.performance().closeReason,'message-consumer-failed');assert.equal(failure.stream.performance().closeCode,1011);
 let resolve,calls=0;const retired=fixture(t,{onMessage:()=>{calls++;return new Promise(done=>{resolve=done;});}});
 retired.socket.emit('data',masked('{}'));retired.socket.emit('data',masked('{}'));retired.stream.destroy();resolve();await new Promise(done=>setImmediate(done));
 assert.equal(calls,1);assert.equal(retired.stream.performance().decodeQueuedMessages,0);
});

test('explicit ordered-consumer pipeline dispatches FIFO before the prior RPC completes, with exact completion ACKs',async t=>{
 const callbacks=[],received=[],f=fixture(t,{maximumConsumerInFlight:2,onMessage:value=>{
  received.push(value.sequence);return new Promise(resolve=>callbacks.push(()=>{f.stream.sendJson({ack:value.sequence});resolve();}));
 }});
 f.socket.emit('data',masked('{"sequence":1}'));
 f.socket.emit('data',masked(gzipSync('{"sequence":2}'),{opcode:2}));
 f.socket.emit('data',masked('{"sequence":3}'));
 await until(()=>received.length===2);assert.deepEqual(received,[1,2]);assert.equal(f.socket.written.length,0,'dispatch is not an acceptance ACK');
 assert.equal(f.stream.performance().decodeQueuedMessages,3);assert.equal(f.stream.performance().consumerInFlight,2);
 callbacks[1]();await until(()=>received.length===3);assert.deepEqual(received,[1,2,3]);assert.deepEqual(f.socket.written.map(decodeJson),[{ack:2}]);
 callbacks[0]();callbacks[2]();await until(()=>f.stream.performance().decodeQueuedMessages===0);
 assert.deepEqual(f.socket.written.map(decodeJson),[{ack:2},{ack:1},{ack:3}]);assert.equal(f.stream.performance().decodeQueuedBytes,0);
});

test('pipelined application work shares the unchanged total bytes/count/age limits, and close cancels late dispatch',async t=>{
 const pending=()=>new Promise(()=>{}),body='{"sequence":1}';
 const count=fixture(t,{maximumConsumerInFlight:2,onMessage:pending,maximumIncomingMessages:2});
 for(let n=0;n<3;n++)count.socket.emit('data',masked(body));assert.equal(count.stream.performance().closeReason,'decode-queue-limit');
 const bytes=fixture(t,{maximumConsumerInFlight:2,onMessage:pending,maximumIncomingQueuedBytes:Buffer.byteLength(body)});
 bytes.socket.emit('data',masked(body));bytes.socket.emit('data',masked(body));assert.equal(bytes.stream.performance().closeReason,'decode-queue-limit');
 let clock=0;const done=[],age=fixture(t,{maximumConsumerInFlight:2,clock:()=>clock,onMessage:()=>new Promise(resolve=>done.push(resolve))});
 age.socket.emit('data',masked(body));clock=100;age.socket.emit('data',masked(body));assert.equal(done.length,2);
 clock=1001;done[1]();await until(()=>age.stream.closed);assert.equal(age.stream.performance().closeReason,'decode-age');
 let calls=0;const finish=[],closed=fixture(t,{maximumConsumerInFlight:2,onMessage:()=>{calls++;return new Promise(resolve=>finish.push(resolve));}});
 for(let n=0;n<3;n++)closed.socket.emit('data',masked(body));assert.equal(calls,2);closed.stream.destroy();finish.forEach(resolve=>resolve());
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);assert.equal(closed.stream.performance().consumerInFlight,0);
 const synchronous=fixture(t,{maximumConsumerInFlight:2,onMessage:()=>{synchronous.stream.destroy();return Promise.resolve();}});
 synchronous.socket.emit('data',masked(body));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(synchronous.stream.performance().consumerInFlight,0,'closing inside dispatch cannot resurrect an in-flight reservation');
 const callbacks=[],failed=fixture(t,{maximumConsumerInFlight:2,onMessage:()=>new Promise((resolve,reject)=>callbacks.push({resolve,reject}))});
 for(let n=0;n<3;n++)failed.socket.emit('data',masked(body));callbacks[1].reject(Error('RPC failed'));
 await until(()=>failed.stream.closed);callbacks[0].resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(callbacks.length,2);assert.equal(failed.stream.performance().closeReason,'message-consumer-failed');
 assert.equal(failed.stream.performance().consumerInFlight,0);
 for(const value of [0,-1,1.5,65,Infinity])assert.throws(()=>createWebSocketStream(new Socket(),{maximumConsumerInFlight:value}),/invalid-consumer-inflight/);
});
