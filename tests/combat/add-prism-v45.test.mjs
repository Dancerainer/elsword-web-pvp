/** Original Particle Prism declarations/geometry and qualified failed-Loop
 * SkinAnim controller, with actual owner encode/validate/restore. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {validateAddPrismAnimation} from '../../packages/combat-core/add-prism-animation-v45.mjs';
const tick=(sim,count)=>{for(let i=0;i<count;i++)sim.step(1/60,{});};
for(const id of ['LP','MM','DE'])for(const formed of [false,true])test(`${id} Prism ${formed?'mutation':'normal'} actual damage/slow, exact carrier and finite field lifetime`,()=>{
 const {sim,a,b}=originalAddFixture(id,{skillId:29003});a.mp=a.mpMax;a.sourceAdd.dp=8000;a.sourceAdd.mutation=3;
 if(formed){a.sourceAdd.formation=true;sim.step(1/60,{});}
 for(let i=0;i<100;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 const started=sim.state.events.find(e=>e.type==='addPrismStarted');assert.equal(started.mutationSpent,formed?1:0);
 assert.equal(a.sourceAdd.mutation,formed?2:3);
 const attack=sim.state.events.find(e=>e.type==='hit'&&e.amount>0&&e.origin?.skillId===a.loadout[0].skillId);assert.ok(attack);
 assert.equal(attack.data.DAMAGE.MAGIC,13.43);assert.equal(attack.data.PVP_RATE,.48);
 assert.ok(b.buffs.some(row=>row.factorId===(formed?352:351)));assert.ok(b.stats.moveSpeedMultiplier<1);
 const carrier=sim.state.effects.find(e=>e.name==='DamageEffect_Particle_Prism_Debuff'+(formed?'_Use_Mutation':''));assert.ok(carrier);
 assert.equal(carrier.sourceBoneEffectSetId,carrier.id);assert.equal(carrier.sourceAddPrismAnimation.controller.animationName,'Normal');
 assert.equal(sim.profileFor(a).effectTemplates.Mesh_Particle_Prism.initialAnimation.name,'Loop','original requested name remains unchanged');
 const child=sim.state.effects.find(e=>e.sourceBoneTargetMeshId===carrier.id);assert.ok(child?.currentAnchor);
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:100}))),prior=structuredClone(wire);
 validateOwnedState(wire);validateOwnedReferences(wire,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 assert.ok(wire.effects.some(e=>e.sourceAddPrismAnimation));sim.state.nextEffectId=500000;sim.state.effects=[];applyOwnedState(sim,a.id,wire);
 const restored=sim.state.effects.find(e=>e.networkId===carrier.id);assert.ok(restored);assert.deepEqual(restored.sourceArcController,carrier.sourceArcController);
 assert.deepEqual(wire,prior);tick(sim,380);assert.equal(sim.state.effects.some(e=>e.setName==='EffectSet_SA_AN_PARTICLE_PRISM'),true,'endpoint6.9s is not caster field lifetime');tick(sim,210);assert.equal(sim.state.effects.some(e=>e.setName==='EffectSet_SA_AN_PARTICLE_PRISM'),false,'main10s Mesh invalidation prunes the group');
});
test('Prism typed controller rejects unknown branch, arbitrary period and foreign skill source',()=>{
 const {sim,a}=originalAddFixture('LP',{skillId:29003});a.mp=a.mpMax;
 for(let i=0;i<70;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 const e=sim.state.effects.find(e=>e.sourceAddPrismAnimation),state=e.sourceAddPrismAnimation;
 for(const change of [s=>s.controller.maxTime=999,s=>s.controller.animationName='Loop',s=>s.pose.animationTime=Infinity,s=>s.extra=1]){
  const bad=structuredClone(state);change(bad);assert.throws(()=>validateAddPrismAnimation(bad),TypeError);
 }
 assert.throws(()=>validateAddPrismAnimation(state,{effect:{...e,skillId:29024},profile:sim.profileFor(a)}),TypeError);
});
test('Prism late native LOOP transition survives endpoint expiry and ends through original10s main-mesh anchor',()=>{
 const {sim,a}=originalAddFixture('LP',{skillId:29003});a.mp=a.mpMax;
 for(let i=0;i<415;i++)sim.step(1/60,{add:{pressed:i===0?['A']:[],held:i===0?['A']:[]}});
 const e=sim.state.effects.find(e=>e.sourceAddPrismAnimation);assert.ok(e);assert.equal(e.sourceAddPrismAnimation.loopSelections,2);
 const p=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:415})));
 validateOwnedState(p);validateOwnedReferences(p,a,sim.profileFor(a),sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 sim.state.effects=[];applyOwnedState(sim,a.id,p);const restored=sim.state.effects.find(row=>row.networkId===e.id);
 assert.deepEqual(restored.sourceArcPose,e.sourceArcPose);tick(sim,20);
 assert.equal(sim.state.effects.some(row=>row.setName==='EffectSet_SA_AN_PARTICLE_PRISM'),true);tick(sim,240);
 assert.equal(sim.state.effects.some(row=>row.setName==='EffectSet_SA_AN_PARTICLE_PRISM'),false);
});
