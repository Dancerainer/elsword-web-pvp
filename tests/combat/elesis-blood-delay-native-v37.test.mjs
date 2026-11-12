/** Actual target poses, Garpai support, NPC bind frame and opposing target.
 * Stage clocks derive from the original snapshot/KL contract; this is current
 * Native simulation evidence, not an original-client dynamic golden. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const dt=1/60;
const live=f=>f.sim.state.effects.filter(e=>e.ownerId===f.a.id&&e.sourceElesisBloodCutter&&!e.dead);
const step=(f,pressed=[])=>f.sim.step(dt,{[f.a.id]:{pressed,held:pressed,sampledDevice:true}},{snapshot:false});
for(const facing of [-1,1])test(`CA Native Blood ${facing}: caster request, independent delay, NPC emission, actual remote hit and finite end`,()=>{
 const f=elesisFixture('CA',{skillId:28023,gap:500,facing,passives:[],guildPassives:[]});
 step(f,['A']);assert.equal(f.a.skillId,28023);
 for(let i=0;i<30&&!f.a.sourceElesisBloodCutterRequests;i++)step(f);
 const pending=f.a.sourceElesisBloodCutterRequests;assert.ok(pending);assert.equal(live(f).length,0);
 const request=structuredClone(pending[0]),atRequest=f.sim.state.time;
 const receiver=elesisFixture('CA',{skillId:28023,gap:500,facing,passives:[],guildPassives:[]});receiver.sim.networkOwnerId=receiver.b.id;
 const packet=validateOwnedState(encodeOwnedState(f.sim,f.a.id,{epoch:0,frameSeq:f.sim.state.step}));
 validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
 applyOwnedState(receiver.sim,receiver.a.id,packet);
 // Freeze the caster animation only. The original game's request/NPC clock
 // must continue; this never inserts a hit or changes a fired callback.
 f.a.hitStop=f.a.worldStop=2;const animation=f.a.animationTime;
 let sawNpcStage=false;
 for(let i=0;i<50&&!live(f).length;i++){
  const current=f.a.sourceElesisBloodCutterRequests?.[0];if(current?.phase==='npc'){sawNpcStage=true;assert.equal(live(f).length,0);}
  step(f);step(receiver);
 }
 assert.ok(sawNpcStage);assert.equal(f.a.animationTime,animation);assert.equal(live(f).length,1);
 assert.ok(f.sim.state.time-atRequest>=request.remaining-dt);
 const effect=live(f)[0];assert.deepEqual(effect.sourceElesisBloodCutter.origin,request.origin);assert.equal(effect.facing,facing);
 assert.equal(live(receiver).length,0,'receiving peer cannot duplicate a pending NPC request');
 const emitted=validateOwnedState(encodeOwnedState(f.sim,f.a.id,{epoch:0,frameSeq:f.sim.state.step}));
 validateOwnedReferences(emitted,receiver.a,receiver.profile,receiver.map,{actors:receiver.sim.state.actors,profiles:receiver.sim.profiles});
 applyOwnedState(receiver.sim,receiver.a.id,emitted);assert.equal(live(receiver).length,1);
 for(let i=0;i<80;i++){step(f);step(receiver);}
 // Feedback13 now restores the source non-passing NPC's bounded impact
 // stop. The old assertion demanded continued travel after a real hit.
 assert.ok((effect.x-request.origin[0])*facing>0,'original NPC moves away after its own .1 before impact');
 assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId===f.a.id&&e.targetId===f.b.id&&e.origin?.kind==='effect'&&e.origin.id===effect.id),
  'the actual moving carrier hits the original opposing target');
 const impact=[effect.x,effect.y,effect.z];for(let i=0;i<6;i++)step(f);
 assert.deepEqual([effect.x,effect.y,effect.z],impact,'feedback13 keeps the accepted impact anchor');
 assert.equal(live(receiver).length,1,'received NPC remains one instance during local projection');
 for(let i=0;i<100;i++)step(f);assert.equal(live(f).length,0,'NPC walk retires on its own two-second clock');
 validateOwnedState(encodeOwnedState(f.sim,f.a.id));
});
