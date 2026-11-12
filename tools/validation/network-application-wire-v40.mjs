/** Deterministic application wires. This is not an SCTP/TCP implementation.
 * All production codec jobs finish at frozen virtual time before it advances.
 * Reliable retransmission and serialization are explicitly modelled below. */
import {setImmediate as realImmediate} from 'node:timers/promises';
import {draw,distribution,scenarios as historicalScenarios} from './network-fault-model-v38.mjs';

export const scenarios=[...historicalScenarios,{id:'duplicate-delivery-10pct',base:35,jitter:25,loss:.02,rto:120,duplicate:.1}];
export const lanes={rtcControl:0,rtcPose:1,rtcMotion:2,rtcStatus:3,wsUp:4,wsAck:5,relayDown:6,rtcAux:8,httpUp:10,httpAck:11};
const hash=value=>{let n=2166136261;for(const c of String(value))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};
const copy=value=>typeof value==='string'?value:new Uint8Array(value).slice();

export class ApplicationWire {
 constructor({scenario,seed,bandwidthMbps=10,lateAttack=false}={}){
  this.scenario=scenario;this.seed=seed;this.bandwidthMbps=bandwidthMbps;this.lateAttack=lateAttack;
  this.now=-200;this.serial=0;this.tasks=new Map();this.links=new Map();this.packets=[];this.activeStreams=0;this.activity=0;
  this.codecSerial=0;this.codecDebug=new Map();this.debugProviders=new Map();
  this.stats={sent:0,payloadBytes:0,attemptBytes:0,attempts:0,lostAttempts:0,datagramsDropped:0,delivered:0,duplicateDeliveries:0,maximumBufferedBytes:0};
  this.timers={setTimeout:(fn,ms,...args)=>this.schedule(fn,ms,0,args),clearTimeout:id=>this.tasks.delete(id?.id??id),
   setInterval:(fn,ms,...args)=>this.schedule(fn,ms,Math.max(1,ms),args),clearInterval:id=>this.tasks.delete(id?.id??id)};
 }
 schedule(fn,ms=0,period=0,args=[]){return this.scheduleAt(fn,this.now+Math.max(0,Number(ms)||0),period,args);}
 scheduleAt(fn,at,period=0,args=[]){if(!Number.isFinite(at))throw Error('invalid-virtual-due-time');
  const id=++this.serial,token={id,unref(){return this;}};this.tasks.set(id,{at:Math.max(this.now,at),fn,args,period,token});return token;}
 install(){
  if(this.restore)throw Error('virtual-wire-already-installed');
  const saved={};for(const name of ['setTimeout','clearTimeout','setInterval','clearInterval']){saved[name]=globalThis[name];globalThis[name]=this.timers[name];}
  for(const name of ['CompressionStream','DecompressionStream']){
   const Original=globalThis[name],wire=this;saved[name]=Original;
   if(!Original)throw Error('native-stream-codec-required');
   globalThis[name]=class TrackedNativeStream{
    constructor(format){const original=new Original(format),reader=original.readable.getReader();wire.activeStreams++;let complete=false;
     const token=++wire.codecSerial;wire.codecDebug.set(token,{name,format,at:wire.now});
     const finish=()=>{if(!complete){complete=true;wire.activeStreams--;wire.activity++;wire.codecDebug.delete(token);}};
     this.writable=original.writable;this.readable=new ReadableStream({async pull(controller){
      try{const row=await reader.read();if(row.done){finish();controller.close();}else controller.enqueue(row.value);}
      catch(error){finish();controller.error(error);}},async cancel(reason){try{await reader.cancel(reason);}finally{finish();}}});
    }
   };
  }
  this.restore=()=>{for(const [name,value]of Object.entries(saved))globalThis[name]=value;this.restore=null;};
 }
 async settle(){
  const deadline=Date.now()+10000;let quiet=0,previous=-1;
  while(quiet<3||this.activeStreams){
   if(Date.now()>deadline)throw Error('native-codec-did-not-settle-at-frozen-virtual-time:'+JSON.stringify({now:this.now,activeStreams:this.activeStreams,
    codecs:[...this.codecDebug.values()],providers:Object.fromEntries([...this.debugProviders].map(([key,read])=>[key,read()])),
    nextTasks:[...this.tasks.values()].sort((a,b)=>a.at-b.at).slice(0,5).map(row=>({at:row.at,period:row.period,fn:String(row.fn).slice(0,100)}))}));
   for(let i=0;i<24;i++)await Promise.resolve();await realImmediate();
   quiet=this.activeStreams===0&&this.activity===previous?quiet+1:0;previous=this.activity;
  }
 }
 async advance(target){
  if(target<this.now)throw Error('virtual-clock-reversal');await this.settle();
  for(let count=0;;count++){
   if(count>100000)throw Error('virtual-task-livelock');
   const entries=[...this.tasks].filter(([,row])=>row.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0]);
   if(!entries.length)break;
   const [id,row]=entries[0];this.now=Math.max(this.now,row.at);this.tasks.delete(id);
   if(row.period)this.tasks.set(id,{...row,at:row.at+row.period});
   row.fn(...row.args);await this.settle();
  }
  this.now=target;await this.settle();
 }
 sample(meta,attempt,sentAt){
  if(sentAt<0)return {lost:false,delayMs:5,duplicate:false,burst:false};
  const s=meta.direction===1&&this.scenario.reverse?{...this.scenario,...this.scenario.reverse,burst:null}:this.scenario;
  const frame=Math.max(0,meta.frame??0),field=hash(meta.identity??meta.kind??''),lane=lanes[meta.lane];
  if(lane===undefined)throw Error('unknown-application-wire-lane:'+meta.lane);
  const random=index=>draw(this.seed,meta.direction,lane,frame,attempt,index^field);
  let burst=false;
  if(s.burst&&meta.direction===0){const number=Math.floor(sentAt/s.burst.cycle),start=450+draw(this.seed,0,7,number,0,0)*250,
   duration=s.burst.minimum+draw(this.seed,0,7,number,0,1)*(s.burst.maximum-s.burst.minimum),within=sentAt-number*s.burst.cycle;
   burst=within>=start&&within<start+duration;}
  return {lost:burst||random(0)<s.loss,delayMs:Math.max(5,s.base+(random(1)*2-1)*s.jitter),duplicate:random(2)<(s.duplicate??0),burst};
 }
 send(data,meta,deliver,channel=null){
  const bytes=typeof data==='string'?Buffer.byteLength(data):data.byteLength,payload=copy(data),sentAt=this.now;
  const key=meta.connection??`${meta.direction}:${meta.reliable?'reliable':'datagram'}:${meta.lane}`;
  const link=this.links.get(key)??{available:-Infinity,ordered:-Infinity};this.links.set(key,link);
  const start=Math.max(sentAt,link.available),transmissionMs=Number.isFinite(this.bandwidthMbps)?bytes*8/(this.bandwidthMbps*1000):0;
  const physicalAt=start+transmissionMs;link.available=physicalAt;
  if(channel){channel.bufferedAmount+=bytes;this.stats.maximumBufferedBytes=Math.max(this.stats.maximumBufferedBytes,channel.bufferedAmount);
   this.scheduleAt(()=>{channel.bufferedAmount=Math.max(0,channel.bufferedAmount-bytes);},physicalAt);}
  const row={...meta,sentAt,bytes,serializedAt:physicalAt,serializationWaitMs:start-sentAt,transmissionMs,attempts:[],deliveredAt:[],duplicateInjected:false};
  this.stats.sent++;this.stats.payloadBytes+=bytes;this.packets.push(row);this.activity++;
  let attemptAt=physicalAt,fault;
  for(let attempt=0;attempt<20;attempt++){
   fault=this.sample(meta,attempt,attemptAt);row.attempts.push({at:attemptAt,...fault});this.stats.attempts++;this.stats.attemptBytes+=bytes;
   if(!fault.lost)break;this.stats.lostAttempts++;
   if(!meta.reliable){this.stats.datagramsDropped++;return row;}
   attemptAt+=Math.min(720,this.scenario.rto*2**attempt);
  }
  if(fault.lost)throw Error('application-retry-horizon-exhausted');
  const physicalDue=attemptAt+fault.delayMs;
  let due=meta.reliable?Math.max(link.ordered,physicalDue):physicalDue;
  if(this.lateAttack&&meta.direction===0&&meta.actions?.length&&sentAt>=0)due=Math.max(700,due);
  if(meta.reliable)link.ordered=due;
  row.physicalDue=physicalDue;row.due=due;row.holWaitMs=due-physicalDue;
  const receive=duplicate=>{row.deliveredAt.push(this.now);this.stats.delivered++;if(duplicate)this.stats.duplicateDeliveries++;this.activity++;deliver(copy(payload),{...row,duplicate});};
  this.scheduleAt(()=>receive(false),due);
  if(fault.duplicate&&!meta.suppressDuplicate){row.duplicateInjected=true;this.scheduleAt(()=>receive(true),due+1);}
  return row;
 }
 report(){const measured=this.packets.filter(row=>row.sentAt>=0);return {model:'production-application-payloads-over-controlled-virtual-links-v40',
  seed:this.seed,scenario:this.scenario,bandwidthMbps:this.bandwidthMbps,stats:{...this.stats},
  serializationWaitMs:distribution(measured.map(row=>row.serializationWaitMs)),holWaitMs:distribution(measured.filter(row=>row.reliable).map(row=>row.holWaitMs).filter(Number.isFinite)),
  byLane:Object.fromEntries(Object.keys(lanes).map(lane=>{const rows=measured.filter(row=>row.lane===lane);return [lane,{messages:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0),
   attempts:rows.reduce((n,r)=>n+r.attempts.length,0),delivered:rows.reduce((n,r)=>n+r.deliveredAt.length,0),duplicateDeliveries:rows.filter(r=>r.deliveredAt.length>1).length}];})),
  limits:['Reliable retry/order and link serialization are a declared application wire model, not native SCTP/TCP congestion control.',
   'Duplicate delivery is an explicit application/reconnect stressor, not a claim that TCP/SCTP duplicates application messages.',
   'Native gzip/EWNB jobs finish at frozen virtual time; no CPU/codec-time performance claim. Payload bytes omit network headers.',
   '10 Mbps is a separate first-transmission serialization budget per connection, not a shared uplink. Retransmissions add attemptBytes and RTO but do not occupy serialization capacity. bufferedAmount clears after first serialization; this is not congestion-control or retransmission-backpressure evidence.']};}
 close(){this.tasks.clear();this.restore?.();}
}
