import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRoomWorkerFactory} from '../../apps/server/room-worker-factory.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),workerEntry=fileURLToPath(new URL('./fixtures/room-worker-fixture.mjs',import.meta.url));
const metadataFactory=Object.assign(()=>{}, {ownership:'local-owner-v1',professions:{RF:true},versions:{fixture:true},maps:[]});
const match=id=>({id,players:[{id:'a'},{id:'b'}]});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('room factories use distinct OS processes with independent snapshots and bounded input RPC',async t=>{
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,maxPendingPerPlayer:2});
  const a=await factory({match:match('a'),emit(){},finish(){}}),b=await factory({match:match('b'),emit(){},finish(){}});t.after(()=>{a.stop();b.stop();});
  const pids=factory.workerDiagnostics().workers.map(row=>row.pid);assert.equal(new Set(pids).size,2);assert.ok(pids.every(pid=>pid!==process.pid));
  assert.equal(a.snapshot().matchId,'a');assert.equal(b.snapshot().matchId,'b');
  const first=a.submitInput('a',{sequence:1,delay:40}),second=a.submitInput('a',{sequence:2,delay:40});
  await assert.rejects(a.submitInput('a',{sequence:3}),/room-worker-input-busy/);
  assert.equal(factory.workerDiagnostics().active,2);assert.equal(factory.workerDiagnostics().recentFailures.length,0,'admission backpressure alone does not cancel a room');
  assert.equal((await first).frameSeq,1);assert.equal((await second).frameSeq,2);
  assert.equal(factory.workerDiagnostics().workers.find(row=>row.pid===a.snapshot().pid).pendingInputs,0);
  a.stop();await wait(70);assert.equal(factory.workerDiagnostics().active,1);assert.equal((await b.ready('b')).ok,true);
});
test('a crashed room rejects outstanding requests and signals failure without retiring another room',async t=>{
  const failures=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
  const a=await factory({match:match('crash'),emit:(...args)=>failures.push(args),finish(){throw Error('no fake result');}});
  const b=await factory({match:match('healthy'),emit(){},finish(){}});t.after(()=>{a.stop();b.stop();});
  await assert.rejects(a.submitInput('a',{sequence:1,crash:true}),/room-worker-(?:exited|disconnected)/);
  assert.equal(failures.filter(([type])=>type==='room-failed').length,1);assert.equal(factory.workerDiagnostics().active,1);
  assert.equal((await b.submitInput('b',{sequence:1})).accepted,true);
});
test('startup failure rejects creation and leaves no reserved worker',async()=>{
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
  await assert.rejects(factory({match:match('startup-failure'),emit(){},finish(){}}),/fixture-startup-failure/);
  assert.equal(factory.workerDiagnostics().active,0);
});
test('stopping an active worker rejects in-flight work and prevents later output',async()=>{
  const events=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry});
  const driver=await factory({match:match('stop'),emit:(...args)=>events.push(args),finish(){}});
  const pending=driver.submitInput('a',{sequence:1,delay:200});driver.stop();await assert.rejects(pending,/room-worker-stopped/);
  await wait(30);assert.equal(factory.workerDiagnostics().active,0);assert.deepEqual(events,[]);
});
test('factory close cancels a child still starting instead of waiting for its startup timeout',async()=>{
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,startTimeoutMs:90000});
  const pending=factory({match:match('startup-pending'),emit(){},finish(){}});
  factory.close();await assert.rejects(pending,/room-worker-factory-closed/);assert.equal(factory.workerDiagnostics().active,0);
});
test('a stalled accepted IPC request has a bounded timeout and cancels only its room',async t=>{
  const failures=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,requestTimeoutMs:40});
  const room=await factory({match:match('timeout'),emit:(...args)=>failures.push(args),finish(){}});t.after(()=>room.stop());
  await assert.rejects(room.submitInput('a',{sequence:1,delay:500}),/room-worker-request-timeout/);
  assert.equal(factory.workerDiagnostics().active,0);assert.equal(failures[0][0],'room-failed');
});
test('lost IPC cancels a room immediately even when the child keeps another event loop handle alive',async t=>{
  const failures=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,requestTimeoutMs:5000});
  const room=await factory({match:match('disconnect'),emit:(...args)=>failures.push(args),finish(){}});t.after(()=>room.stop());
  await assert.rejects(room.submitInput('a',{sequence:1,disconnect:true}),/room-worker-disconnected/);
  assert.equal(factory.workerDiagnostics().active,0);assert.equal(failures.length,1);assert.equal(failures[0][0],'room-failed');
});

