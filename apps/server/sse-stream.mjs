import {createGzip, constants} from 'node:zlib';

export function acceptsSseGzip(value = '') {
  return String(value).split(',').some(part => {
    const [encoding, ...parameters] = part.trim().toLowerCase().split(';').map(value => value.trim());
    if (encoding !== 'gzip') return false;
    const quality = parameters.find(value => value.startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

/** Keep an authenticated event stream low latency even when gzip buffers input. */
export function createSseStream(req, response, {maximumQueuedBytes = 512 * 1024, maximumQueueAgeMs = 1000,
  batchWindowMs = 8, maximumBatchBytes = 64 * 1024, clock = () => performance.now(),createCompressor=options=>createGzip(options),onDiagnostic=null} = {}) {
  if(!Number.isFinite(batchWindowMs)||batchWindowMs<0||batchWindowMs>12||!Number.isSafeInteger(maximumBatchBytes)||maximumBatchBytes<1)throw Error('invalid-sse-batch-config');
  if(typeof createCompressor!=='function')throw Error('invalid-sse-compressor');
  const compressed = acceptsSseGzip(req.headers['accept-encoding']);
  response.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store',
    'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Vary': 'Accept-Encoding',
    ...(compressed ? {'Content-Encoding': 'gzip'} : {})});
  response.flushHeaders();
  // Persistent streams benefit from the stronger shared dictionary: real
  // mixed native traffic at the same8ms flush cadence measured substantially
  // fewer wire bytes at level6, without changing any reliable event or clock.
  const writer = compressed ? createCompressor({level: 6}) : response;
  if (compressed) {
    writer.on('error', error => { diagnostic('writer-error',{code:error.code});if (!response.destroyed) response.destroy(); });
    writer.pipe(response);
    response.once('close', () => writer.destroy());
  }
  let ended = false, ending=false, blocked = false, bufferedBytes = 0, blockedAt = null, batchTimer = null, urgentPending = false;
  let compressionStartedAt=null,compressionInputBytes=0;
  const flushLatencyUpperBoundsMs=[1,2,4,8,16,32,64,128,256,512,1000,Infinity];
  const metrics={acceptedEvents:0,inputBytes:0,outputBytes:0,writeBatches:0,flushes:0,coalescedEvents:0,maximumQueuedBytes:0,maximumQueueAgeMs:0,closeReason:null,
    completedFlushes:0,totalFlushMs:0,maximumFlushMs:0,maximumCompressionAgeMs:0,urgentEvents:0,expeditedBatches:0,flushLatencyCounts:Array(flushLatencyUpperBoundsMs.length).fill(0)};
  const pending = [];
  // zlib's flush markers occupy zero writable bytes. Track the complete
  // write+flush lifecycle explicitly instead of mistaking a short JS queue
  // for completion of compression in the shared libuv worker pool.
  const compressionAge=()=>compressionStartedAt===null?0:Math.max(0,clock()-compressionStartedAt);
  const queuedBytes = () => bufferedBytes + response.writableLength + (compressed ? Math.max(compressionInputBytes,writer.writableLength) + writer.readableLength : 0);
  const openedAt=clock();let retiredReason=null;
  function diagnostic(event,details={}) {
    if(!onDiagnostic)return;
    try{onDiagnostic({event,...details,compressed,elapsedMs:clock()-openedAt,retiredReason,
      queuedBytes:queuedBytes(),queuedEvents:pending.length,blocked,
      blockedAgeMs:blockedAt===null?null:clock()-blockedAt,pendingAgeMs:pending.length?clock()-pending[0].at:null,
      responseWritableLength:response.writableLength,responseNeedDrain:response.writableNeedDrain,
      writerWritableLength:writer.writableLength,writerReadableLength:writer.readableLength,writerNeedDrain:writer.writableNeedDrain,
      responseDestroyed:response.destroyed,responseFinished:response.writableFinished});}catch{}
  }
  const stalled = () => blocked || writer.writableNeedDrain || response.writableNeedDrain;
  const observeStall = () => {if(stalled())blockedAt ??= clock();else blockedAt=null;};
  const expired = () => {observeStall();const now=clock();return blockedAt!==null&&now-blockedAt>=maximumQueueAgeMs || pending.length&&now-pending[0].at>=maximumQueueAgeMs||compressionAge()>=maximumQueueAgeMs;};
  const age = () => Math.max(blockedAt===null?0:clock()-blockedAt,pending.length?clock()-pending[0].at:0,compressionAge());
  const observe = () => {metrics.maximumQueuedBytes=Math.max(metrics.maximumQueuedBytes,queuedBytes());metrics.maximumQueueAgeMs=Math.max(metrics.maximumQueueAgeMs,age());
    metrics.maximumCompressionAgeMs=Math.max(metrics.maximumCompressionAgeMs,compressionAge());};
  const clear = () => {clearInterval(ageTimer);clearTimeout(batchTimer);batchTimer=null;pending.length = 0;bufferedBytes = 0;writer.off('drain',drain);if(compressed)response.off('drain',drain);};
  if(compressed)writer.on('data',chunk=>{metrics.outputBytes+=chunk.length;});
  function finishEnding(){
    if(!ending||ended||pending.length||compressionStartedAt!==null)return;
    metrics.closeReason??='ended';ended=true;clear();if(!writer.destroyed)writer.end();
  }
  function output(value) {
    metrics.writeBatches++;if(!compressed)metrics.outputBytes+=Buffer.byteLength(value);
    if(compressed){compressionStartedAt=clock();compressionInputBytes=Buffer.byteLength(value);}
    const accepted = writer.write(value);
    // flush() is itself queued behind compression writes. Do not produce a
    // separate unbounded compression queue after write() asks us to pause.
    if (compressed) {metrics.flushes++;writer.flush(constants.Z_SYNC_FLUSH,error=>{
      if(ended||response.destroyed||writer.destroyed)return;
      if(error){stream.destroy('compression-error');return;}
      const elapsed=compressionAge();metrics.completedFlushes++;metrics.totalFlushMs+=elapsed;metrics.maximumFlushMs=Math.max(metrics.maximumFlushMs,elapsed);
      metrics.flushLatencyCounts[flushLatencyUpperBoundsMs.findIndex(bound=>elapsed<=bound)]++;observe();
      compressionStartedAt=null;compressionInputBytes=0;blocked=writer.writableNeedDrain;observeStall();
      if(elapsed>=maximumQueueAgeMs||expired()){stream.destroy('queue-age');return;}pump();finishEnding();
    });}
    blocked = !accepted;
    observeStall();observe();
  }
  function pump() {
    if (ended || response.destroyed || writer.destroyed || compressionStartedAt!==null || blocked || writer.writableNeedDrain || response.writableNeedDrain) return;
    while(pending.length && compressionStartedAt===null && !blocked && !writer.writableNeedDrain && !response.writableNeedDrain) {
      const rows=[pending.shift()];let bytes=rows[0].bytes;
      // All events in this fixed, short window retain FIFO order. Only rows
      // explicitly marked replaceable may disappear before compression.
      if(compressed)while(pending.length&&bytes+pending[0].bytes<=maximumBatchBytes){const row=pending.shift();rows.push(row);bytes+=row.bytes;}
      bufferedBytes-=bytes;output(rows.map(row=>row.value).join(''));
    }
    finishEnding();
  }
  function drain() {blocked=writer.writableNeedDrain;observeStall();pump();}
  function expedite() {
    clearTimeout(batchTimer);batchTimer=null;
    if(urgentPending)return;urgentPending=true;
    // Retain the synchronous action/baseline/pose batch and its FIFO order,
    // but do not charge a critical event the ordinary movement batching delay.
    // Compression already in flight and actual socket pressure still win.
    queueMicrotask(()=>{
      urgentPending=false;
      if(ended||response.destroyed||writer.destroyed)return;
      if(expired()){stream.destroy('queue-age');return;}
      const before=metrics.writeBatches;pump();
      if(metrics.writeBatches>before)metrics.expeditedBatches++;
    });
  }
  writer.on('drain',drain);if(compressed)response.on('drain',drain);
  response.once('close',()=>{diagnostic('response-close');metrics.closeReason??='response-closed';ended=true;clear();});
  // Compression can accept a write before the HTTP destination blocks. Keep
  // observing both stages, including the first write already outside pending.
  // Replacing later movement must never renew that original stalled age.
  const ageTimer=setInterval(()=>{if(!ended&&expired())stream.destroy('queue-age');},Math.min(250,maximumQueueAgeMs));ageTimer.unref?.();
  const stream = {
    response, compressed,
    write(value,{replaceKey=null,urgent=false}={}) {
      if (ended || ending || response.destroyed || writer.destroyed) return false;
      if(expired()){stream.destroy('queue-age');return false;}
      // Only superseded event-free snapshots/keepalives are replaceable. Input
      // histories, room events, signals and results retain their FIFO order.
      if(replaceKey!==null)for(let index=pending.length-1;index>=0;index--)if(pending[index].key===replaceKey){
        bufferedBytes-=pending[index].bytes;pending.splice(index,1);metrics.coalescedEvents++;
      }
      const bytes=Buffer.byteLength(value);
      if (queuedBytes()+bytes > maximumQueuedBytes) {stream.destroy('queue-bytes');return false;}
      metrics.acceptedEvents++;metrics.inputBytes+=bytes;
      if(urgent)metrics.urgentEvents++;
      if(!compressed&&!pending.length&&!blocked&&!writer.writableNeedDrain&&!response.writableNeedDrain)output(value);
      else {
        pending.push({value,bytes,key:replaceKey,at:clock()});bufferedBytes+=bytes;observe();
        if(!compressed||batchWindowMs===0)pump();
        else if(urgent)expedite();
        else if(!urgentPending&&!batchTimer&&compressionStartedAt===null&&!stalled()){
          // The first event starts the deadline. New movement cannot keep
          // postponing flushes or starvation would return under sustained load.
          batchTimer=setTimeout(()=>{batchTimer=null;if(expired())stream.destroy('queue-age');else pump();},batchWindowMs);batchTimer.unref?.();
        }
      }
      return true;
    },
    end() { if (ended||ending) return;retiredReason='end';diagnostic('retire');ending=true;clearTimeout(batchTimer);batchTimer=null;pump();finishEnding(); },
    destroy(reason='destroyed') { if(ended)return;retiredReason=reason;diagnostic('retire');observe();metrics.closeReason??=reason;ended = true;clear();if (compressed) writer.destroy(); if (!response.destroyed) response.destroy(); },
    performance() {observe();return {...metrics,flushLatencyCounts:[...metrics.flushLatencyCounts],flushLatencyUpperBoundsMs:flushLatencyUpperBoundsMs.map(value=>Number.isFinite(value)?value:null),
      sampledAtWallMs:Date.now(),compressed,ended,ending,queuedBytes:queuedBytes(),queuedEvents:pending.length,queueAgeMs:age(),
      pendingQueueAgeMs:pending.length?Math.max(0,clock()-pending[0].at):0,transportBlockedAgeMs:blockedAt===null?0:Math.max(0,clock()-blockedAt),
      compressionInFlight:compressionStartedAt!==null,compressionAgeMs:compressionAge(),compressionInputBytes,batchWindowMs};},
    get queuedBytes() { return queuedBytes(); },
    get queuedEvents() {return pending.length;},
  };
  return stream;
}
