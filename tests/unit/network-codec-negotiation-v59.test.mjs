import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {createOnlineSocket,decodeOnlineGzip} from '../../apps/web/online-socket.mjs';
import {createWebSocketStream} from '../../apps/server/websocket-stream.mjs';
import {encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();await new Promise(resolve=>setImmediate(resolve));};

test('old v2 peer capability keeps the complete reliable JSON route without emitting v3',()=>{
  const sent=[];let binaryCalls=0;
  const control=createPeerControl({matchId:'mixed-codec',reliableTransport:true,networkBinary:true,controlDelta:false,
    send:text=>{sent.push(JSON.parse(text));return true;},sendValue(){binaryCalls++;throw Error('v2 cannot consume v3');}});
  control.pump();assert.equal(sent[0].networkBinaryVersion,3);
  control.receiveText(JSON.stringify({v:1,matchId:'mixed-codec',type:'hello-ack',gzip:false,networkBinaryVersion:2}));
  control.stage({protocol:'local-owner-v1',epoch:1,frameSeq:1,actor:{},effects:[],hits:[],actions:[{id:1,frameSeq:1,actor:{},effects:[]}]});
  assert.equal(control.performance().networkBinaryVersion,0);assert.equal(control.performance().receiveNetworkBinaryVersion,0);
  assert.equal(binaryCalls,0);assert.equal(sent.filter(row=>row.type==='actions').length,1);
  assert.deepEqual(sent.find(row=>row.type==='actions').report.actions,[{id:1,frameSeq:1,actor:{},effects:[]}]);
});

test('v3 WebSocket client follows an older server capability using gzip JSON',async t=>{
  const sockets=[];
  class Socket{constructor(url){this.url=url;this.bufferedAmount=0;this.sent=[];sockets.push(this);}send(value){this.sent.push(value);}close(){}}
  const client=createOnlineSocket({WebSocket:Socket,url:'ws://fixture/online',timers:{setTimeout(){return 1;},clearTimeout(){}}});t.after(()=>client.close());client.open();
  assert.equal(new URL(sockets[0].url).searchParams.get('networkBinaryVersion'),'3');
  sockets[0].onmessage({data:JSON.stringify({type:'transport',data:{connected:true,networkBinaryVersion:2}})});await tick();
  const value={sequence:17,frames:[{frameSeq:17,held:['RIGHT'],pressed:[],released:[]}]};
  assert.equal(client.send(value),true);
  for(let i=0;i<100&&!sockets[0].sent.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(sockets[0].sent.length,1);assert.equal(client.performance().networkBinaryVersion,0);
  assert.equal(isNetworkBinary(sockets[0].sent[0]),false);assert.deepEqual(await decodeOnlineGzip(sockets[0].sent[0]),value);
});

test('v3 server keeps v2-requesting streams in JSON mode and a v3 stream retains legacy decoders',async t=>{
  class Socket extends EventEmitter{writableLength=0;writableNeedDrain=false;destroyed=false;written=[];
    write(value){this.written.push(value);return true;}end(value){if(value)this.written.push(value);this.emit('close');}destroy(){this.destroyed=true;this.emit('close');}}
  const socket=new Socket(),stream=createWebSocketStream(socket,{networkBinaryVersion:2,textMessageBytes:0});t.after(()=>stream.destroy());
  const value={type:'event',event:'owner-status',data:{epoch:1,frameSeq:17,actor:{x:.1}}};
  assert.equal(stream.sendJson(value),true);assert.equal(stream.performance().networkBinaryVersion,0);
  const frame=socket.written[0],offset=(frame[1]&127)===126?4:(frame[1]&127)===127?10:2;
  assert.deepEqual(await decodeOnlineGzip(frame.subarray(offset)),value);
  for(const version of [1,2,NETWORK_BINARY_VERSION]){
    const bytes=encodeNetworkBinary(value,{version});assert.deepEqual(decodeNetworkBinary(bytes),value);
    assert.deepEqual(await decodeOnlineGzip(bytes,{allowBinary:true}),value);
  }
});
