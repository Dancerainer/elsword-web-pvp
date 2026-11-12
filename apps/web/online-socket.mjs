import {encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,networkJsonByteLength,NETWORK_BINARY_VERSION,NETWORK_BINARY_COMPRESSION_THRESHOLD} from '../../packages/online/network-binary.mjs';
/** Bounded application gzip shared with negotiated peer packets. */
export const compressOnlineText=async text=>new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
export const compressOnlineBytes=compressOnlineText;
// Some legal numeric arrays are denser in decimal JSON than in typed binary.
// Preserve the existing JSON/gzip route when the new representation exceeds
// its budget; a codec choice must not reject an otherwise legal owner report.
export function encodeOnlineEnvelope(value,{binary=false,maximumBytes=128*1024,measureTextBytes=true}={}){
 if(binary){
  try{const bytes=encodeNetworkBinary(value,{maximumBytes});return {binary:bytes,bytes:bytes.byteLength};}
  catch(error){if(error?.message!=='network-binary-size')throw error;}
 }
 const text=JSON.stringify(value);return {text,...(measureTextBytes?{bytes:new TextEncoder().encode(text).byteLength}:{})};
}
// 2016's compress-only-when-smaller policy, applied to our versioned Web
// envelope. Small updates bypass an asynchronous compression job entirely.
export async function packOnlineBinary(bytes,{compress=compressOnlineBytes,threshold=NETWORK_BINARY_COMPRESSION_THRESHOLD}={}){
 if(bytes.byteLength<=threshold)return bytes;
 const packed=await compress(bytes);
 if(!(packed instanceof Uint8Array))throw Error('invalid-network-compression');
 return packed.byteLength<bytes.byteLength?packed:bytes;
}
export async function decodeOnlineGzip(data,{maximumWireBytes=512*1024,maximumDecodedBytes=1024*1024,returnMetadata=false,allowBinary=false}={}){
 const bytes=data instanceof ArrayBuffer?data:ArrayBuffer.isView(data)?data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength):await data.arrayBuffer();
 if(bytes.byteLength>maximumWireBytes)throw Error('socket-message-too-large');
 const parse=decoded=>{
  if(isNetworkBinary(decoded)){
   if(!allowBinary)throw Error('network-binary-not-negotiated');
   const value=decodeNetworkBinary(decoded,{maximumBytes:maximumDecodedBytes,maximumDecodedBytes});
   return returnMetadata?{value,decodedBytes:networkJsonByteLength(value)}:value;
  }
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
  return returnMetadata?{value,decodedBytes:decoded.byteLength}:value;
 };
 if(isNetworkBinary(bytes))return parse(new Uint8Array(bytes));
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximumDecodedBytes){await reader.cancel();throw Error('socket-decoded-message-too-large');}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 const decoded=new Uint8Array(size);let at=0;for(const chunk of chunks){decoded.set(chunk,at);at+=chunk.byteLength;}
 return parse(decoded);
}

/** Same-origin persistent relay. Movement is one replaceable newest send;
 * acknowledged action/hit identities stay in the coordinator until receipt.
 * Gzip is this application's subprotocol, not a WebSocket extension. */
