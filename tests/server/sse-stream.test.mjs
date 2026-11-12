import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createGunzip,createGzip,gunzipSync} from 'node:zlib';
import {acceptsSseGzip,createSseStream} from '../../apps/server/sse-stream.mjs';

test('SSE gzip negotiation respects q=0 and individual gzip preference', () => {
  for (const value of ['gzip', 'deflate, gzip, br', 'GZIP ; q=1', 'gzip;q=0.5']) assert.equal(acceptsSseGzip(value), true);
  for (const value of ['', 'br', 'gzip;q=0', 'gzip;q=0.000', 'gzip;q=invalid', '*']) assert.equal(acceptsSseGzip(value), false);
});

class HeldResponse extends EventEmitter {
  destroyed=false;writableLength=0;writableNeedDrain=false;written=[];
  writeHead(){}flushHeaders(){}
  write(value){this.written.push(value);this.writableLength+=Buffer.byteLength(value);this.writableNeedDrain=true;return false;}
  release(){this.writableLength=0;this.writableNeedDrain=false;this.emit('drain');}
  end(){this.ended=true;}
  destroy(){this.destroyed=true;this.emit('close');}
}
test('backpressured SSE replaces only stale snapshots and preserves intervening critical events in order',()=>{
  const response=new HeldResponse(),stream=createSseStream({headers:{}},response);
  stream.write('first');
  for(let i=0;i<1000;i++)stream.write('old-state-'+i,{replaceKey:'state:match'});
  assert.equal(response.written.length,1);assert.equal(stream.queuedEvents,1);assert.ok(stream.queuedBytes<100);
  stream.write('hit-history');stream.write('latest-state',{replaceKey:'state:match'});stream.write('result');
  for(let i=0;i<3;i++)response.release();
  assert.deepEqual(response.written,['first','hit-history','latest-state','result']);assert.equal(stream.queuedEvents,0);
  stream.end();assert.equal(response.listenerCount('drain'),0);assert.equal(stream.write('late'),false);
});
test('critical SSE pressure remains byte bounded and closes rather than discarding actions',()=>{
  const response=new HeldResponse(),stream=createSseStream({headers:{}},response,{maximumQueuedBytes:20});
  assert.equal(stream.write('1234567890'),true);assert.equal(stream.write('abcdefghi'),true);
  assert.equal(stream.write('hit'),false);assert.equal(response.destroyed,true);assert.equal(stream.queuedEvents,0);
});
test('gzip SSE flushes promptly, respects a slow destination, and preserves decoded event order',async()=>{
  const chunks=[],gates=[];
  const response=new Writable({highWaterMark:16,write(chunk,encoding,done){chunks.push(Buffer.from(chunk));gates.push(done);}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response);
  const entries=['id: 1\nevent: state\ndata: '+JSON.stringify({noise:Array.from({length:6000},(_,i)=>i.toString(36)).join('|')})+'\n\n','id: 2\nevent: input\ndata: {"hit":1}\n\n','id: 3\nevent: result\ndata: {}\n\n'];
  for(const entry of entries)stream.write(entry);
  for(let i=0;i<100&&(stream.queuedEvents||!chunks.length||response.writableLength);i++){
    await new Promise(resolve=>setImmediate(resolve));while(gates.length)gates.shift()();
  }
  const finished=once(response,'finish');stream.end();
  for(let i=0;i<100&&!response.writableFinished;i++){await new Promise(resolve=>setImmediate(resolve));while(gates.length)gates.shift()();}
  await finished;
  const input=new PassThrough(),gunzip=createGunzip(),decoded=[];gunzip.on('data',chunk=>decoded.push(chunk));
  const end=once(gunzip,'end');input.pipe(gunzip);input.end(Buffer.concat(chunks));await end;
  assert.equal(Buffer.concat(decoded).toString(),entries.join(''));assert.equal(stream.queuedEvents,0);
});

for(const compressed of [false,true])test(`${compressed?'gzip':'plain'} SSE retires a stalled real Writable even as movement replaces pending rows`,async t=>{
  let now=0;const gates=[];
  const response=new Writable({highWaterMark:16,write(chunk,encoding,done){gates.push(done);}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:compressed?{'accept-encoding':'gzip'}:{}},response,{clock:()=>now,maximumQueueAgeMs:1000});
  t.after(()=>stream.destroy());
  stream.write('event: state\ndata: '+JSON.stringify({noise:Array.from({length:6000},(_,i)=>i.toString(36)).join('|')})+'\n\n');
  for(let i=0;i<50&&!response.writableNeedDrain;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(response.writableNeedDrain,true);
  stream.write('frame 0',{replaceKey:'owner:other'});
  for(let i=1;i<=11&&!response.destroyed;i++){now=i*100;stream.write('frame '+i,{replaceKey:'owner:other'});}
  assert.equal(response.destroyed,true);assert.equal(stream.queuedEvents,0);
  assert.equal(stream.performance().closeReason,'queue-age');
});

test('SSE genuine drain restores the stall deadline while preserving queued critical order',()=>{
  let now=0;const response=new HeldResponse(),stream=createSseStream({headers:{}},response,{clock:()=>now});
  stream.write('first');now=900;stream.write('critical');response.release();
  now=1800;stream.write('latest',{replaceKey:'state'});assert.equal(response.destroyed,false);
  response.release();response.release();assert.deepEqual(response.written,['first','critical','latest']);stream.end();
});

test('gzip batches a bounded first-event window, coalesces uncompressed movement and preserves reliable FIFO',async()=>{
  const chunks=[],response=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response);
  for(let i=0;i<50;i++)stream.write(`event: owned-state\ndata: {"frame":${i}}\n\n`,{replaceKey:'owner:a'});
  const input='event: input\ndata: {"action":7}\n\n',latest='event: owned-state\ndata: {"frame":50}\n\n',result='event: result\ndata: {"winner":1}\n\n';
  stream.write(input);stream.write(latest,{replaceKey:'owner:a'});stream.write(result);
  assert.equal(stream.queuedEvents,3);assert.equal(stream.performance().flushes,0);
  for(let i=0;i<100&&!chunks.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(chunks.length);assert.equal(stream.performance().writeBatches,1);assert.equal(stream.performance().flushes,1);
  assert.equal(stream.performance().coalescedEvents,50);assert.equal(stream.performance().batchWindowMs,8);
  const finish=once(response,'finish');stream.end();await finish;
  const source=new PassThrough(),gunzip=createGunzip(),decoded=[];gunzip.on('data',part=>decoded.push(part));const end=once(gunzip,'end');
  source.pipe(gunzip);source.end(Buffer.concat(chunks));await end;
  assert.equal(Buffer.concat(decoded).toString(),input+latest+result);
});

test('gzip pre-compression batching still rejects a critical burst at the same byte bound',()=>{
  const response=new Writable({write(chunk,encoding,done){done();}});response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response,{maximumQueuedBytes:20});
  assert.equal(stream.write('1234567890'),true);assert.equal(stream.write('abcdefghij'),true);
  assert.equal(stream.write('critical'),false);assert.equal(response.destroyed,true);
  assert.equal(stream.performance().closeReason,'queue-bytes');assert.equal(stream.queuedEvents,0);
});

async function until(check){
  for(let i=0;i<200&&!check();i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.ok(check(),'gzip callback did not arrive');
}
function heldGzipCompletion(options){
  const writer=createGzip(options),flush=writer.flush.bind(writer),completions=[];
  writer.flush=(kind,done)=>flush(kind,error=>completions.push(()=>done(error)));
  return {writer,completions};
}

test('gzip waits for real flush completion, coalesces pending movement and drains reliable tail on end',async t=>{
  let now=0,held;const chunks=[];
  const response=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response,{batchWindowMs:0,clock:()=>now,
    createCompressor:options=>(held=heldGzipCompletion(options)).writer});
  t.after(()=>stream.destroy());
  const first='event: input\ndata: {"action":1}\n\n',hit='event: input\ndata: {"action":2}\n\n';
  const latest='event: owned-state\ndata: {"frame":100}\n\n',result='event: result\ndata: {}\n\n';
  stream.write(first);await until(()=>held.completions.length===1);
  assert.equal(held.writer.writableLength,0,'zero-byte zlib flush callback remains outstanding');
  now=200;
  for(let frame=0;frame<100;frame++)stream.write('old'+frame,{replaceKey:'owner:a'});
  stream.write(hit);stream.write(latest,{replaceKey:'owner:a'});stream.write(result);
  const pending=stream.performance();assert.equal(pending.flushes,1);assert.equal(pending.completedFlushes,0);
  assert.equal(pending.compressionInFlight,true);assert.equal(pending.compressionAgeMs,200);
  assert.equal(pending.compressionInputBytes,Buffer.byteLength(first));assert.equal(pending.queuedEvents,3);
  assert.equal(pending.coalescedEvents,100);
  const finished=once(response,'finish');stream.end();assert.equal(stream.write('late'),false);
  assert.equal(response.writableFinished,false);held.completions.shift()();
  await until(()=>held.completions.length===1);assert.equal(stream.performance().flushes,2);
  now=215;held.completions.shift()();await finished;
  const metrics=stream.performance();assert.equal(metrics.completedFlushes,2);assert.equal(metrics.totalFlushMs,215);
  assert.equal(metrics.maximumFlushMs,200);assert.equal(metrics.maximumCompressionAgeMs,200);
  assert.equal(metrics.flushLatencyCounts.reduce((a,b)=>a+b,0),2);
  assert.equal(metrics.flushLatencyCounts[metrics.flushLatencyUpperBoundsMs.indexOf(256)],1);
  assert.equal(metrics.flushLatencyCounts[metrics.flushLatencyUpperBoundsMs.indexOf(16)],1);
  assert.equal(metrics.compressionInFlight,false);assert.equal(metrics.queuedEvents,0);
  assert.equal(gunzipSync(Buffer.concat(chunks)).toString(),first+hit+latest+result);
});

test('zero writable bytes do not hide an overdue gzip completion from the queue deadline',async t=>{
  let now=0,held;const response=new Writable({write(chunk,encoding,done){done();}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response,{batchWindowMs:0,clock:()=>now,
    createCompressor:options=>(held=heldGzipCompletion(options)).writer});t.after(()=>stream.destroy());
  stream.write('first');await until(()=>held.completions.length===1);assert.equal(held.writer.writableLength,0);
  now=999;assert.equal(stream.write('old',{replaceKey:'state'}),true);
  now=1000;assert.equal(stream.write('latest',{replaceKey:'state'}),false);
  assert.equal(stream.performance().closeReason,'queue-age');assert.equal(response.destroyed,true);
  assert.equal(stream.performance().maximumCompressionAgeMs,1000);
  held.completions.shift()();assert.equal(stream.performance().flushes,1);
});

test('gzip input remains byte-accounted until its completion callback even with an empty writable buffer',async t=>{
  let held;const response=new Writable({write(chunk,encoding,done){done();}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response,{batchWindowMs:0,maximumQueuedBytes:30,
    createCompressor:options=>(held=heldGzipCompletion(options)).writer});t.after(()=>stream.destroy());
  assert.equal(stream.write('12345678901234567890'),true);await until(()=>held.completions.length===1);
  assert.equal(held.writer.writableLength,0);assert.equal(stream.queuedBytes,20);
  assert.equal(stream.write('12345678901'),false);assert.equal(stream.performance().closeReason,'queue-bytes');
  held.completions.shift()();assert.equal(stream.performance().completedFlushes,0);
});

test('optional SSE diagnostics retain the byte-overflow cause and pre-clear queue measurements',()=>{
  const rows=[],response=new HeldResponse(),stream=createSseStream({headers:{}},response,{maximumQueuedBytes:20,onDiagnostic:row=>rows.push(row)});
  stream.write('1234567890');stream.write('abcdefghi');assert.equal(stream.write('hit'),false);
  assert.equal(response.destroyed,true);
  const retirement=rows.find(row=>row.event==='retire');
  assert.equal(retirement.retiredReason,'queue-bytes');assert.equal(retirement.queuedBytes,19);assert.equal(retirement.queuedEvents,1);
  assert.equal(rows.at(-1).event,'response-close');assert.equal(rows.at(-1).retiredReason,'queue-bytes');
});

test('optional SSE diagnostics distinguish stalled age from external response closure',()=>{
  let now=0;const rows=[],response=new HeldResponse(),stream=createSseStream({headers:{}},response,{clock:()=>now,onDiagnostic:row=>rows.push(row)});
  stream.write('first');now=1000;assert.equal(stream.write('later'),false);
  const retirement=rows.find(row=>row.event==='retire');assert.equal(retirement.retiredReason,'queue-age');assert.equal(retirement.blockedAgeMs,1000);
  const closed=[],other=new HeldResponse();createSseStream({headers:{}},other,{onDiagnostic:row=>closed.push(row)});
  other.destroy();assert.equal(closed.length,1);assert.equal(closed[0].event,'response-close');assert.equal(closed[0].retiredReason,null);
});

test('failing SSE diagnostic observers cannot prevent bounded retirement',()=>{
  const response=new HeldResponse(),stream=createSseStream({headers:{}},response,{maximumQueuedBytes:1,onDiagnostic(){throw Error('observer failed');}});
  assert.equal(stream.write('too large'),false);assert.equal(response.destroyed,true);assert.equal(stream.queuedEvents,0);
});
