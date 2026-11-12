/** Source-bound timing/ownership tests with a synthetic stationary bind bone.
 * These exercise queue clocks and wire lifecycles, not original NPC rendering
 * or original-client combat trajectories. Native contact has separate tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {requestBloodCutterCarrier,tickBloodCutterRequests,validateBloodCutterRequests} from '../../packages/combat-core/elesis-blood-cutter.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,mergeOwnedActionActor} from '../../packages/online/owned-state.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/ca-profile.json',import.meta.url)));
const original=JSON.parse(readFileSync(new URL('../../contracts/elesis-blood-cutter-delay-v37.json',import.meta.url)));
const carrier=f=>f.sim.state.effects.find(e=>e.ownerId===f.a.id&&e.sourceElesisBloodCutter&&!e.dead);
function fixture(){
 const sim=createSimulation({profile,map:{lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0]}]},
  preset:{passives:[],guildPassives:[],loadout:[{skillId:28023},...Array(7).fill(null)]},
  actors:[{id:'ca',professionId:'CA',team:0,x:10,y:0,z:0,lineId:0,facing:1},
   {id:'other',professionId:'CA',team:1,x:5000,y:0,z:0,lineId:0,facing:-1,loadout:Array(8).fill(null)}],
  effectBoneSampler:(e,_a,bone)=>bone==='Dummy01'?[...(e.currentAnchor?.position??[10,0,0])]:null});
 const a=sim.actor('ca');a.skillId=28023;a.skillScale=1.4;
 a.skillContext={level:1,branchId:'memo-52',traitPolicy:createSkillTraitPolicy(sim.skill(28023,a),'memo-52')};
 return {sim,a,profile,map:sim.map};
}
const step=f=>f.sim.step(1/60,{},{snapshot:false});
function report(f,epoch=0){const p=validateOwnedState(encodeOwnedState(f.sim,f.a.id,{epoch,frameSeq:f.sim.state.step}));
 validateOwnedReferences(p,f.a,profile,f.map,{actors:f.sim.state.actors,profiles:f.sim.profiles});return p;}
test('Blood original .3 request and NPC .01 emission are separate float timer boundaries',()=>{
 const f=fixture();requestBloodCutterCarrier(f.sim,f.a);
 assert.equal(Buffer.from(original.request.delay.hex,'hex').readFloatLE(),Math.fround(.3));
 assert.equal(carrier(f),undefined);assert.equal(f.a.sourceElesisBloodCutterRequests[0].remaining,Math.fround(.3));
 const dummy=f.sim.state.effects.find(e=>e.name==='DamageEffect_SI_SA_SCA_BLOOD_CUTTER_DUMMY');
 assert.ok(dummy?.dead);assert.equal(dummy.active,false,'temporary original DUMMY never becomes a stationary hitbox');
 tickBloodCutterRequests(f.sim,f.a,.299);assert.equal(carrier(f),undefined);
 tickBloodCutterRequests(f.sim,f.a,.00101);assert.equal(f.a.sourceElesisBloodCutterRequests[0].phase,'npc');assert.equal(carrier(f),undefined);
 tickBloodCutterRequests(f.sim,f.a,.009);assert.equal(carrier(f),undefined);
 tickBloodCutterRequests(f.sim,f.a,.00101);assert.ok(carrier(f));assert.equal(f.a.sourceElesisBloodCutterRequests,undefined);
 assert.ok(carrier(f).sourceElesisBloodCutter.npcAge>=.01);
});
test('Blood pending request freezes origin, direction, line, power and branch across other actions',()=>{
 const f=fixture();requestBloodCutterCarrier(f.sim,f.a);const requested=structuredClone(f.a.sourceElesisBloodCutterRequests[0]);
 f.sim.enter(f.a,'RSI_WAIT','later-action');Object.assign(f.a,{x:900,y:600,z:0,facing:-1,skillId:28214,skillScale:.25,skillContext:null});
 tickBloodCutterRequests(f.sim,f.a,.31);tickBloodCutterRequests(f.sim,f.a,.02);
 const e=carrier(f);assert.ok(e);assert.deepEqual(e.sourceElesisBloodCutter.origin,requested.origin);
 assert.deepEqual(e.sourceElesisBloodCutter.direction,requested.direction);assert.equal(e.facing,1);
 assert.equal(e.skillId,28023);assert.equal(e.powerMultiplier,1.4);assert.equal(e.traitPolicy.branchId,'memo-52');
 assert.equal(e.ownerStateSerial,requested.sourceStateSerial);
});
test('Blood game-frame delay runs through actor STOP without using animation speed',()=>{
 const f=fixture();requestBloodCutterCarrier(f.sim,f.a);f.a.hitStop=f.a.worldStop=2;f.a.animationSpeedOverride=10;
 const clock=f.a.animationTime;for(let i=0;i<18;i++)step(f);
 assert.equal(f.a.animationTime,clock);assert.equal(carrier(f),undefined,'request delay ends before the separate NPC timer');
 assert.equal(f.a.sourceElesisBloodCutterRequests[0].phase,'npc');step(f);assert.ok(carrier(f));
 for(let i=0;i<7;i++)step(f);assert.ok(carrier(f).sourceElesisBloodCutter.npcAge>.1);
 assert.ok(carrier(f).x>10,'NPC speed begins at its own .1 clock despite owner STOP');
});
test('Blood request rejects malformed queues, phases, branch, line and captured direction',()=>{
 const f=fixture();requestBloodCutterCarrier(f.sim,f.a);const source=structuredClone(f.a.sourceElesisBloodCutterRequests);
 for(const change of [r=>r.extra=1,r=>r.remaining=1,r=>r.phase='other',r=>r.npcElapsed=.1,r=>r.skillId=28214,
  r=>r.direction=[3,0,0],r=>r.lineId=999,r=>r.branchId='memo-unknown']){
  const queue=structuredClone(source);change(queue[0]);assert.throws(()=>validateBloodCutterRequests({sourceElesisBloodCutterRequests:queue},profile,f.map),/blood-cutter-request/);
 }
 const duplicate=[source[0],structuredClone(source[0])];assert.throws(()=>validateBloodCutterRequests({sourceElesisBloodCutterRequests:duplicate},profile,f.map),/blood-cutter-request/);
});
test('Blood pending full owner restore continues once with frozen payload and no surviving absent lifecycle',()=>{
 const owner=fixture(),receiver=fixture();requestBloodCutterCarrier(owner.sim,owner.a);tickBloodCutterRequests(owner.sim,owner.a,.1);
 const pending=report(owner);applyOwnedState(receiver.sim,receiver.a.id,pending);
 assert.deepEqual(receiver.a.sourceElesisBloodCutterRequests,owner.a.sourceElesisBloodCutterRequests);
 for(let i=0;i<25;i++){step(owner);step(receiver);}
 assert.equal(owner.sim.state.effects.filter(e=>e.sourceElesisBloodCutter).length,1);
 assert.equal(receiver.sim.state.effects.filter(e=>e.sourceElesisBloodCutter).length,1);
 assert.deepEqual(carrier(receiver).sourceElesisBloodCutter,carrier(owner).sourceElesisBloodCutter);
 const live=report(owner);applyOwnedState(receiver.sim,receiver.a.id,live);step(receiver);
 assert.equal(receiver.sim.state.effects.filter(e=>e.sourceElesisBloodCutter).length,1,'live owner report reconciles the existing local carrier');
 assert.equal(receiver.a.sourceElesisBloodCutterRequests,undefined);
 assert.equal(mergeOwnedActionActor({...pending.actor},live.actor).sourceElesisBloodCutterRequests,undefined);
});
test('Blood remote pending packets cannot locally issue another NPC, and epoch replacement clears old queue',()=>{
 const owner=fixture(),receiver=fixture();receiver.sim.networkOwnerId='other';requestBloodCutterCarrier(owner.sim,owner.a);
 const pending=report(owner);applyOwnedState(receiver.sim,receiver.a.id,pending);for(let i=0;i<35;i++)step(receiver);
 assert.equal(carrier(receiver),undefined,'a receiving peer does not consume another owner request');
 for(let i=0;i<35;i++)step(owner);const live=report(owner);applyOwnedState(receiver.sim,receiver.a.id,live);
 for(let i=0;i<5;i++)step(receiver);assert.equal(receiver.sim.state.effects.filter(e=>e.sourceElesisBloodCutter).length,1);
 const newer=fixture(),newEpoch=report(newer,1);applyOwnedState(receiver.sim,receiver.a.id,newEpoch);receiver.sim.networkOwnerId=receiver.a.id;
 for(let i=0;i<35;i++)step(receiver);assert.equal(receiver.a.sourceElesisBloodCutterRequests,undefined);assert.equal(carrier(receiver),undefined);
});
test('Blood explicit Web death policy clears only unissued requests',()=>{
 const f=fixture();requestBloodCutterCarrier(f.sim,f.a);f.a.death=true;tickBloodCutterRequests(f.sim,f.a,.31);
 assert.equal(f.a.sourceElesisBloodCutterRequests,undefined);assert.equal(carrier(f),undefined);
});
