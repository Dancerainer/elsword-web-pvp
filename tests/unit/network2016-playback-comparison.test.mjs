/** Pure summary checks: this imports no Native or combat simulation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePlaybackReports} from '../../tools/validation/compare-network2016-playback.mjs';
const scenarios=['stall-1300','spike-300','spike-650','lan','fixed-rtt-80','fixed-rtt-160','jitter-rtt-80','jitter-loss-1pct'];
function report(){return {assetHashes:{fixture:'same'},rows:scenarios.flatMap(name=>['dash','air-command','platform'].map(workload=>({
  scenario:{name},workload,frames:660,seed:20161014,controlHeaders:true,inputSha256:name+'/'+workload,
  trace:[{frame:1,source:{ownerX:0,ownerY:0,ownerHp:100,ownerState:'wait',ownerSerial:1,ownerTime:0,ownerLine:2}}],
  faults:[],wire:{messages:1,bytes:100,poseBaselineMisses:0},owners:[{id:'source',reports:1,actions:1,hits:[],hitCount:0,damageTaken:0,
    final:{ownerX:0,observedX:0,error:0,ownerY:0,observedY:0,ownerHp:100,observedHp:100,ownerState:'wait',observedState:'wait',ownerLine:2,observedLine:2},
    positionErrorP95:2,maximumCorrection:1,contrarySteps:0,steadyVelocityErrorP95:0,steadyVelocitySamples:1,lineTransitions:[],
    receiver:{receiver:{admitted:1,played:1,pending:0,rejected:0,overflowed:0}},
    control:{pendingPackets:0,inflightPackets:0,pendingReceive:0,pendingPoses:0}}]})))};}

test('complete identical matrices pass while raw JSON counters remain explicitly qualified',()=>{
  const before=report(),after=structuredClone(before);after.rows[0].wire.bytes=50;
  const result=comparePlaybackReports(before,after);assert.equal(result.status,'passed');assert.equal(result.aggregate.cases,24);
  assert.equal(result.comparisonPassed,true);assert.equal(result.aggregate.absolutePass.baseline,true);
  assert.match(result.rows[0].applicationModelCounters.scope,/do not measure binary/);
});

test('an existing baseline absolute failure is visible without inventing a relative regression',()=>{
  const before=report();before.rows[0].owners[0].final.error=2;
  const after=structuredClone(before),result=comparePlaybackReports(before,after);
  assert.equal(result.status,'existing-absolute-failures');assert.equal(result.comparisonPassed,true);
  assert.deepEqual(result.aggregate.absolutePass,{baseline:false,candidate:false});
  assert.equal(result.absoluteFailures.baseline[0].check,'finalX');assert.equal(result.absoluteFailures.candidate[0].check,'finalX');
  after.rows[0].owners[0].final.error=0;
  assert.equal(comparePlaybackReports(before,after).status,'baseline-existing-failures');
});

test('input, source trajectory, hit changes and newly unconsumed playback queues cannot appear as passing comparisons',()=>{
  const before=report(),after=structuredClone(before);
  after.rows[0].inputSha256='changed';after.rows[1].trace[0].source.ownerX=1;
  after.rows[2].owners[0].hitCount=1;after.rows[3].owners[0].receiver.receiver.pending=1;
  const result=comparePlaybackReports(before,after);assert.equal(result.status,'regression');assert.equal(result.comparisonPassed,false);
  assert.deepEqual(result.invariantFailures.map(value=>value.check),['inputSha256','ownerTrajectorySha256','hitCount']);
  assert.ok(result.regressions.some(value=>value.reasons.includes('new-absolute-failure:playbackQueue')));
});

test('existing extreme stalls retain fault timelines; a new timeout is reported as a regression',()=>{
  const before=report();before.rows[0].faults=[{at:1000,from:'source',reason:'control-ack-timeout'}];
  before.rows[0].wire.poseBaselineMisses=4;
  const after=structuredClone(before);after.rows[0].faults[0].at=1050;
  let result=comparePlaybackReports(before,after);assert.equal(result.status,'passed');
  assert.equal(result.rows[0].faults.timelineEqual,false);assert.deepEqual(result.rows[0].faults.baseline,before.rows[0].faults);
  assert.equal(result.aggregate.baselineFaults,1);assert.equal(result.rows[0].applicationModelCounters.baseline.poseBaselineMisses,4);
  after.rows[0].faults.push({at:1200,from:'source',reason:'control-pose-timeout'});
  result=comparePlaybackReports(before,after);assert.equal(result.status,'regression');assert.equal(result.aggregate.candidateFaults,2);
});

test('missing cases and different assets fail even if the remaining final poses agree',()=>{
  const before=report(),after=structuredClone(before);after.rows.pop();after.assetHashes.fixture='different';
  const result=comparePlaybackReports(before,after);assert.equal(result.comparisonPassed,false);
  assert.deepEqual(result.invariantFailures.map(value=>value.check),['candidateMatrixCases','assetHashes']);
});
