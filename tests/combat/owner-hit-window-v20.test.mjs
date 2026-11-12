/** Synthetic accepted source-frame identities isolate receiver ledger capacity.
 * Counts use the public owner schema limit; this is not an original cast trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {MAX_OWNER_EFFECTS,OWNER_ACTION_HISTORY_FRAMES} from '../../packages/online/owned-state.mjs';
function fixture(){
  const actor={id:'sender',state:'ATTACK',stateSerial:7,hits:{},hitGaps:{}};
  const simulation={profile:{states:{ATTACK:{raw:{}}}},state:{actors:[actor],effects:[]}};
  const consumer=createRemoteActionConsumer({clock:()=>0});
  const effect=(id,frame,hits={})=>({ownerId:'sender',networkId:id,networkEpoch:1,networkFrameSeq:frame,
    stage:0,damage:{},hits,hitGaps:{receiver:.25}});
  const report=(frame,effects)=>{assert.equal(consumer.receive('sender',[],1,frame),true);
    simulation.state.effects=effects;consumer.remember(simulation,'receiver',()=>1);};
  return {consumer,simulation,effect,report};
}
test('a retired accepted effect survives more than192 distinct source effects inside60 source frames',()=>{
  const f=fixture();f.report(1,[f.effect(1,1,{receiver:1})]);
  for(let frame=2;frame<=4;frame++)f.report(frame,Array.from({length:MAX_OWNER_EFFECTS},(_,i)=>f.effect(1000+frame*MAX_OWNER_EFFECTS+i,frame)));
  const reconstructed=f.effect(1,5);f.report(5,[reconstructed]);
  assert.equal(reconstructed.hits.receiver,1,'new temporary/live objects reconnect the existing accepted collision');
  assert.equal(reconstructed.hitGaps.receiver,.25);assert.ok(f.consumer.diagnostics.effectReceipts>192);
  f.consumer.clear();
});
test('live receiver hit receipts stay protected while ended receipts expire after the supported source window',()=>{
  const f=fixture(),live=f.effect(1,1,{receiver:1});f.report(1,[live]);
  for(let frame=2;frame<=70;frame++){
    const restored=f.effect(1,frame);
    f.report(frame,[restored,...Array.from({length:MAX_OWNER_EFFECTS-1},(_,i)=>f.effect(1000+frame*MAX_OWNER_EFFECTS+i,frame))]);
    assert.equal(restored.hits.receiver,1,'the current live source ID cannot lose its receipt');
  }
  assert.ok(f.consumer.diagnostics.effectReceipts<=MAX_OWNER_EFFECTS*(OWNER_ACTION_HISTORY_FRAMES+1));
  for(let frame=71;frame<=70+OWNER_ACTION_HISTORY_FRAMES+1;frame++)f.report(frame,[]);
  assert.equal(f.consumer.diagnostics.effectReceipts,0,'retired identities leave after their final supported source frame');
  const fresh=f.effect(1,132);fresh.networkEpoch=2;
  f.consumer.receive('sender',[],2,132);f.simulation.state.effects=[fresh];f.consumer.remember(f.simulation,'receiver',()=>2);
  assert.deepEqual(fresh.hits,{},'a new life remains a distinct collision identity');f.consumer.clear();
});
test('a new life source-frame counter cannot inherit the previous actor life frame watermark',()=>{
  const f=fixture(),actor=f.simulation.state.actors[0];Object.assign(actor,{networkFrameSeq:500,networkFrameEpoch:1});
  const remember=(frame,effects)=>{assert.equal(f.consumer.receive('sender',[],2,frame),true);f.simulation.state.effects=effects;f.consumer.remember(f.simulation,'receiver',()=>2);};
  const first=f.effect(1,1,{receiver:1});first.networkEpoch=2;remember(1,[first]);remember(2,[]);
  const reconstructed=f.effect(1,3);reconstructed.networkEpoch=2;remember(3,[reconstructed]);
  assert.equal(reconstructed.hits.receiver,1,'same new-life source ID remains in its own frame window');f.consumer.clear();
});
