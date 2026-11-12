import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {gzipSync} from 'node:zlib';
import {createWebSocketStream} from '../../apps/server/websocket-stream.mjs';
import {NETWORK_BINARY_VERSION,encodeNetworkBinary,isNetworkBinary} from '../../packages/online/network-binary.mjs';
import {decodeOnlineGzip} from '../../apps/web/online-socket.mjs';
class Socket extends EventEmitter{writableLength=0;writableNeedDrain=false;destroyed=false;written=[];
 write(value){this.written.push(value);return true;}end(value){if(value)this.written.push(value);this.emit('close');}destroy(){this.destroyed=true;this.emit('close');}}
function masked(payload){payload=Buffer.from(payload);const n=payload.length,header=Buffer.alloc(n<126?6:8);header[0]=0x82;header[1]=0x80|(n<126?n:126);if(n>=126)header.writeUInt16BE(n,2);return Buffer.concat([header,payload]);}
function payload(frame){let offset=2;if((frame[1]&127)===126)offset=4;else if((frame[1]&127)===127)offset=10;return frame.subarray(offset);}
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('timeout');};
function fixture(t,options={}){const socket=new Socket(),messages=[];const stream=createWebSocketStream(socket,{onMessage:value=>messages.push(value),...options});t.after(()=>stream.destroy());return {socket,stream,messages};}
test('server negotiated raw/gzip binary and legacy JSON retain ordered application values',async t=>{
 const f=fixture(t,{networkBinaryVersion:NETWORK_BINARY_VERSION}),one={sequence:1,actor:{x:1,y:-0}},two={sequence:2,description:'x'.repeat(3000)};
 f.socket.emit('data',masked(encodeNetworkBinary(one)));f.socket.emit('data',masked(gzipSync(encodeNetworkBinary(two))));f.socket.emit('data',masked(gzipSync(JSON.stringify({sequence:3}))));
 await until(()=>f.messages.length===3);assert.deepEqual(f.messages,[one,two,{sequence:3}]);assert.equal(f.stream.performance().decodeQueuedMessages,0);
});
test('unnegotiated binary and decoded JSON amplification fail before the room callback',async t=>{
 const a=fixture(t);a.socket.emit('data',masked(encodeNetworkBinary({sequence:1})));assert.equal(a.stream.closed,true);assert.deepEqual(a.messages,[]);
 const b=fixture(t,{networkBinaryVersion:NETWORK_BINARY_VERSION,maximumDecodedBytes:100});
 b.socket.emit('data',masked(gzipSync(encodeNetworkBinary({value:'x'.repeat(2000)}))));await until(()=>b.stream.closed);assert.deepEqual(b.messages,[]);
});
test('server capability starts as text, binary output preserves small packets and only smaller compression',async t=>{
 const f=fixture(t,{networkBinaryVersion:NETWORK_BINARY_VERSION,textMessageBytes:0});
 f.stream.sendJson({type:'transport',data:{connected:true,networkBinaryVersion:NETWORK_BINARY_VERSION}});
 assert.equal(f.socket.written[0][0]&15,1);
 const value={type:'event',data:{x:1,y:2}};f.stream.sendJson(value);
 assert.ok(isNetworkBinary(payload(f.socket.written[1])));assert.deepEqual(await decodeOnlineGzip(payload(f.socket.written[1]),{allowBinary:true}),value);
 const large={type:'event',data:{description:'x'.repeat(4000)}};f.stream.sendJson(large);
 assert.equal(isNetworkBinary(payload(f.socket.written[2])),false);assert.deepEqual(await decodeOnlineGzip(payload(f.socket.written[2]),{allowBinary:true}),large);
 assert.equal(f.stream.performance().binaryRawMessages,1);assert.equal(f.stream.performance().binaryMessages,2);
});

test('text frames cannot smuggle negotiated binary past UTF-8 JSON validation',t=>{
 const f=fixture(t,{networkBinaryVersion:NETWORK_BINARY_VERSION}),frame=masked(encodeNetworkBinary({sequence:1}));frame[0]=0x81;
 f.socket.emit('data',frame);assert.equal(f.stream.closed,true);assert.deepEqual(f.messages,[]);
});

test('server events keep legal JSON capacity when numeric binary is larger',async t=>{
 const f=fixture(t,{networkBinaryVersion:NETWORK_BINARY_VERSION});
 const value={type:'event',data:{values:Array.from({length:3},()=>Array(50000).fill(.1))}};
 assert.ok(Buffer.byteLength(JSON.stringify(value))<1024*1024);
 assert.ok(encodeNetworkBinary(value,{maximumBytes:2*1024*1024}).length>1024*1024);
 assert.equal(f.stream.sendJson(value),true);assert.equal(f.stream.closed,false);
 assert.deepEqual(await decodeOnlineGzip(payload(f.socket.written[0]),{allowBinary:true}),value);
 assert.equal(f.stream.performance().binaryMessages,0);
});
