import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCapacityHeadroom} from '../../tools/validation/network-capacity-v45.mjs';
import net from 'node:net';
import {createCapacityTcpProxy} from '../../tools/validation/network-health-proxy-v7.mjs';
const result={method:{rooms:['2v2','2v2'],players:8,rtc:false,sharedBottleneck:true,egressMbps:10},concurrency:{startWallMs:0,endWallMs:8000,valid:true},integrity:{passed:true},health:{qualityPassed:true,consumptionCoverage:{steadyObserved:1,matchedSource:1,unmatchedCanonicalIdentity:0,missingGeneratedSource:0,sourceOutsideSteady:0}}};
const fixture=()=>({method:{egressBytesPerSecond:1250000},phase:'pre-server-stop',capturedAtWallMs:8001,bins:Array.from({length:80},(_,i)=>({atWallMs:i*100,down:75000,up:0})),flows:[],queueSamples:Array.from({length:80},(_,i)=>({atWallMs:i*100,downQueuedBytes:0,readyDownQueuedBytes:0})),maxSharedDownQueuedBytes:0});
test('one-second sliding windows include zeros and exclude partial overlap and warmup',()=>{
 const wire=fixture();wire.bins=wire.bins.filter(row=>row.atWallMs!==5500);
 const summary=summarizeCapacityHeadroom({result,wire});
 assert.equal(summary.slidingOneSecondMbps.samples,21);
 assert.equal(summary.slidingOneSecondMbps.max,6);
 assert.equal(summary.slidingOneSecondMbps.min,5.4);
 assert.equal(summary.passed,true);
});
test('sliding peak catches a burst across wall-second boundaries',()=>{
 const wire=fixture();for(const row of wire.bins)if(row.atWallMs>=6500&&row.atWallMs<7500)row.down=120000;
 const summary=summarizeCapacityHeadroom({result,wire});
 assert.equal(summary.slidingOneSecondMbps.max,9.6);
 assert.ok(summary.failures.includes('sliding-peak-exceeds-9mbps'));
 assert.equal(summary.passed,false);
});
test('an invalid underlying match and an empty observation cannot pass headroom',()=>{
 const summary=summarizeCapacityHeadroom({result:{...result,concurrency:{startWallMs:0,endWallMs:5200},integrity:{passed:false},health:{...result.health,qualityPassed:false}},wire:fixture()});
 assert.deepEqual(summary.failures,['underlying-integrity-failed','underlying-quality-failed','no-complete-sliding-window']);
 assert.equal(summary.applicationMarginMbps.peak,null);
});
test('wrong room count, missing observers or discarded steady data cannot claim capacity',()=>{
 const wire=fixture();wire.queueSamples=[];wire.flows=[{direction:'down',queuedBytes:1,abortedQueuedBytes:5,closedAtWallMs:6000,maxReadyWaitMs:0}];
 const summary=summarizeCapacityHeadroom({result:{...result,method:{...result.method,players:4},health:{...result.health,consumptionCoverage:{...result.health.consumptionCoverage,missingGeneratedSource:1}}},wire});
 for(const reason of ['unexpected-two-room-wire-contract','incomplete-steady-queue-observation','unverified-steady-action-consumption','steady-or-unclassified-downstream-discard','pre-stop-downstream-tail-not-drained'])assert.ok(summary.failures.includes(reason));
 assert.equal(summary.passed,false);
});
test('normal cleanup outside the common window remains explicit without being counted as steady delivery loss',()=>{
 const wire=fixture();wire.flows=[{direction:'down',queuedBytes:0,abortedQueuedBytes:5,closedAtWallMs:8000,maxReadyWaitMs:0}];
 const summary=summarizeCapacityHeadroom({result,wire});
 assert.equal(summary.steadyDiscardedDownQueuedBytes,0);
 assert.equal(summary.outOfSteadyDiscardedDownQueuedBytes,5);
 assert.equal(summary.passed,true);
});
test('queue observers preserve actual TCP bytes and retain finite queue evidence',async()=>{
 const payload=Buffer.alloc(8192,0x7b),received=[];
 const upstream=net.createServer(socket=>socket.end(payload));
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const proxy=await createCapacityTcpProxy({upstreamPort:upstream.address().port,players:1,egressBytesPerSecond:128000,oneWayMs:5});
 try {
  await new Promise((resolve,reject)=>{
   const client=net.connect({host:'127.0.0.1',port:proxy.ports[0]});
   client.on('data',bytes=>received.push(bytes));client.on('error',reject);client.on('end',()=>client.end());client.on('close',resolve);
  });
  assert.deepEqual(Buffer.concat(received),payload);
  const wire=proxy.snapshot(),down=wire.flows.filter(row=>row.direction==='down');
  assert.equal(down.reduce((n,row)=>n+row.bytes,0),payload.length);
  assert.ok(wire.maxSharedDownQueuedBytes>0);
  assert.ok(wire.queueSamples.length>0);
  assert.ok(down.every(row=>Number.isFinite(row.maxReadyWaitMs)&&row.maxReadyWaitMs>=0));
  assert.equal(down.reduce((n,row)=>n+(row.abortedQueuedBytes??0),0),0);
 } finally {await proxy.close();await new Promise(resolve=>upstream.close(resolve));}
});
