/** Narrow, unauthenticated UDP Binding discovery for browser ICE. RFC 8489
 * sections 5, 6.3, 14.2 and 14.7; this is not TURN or an ICE connectivity peer.
 * TCP, legacy RFC 3489 and authenticated/mandatory-attribute usages are outside
 * this endpoint. Unsupported usages are silently dropped, never echoed.
 */
import {isIP} from 'node:net';
import {performance} from 'node:perf_hooks';

export const STUN_MAGIC_COOKIE = 0x2112a442;
export const STUN_MAX_DATAGRAM_BYTES = 1200;
const BINDING_REQUEST = 0x0001, BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020, FINGERPRINT = 0x8028;
const CRC_XOR = 0x5354554e, MAX_ATTRIBUTES = 64;
const crcTable = Uint32Array.from({length:256},(_,i)=>{
  let value=i;for(let bit=0;bit<8;bit++)value=value&1?(value>>>1)^0xedb88320:value>>>1;return value>>>0;
});

export function stunFingerprint(bytes){
  let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^crcTable[(crc^byte)&255];
  return ((crc^0xffffffff)^CRC_XOR)>>>0;
}

function asBuffer(value){
  return value instanceof Uint8Array?Buffer.from(value.buffer,value.byteOffset,value.byteLength):null;
}

/** Accept only complete modern Binding requests with optional discovery attrs.
 * No request data other than its fixed 96-bit transaction ID enters a response.
 */
export function parseStunBindingRequest(value){
  const packet=asBuffer(value);
  if(!packet||packet.length<20||packet.length>STUN_MAX_DATAGRAM_BYTES
    ||packet.readUInt16BE(0)!==BINDING_REQUEST||packet.readUInt32BE(4)!==STUN_MAGIC_COOKIE)return null;
  const length=packet.readUInt16BE(2);
  if(length%4!==0||length+20!==packet.length)return null;
  let offset=20,attributes=0,fingerprint=false;
  while(offset<packet.length){
    if(++attributes>MAX_ATTRIBUTES||offset+4>packet.length)return null;
    const type=packet.readUInt16BE(offset),size=packet.readUInt16BE(offset+2);
    const end=offset+4+size,paddedEnd=offset+4+Math.ceil(size/4)*4;
    if(end>packet.length||paddedEnd>packet.length)return null;
    // Required attributes indicate another usage (e.g. ICE checks/TURN). This
    // discovery-only endpoint neither claims to authenticate nor answers them.
    if(type<0x8000)return null;
    if(type===FINGERPRINT){
      if(fingerprint||size!==4||paddedEnd!==packet.length
        ||packet.readUInt32BE(offset+4)!==stunFingerprint(packet.subarray(0,offset)))return null;
      fingerprint=true;
    }
    offset=paddedEnd;
  }
  return {transactionId:Buffer.from(packet.subarray(8,20)),fingerprint};
}

function addressBytes(address){
  if(typeof address!=='string')return null;
  const plain=address.split('%')[0],family=isIP(plain);
  if(family===4)return {family:1,bytes:Buffer.from(plain.split('.').map(Number))};
  if(family!==6)return null;
  // Convert a dotted IPv4 tail before expanding :: (including IPv4-mapped
  // senders received by a dual-stack udp6 socket).
  let expanded=plain.toLowerCase();
  if(expanded.includes('.')){
    const cut=expanded.lastIndexOf(':'),tail=expanded.slice(cut+1).split('.').map(Number);
    expanded=expanded.slice(0,cut+1)+((tail[0]<<8)|tail[1]).toString(16)+':'+((tail[2]<<8)|tail[3]).toString(16);
  }
  const parts=expanded.split('::'),left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[];
  const words=parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  if(words.length!==8)return null;
  const bytes=Buffer.alloc(16);for(let i=0;i<8;i++)bytes.writeUInt16BE(parseInt(words[i],16),i*2);
  if(bytes.subarray(0,10).every(byte=>byte===0)&&bytes[10]===255&&bytes[11]===255)
    return {family:1,bytes:Buffer.from(bytes.subarray(12))};
  return {family:2,bytes};
}

