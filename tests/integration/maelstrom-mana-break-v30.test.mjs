/** Actual Native geometry through production owner codecs and late actions.
 * Web regression; target-client timing/network goldens are not available. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {make,profile} from '../fixtures/is-native-simulation.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,applyOwnedState} from '../../packages/online/owned-state.mjs';
const wire=value=>JSON.parse(JSON.stringify(value));
const step=(sim,count)=>{for(let i=0;i<count;i++)sim.step(1/60,{}, {snapshot:false});};

test('original Maelstrom declaration permits break and original down rows declare invincibility',()=>{
  const effect=profile.damageEffects.ELSWORD_MAELSTROM;
  assert.ok(effect);assert.equal(effect.raw.DAMAGE_DATA.NO_DETONATION,undefined);
  for(const name of ['RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_DOWN_LANDING']){
    assert.deepEqual(Object.values(profile.states[name].raw.INVINCIBLE),[0,100]);
  }
});

for(const facing of [-1,1])test(`actual Maelstrom ${facing}: delayed pre-break witness cannot undo paid down immunity`,()=>{
  const source=make({skillId:21024,facing}),receiver=make({skillId:21024,facing});
  receiver.networkOwnerId='target';const target=receiver.actor('target'),consumer=createRemoteActionConsumer({clock:()=>0}),epoch=()=>1;
  const receiptObservations=[],collisionReceipts=receiver.collisionReceipts.bind(receiver);
  receiver.collisionReceipts=(...args)=>{const result=collisionReceipts(...args);if(args[2]?.kind==='effect')receiptObservations.push({name:args[1].name,
    time:receiver.state.time,sourceMemory:structuredClone(result.sourceHitMemory2016),hits:structuredClone(result.hits)});return result;};
  consumer.bind(receiver,'target',epoch);consumer.rememberVictim(receiver,'target',1,6);
  const oldView={playerId:'target',epoch:1,frameSeq:6,position:[target.x,target.y,target.z]};
  const upload=createOwnerUploadDelta(),uploadReceiver=createOwnerUploadDelta(),control=createPeerControlDelta(),controlReceiver=createPeerControlDelta();
  const base=encodeOwnedState(source,'is',{epoch:1,frameSeq:1}),initial=uploadReceiver.decode(wire(upload.encode(base)));
  initial.commit();assert.equal(upload.acknowledge(initial.ownerReceipt),true);
  target.mp=300;target.manaBreak.charge=100;
  source.step(1/60,{is:{pressed:['A']}},{snapshot:false});step(source,43);
  const receive=(frame,id,view=oldView)=>{
    const state=encodeOwnedState(source,'is',{epoch:1,frameSeq:frame}),decoded=uploadReceiver.decode(wire(upload.encode(state)));
    assert.deepEqual(decoded.report,validateOwnedState(state));decoded.commit();upload.acknowledge(decoded.ownerReceipt);
    // The state receiver installs its live foreign carrier independently of
    // historical action samples. Original hit-memory TTL advances only with
    // that carrier's actual delta; a dt0 witness cannot age it by wall clock.
    applyOwnedState(receiver,'is',decoded.report);
    const packet=validateOwnedState({...state,actions:[encodeCriticalAction(state,{id,effectIds:new Set(state.effects.map(e=>e.id)),targetViews:[view]})]});
    const reliable=validateOwnedState(controlReceiver.decode(wire(control.encode(packet))));
    assert.deepEqual(reliable.actions,packet.actions);
    assert.equal(consumer.receive('is',reliable.actions,1,frame),true);assert.equal(consumer.consume(receiver,'target',epoch),1);
    return receiver.drainEvents();
  };
  try{
    const first=receive(44,1),cost=first.filter(e=>e.type==='manaBreakTriggered');
    assert.equal(cost.length,1);assert.equal(cost[0].cost,100);
    assert.equal(first.filter(e=>e.type==='manaBreakConsumed').length,0);
    assert.equal(target.invincible,true);assert.ok(target.manaBreak.pendingDown,'V61 future-down protection holds last hit first');
    const live=receiver.state.effects.find(e=>e.ownerId==='is'&&e.name==='ELSWORD_MAELSTROM');assert.ok(live);
    step(receiver,12);step(source,12);receiver.drainEvents();
    assert.equal(live.sourceHitMemory2016.length,0,'live global-time carrier expires its original .166 contact record during .2 seconds');
    const protectedState={state:target.state,serial:target.stateSerial,hp:target.hp,mp:target.mp};
    const late=receive(56,2);
    assert.deepEqual({state:target.state,serial:target.stateSerial,hp:target.hp,mp:target.mp},protectedState);
    assert.equal(target.invincible,true);assert.equal(late.filter(e=>e.type==='hit').length,0);
    assert.equal(late.filter(e=>e.type==='manaBreakConsumed').length,0);
    assert.equal(consumer.diagnostics.victimProtection.reactionInvincibility,1);
    // Source-native immunity itself rejects an unreferenced late action too.
    const state=encodeOwnedState(source,'is',{epoch:1,frameSeq:57});
    consumer.receive('is',[encodeCriticalAction(state,{id:3,effectIds:new Set(state.effects.map(e=>e.id))})],1,57);consumer.consume(receiver,'target',epoch);
    assert.equal(target.hp,protectedState.hp);
    for(let n=0;n<60&&target.manaBreak.pendingDown;n++)step(receiver,1);
    assert.equal(target.manaBreak.pendingDown,undefined);assert.equal(receiver.drainEvents().filter(e=>e.type==='manaBreakConsumed').length,1);
    // End the recovery via the normal controller entry to isolate expiry from
    // movement. A fresh vulnerable witness admits the same live vortex again.
    receiver.enter(target,'RSI_WAIT','test-current-recovery-ended');target.forceInvincible=0;
    assert.equal(target.invincible,false);consumer.rememberVictim(receiver,'target',1,50);
    const newView={playerId:'target',epoch:1,frameSeq:50,position:[target.x,target.y,target.z]};
    step(source,12);const after=receive(68,4,newView);
    assert.equal(after.filter(e=>e.type==='hit').length,1,JSON.stringify({after,diagnostics:consumer.diagnostics,receiptObservations,
      target:{state:target.state,x:target.x,y:target.y,z:target.z,grounded:target.grounded,lineId:target.lineId,animationTime:target.animationTime},
      source:{time:source.state.time,effects:source.state.effects.map(e=>({name:e.name,time:e.time,position:e.position,scale:e.scale}))},witness:newView}));assert.ok(target.hp<protectedState.hp);
    assert.equal(after.filter(e=>e.type==='manaBreakConsumed').length,0,'original payment is never repeated');
  }finally{consumer.clear();}
});