test('a timed-out admitted request retains its method and age, with a single bounded diagnostic and another room still healthy',async t=>{
  const logs=[],events=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,requestTimeoutMs:30,onFailure:row=>logs.push(row)});
  const a=await factory({match:match('diag-timeout'),emit:(...args)=>events.push(args),finish(){}}),b=await factory({match:match('diag-healthy'),emit(){},finish(){}});
  t.after(()=>{a.stop();b.stop();});await assert.rejects(a.submitInput('a',{sequence:1,delay:500}),/room-worker-request-timeout/);
  const diagnostics=factory.workerDiagnostics();assert.equal(diagnostics.active,1);assert.equal(diagnostics.recentFailures.length,1);
  const failure=diagnostics.recentFailures[0];assert.equal(failure.cause,'room-worker-request-timeout');assert.equal(failure.requestMethod,'submitInput');assert.ok(failure.requestAgeMs>=25);
  assert.equal(failure.pendingRequests,1);assert.equal(failure.pendingInputs,1);assert.equal(failure.pendingBytes,128*1024);
  assert.equal(logs.length,1);assert.equal(logs[0].stderrTail,undefined);assert.equal(logs[0].matchId,undefined);assert.equal(logs[0].playerId,undefined);
  assert.equal(events.length,1);assert.equal(events[0][1].error,'room-worker-unavailable');assert.equal(events[0][1].cause,'room-worker-request-timeout');
  assert.equal((await b.submitInput('b',{sequence:1})).accepted,true);
  diagnostics.recentFailures[0].cause='mutated';assert.equal(factory.workerDiagnostics().recentFailures[0].cause,'room-worker-request-timeout');
});

test('crashed child stderr is bounded and retained privately with its exit code, while journal summaries omit raw child text',async t=>{
  const logs=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,onFailure:row=>logs.push(row)});
  const room=await factory({match:match('diag-stderr'),emit(){},finish(){}});t.after(()=>room.stop());
  await assert.rejects(room.submitInput('a',{sequence:1,stderrCrash:true}),/room-worker-(?:exited|disconnected)/);
  for(let n=0;n<100&&factory.workerDiagnostics().recentFailures[0].exitCode===null;n++)await wait(5);
  const failure=factory.workerDiagnostics().recentFailures[0];assert.equal(failure.exitCode,8);assert.ok(failure.stderrBytes>20_000);
  assert.ok(Buffer.byteLength(failure.stderrTail)<=8192);assert.match(failure.stderrTail,/fixture-tail-marker/);
  assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/fixture-tail-marker|fixture-private-detail/);
});

test('a reported worker IPC safety overflow retains its numeric cause without lifting the output or RPC limits',async t=>{
  const logs=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,onFailure:row=>logs.push(row)});
  const room=await factory({match:match('diag-overflow'),emit(){},finish(){}});t.after(()=>room.stop());
  await assert.rejects(room.submitInput('a',{sequence:1,outputOverflow:true}),/room-worker-output-overflow/);
  const failure=factory.workerDiagnostics().recentFailures[0];assert.equal(failure.cause,'room-worker-output-overflow');
  assert.equal(failure.pendingOutputMessages,256);assert.equal(failure.pendingOutputBytes,1_000_000);assert.equal(logs.length,1);
});

test('production entry reports the real output safety bound and cancels only the overflowing room',async t=>{
  const logs=[],entry=fileURLToPath(new URL('./fixtures/room-worker-health-entry-v7.mjs',import.meta.url));
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry:entry,onFailure:row=>logs.push(row)});
  const a=await factory({match:match('real-overflow'),emit(){},finish(){}}),b=await factory({match:match('still-healthy'),emit(){},finish(){}});
  t.after(()=>{a.stop();b.stop();});
  await assert.rejects(a.submitInput('a',{matchId:'real-overflow',sequence:1,frames:[{held:[],pressed:['X'],released:[],frameSeq:1}]}),/room-worker-output-overflow/);
  assert.equal(factory.workerDiagnostics().active,1);assert.equal(factory.workerDiagnostics().recentFailures[0].cause,'room-worker-output-overflow');
  assert.equal(logs.length,1);assert.ok(logs[0].pendingOutputBytes>=0);assert.equal((await b.ready('b')).ok,true);
});

test('production entry keeps startup exception details privately while journals and callers use a stable cause',async()=>{
  const logs=[],entry=fileURLToPath(new URL('./fixtures/room-worker-health-entry-v7.mjs',import.meta.url));
  const factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry:entry,onFailure:row=>logs.push(row)});
  await assert.rejects(factory({match:match('health-initialize-failure'),emit(){},finish(){}}),/room-worker-initialize-failed/);
  const failure=factory.workerDiagnostics().recentFailures[0];assert.equal(failure.workerErrorName,'Error');assert.equal(failure.workerErrorMessage,'fixture-private-initialize-detail');
  assert.equal(logs.length,1);assert.doesNotMatch(JSON.stringify(logs),/fixture-private-initialize-detail/);assert.equal(factory.workerDiagnostics().active,0);
});

test('repeated startup faults retain only the latest sixteen summaries rather than accumulating a diagnostic history',async()=>{
  const logs=[],factory=await createRoomWorkerFactory({root,assetRoot:root,metadataFactory,workerEntry,onFailure:row=>logs.push(row)});
  for(let n=0;n<19;n++)await assert.rejects(factory({match:match('startup-failure'),emit(){},finish(){}}),/fixture-startup-failure/);
  const diagnostics=factory.workerDiagnostics();assert.equal(diagnostics.active,0);assert.equal(diagnostics.recentFailures.length,16);
  assert.deepEqual(diagnostics.recentFailures.map(row=>row.pid),logs.slice(-16).map(row=>row.pid));
});
