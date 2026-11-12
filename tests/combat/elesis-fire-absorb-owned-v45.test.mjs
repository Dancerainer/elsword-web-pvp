import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {encodeOwnedState,encodeCriticalAction,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {flushElesisFireAbsorbNotices,receiveElesisAvatarScan} from '../../packages/combat-core/elesis-fire-absorb-v45.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
const tick=f=>f.sim.step(1/60,{}, {snapshot:false});
function receive(f,id,p,options){validateOwnedState(p);validateOwnedReferences(p,f.sim.actor(id),f.sim.profileFor(f.sim.actor(id)),f.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});applyOwnedState(f.sim,id,p,options);}
function prepare(){
 const owner=elesisFixture('BH',{skillId:28208,gap:100}),victim=elesisFixture('BH',{skillId:28208,gap:100});
 for(const [f,id]of [[owner,'elesis'],[victim,'target']]){f.sim.networkOwnerId=id;f.sim.networkEpochFor=key=>key==='elesis'?2:3;f.a.mp=100;}
 victim.sim.state.nextEffectId=500000;owner.sim.step(1/60,{elesis:{pressed:['A'],held:['A']}},{snapshot:false});
 for(let i=0;i<200&&!owner.sim.state.effects.some(e=>e.name==='DamageEffect_SPK_Avatar_of_the_Fire_Damage2'&&e.active);i++)tick(owner);
 assert.ok(owner.sim.state.localOwnerElesisAvatarEffects?.length);
 const p=JSON.parse(JSON.stringify(encodeOwnedState(owner.sim,'elesis',{epoch:2,frameSeq:10})));
 victim.sim.grantBuff(victim.a,victim.b,294,1);victim.sim.grantBuff(victim.a,victim.b,301,1);
 receive(victim,'elesis',p);receiveElesisAvatarScan(victim.sim,victim.a);
 const remapped=victim.sim.state.effects.find(e=>e.name==='DamageEffect_SPK_Avatar_of_the_Fire_Damage2');assert.notEqual(remapped.id,remapped.networkId);
 assert.ok(victim.b.sourceElesisFireAbsorbNotice);assert.deepEqual(victim.b.sourceElesisFireAbsorbNotice.receipts[0].templateIds,[37,293]);
 const receipt=JSON.parse(JSON.stringify(encodeOwnedState(victim.sim,'target',{epoch:3,frameSeq:20})));
 return {owner,victim,receipt,p};
}
test('23 defender-owned original .01 radius scan refunds10 per identity once independently of the later Damage2 handle',()=>{
 const {owner,victim,receipt}=prepare(),before=owner.a.mp;
 assert.equal(owner.sim.state.events.some(e=>e.type==='elesisFireAbsorbed'),false,'caster speculative collision cannot credit');
 assert.ok(!victim.b.buffs.some(b=>[37,47,293].includes(b.templateId)));
 receive(owner,'target',receipt);assert.ok(Math.abs(owner.a.mp-before-20)<.0001);
 receive(owner,'target',receipt);assert.ok(Math.abs(owner.a.mp-before-20)<.0001);
 const snapshot=structuredClone(owner.sim.state);owner.sim.state=structuredClone(snapshot);
 receive(owner,'target',receipt);assert.ok(Math.abs(owner.sim.actor('elesis').mp-before-20)<.0001);
});
test('23 original cast identity prevents a forged new sequence or a different effect/state from duplicating MP',()=>{
 const {owner,receipt}=prepare(),before=owner.a.mp;receive(owner,'target',receipt);
 for(const patch of [{effectId:900000},{stateSerial:999},{}, {casterEpoch:1}]){
  const p=structuredClone(receipt),n=p.actor.sourceElesisFireAbsorbNotice;n.serial++;n.receipts=[{...n.receipts[0],...patch,serial:n.serial}];p.frameSeq++;
  receive(owner,'target',p);assert.ok(Math.abs(owner.a.mp-before-20)<.0001);
 }
});
test('23 stale sender life, dead caster and different caster life never credit a later resurrection',()=>{
 for(const mode of ['sender-life','dead','caster-life']){
  const {owner,receipt}=prepare(),before=owner.a.mp;
  if(mode==='sender-life'){const current=structuredClone(receipt);delete current.actor.sourceElesisFireAbsorbNotice;current.epoch=4;receive(owner,'target',current);
   // The ownership transport rejects stale reports before apply. Exercise the
   // receipt ledger independently by first installing a newer valid receipt.
   const newer=structuredClone(receipt);newer.epoch=4;newer.actor.sourceElesisFireAbsorbNotice.receipts[0].effectId=900000;receive(owner,'target',newer);
  }
  if(mode==='dead')owner.a.hp=0;
  if(mode==='caster-life')owner.sim.networkEpochFor=key=>key==='elesis'?4:3;
  receive(owner,'target',receipt);assert.equal(owner.a.mp,before,mode);
  owner.a.hp=owner.a.hpMax;owner.sim.networkEpochFor=key=>key==='elesis'?2:3;
  receive(owner,'target',receipt);assert.equal(owner.a.mp,before,mode);
 }
});
test('23 full and critical notice schema reject arbitrary amount, unknown templates, extra fields and caster references',()=>{
 const {owner,receipt}=prepare();
 for(const patch of [{amount:500},{templateIds:[37,37]},{templateIds:[371]},{casterId:'missing'},{skillId:28018}]){
  const p=structuredClone(receipt);Object.assign(p.actor.sourceElesisFireAbsorbNotice.receipts[0],patch);
  assert.throws(()=>receive(owner,'target',p));
  const q=structuredClone(receipt);q.actions=[encodeCriticalAction(p,{id:1,effectIds:new Set()})];assert.throws(()=>receive(owner,'target',q));
 }
});
test('23 replayed critical reaction cannot credit; current owner notice credits once after replay',()=>{
 const {owner,receipt}=prepare(),before=owner.a.mp,consumer=createRemoteActionConsumer({clock:()=>0});
 const action=encodeCriticalAction(receipt,{id:1,effectIds:new Set()});assert.deepEqual(action.actor.sourceElesisFireAbsorbNotice,receipt.actor.sourceElesisFireAbsorbNotice);
 consumer.remember(owner.sim,'elesis',id=>id==='elesis'?2:3);
 consumer.receive('target',[action],3,20);consumer.consume(owner.sim,'elesis',id=>id==='elesis'?2:3);
 assert.equal(owner.a.mp,before);receive(owner,'target',receipt);assert.ok(Math.abs(owner.a.mp-before-20)<.0001);consumer.clear();
});
test('23 roster transaction queues receipts until all life epochs are installed and discards failed transaction',()=>{
 const {owner,receipt}=prepare(),before=owner.a.mp;owner.sim.deferAddTimeRingNotices=true;
 receive(owner,'target',receipt);assert.equal(owner.a.mp,before);owner.sim.deferAddTimeRingNotices=false;flushElesisFireAbsorbNotices(owner.sim,{discard:true});assert.equal(owner.a.mp,before);
 owner.sim.deferAddTimeRingNotices=true;receive(owner,'target',receipt);owner.sim.deferAddTimeRingNotices=false;flushElesisFireAbsorbNotices(owner.sim);assert.ok(Math.abs(owner.a.mp-before-20)<.0001);
});