export function createStunBindingResponse(value,{address,port}={}){
  const request=parseStunBindingRequest(value),mapped=addressBytes(address);
  if(!request||!mapped||!Number.isInteger(port)||port<1||port>65535)return null;
  const attributeLength=4+mapped.bytes.length,total=20+4+attributeLength+(request.fingerprint?8:0);
  const response=Buffer.alloc(total);
  response.writeUInt16BE(BINDING_SUCCESS,0);response.writeUInt16BE(total-20,2);
  response.writeUInt32BE(STUN_MAGIC_COOKIE,4);request.transactionId.copy(response,8);
  response.writeUInt16BE(XOR_MAPPED_ADDRESS,20);response.writeUInt16BE(attributeLength,22);
  response[25]=mapped.family;response.writeUInt16BE(port^(STUN_MAGIC_COOKIE>>>16),26);
  const mask=response.subarray(4,20);
  for(let i=0;i<mapped.bytes.length;i++)response[28+i]=mapped.bytes[i]^mask[i];
  if(request.fingerprint){
    const offset=total-8;response.writeUInt16BE(FINGERPRINT,offset);response.writeUInt16BE(4,offset+2);
    response.writeUInt32BE(stunFingerprint(response.subarray(0,offset)),offset+4);
  }
  return response;
}

function positive(value,name,maximum){
  if(!Number.isSafeInteger(value)||value<=0||value>maximum)throw new TypeError('invalid-stun-'+name);
  return value;
}

/** Bounded token buckets, charged before parsing or replying. IPv6 /64 and
 * IPv4-mapped IPv6 share a source bucket; changing the UDP port cannot bypass it.
 * These limits reduce reflection but do not authenticate spoofed source IPs.
 */
export function createStunRateLimiter({clock=()=>performance.now(),sourceRate=32,sourceBurst=128,
  globalRate=200,globalBurst=400,maxSources=1024,idleMs=60000}={}){
  for(const [name,value,max] of [['source-rate',sourceRate,5000],['source-burst',sourceBurst,10000],
    ['global-rate',globalRate,5000],['global-burst',globalBurst,10000],['max-sources',maxSources,4096],['idle-ms',idleMs,86400000]])positive(value,name,max);
  if(typeof clock!=='function')throw new TypeError('invalid-stun-clock');
  const sources=new Map(),counts={accepted:0,globalLimited:0,sourceLimited:0,sourceCapacityLimited:0,invalidSource:0};
  let last=0,global={tokens:globalBurst,at:0};
  function refill(bucket,rate,burst,at){bucket.tokens=Math.min(burst,bucket.tokens+(at-bucket.at)*rate/1000);bucket.at=at;}
  return {
    allow(address){
      const reading=clock();if(!Number.isFinite(reading)){counts.invalidSource++;return false;}
      const at=Math.max(last,reading);last=at;refill(global,globalRate,globalBurst,at);
      if(global.tokens<1){counts.globalLimited++;return false;}global.tokens--;
      const mapped=addressBytes(address);if(!mapped){counts.invalidSource++;return false;}
      const key=mapped.family===1?'4:'+mapped.bytes.toString('hex'):'6:'+mapped.bytes.subarray(0,8).toString('hex');
      let row=sources.get(key);
      if(!row){
        // Map order tracks last source use; bounded cleanup runs only at capacity.
        if(sources.size>=maxSources){let checked=0;for(const [id,entry] of sources){
          if(++checked>64||at-entry.last<idleMs)break;sources.delete(id);
        }}
        if(sources.size>=maxSources){counts.sourceCapacityLimited++;return false;}
        row={tokens:sourceBurst,at,last:at};
      }else{refill(row,sourceRate,sourceBurst,at);sources.delete(key);row.last=at;}
      sources.set(key,row);
      if(row.tokens<1){counts.sourceLimited++;return false;}row.tokens--;counts.accepted++;return true;
    },
    stats(){return {...counts,sources:sources.size};},
    clear(){sources.clear();global={tokens:globalBurst,at:last};},
  };
}
