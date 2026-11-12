/** Bounded RFC6455 transport. No extension (including permessage-deflate) is
 * negotiated. Application gzip is a separate explicitly named subprotocol. */
import {createHash} from 'node:crypto';
import {gzipSync,gunzip} from 'node:zlib';
import {encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,networkJsonByteLength,NETWORK_BINARY_VERSION,NETWORK_BINARY_COMPRESSION_THRESHOLD} from '../../packages/online/network-binary.mjs';
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const ONLINE_SOCKET_PROTOCOL='rf-online-gzip-v1';
const utf8=new TextDecoder('utf-8',{fatal:true});
const validCode=code=>code>=1000&&code<=4999&&![1004,1005,1006,1015].includes(code)&&(code<=1014||code>=3000);
export function websocketHandshake(req){
 const key=req.headers['sec-websocket-key'];
 if(req.method!=='GET'||String(req.headers.upgrade).toLowerCase()!=='websocket'
  ||!String(req.headers.connection).toLowerCase().split(',').map(v=>v.trim()).includes('upgrade')
  ||req.headers['sec-websocket-version']!=='13'||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)
  ||Buffer.from(key,'base64').length!==16||!String(req.headers['sec-websocket-protocol']).split(',').map(v=>v.trim()).includes(ONLINE_SOCKET_PROTOCOL))return null;
 return createHash('sha1').update(key+GUID).digest('base64');
}
export function websocketFrame(payload,opcode=2){
 payload=Buffer.from(payload);let header;
 if(payload.length<126){header=Buffer.alloc(2);header[1]=payload.length;}
 else if(payload.length<=65535){header=Buffer.alloc(4);header[1]=126;header.writeUInt16BE(payload.length,2);}
 else{header=Buffer.alloc(10);header[1]=127;header.writeBigUInt64BE(BigInt(payload.length),2);}
 header[0]=0x80|opcode;return Buffer.concat([header,payload]);
}
export function createWebSocketStream(socket,{head=Buffer.alloc(0),onMessage=()=>{},onClose=()=>{},clock=()=>performance.now(),
 maximumMessageBytes=128*1024,maximumDecodedBytes=128*1024,maximumQueuedBytes=512*1024,maximumQueueAgeMs=1000,
 maximumIncomingQueuedBytes=512*1024,maximumIncomingMessages=64,textMessageBytes=1024,maximumConsumerInFlight=1,networkBinaryVersion=0,
 decodeGzip=(bytes,options)=>new Promise((resolve,reject)=>gunzip(bytes,options,(error,value)=>error?reject(error):resolve(value)))}={}){
 if(!Number.isSafeInteger(maximumConsumerInFlight)||maximumConsumerInFlight<1||maximumConsumerInFlight>64)
  throw Error('invalid-consumer-inflight');
 let input=Buffer.alloc(0),fragmentOpcode=null,fragmentBytes=0,fragments=[],closed=false,closing=false,blocked=false,queueBytes=0,rateStart=clock(),rateCount=0;
 const queue=[],incoming=[],consuming=new Set();let closeTimer=null,blockedAt=null,decoding=null,incomingBytes=0;
 const binaryEnabled=networkBinaryVersion===NETWORK_BINARY_VERSION;
 const metrics={receivedMessages:0,receivedBytes:0,decodedBytes:0,sentMessages:0,sentBytes:0,textMessages:0,gzipMessages:0,binaryMessages:0,binaryRawMessages:0,
  maximumDecodeQueuedBytes:0,maximumDecodeQueuedMessages:0,maximumDecodeMs:0,maximumQueuedBytes:0,coalescedMessages:0,closeReason:null,closeCode:null};
 const incomingCount=()=>incoming.length+(decoding?1:0)+consuming.size;
 const oldestIncomingAt=()=>Math.min(decoding?.at??Infinity,incoming[0]?.at??Infinity,...[...consuming].map(row=>row.at));
 const incomingAge=()=>Math.max(0,clock()-oldestIncomingAt());
 const discard=()=>{queue.length=0;queueBytes=0;input=Buffer.alloc(0);fragments=[];fragmentBytes=0;incoming.length=0;incomingBytes=0;decoding=null;consuming.clear();};
 const totalBytes=()=>queueBytes+socket.writableLength;
 function shutdown(){if(closed)return;closed=true;metrics.closeReason??='socket-closed';
  const closeState={...metrics,closingQueuedBytes:totalBytes(),closingQueueAgeMs:Math.max(blockedAt===null?0:clock()-blockedAt,queue[0]?clock()-queue[0].at:0),
   closingDecodeQueuedBytes:incomingBytes,closingDecodeAgeMs:incomingAge()};
  clearTimeout(closeTimer);discard();socket.off('drain',drain);onClose(closeState);}
 function abort(reason='destroyed'){if(closed)return;metrics.closeReason??=reason;shutdown();socket.destroy();}
 function output(frame){metrics.sentMessages++;metrics.sentBytes+=frame.length;blocked=!socket.write(frame);if(blocked&&blockedAt===null)blockedAt=clock();}
 function pump(){
  if(closed||closing||blocked||socket.writableNeedDrain)return;
  if(queue[0]&&clock()-queue[0].at>maximumQueueAgeMs){abort('output-age');return;}
  while(queue.length&&!blocked&&!socket.writableNeedDrain){const row=queue.shift();queueBytes-=row.frame.length;output(row.frame);}
 }
 function drain(){blocked=false;blockedAt=null;pump();}
 function close(code=1000,reason='close-'+code){
  if(closed||closing)return;metrics.closeReason??=reason;metrics.closeCode=code;closing=true;discard();const payload=Buffer.alloc(2);payload.writeUInt16BE(code);
  if(!socket.destroyed)socket.end(websocketFrame(payload,8));
  closeTimer=setTimeout(abort,1000);closeTimer.unref?.();
 }
 function send(payload,{opcode=2,replaceKey=null}={}){
  if(closed||closing||socket.destroyed)return false;
  if(replaceKey!==null)for(let i=queue.length-1;i>=0;i--)if(queue[i].key===replaceKey){queueBytes-=queue[i].frame.length;queue.splice(i,1);metrics.coalescedMessages++;}
  const frame=websocketFrame(payload,opcode);
  if(totalBytes()+frame.length>maximumQueuedBytes){abort('output-bytes');return false;}
  if(queue[0]&&clock()-queue[0].at>maximumQueueAgeMs||blockedAt!==null&&clock()-blockedAt>maximumQueueAgeMs){abort('output-age');return false;}
  if(!queue.length&&!blocked&&!socket.writableNeedDrain)output(frame);
  else{queue.push({frame,key:replaceKey,at:clock()});queueBytes+=frame.length;pump();}
  metrics.maximumQueuedBytes=Math.max(metrics.maximumQueuedBytes,totalBytes());return true;
 }
 function deliver(decoded,binaryAllowed){
  if(closed||closing)return;
  try{
   if(decoded.length>maximumDecodedBytes){close(1009);return;}
   const binary=binaryAllowed&&isNetworkBinary(decoded);
   if(binary&&!binaryEnabled){close(1007,'network-binary-not-negotiated');return;}
   const value=binary?decodeNetworkBinary(decoded,{maximumBytes:maximumDecodedBytes,maximumDecodedBytes}):JSON.parse(utf8.decode(decoded));
   if(!value||typeof value!=='object'||Array.isArray(value)){close(1007);return;}
   metrics.decodedBytes+=binary?networkJsonByteLength(value):decoded.length;return onMessage(value);
  }catch{close(1007,'invalid-json');}
 }
 function decodeNext(){
  if(closed||closing||decoding||consuming.size>=maximumConsumerInFlight||!incoming.length)return;
  if(incomingAge()>maximumQueueAgeMs){abort('decode-age');return;}
  const row=incoming.shift();decoding=row;
  if(clock()-row.at>maximumQueueAgeMs){abort('decode-age');return;}
  const complete=()=>{
   if(closed||closing||decoding!==row&&!consuming.has(row))return;
   if(incomingAge()>maximumQueueAgeMs){abort('decode-age');return;}
   incomingBytes-=row.bytes.length;consuming.delete(row);if(decoding===row)decoding=null;decodeNext();
  };
  const consume=decoded=>{
   if(closed||closing||decoding!==row)return;
   const result=deliver(decoded,row.opcode===2);
   // Dispatch remains FIFO with one decoder. A known synchronous IPC room
   // can opt into bounded submission overlap without waiting for its reply
   // round trip. Generic consumers still await each completion by default.
   // Every in-flight consumer retains its original byte/count/age reservation;
   // a slow earlier RPC cannot evade the limits by completing a newer one.
   if(result&&typeof result.then==='function'){
    if(!closed&&!closing&&decoding===row){consuming.add(row);decoding=null;}
    Promise.resolve(result).then(complete,()=>{
     if(!closed&&!closing&&consuming.has(row))close(1011,'message-consumer-failed');
    });decodeNext();
   }else complete();
  };
  if(row.opcode===1){consume(row.bytes);return;}
  if(isNetworkBinary(row.bytes)){consume(row.bytes);return;}
  // Exactly one async decompression per connection preserves reliable action
  // order without blocking every other room's event loop. The in-flight row
  // remains counted in both limits until its application result is consumed.
  Promise.resolve().then(()=>decodeGzip(row.bytes,{maxOutputLength:maximumDecodedBytes})).then(decoded=>{
   if(closed||closing||decoding!==row)return;
   const age=clock()-row.at;metrics.maximumDecodeMs=Math.max(metrics.maximumDecodeMs,age);
   if(age>maximumQueueAgeMs){abort('decode-age');return;}consume(decoded);
  }).catch(error=>{if(!closed&&!closing&&decoding===row)close(error?.code==='ERR_BUFFER_TOO_LARGE'?1009:1007,'invalid-gzip');});
 }
 function message(opcode,bytes){
  metrics.receivedMessages++;metrics.receivedBytes+=bytes.length;
  if(incomingBytes+bytes.length>maximumIncomingQueuedBytes||incomingCount()>=maximumIncomingMessages){abort('decode-queue-limit');return;}
  incoming.push({opcode,bytes,at:clock()});incomingBytes+=bytes.length;
  metrics.maximumDecodeQueuedBytes=Math.max(metrics.maximumDecodeQueuedBytes,incomingBytes);
  metrics.maximumDecodeQueuedMessages=Math.max(metrics.maximumDecodeQueuedMessages,incomingCount());decodeNext();
 }
 function read(chunk){
  if(closed||closing)return;
  if(chunk.length>maximumMessageBytes+14){close(1009);return;}
  // A TCP read may contain many complete frames; consume before retaining its
  // partial suffix. The suffix and fragment chain independently stay bounded.
  input=Buffer.concat([input,chunk]);
  while(input.length>=2&&!closed&&!closing){
   const first=input[0],second=input[1],fin=!!(first&128),opcode=first&15;
   if(first&112||!(second&128)||![0,1,2,8,9,10].includes(opcode)){close(1002);return;}
   let length=second&127,offset=2;
   if(length===126){if(input.length<4)break;length=input.readUInt16BE(2);offset=4;if(length<126){close(1002);return;}}
   else if(length===127){if(input.length<10)break;const big=input.readBigUInt64BE(2);if(big<65536n||big>BigInt(maximumMessageBytes)){close(big>BigInt(maximumMessageBytes)?1009:1002);return;}length=Number(big);offset=10;}
   const control=opcode>=8;
   if(control&&(!fin||length>125)){close(1002);return;}
   if(length>maximumMessageBytes||!control&&fragmentBytes+length>maximumMessageBytes){close(1009);return;}
   if(input.length<offset+4+length)break;
   const mask=input.subarray(offset,offset+4),payload=Buffer.from(input.subarray(offset+4,offset+4+length));
   for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];input=input.subarray(offset+4+length);
   if(clock()-rateStart>=1000){rateStart=clock();rateCount=0;}if(++rateCount>240){close(1008);return;}
   if(control){
    if(opcode===8){if(length===1){close(1002);return;}
     if(length>=2){const code=payload.readUInt16BE();if(!validCode(code)){close(1002);return;}try{utf8.decode(payload.subarray(2));}catch{close(1007);return;}}
     metrics.closeReason='peer-close';metrics.closeCode=length>=2?payload.readUInt16BE():1000;closing=true;discard();socket.end(websocketFrame(payload,8));closeTimer=setTimeout(abort,1000);closeTimer.unref?.();return;
    }
    if(opcode===9)send(payload,{opcode:10});continue;
   }
   if(opcode===0){if(fragmentOpcode===null){close(1002);return;}}
   else if(fragmentOpcode!==null){close(1002);return;}
   else fragmentOpcode=opcode;
   fragments.push(payload);fragmentBytes+=length;
   if(fragments.length>256){close(1009);return;}
   if(fin){const complete=Buffer.concat(fragments,fragmentBytes),kind=fragmentOpcode;fragments=[];fragmentBytes=0;fragmentOpcode=null;message(kind,complete);}
  }
  if(input.length>maximumMessageBytes+14)close(1009);
 }
 socket.on('data',read);socket.on('drain',drain);socket.on('error',()=>abort('socket-error'));socket.once('close',shutdown);socket.once('end',()=>{metrics.closeReason??='socket-end';shutdown();socket.end();});
 const expiry=setInterval(()=>{if(closed||closing)return;
  if(queue[0]&&clock()-queue[0].at>maximumQueueAgeMs||blockedAt!==null&&clock()-blockedAt>maximumQueueAgeMs)abort('output-age');
  else if(incomingAge()>maximumQueueAgeMs)abort('decode-age');
 },250);expiry.unref?.();
 socket.once('close',()=>clearInterval(expiry));
 const stream={sendJson(value,options){
   // Keep initial capability and small ACK messages readable by legacy peers.
   if(binaryEnabled&&value?.type!=='transport'){
    try{
     const jsonBytes=networkJsonByteLength(value);if(jsonBytes>1024*1024){close(1009);return false;}
     if(jsonBytes>textMessageBytes){
      const raw=encodeNetworkBinary(value,{maximumBytes:1024*1024});
      const zipped=raw.byteLength>NETWORK_BINARY_COMPRESSION_THRESHOLD?gzipSync(raw,{level:1}):raw;
      const bytes=zipped.byteLength<raw.byteLength?zipped:raw;
      metrics.binaryMessages++;if(bytes===raw)metrics.binaryRawMessages++;else metrics.gzipMessages++;
      return send(bytes,options);
     }
    }catch(error){if(error?.message!=='network-binary-size'){close(1007,'binary-encode-failed');return false;}}
   }
   const text=JSON.stringify(value),bytes=Buffer.byteLength(text);if(bytes>1024*1024){close(1009);return false;}
   if(binaryEnabled&&value?.type==='transport'){metrics.textMessages++;return send(text,{...options,opcode:1});}
   if(bytes<=textMessageBytes){metrics.textMessages++;return send(text,{...options,opcode:1});}
   metrics.gzipMessages++;return send(gzipSync(text,{level:1}),options);},close,destroy:abort,
   performance(){return {...metrics,networkBinaryVersion:binaryEnabled?NETWORK_BINARY_VERSION:0,closed:closed||closing,queuedBytes:totalBytes(),queuedEvents:queue.length,
    queueAgeMs:Math.max(blockedAt===null?0:clock()-blockedAt,queue[0]?clock()-queue[0].at:0),decodeQueuedBytes:incomingBytes,
    decodeQueuedMessages:incomingCount(),decodeAgeMs:incomingAge(),consumerInFlight:consuming.size,maximumConsumerInFlight};},
   get queuedBytes(){return totalBytes();},get queuedEvents(){return queue.length;},get closed(){return closed||closing;}};
 if(head.length)queueMicrotask(()=>read(head));return stream;
}
