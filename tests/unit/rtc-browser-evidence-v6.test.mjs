import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativeRtcStats,assessNativeRtcEvidence,collectNativeRtcStats,assessOnlinePeerHealth,multiRoomMatchWait} from '../../tools/rtc-browser-evidence-v6.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';

test('native evidence requires explicit selected pair and keeps candidate addresses out of persisted statistics',()=>{
  const rows=[{id:'transport',type:'transport',selectedCandidatePairId:'good'},
    {id:'unused',type:'candidate-pair',state:'succeeded',nominated:true,localCandidateId:'relay',remoteCandidateId:'remote'},
    {id:'good',type:'candidate-pair',state:'succeeded',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:.025,bytesSent:128,bytesReceived:64},
    {id:'local',type:'local-candidate',candidateType:'srflx',protocol:'udp',address:'secret-local'},
    {id:'remote',type:'remote-candidate',candidateType:'prflx',address:'secret-remote'},
    {id:'relay',type:'local-candidate',candidateType:'relay',protocol:'udp'},
    {id:'channel',type:'data-channel',label:'control',state:'open',messagesSent:2,messagesReceived:2,bytesSent:128,bytesReceived:64}];
  const result=summarizeNativeRtcStats(rows);assert.equal(result.route,'direct');assert.equal(result.roundTripTimeMs,25);
  assert.equal(result.channels[0].bytesSent,128);assert.doesNotMatch(JSON.stringify(result),/secret|address/);
  assert.equal(summarizeNativeRtcStats(rows.filter(row=>row.type!=='transport')).route,'unknown','nominated alone is not selection');
  rows[0].selectedCandidatePairId='unused';assert.equal(summarizeNativeRtcStats(rows).route,'relay');
});

test('merely open channels, synthetic ACKs, or bytes without selected routing cannot establish real native transport evidence',()=>{
  const pair=playerId=>({playerId,everSelected:true,pose:{received:1,aheadOfControl:0},control:{received:1,acknowledged:1,orderViolations:0},
    stats:{channels:[{label:'input',bytesSent:1,bytesReceived:1},{label:'control',bytesSent:1,bytesReceived:1}]}});
  const report={players:2,fault:'none',final:[{playerId:0,errors:[],pairs:[pair(1)]},{playerId:1,errors:[],pairs:[pair(0)]}]};
  assert.equal(assessNativeRtcEvidence(report).passed,true);
  report.final[0].pairs[0].everSelected=false;assert.ok(assessNativeRtcEvidence(report).reasons.includes('unproven-selected-route:0/1'));
  report.final[0].pairs[0].everSelected=true;report.final[0].pairs[0].control.acknowledged=0;
  assert.ok(assessNativeRtcEvidence(report).reasons.includes('missing-application-delivery:0/1'));
  report.final[0].pairs[0].control.acknowledged=1;report.final[0].pairs[0].stats.channels[0].bytesReceived=0;
  assert.ok(assessNativeRtcEvidence(report).reasons.includes('missing-native-channel-bytes:0/1'));
});

test('a declared critical-late experiment must actually expose the separate-channel ordering boundary',()=>{
  const report={players:2,fault:'critical-late',final:[]};
  assert.ok(assessNativeRtcEvidence(report).reasons.includes('cross-channel-order-fault-not-observed'));
});

test('final route observer retries fresh same-PC evidence, preserves gaps and never substitutes historical selection',async()=>{
  const proven=[{id:'t',type:'transport',selectedCandidatePairId:'p'},{id:'p',type:'candidate-pair',state:'succeeded',localCandidateId:'l',remoteCandidateId:'r'},
    {id:'l',type:'local-candidate',candidateType:'host',address:'private-address'},{id:'r',type:'remote-candidate',candidateType:'host'}];
  let requests=0,waits=0;
  const pc={connectionState:'connected',async getStats(){requests++;return new Map((requests===1?[]:proven).map(row=>[row.id,row]));}};
  const observed=await collectNativeRtcStats(pc,{retryMissingSelection:true,pause:async ms=>{assert.equal(ms,25);waits++;}});
  assert.equal(requests,2);assert.equal(waits,1);assert.equal(observed.attempts[0].stats.selected,false);assert.equal(observed.attempts[1].stats.route,'direct');
  assert.doesNotMatch(JSON.stringify(observed.attempts),/private-address/);
  requests=0;pc.getStats=async()=>{requests++;return new Map();};
  const missing=await collectNativeRtcStats(pc,{retryMissingSelection:true,pause:async()=>{}});
  assert.equal(requests,3);assert.equal(missing.attempts.length,3);assert.equal(summarizeNativeRtcStats(missing.rawStats).selected,false);
  requests=0;await collectNativeRtcStats(pc);assert.equal(requests,1,'periodic observer remains one request');
  requests=0;pc.connectionState='closed';await collectNativeRtcStats(pc,{retryMissingSelection:true});assert.equal(requests,1,'closed PC has no fresh route retry');
});

