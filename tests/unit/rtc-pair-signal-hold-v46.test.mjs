import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairSignalHold,validatePairSignalHoldMs} from '../../tools/rtc-pair-signal-hold-v46.mjs';

function fixture(durationMs=1000) {
  let now=100,next=0;const timers=new Map();
  const hold=createPairSignalHold({playerId:'rtc-v6-0',durationMs,clock:()=>now,
    schedule:(fn,ms)=>{const id=next++;timers.set(id,{fn,at:now+ms});return id;},cancel:id=>timers.delete(id)});
  return {hold,timers,async advance(at) {now=at;for(const [id,row]of [...timers])if(row.at<=now){timers.delete(id);row.fn();}await Promise.resolve();await Promise.resolve();}};
}

test('default zero preserves real request result and never arms a queue',async()=>{
  const f=fixture(0),response={status:201};let sent=0;
  f.hold.arm('rtc-v6-1',100);
  assert.equal(await f.hold.send('rtc-v6-1','offer',async()=>{sent++;return response;}),response);
  assert.equal(sent,1);assert.equal(f.hold.snapshot().armedAtWallMs,null);assert.equal(f.hold.snapshot().requests.length,0);
  assert.equal(f.timers.size,0);
});

test('only the armed pair waits; genuine responses serialize held HTTP FIFO',async()=>{
  const f=fixture(),sent=[];let finishFirst;
  const firstResponse={status:202},secondResponse={status:203};f.hold.arm('rtc-v6-1',100);
  const first=f.hold.send('rtc-v6-1','offer',()=>{sent.push('offer');return new Promise(resolve=>{finishFirst=()=>resolve(firstResponse);});});
  const second=f.hold.send('rtc-v6-1','candidate',async()=>{sent.push('candidate');return secondResponse;});
  await f.hold.send('rtc-v6-2','offer',async()=>{sent.push('other-pair');return {status:200};});
  await f.hold.send('rtc-v6-1','not-a-signal',async()=>{sent.push('other-request');return {status:200};});
  await f.advance(1099);assert.deepEqual(sent,['other-pair','other-request']);
  await f.advance(1100);assert.deepEqual(sent,['other-pair','other-request','offer']);
  finishFirst();assert.equal(await first,firstResponse);assert.equal(await second,secondResponse);
  assert.deepEqual(sent,['other-pair','other-request','offer','candidate']);
  const snap=f.hold.snapshot();assert.equal(snap.queuedRequests,2);assert.equal(snap.pendingRequests,0);
  assert.deepEqual(snap.requests.map(row=>row.status),[202,203]);
  assert.ok(snap.requests.every(row=>row.fetchStartedAtWallMs>=1100));
  assert.ok(snap.requests[1].fetchStartedAtWallMs>=snap.requests[0].completedAtWallMs);
  assert.equal(Object.hasOwn(f.hold.snapshot({histories:false}),'requests'),false);
});

test('real request rejection propagates without a fake ACK or starving the next signal',async()=>{
  const f=fixture(),failure=Error('real-fetch-failure');f.hold.arm('rtc-v6-1',100);
  const first=f.hold.send('rtc-v6-1','offer',()=>Promise.reject(failure));
  const rejected=assert.rejects(first,error=>error===failure);
  const response={status:200},second=f.hold.send('rtc-v6-1','candidate',async()=>response);
  await f.advance(1100);await rejected;assert.equal(await second,response);
  assert.equal(f.hold.snapshot().failedRequests,1);assert.equal(f.hold.snapshot().pendingRequests,0);
});

test('closing a pending hold cancels its timer and rejects queued requests',async()=>{
  const f=fixture();let sent=0;f.hold.arm('rtc-v6-1',100);
  const request=f.hold.send('rtc-v6-1','offer',async()=>{sent++;return {status:200};});
  const rejected=assert.rejects(request,/diagnostic-signal-hold-closed/);f.hold.close();await rejected;
  await f.advance(1200);assert.equal(sent,0);assert.equal(f.timers.size,0);
  assert.equal(f.hold.snapshot().queueLength,0);assert.equal(f.hold.snapshot().pendingRequests,0);
});

test('hold duration and target validation reject an unregistered fault scope',()=>{
  for(const value of [-1,1,499,1001,NaN,Infinity,500.5,'1000'])assert.throws(()=>validatePairSignalHoldMs(value));
  for(const value of [0,500,750,1000])assert.equal(validatePairSignalHoldMs(value),value);
  const f=fixture();assert.throws(()=>f.hold.arm('rtc-v6-2',100));f.hold.arm('rtc-v6-1',100);
  assert.throws(()=>f.hold.arm('rtc-v6-1',100));
});
