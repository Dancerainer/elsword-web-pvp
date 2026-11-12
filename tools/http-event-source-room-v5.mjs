/** Diagnostic EventSource for v5 native peers. These timestamps start when
 * fetch's decompressed reader yields; they are not kernel/socket arrival times.
 * No event payload is parsed twice, changed, delayed or dropped for diagnostics. */
import {performance} from 'node:perf_hooks';

const upperBoundsMs=[1,2,4,8,16,32,64,128,256,512,1024,2048,null];
function timings(){return {count:0,totalMs:0,maxMs:0,upperBoundsMs:[...upperBoundsMs],counts:Array(upperBoundsMs.length).fill(0)};}
function observe(histogram,value){
  histogram.count++;histogram.totalMs+=value;histogram.maxMs=Math.max(histogram.maxMs,value);
  histogram.counts[upperBoundsMs.findIndex(upper=>upper===null||value<=upper)]++;
}
export function createHttpEventSourceClass({request,onParseCpu=()=>{},onDispatchContext=()=>{},now=()=>performance.now(),wallNow=()=>Date.now()}){
 return class HttpEventSource {
  static instances=[];
  constructor(url){
   this.url=url;this.listeners=new Map();this.stopped=false;this.readyState=0;this.retryMs=1000;this.lastEventId='';
   this.metrics={connections:0,reconnects:0,eofs:0,failures:0,events:0,decodedBytes:0,statuses:{},eventTypes:{},reader:{
    scope:'decompressed fetch reader yield through synchronous production event dispatch; excludes kernel arrival and asynchronous ownership application',
    reads:0,maxReadBytes:0,maxBufferedChars:0,maxEventsPerRead:0,waitMs:timings(),yieldGapMs:timings(),drainMs:timings(),readToDispatchMs:timings(),partialBlockMs:timings()}};
   this.constructor.instances.push(this);this.task=this.loop();
  }
  snapshotMetrics(){return structuredClone(this.metrics);}
  addEventListener(type,fn){const rows=this.listeners.get(type)??[];rows.push(fn);this.listeners.set(type,rows);}
  close(){this.stopped=true;this.readyState=2;this.controller?.abort();clearTimeout(this.timer);this.releaseWait?.();}
  dispatch(block,context){
   const began=now();let type='message',data=[];
   for(const line of block.replace(/\r\n/g,'\n').split('\n')){if(!line||line.startsWith(':'))continue;
    const cut=line.indexOf(':'),name=cut<0?line:line.slice(0,cut);let value=cut<0?'':line.slice(cut+1);if(value.startsWith(' '))value=value.slice(1);
    if(name==='event')type=value;else if(name==='data')data.push(value);else if(name==='id'&&!value.includes('\0'))this.lastEventId=value;
    else if(name==='retry'&&/^\d+$/.test(value))this.retryMs=Math.min(30000,Number(value));
   }
   if(data.length){
    this.metrics.events++;const payload=data.join('\n'),typeStats=this.metrics.eventTypes[type]??={events:0,payloadBytes:0};
    typeStats.events++;typeStats.payloadBytes+=Buffer.byteLength(payload,'utf8');
    const delivery={...context,eventType:type,dispatchStartedAtWallMs:wallNow(),readToDispatchMs:Math.max(0,began-context.readAtMonoMs)};
    observe(this.metrics.reader.readToDispatchMs,delivery.readToDispatchMs);
    observe(this.metrics.reader.partialBlockMs,Math.max(0,context.readAtMonoMs-context.firstReadAtMonoMs));
    onDispatchContext(delivery);
    try{for(const fn of this.listeners.get(type)??[])fn({data:payload,lastEventId:this.lastEventId});}
    finally{onDispatchContext(null);}
   }
   onParseCpu(now()-began);
  }
  async loop(){
   while(!this.stopped){this.controller=new AbortController();this.metrics.connections++;
    try{
     const response=await request(this.url,{signal:this.controller.signal,headers:{Accept:'text/event-stream',...(this.lastEventId?{'Last-Event-ID':this.lastEventId}:{})}});
     this.metrics.statuses[response.status]=(this.metrics.statuses[response.status]??0)+1;
     if(response.status===204){this.close();break;}if(!response.ok)throw Error('SSE HTTP '+response.status);
     if(this.stopped){await response.body?.cancel?.().catch(()=>{});break;}
     this.readyState=1;const opened={type:'open'};this.onopen?.(opened);for(const fn of this.listeners.get('open')??[])fn(opened);
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',segments=[],lastYieldAt=null;
     try{while(!this.stopped){
       const waitingAt=now(),part=await reader.read(),readAtMonoMs=now(),readAtWallMs=wallNow();
       if(part.done){this.metrics.eofs++;throw Error('SSE EOF');}
       const metrics=this.metrics.reader,readSeq=++metrics.reads;observe(metrics.waitMs,readAtMonoMs-waitingAt);
       if(lastYieldAt!==null)observe(metrics.yieldGapMs,readAtMonoMs-lastYieldAt);lastYieldAt=readAtMonoMs;
       metrics.maxReadBytes=Math.max(metrics.maxReadBytes,part.value.byteLength);this.metrics.decodedBytes+=part.value.byteLength;
       const text=decoder.decode(part.value,{stream:true});buffer+=text;
       if(text.length)segments.push({length:text.length,readSeq,readAtMonoMs,readAtWallMs});
       metrics.maxBufferedChars=Math.max(metrics.maxBufferedChars,buffer.length);const eventsBefore=this.metrics.events;
       let end;while((end=/(?:\r?\n){2}/.exec(buffer))!==null){
        const first=segments[0],length=end.index+end[0].length,block=buffer.slice(0,end.index);buffer=buffer.slice(length);
        let consume=length;while(consume&&segments.length){const count=Math.min(consume,segments[0].length);consume-=count;segments[0].length-=count;if(!segments[0].length)segments.shift();}
        this.dispatch(block,{readSeq,readAtMonoMs,readAtWallMs,firstReadSeq:first?.readSeq??readSeq,
          firstReadAtMonoMs:first?.readAtMonoMs??readAtMonoMs,firstReadAtWallMs:first?.readAtWallMs??readAtWallMs});
       }
       metrics.maxEventsPerRead=Math.max(metrics.maxEventsPerRead,this.metrics.events-eventsBefore);observe(metrics.drainMs,now()-readAtMonoMs);
      }}finally{await reader.cancel().catch(()=>{});}
    }catch(error){if(!this.stopped){this.readyState=0;this.metrics.failures++;this.onerror?.({message:error.message});}}
    if(this.stopped)break;this.metrics.reconnects++;await new Promise(resolve=>{this.releaseWait=resolve;this.timer=setTimeout(resolve,this.retryMs);});this.releaseWait=null;
   }
  }
 };
}
