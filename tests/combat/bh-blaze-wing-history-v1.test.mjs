import test from 'node:test';
import assert from 'node:assert/strict';
import {blazeWingHistoryFor,blazeWingSelectionSerialFor,recordBlazeWingSelection,receiveBlazeWingHistory}
  from '../../packages/combat-core/bh-blaze-wing-history.mjs';
const damage='DamageEffect_SBH_Blaze_Wing_Sub';
const make=(networkOwnerId=null)=>({networkOwnerId,state:{actors:['local','remote-a','remote-b','victim'].map(id=>({id,hp:100}))}});
const effect=(selectionSerial,historySnapshot,extra={})=>({name:damage,sourceBlazeWingLockOn:{selectionSerial,historySnapshot},...extra});
const report=(frameSeq,effects,epoch=0)=>({epoch,frameSeq,effects});
const receive=(sim,owner,frame,serial,history,epoch=0)=>receiveBlazeWingHistory(sim,owner,report(frame,[effect(serial,history)],epoch));

test('offline owners share the native game-global exclusion set and decision serial',()=>{
  const sim=make(),history=blazeWingHistoryFor(sim,'local');history.push('victim');
  assert.equal(blazeWingHistoryFor(sim,'remote-a'),history);
  assert.equal(recordBlazeWingSelection(sim,'local'),1);
  assert.equal(recordBlazeWingSelection(sim,'remote-a'),2);
  assert.equal(blazeWingSelectionSerialFor(sim,'local'),2);
  assert.equal(sim.state.sourceBlazeWingMirrors,undefined);
  assert.equal(receive(sim,'remote-a',1,20,[]),false);
  assert.deepEqual(history,['victim']);
});
test('network local and each remote owner have independent history and serial domains',()=>{
  const sim=make('local');
  for(const owner of ['local','remote-a','remote-b']){blazeWingHistoryFor(sim,owner).push('victim');recordBlazeWingSelection(sim,owner);}
  blazeWingHistoryFor(sim,'remote-a').length=0;recordBlazeWingSelection(sim,'remote-a');
  assert.deepEqual(sim.state.sourceBlazeWingPreviousTargets,['victim']);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-b'),['victim']);
  assert.equal(blazeWingSelectionSerialFor(sim,'local'),1);
  assert.equal(blazeWingSelectionSerialFor(sim,'remote-a'),2);
  assert.equal(blazeWingSelectionSerialFor(sim,'remote-b'),1);
});
test('full receive chooses maximum packet serial, copies history, and cannot reset other owners',()=>{
  const sim=make('local'),history=['victim','remote-b'];
  blazeWingHistoryFor(sim,'local').push('victim');recordBlazeWingSelection(sim,'local');
  assert.equal(receive(sim,'remote-b',30,100,['remote-a']),true);
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(20,[effect(5,['victim']),effect(8,history),effect(7,[])])),true);
  history.length=0;
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-a'),['victim','remote-b']);
  assert.equal(blazeWingSelectionSerialFor(sim,'remote-a'),8);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-b'),['remote-a']);
  assert.equal(blazeWingSelectionSerialFor(sim,'remote-b'),100);
  assert.deepEqual(sim.state.sourceBlazeWingPreviousTargets,['victim']);
  assert.equal(sim.state.sourceBlazeWingSelectionSerial,1);
});
test('partial replay, duplicate and older reports cannot mutate receipt or predicted history',()=>{
  const sim=make('local');receive(sim,'remote-a',10,2,['victim'],1);
  blazeWingHistoryFor(sim,'remote-a').push('remote-b');recordBlazeWingSelection(sim,'remote-a');
  const before=structuredClone(sim.state);
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(100,[effect(100,[])],2),{endMissing:false}),false);
  assert.equal(receive(sim,'remote-a',10,100,[],1),false);
  assert.equal(receive(sim,'remote-a',9,100,[],1),false);
  assert.equal(receive(sim,'remote-a',999,100,[],0),false);
  assert.deepEqual(sim.state,before);
});
test('new authoritative frames can correct prediction to a lower serial, including an empty set',()=>{
  const sim=make('local');receive(sim,'remote-a',10,2,['victim']);
  for(let i=0;i<5;i++)recordBlazeWingSelection(sim,'remote-a');
  assert.equal(receive(sim,'remote-a',11,3,[]),true);
  assert.equal(blazeWingSelectionSerialFor(sim,'remote-a'),3);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-a'),[]);
});
test('absent effects and actor death retain history while receipt watermarks still advance',()=>{
  const sim=make('local');receive(sim,'remote-a',10,2,['victim']);
  sim.state.actors.find(a=>a.id==='remote-a').hp=0;
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(12,[])),false);
  assert.equal(receive(sim,'remote-a',11,3,[]),false);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-a'),['victim']);
  assert.deepEqual(sim.state.localBlazeWingHistoryReceipts['remote-a'],{epoch:0,frameSeq:12});
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(0,[],1)),false);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-a'),['victim']);
  assert.equal(receive(sim,'remote-a',1,3,['remote-b'],1),true);
});
test('receipt state rolls back with snapshots and permits the same next authoritative frame again',()=>{
  const sim=make('local');receive(sim,'remote-a',7,3,['victim']);
  const seventh=structuredClone(sim.state);
  assert.equal(receive(sim,'remote-a',8,4,['victim','remote-b']),true);
  const eighth=structuredClone(sim.state);
  sim.state=structuredClone(seventh);
  assert.equal(receive(sim,'remote-a',8,4,['victim','remote-b']),true);
  assert.deepEqual(sim.state,eighth);
  sim.state=structuredClone(eighth);
  assert.equal(receive(sim,'remote-a',8,99,[]),false);
  assert.deepEqual(sim.state,eighth);
});
test('owner routing and current epoch reject unrelated or stale packets without creating state',()=>{
  const sim=make('local');sim.networkEpochFor=()=>2;const before=structuredClone(sim.state);
  assert.equal(receive(sim,'local',1,1,[],2),false);
  assert.equal(receive(sim,'outsider',1,1,[],2),false);
  assert.equal(receive(sim,'remote-a',1,1,[],1),false);
  assert.equal(receive(sim,'remote-a',1,1,[],3),false);
  assert.deepEqual(sim.state,before);
  assert.equal(receive(sim,'remote-a',0,1,['victim'],2),true);
});
test('malformed or contradictory histories do not partially update a mirror or watermark',()=>{
  const sim=make('local');receive(sim,'remote-a',1,1,['victim']);const before=structuredClone(sim.state);
  const bad=[effect(-1,[]),effect(1,['missing']),effect(1,['victim','victim']),effect(1,null),
    effect(1,[],{ownerId:'remote-b'}),effect(Number.MAX_SAFE_INTEGER+1,[])];
  for(const item of bad)assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(2,[effect(2,[]),item])),false);
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(2,[effect(2,[]),effect(2,['victim'])])),false);
  assert.deepEqual(sim.state,before);
});
test('roster IDs are own dictionary keys and unrelated effects never supply Blaze Wing histories',()=>{
  const sim=make('local');sim.state.actors.push({id:'__proto__',hp:100});
  assert.equal(receive(sim,'__proto__',1,2,['victim']),true);
  assert.equal(Object.getPrototypeOf(sim.state.sourceBlazeWingMirrors),Object.prototype);
  assert.deepEqual(blazeWingHistoryFor(sim,'__proto__'),['victim']);
  const before=structuredClone(blazeWingHistoryFor(sim,'remote-a'));
  assert.equal(receiveBlazeWingHistory(sim,'remote-a',report(1,[effect(999,[],{name:'unrelated'})])),false);
  assert.deepEqual(blazeWingHistoryFor(sim,'remote-a'),before);
});
