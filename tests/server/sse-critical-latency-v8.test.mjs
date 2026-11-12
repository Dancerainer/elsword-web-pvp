// Web transport timing/order evidence, not original-client combat goldens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Writable} from 'node:stream';
import {createGzip,gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const {createSseStream}=await import(process.env.RF_V8_SSE_BASELINE?
  pathToFileURL(process.env.RF_V8_SSE_BASELINE).href:new URL('../../apps/server/sse-stream.mjs',import.meta.url));

function fixture(t,options={}){
  const chunks=[],response=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
  response.writeHead=()=>{};response.flushHeaders=()=>{};
  const stream=createSseStream({headers:{'accept-encoding':'gzip'}},response,options);
  t.after(()=>stream.destroy());
  return {stream,response,chunks,async end(){const finished=once(response,'finish');stream.end();await finished;return gunzipSync(Buffer.concat(chunks)).toString();}};
}
async function until(check){for(let i=0;i<200&&!check();i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(check());}

test('critical action flush starts at the microtask boundary without the movement8ms wait, retaining same-turn FIFO',async t=>{
  const f=fixture(t),{stream}=f;
  stream.write('old pose\n',{replaceKey:'owner:a'});
  stream.write('canonical action\n',{urgent:true});
  stream.write('birth baseline\n',{urgent:true});
  stream.write('current pose\n',{replaceKey:'owner:a',urgent:true});
  assert.equal(stream.performance().flushes,0,'same-turn action/pose may still share the dictionary flush');
  await Promise.resolve();
  assert.equal(stream.performance().flushes,1,'no timer advancement is needed to start critical compression');
  assert.equal(stream.performance().expeditedBatches,1);
  assert.equal(stream.performance().urgentEvents,3);
  assert.equal(await f.end(),'canonical action\nbirth baseline\ncurrent pose\n');
  assert.equal(stream.performance().flushes,1);
});

test('ordinary movement keeps its8ms window and coalesces before compression',async t=>{
  const f=fixture(t),{stream}=f;
  stream.write('old\n',{replaceKey:'owner:a'});stream.write('new\n',{replaceKey:'owner:a'});
  await Promise.resolve();assert.equal(stream.performance().flushes,0);
  assert.equal(stream.performance().batchWindowMs,8);
  await until(()=>stream.performance().completedFlushes===1);
  assert.equal(await f.end(),'new\n');
});

test('critical traffic cannot overtake compression in flight, bypass backpressure or duplicate actions',async t=>{
  const completions=[];let writer;
  const f=fixture(t,{createCompressor(options){writer=createGzip(options);const flush=writer.flush.bind(writer);
    writer.flush=(kind,done)=>flush(kind,error=>completions.push(()=>done(error)));return writer;}}),{stream}=f;
  stream.write('action1\n',{urgent:true});await Promise.resolve();await until(()=>completions.length===1);
  assert.equal(writer.writableLength,0,'an outstanding zlib callback still owns the compression slot');
  stream.write('action2\n',{urgent:true});stream.write('pose\n',{replaceKey:'owner:a'});
  await Promise.resolve();assert.equal(stream.performance().flushes,1);
  assert.equal(stream.performance().queuedEvents,2);
  completions.shift()();await until(()=>completions.length===1);assert.equal(stream.performance().flushes,2);
  completions.shift()();assert.equal(await f.end(),'action1\naction2\npose\n');
});

test('retired critical microtasks cannot flush into a closed stream',async t=>{
  const f=fixture(t),{stream}=f;stream.write('action\n',{urgent:true});stream.destroy('retired');
  await Promise.resolve();assert.equal(stream.performance().flushes,0);assert.equal(stream.performance().closeReason,'retired');
});

test('critical microtasks still enforce the original age and byte bounds',async t=>{
  let now=0;const f=fixture(t,{clock:()=>now}),{stream}=f;
  stream.write('action\n',{urgent:true});now=1000;await Promise.resolve();
  assert.equal(stream.performance().flushes,0);assert.equal(stream.performance().closeReason,'queue-age');
  const other=fixture(t,{maximumQueuedBytes:8});
  assert.equal(other.stream.write('12345678',{urgent:true}),true);
  assert.equal(other.stream.write('9',{urgent:true}),false);
  await Promise.resolve();assert.equal(other.stream.performance().flushes,0);assert.equal(other.stream.performance().closeReason,'queue-bytes');
});
