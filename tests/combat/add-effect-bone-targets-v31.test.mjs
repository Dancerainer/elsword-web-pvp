import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {ADD_BONE_TARGETS} from '../../packages/combat-core/lk-effect-set-targets.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
test('all ten LP bindings refer to the unique original declared mesh carrier and converted pose',()=>{
 const {profile}=originalAddFixture('LP');assert.equal(Object.keys(ADD_BONE_TARGETS).length,10);
 for(const [name,target]of Object.entries(ADD_BONE_TARGETS)){
  const carriers=Object.values(profile.effectSets[name].raw).filter(e=>e?.BONE_TRACE_TARGET_MESH===1);
  assert.equal(carriers.length,1);assert.equal(carriers[0].NAME,target);
  assert.equal(profile.effectTemplates[target].fields.MeshType,'X_SKIN_MESH');assert.ok(profile.effectTemplates[target].poseData);
 }
});
for(const name of ['EffectSet_SI_HA_ALP_DOOMS_DAY','EffectSet_SA_APT_Conqueror_Hyper_1st'])test(`actual original LP carrier owns its effect-set child bones: ${name}`,()=>{
 const {sim,a,b,profile}=originalAddFixture('LP');b.x=1200;sim.spawnSet(a,name);for(let i=0;i<38;i++)sim.step(1/60,{});
 const carrier=sim.state.effects.find(e=>e.name===ADD_BONE_TARGETS[name]&&e.setName===name);assert.ok(carrier);
 assert.equal(carrier.mainEffectName,carrier.name);assert.equal(carrier.sourceBoneEffectSetId,carrier.id);
 const child=sim.state.effects.find(e=>e.sourceBoneTargetMeshId===carrier.id&&e.active);assert.ok(child);
 const bone=child.definition.BONE_NAME?sim.effectBoneSampler(carrier,a,child.definition.BONE_NAME):(carrier.currentAnchor??carrier.birthAnchor).position;assert.ok(bone);
 assert.ok(child.currentAnchor?.position);
 for(let i=0;i<3;i++)assert.ok(Math.abs(child.currentAnchor.position[i]-bone[i]-(child.definition[['POSITION_OFFSET_X','POSITION_OFFSET_Y','POSITION_OFFSET_Z'][i]]??0)*(i===0?a.facing:1))<1e-4,'original carrier bone plus authored offset');
 const raw=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:0,frameSeq:38}))),report=validateOwnedState(raw);
 validateOwnedReferences(report,a,profile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});applyOwnedState(sim,a.id,report);
 const restored=sim.state.effects.find(e=>e.name===carrier.name&&e.setName===name);assert.ok(restored);
 assert.ok(sim.state.effects.some(e=>e.sourceBoneTargetMeshId===restored.id));
 for(let i=0;i<500;i++)sim.step(1/60,{});
 assert.equal(sim.state.effects.some(e=>e.sourceBoneEffectSetId===restored.id),false,'native carrier lifetime also reclaims its attached children');
});
