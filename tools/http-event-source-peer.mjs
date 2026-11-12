/** Diagnostic peer EventSource. Reconnects at the server retry interval and
 * preserves event IDs; only authenticated transport supplied by the caller is
 * used. Not browser or production code. */
import {performance} from 'node:perf_hooks';
export function createHttpEventSourceClass({request,onParseCpu=()=>{}}){
 return class HttpEventSource {
  static instances=[];
  constructor(url){this.url=url;this.listeners=new Map();this.stopped=false;this.readyState=0;this.retryMs=1000;this.lastEventId='';
   this.metrics={connections:0,reconnects:0,eofs:0,failures:0,events:0,decodedBytes:0,statuses:{},eventTypes:{}};
   this.constructor.instances.push(this);this.task=this.loop();}
  addEventListener(type,fn){const rows=this.listeners.get(type)??[];rows.push(fn);this.listeners.set(type,rows);}
  close(){this.stopped=true;this.readyState=2;this.controller?.abort();clearTimeout(this.timer);this.releaseWait?.();}
  dispatch(block){
   const began=performance.now();let type='message',data=[];
   for(const line of block.split('\n')){if(!line||line.startsWith(':'))continue;
    const cut=line.indexOf(':'),name=cut<0?line:line.slice(0,cut);let value=cut<0?'':line.slice(cut+1);if(value.startsWith(' '))value=value.slice(1);
    if(name==='event')type=value;else if(name==='data')data.push(value);else if(name==='id'&&!value.includes('\0'))this.lastEventId=value;
    else if(name==='retry'&&/^\d+$/.test(value))this.retryMs=Math.min(30000,Number(value));
   }
   if(data.length){this.metrics.events++;const payload=data.join('\n'),typeStats=this.metrics.eventTypes[type]??={events:0,payloadBytes:0};typeStats.events++;typeStats.payloadBytes+=Buffer.byteLength(payload,'utf8');for(const fn of this.listeners.get(type)??[])fn({data:payload,lastEventId:this.lastEventId});}
   onParseCpu(performance.now()-began);
  }
  async loop(){
   while(!this.stopped){this.controller=new AbortController();this.metrics.connections++;
    try{const response=await request(this.url,{signal:this.controller.signal,headers:{Accept:'text/event-stream',...(this.lastEventId?{'Last-Event-ID':this.lastEventId}:{})}});
     this.metrics.statuses[response.status]=(this.metrics.statuses[response.status]??0)+1;
     if(response.status===204){this.close();break;}if(!response.ok)throw Error('SSE HTTP '+response.status);
     if(this.stopped){await response.body?.cancel?.().catch(()=>{});break;}
     this.readyState=1;const opened={type:'open'};this.onopen?.(opened);for(const fn of this.listeners.get('open')??[])fn(opened);
     const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
     try{while(!this.stopped){const part=await reader.read();if(part.done){this.metrics.eofs++;throw Error('SSE EOF');}
       this.metrics.decodedBytes+=part.value.byteLength;buffer+=decoder.decode(part.value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;
       while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);this.dispatch(block);}
      }}finally{await reader.cancel().catch(()=>{});}
    }catch(error){if(!this.stopped){this.readyState=0;this.metrics.failures++;this.onerror?.({message:error.message});}}
    if(this.stopped)break;this.metrics.reconnects++;await new Promise(resolve=>{this.releaseWait=resolve;this.timer=setTimeout(resolve,this.retryMs);});this.releaseWait=null;
   }
  }
 };
}
