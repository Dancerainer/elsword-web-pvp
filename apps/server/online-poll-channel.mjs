/** Bounded named-event mailbox. Session/connection ownership lives in the HTTP server. */
import {ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS, ONLINE_POLL_MAXIMUM_BATCH_EVENTS} from '../../packages/online/poll-contract.mjs';
export class PollChannelError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export function createOnlinePollChannel({waitMs=10_000,maximumCriticalEvents=ONLINE_POLL_MAXIMUM_CRITICAL_EVENTS,
  maximumEvents=ONLINE_POLL_MAXIMUM_BATCH_EVENTS,maximumBytes=512*1024,
  timers={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},onOverflow=()=>{}}={}){
  let events=[],bytes=0,nextId=0,acknowledged=0,delivered=0,pending=null,closed=false;
  const batch=()=>{
    const result={events:events.map(row=>structuredClone(row.event)),cursor:events.at(-1)?.event.id??acknowledged};
    delivered=Math.max(delivered,result.cursor);return result;
  };
  const channel={
    push(type,data,{replaceKey=type==='state'?'state':null,critical=type!=='state'}={}){
      if(closed)return false;
      const event={id:++nextId,type,data:structuredClone(data)},size=Buffer.byteLength(JSON.stringify(event));
      if(replaceKey!==null)events=events.filter(row=>{if(row.key!==replaceKey)return true;bytes-=row.bytes;return false;});
      const criticalCount=events.filter(row=>row.critical).length+(critical?1:0);
      if(criticalCount>maximumCriticalEvents||events.length+1>maximumEvents||bytes+size>maximumBytes){channel.close('poll-event-overflow');onOverflow();return false;}
      events.push({event,bytes:size,key:replaceKey,critical});bytes+=size;
      pending?.finish(batch());return true;
    },
    poll(after){
      if(closed)throw new PollChannelError('poll-connection-not-active');
      if(!Number.isSafeInteger(after)||after<0)throw new PollChannelError('invalid-poll-cursor',400);
      if(after<acknowledged||after>delivered)throw new PollChannelError('poll-cursor-rejected');
      if(pending)throw new PollChannelError('poll-already-pending');
      acknowledged=after;
      events=events.filter(row=>{if(row.event.id>after)return true;bytes-=row.bytes;return false;});
      let resolve,timer,settled=false;
      const handle={promise:new Promise(done=>{resolve=done;}),
        finish(value){if(settled)return;settled=true;timers.clearTimeout(timer);if(pending===handle)pending=null;resolve(value);},
        cancel(){handle.finish({error:'poll-request-cancelled'});}};
      if(events.length)handle.finish(batch());
      else {pending=handle;timer=timers.setTimeout(()=>handle.finish(batch()),waitMs);timer.unref?.();}
      return handle;
    },
    close(error='poll-connection-closed'){
      if(closed)return;closed=true;events=[];bytes=0;pending?.finish({error});
    },
    get closed(){return closed;},get pending(){return Boolean(pending);},get cursor(){return acknowledged;},
    get queuedBytes(){return bytes;},get queuedEvents(){return events.length;},
  };
  return channel;
}
