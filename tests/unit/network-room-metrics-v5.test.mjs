import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoomPlan,distribution,summarizeRoomOverlap,summarizeSharedWire,assessMeasurementIntegrity} from '../../tools/network-room-metrics-v5.mjs';

function fixture(){
  const plan=parseRoomPlan('3v3,3v3'),peers=[];
  // Real queue selection need not preserve launch order or contiguous indexes.
  for(let i=0;i<12;i++){
    const memberIds=Array.from({length:6},(_,n)=>'p'+(n*2+i%2));
    peers.push({playerId:'p'+i,matchId:'match-'+i%2,matchMode:'3v3',requestedMode:'3v3',matchPlayerIds:memberIds,
      generatedReports:[{generatedAtWallMs:10000+i*100},{generatedAtWallMs:190000+i*100}]});
  }
  return {plan,peers};
}
test('room plan supports twelve players without inventing twelve-player game rules',()=>{
  assert.deepEqual(parseRoomPlan('2v2,2v2,2v2').peerModes,Array(12).fill('2v2'));
  assert.equal(parseRoomPlan('3v3,3v3').players,12);
  for(const invalid of ['12v12','3v3,','3v3,3v3,3v3,3v3,3v3,3v3'])assert.throws(()=>parseRoomPlan(invalid));
});
test('concurrency uses the intersection of all real room lifetimes and actual randomized membership',()=>{
  const input=fixture(),rows=[{source:'p0',sink:'p2',generatedAtWallMs:12000,acceptedAtWallMs:12240,ms:240,applied:true},
    {source:'p1',sink:'p3',generatedAtWallMs:13000,acceptedAtWallMs:13200,ms:200,applied:false},
    {source:'p0',sink:'p2',generatedAtWallMs:190000,acceptedAtWallMs:190300,ms:300,applied:true}];
  const result=summarizeRoomOverlap({...input,receiveRows:rows});
  assert.equal(result.valid,true);assert.equal(result.startWallMs,11100);assert.equal(result.endWallMs,190000);assert.equal(result.overlapSeconds,178.9);
  assert.equal(result.acceptedEndToEndMs.samples,2);assert.equal(result.actuallyAppliedEndToEndMs.samples,1);assert.equal(result.actuallyAppliedEndToEndMs.p95,240);
  assert.equal(result.rejectedOrSupersededDeliveries,1);assert.equal(result.rooms[0].players.length,6);
});
test('short second room cannot pass as a full twelve-player run',()=>{
  const input=fixture();for(const peer of input.peers.filter(peer=>peer.matchId==='match-1'))peer.generatedReports[1].generatedAtWallMs=60000;
  const result=summarizeRoomOverlap(input);assert.equal(result.valid,false);assert.equal(result.overlapSeconds,48.9);assert.ok(result.reasons.includes('concurrent-window-too-short'));
});
test('missing players, inconsistent declared membership and cross-room states remain failures',()=>{
  const input=fixture();input.peers[0].matchPlayerIds=['other'];
  const result=summarizeRoomOverlap({...input,receiveRows:[{source:'p1',sink:'p0',generatedAtWallMs:12000,acceptedAtWallMs:12200,ms:200,applied:true}]});
  assert.equal(result.valid,false);assert.ok(result.reasons.includes('membership-disagreement'));assert.equal(result.crossRoomDeliveries,1);
  const missing=summarizeRoomOverlap({...fixture(),peers:fixture().peers.slice(1)});assert.equal(missing.valid,false);assert.equal(missing.startWallMs,null);assert.equal(missing.overlapSeconds,0);
});
test('wire budget uses full aligned seconds and retains zero-traffic seconds',()=>{
  const bins=[{atWallMs:10100,down:999,up:999},{atWallMs:11000,down:10,up:2},{atWallMs:11700,down:20,up:3},{atWallMs:13000,down:60,up:10},{atWallMs:14000,down:999,up:999}];
  const result=summarizeSharedWire(bins,10250,14850);
  assert.equal(result.startWallMs,11000);assert.equal(result.endWallMs,14000);assert.equal(result.seconds,3);
  assert.deepEqual(result.rows.map(row=>row.downBytes),[30,0,60]);assert.equal(result.downBytesPerSecond.mean,30);
  assert.equal(result.upBytesPerSecond.mean,5);
});
test('distribution supports more deliveries than the JavaScript call argument limit',()=>{
  const result=distribution(Array.from({length:250000},(_,i)=>i));
  assert.equal(result.max,249999);assert.equal(result.samples,250000);assert.equal(result.p95,237499);assert.deepEqual(distribution([]),{samples:0,mean:null,p50:null,p95:null,p99:null,max:null});
});
test('a collected report is not a pass when a player or protocol failed',()=>{
  const valid={concurrency:{valid:true,reasons:[]},peers:[{errors:[]}],peerExit:[{code:0}],drops:[{reason:'logout'}],sourceUnchanged:true,measurementUnchanged:true};
  assert.equal(assessMeasurementIntegrity(valid).passed,true);
  const result=assessMeasurementIntegrity({...valid,peers:[{errors:[{message:'room-worker-input-busy'}]}],peerExit:[{code:1}],concurrency:{valid:false,reasons:['concurrent-window-too-short']}});
  assert.equal(result.passed,false);assert.deepEqual(result.failures,['concurrent-window-too-short','peer-process-failed','peer-reported-error']);
});
