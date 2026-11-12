/** Original Web resource callbacks plus presentation-only owner delivery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addFixture} from '../helpers/add-fixture.mjs';
import {addTargetSkillEvents} from '../../packages/combat-core/add-target-skills.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {encodeNetworkBinary,decodeNetworkBinary} from '../../packages/online/network-binary.mjs';
import {createRemoteCombatPlayback} from '../../apps/web/remote-combat-playback.mjs';
import {captureForceFingerResourceNumbers,receiveForceFingerResourceNumbers} from '../../packages/online/force-finger-resource-numbers-v49.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {emitForceFingerResourceNumbers} from '../../apps/web/damage-number-layout.mjs';
const manifest=JSON.parse(readFileSync(new URL('../../artifacts/ui/damage-numbers/manifest.json',import.meta.url)));
function fixture(owner='add'){
 const f=addFixture('DE',{skillId:29215,targetProfession:'LK',networkOwnerId:owner});
 f.sim.networkCombatPlaybackVersion=1;f.sim.networkEpochFor=id=>id==='add'?3:7;
 f.a.mp=100;f.b.mp=6;f.b.x=250;f.sim.drainEvents();return f;
}
function event(f){
 f.a.skillId=29215;f.sim.enter(f.a,f.sim.skill(29215,f.a).state,'force-finger-resource-fixture');
 f.a.animationTime=.272;f.a.stateTime=.272;addTargetSkillEvents(f.sim,f.a,.270,.272);
 return f.sim.drainEvents();
}
function packet(f,owner,events,epoch,frameSeq){
 const producer=createCombatPlaybackProducer({version:1});
 const action=producer.capture(f.sim,owner,{epoch,frameSeq,events});assert.ok(action);
 const report=encodeOwnedState(f.sim,owner,{epoch,frameSeq});report.actions=[action];
 const wire=decodeNetworkBinary(encodeNetworkBinary(report));validateOwnedState(wire);
 validateOwnedReferences(wire,f.sim.actor(owner),f.sim.profileFor(f.sim.actor(owner)),f.sim.map,{profiles:f.sim.profiles,actors:f.sim.state.actors});return wire;
}
test('both owner-confirmed Force Finger numbers reach the other browser once and never reapply MP',()=>{
 const caster=fixture('add'),victim=fixture('target');
 const blue=packet(caster,'add',event(caster),3,10),red=packet(victim,'target',event(victim),7,10);
 assert.equal(caster.a.mp,145);assert.equal(caster.b.mp,6);assert.equal(victim.a.mp,100);assert.equal(victim.b.mp,0);
 assert.equal(blue.actor.sourceForceFingerResourceNumbers.receipts[0].amount,45);
 assert.equal(red.actor.sourceForceFingerResourceNumbers.receipts[0].amount,6,'only actual capped resource loss is shown');
 assert.ok(blue.actions[0].actor.sourceForceFingerResourceNumbers);assert.ok(red.actions[0].actor.sourceForceFingerResourceNumbers);
 const playback=createRemoteCombatPlayback({clock:()=>0});playback.bind(victim.sim,'target',victim.sim.networkEpochFor);
 playback.receiveActions('add',blue.actions,3,10);playback.observeState(victim.sim,'add',blue,'target');
 playback.beforeStep(victim.sim,'target',victim.sim.networkEpochFor);
 const incomingBlue=victim.sim.drainEvents().filter(e=>e.type==='addForceFingerTransfer'&&e.networkArrival);
 assert.equal(incomingBlue.length,1);assert.equal(incomingBlue[0].restored,45);assert.equal(victim.b.mp,0);
 applyOwnedState(caster.sim,'target',red);applyOwnedState(caster.sim,'target',red);
 const incomingRed=caster.sim.drainEvents().filter(e=>e.type==='addForceFingerRecipient'&&e.networkArrival);
 assert.equal(incomingRed.length,1);assert.equal(incomingRed[0].drain,6);assert.equal(caster.a.mp,145);
 playback.observeState(victim.sim,'add',blue,'target');assert.equal(victim.sim.drainEvents().filter(e=>e.networkArrival&&e.type==='addForceFingerTransfer').length,0);
 const runtime=createEffectRuntime({index:manifest});
 assert.ok(emitForceFingerResourceNumbers(runtime,manifest,incomingRed[0])>0);assert.ok(emitForceFingerResourceNumbers(runtime,manifest,incomingBlue[0])>0);
 const particles=[...runtime.particles.values()];assert.ok(particles.some(p=>p.name==='PicCharRed'));assert.ok(particles.some(p=>p.name==='PicCharBlue'));
 playback.clear();
});
test('stale, old-life, DP, duplicate and malformed resource receipts cannot produce MP numbers',()=>{
 const source=fixture('add'),receiver=fixture('target'),events=event(source),report=packet(source,'add',events,3,10);
 const notice=report.actor.sourceForceFingerResourceNumbers;
 const receive=(n,frameSeq=10,age=0)=>receiveForceFingerResourceNumbers(receiver.sim,receiver.a,n.epoch,n,{frameSeq,presentationAge:age});
 assert.equal(receive(notice,131),false);assert.equal(receive(notice),false,'expired delivery is consumed');
 assert.equal(receiver.sim.drainEvents().filter(e=>e.networkArrival).length,0);
 receiver.sim.state.localOwnerForceFingerResourceNumberReceipts=[];
 receiver.sim.networkEpochFor=id=>id==='add'?4:7;assert.equal(receive(notice),false,'old caster life cannot show on a respawn');
 assert.equal(receiver.sim.drainEvents().filter(e=>e.networkArrival).length,0);
 const raw=fixture('add');assert.equal(captureForceFingerResourceNumbers(raw.sim,raw.a,{epoch:3,frameSeq:10,
  events:[{type:'addForceFingerTransfer',actorId:'add',resource:'DP',restored:45,position:[0,3130,0]}]}),false);
 for(const mutate of [p=>p.actor.sourceForceFingerResourceNumbers.receipts[0].amount=46,
  p=>p.actor.sourceForceFingerResourceNumbers.receipts[0].amount=-1,
  p=>p.actor.sourceForceFingerResourceNumbers.receipts[0].position[1]=Infinity,
  p=>p.actor.sourceForceFingerResourceNumbers.receipts[0].kind='mp-write',
  p=>p.actor.sourceForceFingerResourceNumbers.receipts[0].extra='unsupported',
  p=>p.actor.sourceForceFingerResourceNumbers.receipts.push(...p.actor.sourceForceFingerResourceNumbers.receipts,...p.actor.sourceForceFingerResourceNumbers.receipts,...p.actor.sourceForceFingerResourceNumbers.receipts)]){
  const bad=structuredClone(report);delete bad.actions;mutate(bad);assert.throws(()=>validateOwnedState(bad),/invalid-owner/);
 }
 const foreign=structuredClone(report);delete foreign.actions;foreign.actor.sourceForceFingerResourceNumbers.receipts[0].casterId='target';
 assert.throws(()=>validateOwnedReferences(foreign,source.a,source.sim.profileFor(source.a),source.sim.map,{profiles:source.sim.profiles,actors:source.sim.state.actors}),/Force Finger/);
 assert.equal(encodeOwnedState(source.sim,'add',{epoch:3,frameSeq:131}).actor.sourceForceFingerResourceNumbers,undefined);
 assert.equal(encodeOwnedState(source.sim,'add',{epoch:4,frameSeq:1}).actor.sourceForceFingerResourceNumbers,undefined);
});
