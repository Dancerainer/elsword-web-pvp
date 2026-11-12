import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpEventSourceClass} from '../../tools/http-event-source-room-v5.mjs';

test('v5 reader preserves split UTF-8/CRLF payloads and attributes first/completing reads',async()=>{
  const encoded=Buffer.from(': heartbeat\r\n\r\nevent: owned-state\r\nid: seven\r\nretry: 12\r\ndata: {"é":1}\r\n\r\nevent: owned-state\r\ndata: second\r\ndata: line\r\n\r\n');
  const split=encoded.indexOf(Buffer.from('é'))+1,chunks=[encoded.subarray(0,split),encoded.subarray(split)];
  let clock=0,context=null,cancelled=false;
  const Source=createHttpEventSourceClass({now:()=>clock,wallNow:()=>1000+clock,onDispatchContext:value=>{context=value;},request:async()=>({status:200,ok:true,body:{getReader:()=>({
    read:async()=>{clock+=10;return {done:false,value:chunks.shift()};},cancel:async()=>{cancelled=true;}
  })}})});
  const source=new Source('/events'),events=[];
  source.addEventListener('owned-state',event=>{events.push({event,context:{...context}});clock+=30;if(events.length===2)source.close();});
  await source.task;
  assert.deepEqual(events.map(row=>row.event),[{data:'{"é":1}',lastEventId:'seven'},{data:'second\nline',lastEventId:'seven'}]);
  assert.equal(events[0].context.firstReadAtWallMs,1010);assert.equal(events[0].context.readAtWallMs,1020);
  assert.equal(events[0].context.firstReadSeq,1);assert.equal(events[0].context.readSeq,2);
  assert.equal(events[1].context.firstReadSeq,2);assert.equal(events[1].context.readToDispatchMs,30);
  assert.equal(source.retryMs,12);assert.equal(context,null);assert.equal(cancelled,true);
  assert.equal(source.metrics.reader.partialBlockMs.maxMs,10);assert.equal(source.metrics.reader.drainMs.maxMs,60);
  assert.equal(source.metrics.reader.maxEventsPerRead,2);assert.equal(source.metrics.events,2);
  assert.equal(source.metrics.decodedBytes,encoded.length);
  const snapshot=source.snapshotMetrics();source.metrics.reader.reads++;assert.equal(snapshot.reader.reads,2);
});

test('v5 reader reconnects with the last event ID and closes on HTTP 204',async()=>{
  const requests=[];let sent=false;
  const Source=createHttpEventSourceClass({request:async(url,options)=>{
    requests.push({url,headers:options.headers});if(requests.length===2)return {status:204,ok:true};
    return {status:200,ok:true,body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:Buffer.from('retry: 0\nid: 42\ndata: ready\n\n')}),cancel:async()=>{}})}};
  }});
  const source=new Source('/events');let payload;
  source.addEventListener('message',event=>{payload=event.data;});await source.task;
  assert.equal(payload,'ready');assert.equal(requests[1].headers['Last-Event-ID'],'42');
  assert.equal(source.metrics.connections,2);assert.equal(source.metrics.reconnects,1);assert.equal(source.metrics.eofs,1);
  assert.equal(source.readyState,2);assert.equal(source.stopped,true);
});
