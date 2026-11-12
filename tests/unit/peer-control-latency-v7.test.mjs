import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {runPeerControlLatency} from '../fixtures/peer-control-latency-v7.mjs';
for(const rttMs of [200,300])test(`20Hz canonical actions at ${rttMs}ms RTT retain immediate one-way admission and causal pose release`,()=>{
  const result=runPeerControlLatency(createPeerControl,{rttMs});
  assert.equal(result.sourceActions,80);assert.deepEqual(result.actionIds,Array.from({length:80},(_,index)=>index+1));
  assert.equal(result.actions.count,80);assert.equal(result.poses.count,80);
  assert.equal(result.actions.p95Ms,rttMs/2);assert.equal(result.actions.maxMs,rttMs/2);
  assert.equal(result.poses.p95Ms,rttMs/2);assert.equal(result.poses.maxMs,rttMs/2);
  assert.deepEqual(result.faults,[]);assert.equal(result.sender.pendingPackets,0);assert.equal(result.receiver.pendingPoses,0);
  assert.equal(result.sender.creditLimit,8);assert.equal(result.sender.mergedActionBatches,0);
});
