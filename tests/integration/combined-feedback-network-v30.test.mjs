/** New feedback carriers through the merged v9 codecs and actual Native poses.
 * This is web ownership equivalence, not a target-client or WAN trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {createPeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';

const dt=1/60;
const bloodSource=JSON.parse(readFileSync(new URL('../../contracts/elesis-blood-cutter-delay-v37.json',import.meta.url),'utf8'));
const bloodRequestDelay=Buffer.from(bloodSource.request.delay.hex,'hex').readFloatLE();
const [bloodNpcEffectTime,bloodNpcMotionTime]=bloodSource.npcScript.numbers;
function advance(f,count,input={}){
  for(let i=0;i<count;i++)f.sim.step(dt,{[f.a.id]:input},{snapshot:false});
}
const owner=(f,frame)=>encodeOwnedState(f.sim,f.a.id,{epoch:1,frameSeq:frame});
const wire=value=>JSON.parse(JSON.stringify(value));

for(const facing of [-1,1])test(`CA ${facing} independent Blood Cutter survives pose loss, upload delta and reliable action compression`,()=>{
  const f=elesisFixture('CA',{skillId:28023,gap:500,facing}),receiver=elesisFixture('CA',{skillId:28023,gap:500,facing});
  const poseSender=createOwnerPoseDelta(),poseReceiver=createOwnerPoseDelta();
  const uploadSender=createOwnerUploadDelta(),uploadReceiver=createOwnerUploadDelta();
  const controlSender=createPeerControlDelta(),controlReceiver=createPeerControlDelta();
  const base=owner(f,1),full=poseSender.encode(base),initial=poseReceiver.decode(wire(full));initial.commit();
  const uploadedBase=uploadReceiver.decode(wire(uploadSender.encode(base)));uploadedBase.commit();
  assert.equal(uploadSender.acknowledge(uploadedBase.ownerReceipt),true);
  assert.equal(bloodRequestDelay,Math.fround(.3),'independent captured request argument');
  assert.equal(bloodNpcEffectTime,.01,'independent original NPC script gate');
  assert.equal(bloodNpcMotionTime,.1,'independent original NPC motion gate');
  const carrier=()=>f.sim.state.effects.find(effect=>effect.sourceElesisBloodCutter&&!effect.dead);
  advance(f,1,{pressed:['A']});
  for(let i=0;i<30&&!f.a.sourceElesisBloodCutterRequests;i++)advance(f,1);
  assert.ok(f.a.sourceElesisBloodCutterRequests,'real caster callback must queue the NPC request');
  assert.equal(carrier(),undefined,'the temporary caster dummy is not the eventual carrier');
  // The source PvP frame consumer runs after unit processing, so the first
  // observed request has already consumed this frame's float elapsed. Derive
  // the remaining clock from sealed source bytes, never from a live value.
  let remaining=Math.fround(bloodRequestDelay-Math.fround(dt));
  assert.equal(f.a.sourceElesisBloodCutterRequests[0].remaining,remaining);
  for(let i=0;i<Math.ceil(bloodRequestDelay/dt)+2&&remaining>0;i++){
    assert.equal(carrier(),undefined,'the original request delay must not emit early');
    advance(f,1);remaining=Math.max(0,Math.fround(remaining-Math.fround(dt)));
    const queued=f.a.sourceElesisBloodCutterRequests?.[0];assert.ok(queued);
    if(remaining>0){assert.equal(queued.phase,'request');assert.equal(queued.remaining,remaining);}
    else{assert.equal(queued.phase,'npc');assert.equal(queued.remaining,Math.fround(bloodNpcEffectTime));}
  }
  assert.equal(remaining,0);assert.equal(carrier(),undefined,'NPC .01 is a separate timer after the .3 request');
  for(let i=0;i<Math.ceil(bloodNpcEffectTime/dt)+1&&!carrier();i++)advance(f,1);
  const born=owner(f,f.sim.state.step+1);
  assert.ok(born.effects.some(effect=>effect.sourceElesisBloodCutter));
  // Deliberately lose this birth pose. The next independently decodable packet
  // must still carry that real projectile's source metadata and mesh anchor.
  poseSender.encode(born,{acknowledgedEpoch:1,acknowledgedFrameSeq:1});
  const bornX=carrier().currentAnchor.position[0];
  // Original NPC speed is 2000 after its own .1 gate. Bound the wait using
  // that source schedule and require actual forward travel before encoding.
  const movementBound=Math.ceil((bloodNpcMotionTime+100/2000)/dt)+2;
  for(let i=0;i<movementBound&&(carrier().currentAnchor.position[0]-bornX)*facing<=100;i++)advance(f,1);
  assert.ok((carrier().currentAnchor.position[0]-bornX)*facing>100,'the independently delayed carrier must actually move');
  const moved=owner(f,f.sim.state.step+1);
  const decoded=poseReceiver.decode(wire(poseSender.encode(moved,{acknowledgedEpoch:1,acknowledgedFrameSeq:1})));
  assert.deepEqual(decoded.report,validateOwnedState(moved));decoded.commit();
  validateOwnedReferences(decoded.report,receiver.a,receiver.profile,receiver.map);
  applyOwnedState(receiver.sim,receiver.a.id,decoded.report);
  const original=f.sim.state.effects.find(effect=>effect.sourceElesisBloodCutter);
  const restored=receiver.sim.state.effects.find(effect=>effect.sourceElesisBloodCutter);
  assert.deepEqual(restored.currentAnchor.position,original.currentAnchor.position);
  assert.deepEqual(restored.currentAnchor.rotation,original.currentAnchor.rotation);
  assert.equal(restored.currentAnchor.facing,original.currentAnchor.facing);
  assert.deepEqual(restored.sourceElesisBloodCutter,wire(original.sourceElesisBloodCutter));
  const upload=uploadReceiver.decode(wire(uploadSender.encode(moved)));
  assert.deepEqual(upload.report,validateOwnedState(moved));upload.commit();
  const action=validateOwnedState({...moved,actions:[encodeCriticalAction(moved,{id:1,effectIds:new Set(moved.effects.map(e=>e.id))})]});
  const control=validateOwnedState(controlReceiver.decode(wire(controlSender.encode(action))));
  assert.deepEqual(control.actions,action.actions);
  assert.ok(control.actions[0].effects.some(effect=>effect.sourceElesisBloodCutter));
  assert.equal(control.effects.length,0,'reliable carrier retains action effects without duplicating pose effects');
  assert.ok(poseSender.performance().deltaSent>0);
});

for(const dash of [false,true])test(`GM Leap ${dash?'dash':'standing'} launch metadata survives negotiated owner delta`,()=>{
  const f=elesisFixture('GM',{skillId:28204,gap:10000}),receiver=elesisFixture('GM',{skillId:28204,gap:10000});
  if(dash)f.sim.enter(f.a,'RSI_DASH','sourced dash precondition');
  const sender=createOwnerUploadDelta(),decoder=createOwnerUploadDelta();
  const initial=decoder.decode(wire(sender.encode(owner(f,1))));initial.commit();sender.acknowledge(initial.ownerReceipt);
  advance(f,1,{pressed:['A'],held:dash?['RIGHT']:[]});advance(f,11);const launched=owner(f,13);
  assert.equal(launched.actor.sourceElesisSkills.leapFromDash,dash);
  const decoded=decoder.decode(wire(sender.encode(launched)));decoded.commit();
  assert.deepEqual(decoded.report,validateOwnedState(launched));
  validateOwnedReferences(decoded.report,receiver.a,receiver.profile,receiver.map);
  applyOwnedState(receiver.sim,receiver.a.id,decoded.report);
  assert.equal(receiver.a.sourceElesisSkills.leapFromDash,dash);
  assert.equal(receiver.a.y,f.a.y);assert.equal(receiver.a.vx,f.a.vx);assert.equal(receiver.a.vy,f.a.vy);
});