export function createOnlineSocket({WebSocket:Socket=globalThis.WebSocket,url,clock=()=>performance.now(),timers=globalThis,
 onEvent=()=>{},onActive=()=>{},onInactive=()=>{},onAcknowledgement=()=>{},compress,decode,networkBinary=true,compressBytes=compressOnlineBytes}={}){
 const gzip=compress??compressOnlineText,gunzip=decode??decodeOnlineGzip;
 let connection=null,active=false,stopped=false,packing=null,pending=null,reading=null,retry=null,packingRetry=null,openingDeadline=null,retryDelay=1000,blockedAt=null;
 const incoming=[];let incomingBytes=0,generation=0;
 let ownerUploadDelta=false,binaryNegotiated=false;
 const maximumWorkAgeMs=1000;
 const metrics={sentMessages:0,sentBytes:0,receivedMessages:0,receivedBytes:0,reconnections:0,coalescedSends:0,failures:0,
  lastFailure:null,lastCloseCode:null,lastCloseWasClean:null,lastCompressionMs:0,maximumCompressionMs:0,binaryMessages:0,binaryRawMessages:0,independentAckBypasses:0};
 const isCurrent=(socket,serial)=>!stopped&&connection===socket&&generation===serial;
 function clearPacking(){
  timers.clearTimeout(packingRetry);packingRetry=null;timers.clearTimeout(packing?.deadline);
  const row=packing?.row;packing=null;row?.onSuperseded?.();
 }
 function inactive(socket,serial,reason='socket-closed'){
  if(!isCurrent(socket,serial))return;connection=null;generation++;timers.clearTimeout(openingDeadline);openingDeadline=null;
  const wasActive=active;active=false;ownerUploadDelta=false;binaryNegotiated=false;clearPacking();timers.clearTimeout(reading?.deadline);reading=null;
  pending=null;blockedAt=null;incoming.length=0;incomingBytes=0;metrics.failures++;metrics.lastFailure=reason;
  if(wasActive)onInactive();socket.onopen=socket.onclose=socket.onerror=socket.onmessage=null;socket.close?.();
  retry=timers.setTimeout(()=>{retry=null;open();},retryDelay);retryDelay=Math.min(30000,retryDelay*2);
 }
 async function read(socket,serial){
  if(reading)return;const job={deadline:null,startedAt:clock()};reading=job;
  try{while(incoming.length&&isCurrent(socket,serial)){
   const row=incoming.shift();incomingBytes-=row.bytes;job.startedAt=clock();
   job.deadline=timers.setTimeout(()=>inactive(socket,serial,'decode-timeout'),maximumWorkAgeMs);
   // Small server confirmations need neither a gzip job nor a native stream.
   // Existing binary gzip remains accepted for older deployed coordinators.
   const value=typeof row.data==='string'?JSON.parse(row.data):binaryNegotiated
    ?await decodeOnlineGzip(row.data,{allowBinary:true}):await gunzip(row.data);timers.clearTimeout(job.deadline);job.deadline=null;
   if(!isCurrent(socket,serial)||reading!==job)return;
   if(clock()-job.startedAt>=maximumWorkAgeMs){inactive(socket,serial,'decode-timeout');return;}
   if(value?.type==='transport'&&value.data?.connected===true){timers.clearTimeout(openingDeadline);openingDeadline=null;
    ownerUploadDelta=value.data.ownerUploadDelta===1;binaryNegotiated=networkBinary!==false&&value.data.networkBinaryVersion===NETWORK_BINARY_VERSION;
    active=true;retryDelay=1000;onActive(value.data);void pack(socket,serial);}
   else if(value?.type==='ack')onAcknowledgement(value.data);
   else if(value?.type==='event'&&typeof value.event==='string'&&value.data&&typeof value.data==='object')onEvent(value.event,value.data,{eventId:value.id});
   else throw Error('invalid-socket-message');
  }}catch{inactive(socket,serial,'decode-failed');}finally{timers.clearTimeout(job.deadline);if(reading===job){reading=null;if(incoming.length&&connection)void read(connection,generation);}}
 }
 async function pack(socket,serial){
  if(packing)return;timers.clearTimeout(packingRetry);packingRetry=null;
  const job={row:null,deadline:null,startedAt:clock()};packing=job;
  try{while(pending&&active&&isCurrent(socket,serial)){
   if(socket.bufferedAmount>32768){blockedAt??=clock();if(clock()-blockedAt>=maximumWorkAgeMs)inactive(socket,serial,'buffered-output-timeout');break;}
   blockedAt=null;const row=pending;pending=null;job.row=row;job.startedAt=clock();
   job.deadline=timers.setTimeout(()=>inactive(socket,serial,'compression-timeout'),maximumWorkAgeMs);
   const bytes=row.binary?await packOnlineBinary(row.binary,{compress:compressBytes}):await gzip(row.text);timers.clearTimeout(job.deadline);job.deadline=null;
   if(!isCurrent(socket,serial)||!active||packing!==job)return;
   const elapsed=clock()-job.startedAt;metrics.lastCompressionMs=elapsed;metrics.maximumCompressionMs=Math.max(metrics.maximumCompressionMs,elapsed);
   if(elapsed>=maximumWorkAgeMs){inactive(socket,serial,'compression-timeout');return;}
   // Finish the one in-progress packet even when newer movement arrived.
   // Discarding it here starves every send whenever compression takes longer
   // than the sampling interval. Only the not-yet-started slot is replaceable.
   if(bytes.byteLength>128*1024)throw Error('socket-owner-message-too-large');
   socket.send(bytes);metrics.sentMessages++;metrics.sentBytes+=bytes.byteLength;
   if(row.binary){metrics.binaryMessages++;if(isNetworkBinary(bytes))metrics.binaryRawMessages++;}
   job.row=null;row.onSent?.(clock(),bytes.byteLength);
  }}catch{if(packing===job)inactive(socket,serial,'compression-or-send-failed');}finally{
   timers.clearTimeout(job.deadline);if(packing===job){packing=null;if(pending&&active&&connection){
    packingRetry=timers.setTimeout(()=>{packingRetry=null;void pack(connection,generation);},25);}}
  }
 }
 function open(){
  if(stopped||connection||!Socket)return;
  let socket;const serial=++generation;
  try{
   // The existing gzip subprotocol also serves older binary-only clients.
   // Explicitly advertise text ACK support without retiring that protocol or
   // changing the page/session identity already encoded in the query string.
   const hashAt=url.indexOf('#'),target=hashAt<0?url:url.slice(0,hashAt),fragment=hashAt<0?'':url.slice(hashAt);
   const queryAt=target.indexOf('?'),query=new URLSearchParams(queryAt<0?'':target.slice(queryAt+1));query.set('textAck','1');query.set('ownedDelta','3');query.set('ownerUploadDelta','1');
   if(networkBinary!==false)query.set('networkBinaryVersion',String(NETWORK_BINARY_VERSION));else query.delete('networkBinaryVersion');
   const address=(queryAt<0?target:target.slice(0,queryAt))+'?'+query+fragment;
   socket=new Socket(address,'rf-online-gzip-v1');
  }catch{retry=timers.setTimeout(()=>{retry=null;open();},retryDelay);return;}
  connection=socket;ownerUploadDelta=false;binaryNegotiated=false;socket.binaryType='arraybuffer';metrics.reconnections++;
  openingDeadline=timers.setTimeout(()=>inactive(socket,serial,'opening-timeout'),2500);
  socket.onopen=()=>{};socket.onerror=()=>inactive(socket,serial,'socket-error');socket.onclose=event=>{
   if(!isCurrent(socket,serial))return;
   metrics.lastCloseCode=Number.isInteger(event?.code)?event.code:null;metrics.lastCloseWasClean=typeof event?.wasClean==='boolean'?event.wasClean:null;
   inactive(socket,serial);
  };
  socket.onmessage=event=>{
   if(!isCurrent(socket,serial))return;
   if(typeof event.data==='string'&&event.data.length>512*1024){inactive(socket,serial,'incoming-limit');return;}
   const bytes=typeof event.data==='string'?new TextEncoder().encode(event.data).byteLength:event.data?.byteLength??event.data?.size??0;
   // A positive upload receipt releases an already accepted source identity;
   // it carries no playback or state delta. Its coordinator still checks the
   // outstanding sequence, match, life and exact owner receipt. Let only this
   // small independent record pass an unrelated native event decompressor.
   if(active&&reading&&typeof event.data==='string'&&bytes<=8192){
    try{
     const value=JSON.parse(event.data);
     if(value?.type==='ack'&&Object.keys(value).length===2&&Object.hasOwn(value,'data')
       &&value.data&&typeof value.data==='object'&&!Array.isArray(value.data)&&value.data.accepted===true){
      metrics.receivedMessages++;metrics.receivedBytes+=bytes;metrics.independentAckBypasses++;
      onAcknowledgement(value.data);return;
     }
    }catch{inactive(socket,serial,'decode-failed');return;}
   }
   if(bytes>512*1024||incomingBytes+bytes>512*1024||incoming.length>=64){inactive(socket,serial,'incoming-limit');return;}
   metrics.receivedMessages++;metrics.receivedBytes+=bytes;incoming.push({data:event.data,bytes});incomingBytes+=bytes;void read(socket,serial);
  };
 }
 return {
  open,
  send(value,{onSent,onSuperseded}={}){
   if(!active||!connection)return false;
   if(pending){metrics.coalescedSends++;pending.onSuperseded?.();}
   // Capture immutable bytes before the caller can mutate its live report.
   try{pending={...encodeOnlineEnvelope(value,{binary:binaryNegotiated,measureTextBytes:false}),onSent,onSuperseded};}
   catch{inactive(connection,generation,'encode-failed');return false;}
   void pack(connection,generation);return true;
  },
  clearPending(){pending?.onSuperseded?.();pending=null;clearPacking();blockedAt=null;},
  fail(){if(connection)inactive(connection,generation,'coordinator-fallback');},
  close(){stopped=true;generation++;timers.clearTimeout(retry);timers.clearTimeout(openingDeadline);clearPacking();timers.clearTimeout(reading?.deadline);reading=null;pending=null;incoming.length=0;incomingBytes=0;
   const socket=connection;connection=null;active=false;ownerUploadDelta=false;binaryNegotiated=false;if(socket){socket.onopen=socket.onclose=socket.onerror=socket.onmessage=null;socket.close?.();}},
  get active(){return active;},
  performance(){return {...metrics,active,ownerUploadDelta,networkBinaryVersion:binaryNegotiated?NETWORK_BINARY_VERSION:0,bufferedBytes:connection?.bufferedAmount??0,pending:!!pending,
   compressionAgeMs:packing?.row?Math.max(0,clock()-packing.startedAt):0,decodeAgeMs:reading?Math.max(0,clock()-reading.startedAt):0,
   decodePending:incoming.length,decodeQueuedBytes:incomingBytes};},
 };
}