test('current control fallback or unintended restart cannot pass by retaining historical native bytes and canonical admissions',()=>{
  const healthy=()=>({playerId:'a',transport:{ownerFatal:null,peerControls:{b:{negotiated:true,failed:false,degraded:false,frontierComplete:true,creditLimit:4,inflightPackets:4,wire:{encodeFailures:0,decodeFailures:0}}},peerActionLedgers:{b:{disabled:false}},peerRestarts:{}}});
  let peer=healthy();assert.deepEqual(assessOnlinePeerHealth(peer),[]);
  peer.transport.peerControls.b.failed=true;assert.ok(assessOnlinePeerHealth(peer).includes('current-control-unhealthy:a/b'));
  peer=healthy();peer.transport.peerControls.b.degraded=true;assert.ok(assessOnlinePeerHealth(peer).includes('current-control-unhealthy:a/b'));
  peer=healthy();peer.transport.peerRestarts.b=1;assert.ok(assessOnlinePeerHealth(peer).includes('unexpected-peer-restart:a/b'));
  assert.deepEqual(assessOnlinePeerHealth(peer,{fault:'one-pair-close',closedDirectedPairs:['a/b']}),[]);
  assert.ok(assessOnlinePeerHealth(peer,{fault:'one-pair-close',closedDirectedPairs:['a/c']}).includes('unexpected-peer-restart:a/b'));
  peer=healthy();peer.transport.peerActionLedgers.b.disabled=true;assert.ok(assessOnlinePeerHealth(peer).includes('peer-ledger-disabled:a/b'));
  peer=healthy();peer.transport.peerControls.b.inflightPackets=5;assert.ok(assessOnlinePeerHealth(peer).includes('native-control-credit-invalid:a/b'));
});

test('three 2v2 room bootstrap accounts for the real coordinator consecutive7s/11s deadlines without changing network bounds',async t=>{
  let stamp=0;const matches=[];
  const online=createOnlineService({versions:{fixture:true},now:()=>stamp,random:()=>.5,
    accountStore:{},driverFactory:({match})=>{matches.push(match);return {submitInput(){},stop(){}};}});
  t.after(()=>online.close());
  for(let id=0;id<12;id++)await online.join('fixture-'+id,'gm',{loadout:Array(8).fill(null)},'2v2');
  stamp=12000;await online.tick();assert.equal(matches.length,1);
  const waiting=()=>Array.from({length:12},(_,id)=>online.status('fixture-'+id)).find(s=>s.queue.joinedAt!==null);
  assert.equal(waiting().queue.deadline,19000);
  stamp=18999;await online.tick();assert.equal(matches.length,1);
  stamp=19000;await online.tick();assert.equal(matches.length,2);assert.equal(waiting().queue.deadline,30000);
  stamp=27000;await online.tick();assert.equal(matches.length,2,'old fifteen-second fixture wait ends before third matching deadline');
  stamp=30000;await online.tick();assert.equal(matches.length,3);assert.equal(online.roomCapacityStatus().activeRooms,3);
  const wait=multiRoomMatchWait('2v2',3);assert.equal(wait.normalQueueWaitMs,30000-12000);assert.equal(wait.timeoutMs,22000);
  assert.equal(multiRoomMatchWait('2v2',1).timeoutMs,15000);assert.equal(multiRoomMatchWait('3v3',2).timeoutMs,15000);
  assert.throws(()=>multiRoomMatchWait('2v2',4),/invalid-fixture-room-layout/);
});
