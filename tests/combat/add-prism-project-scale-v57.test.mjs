/** Explicit project override. Original source assertions are
 * independent of the new actual instances and owner reconstruction. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {addPrismProjectDefinition} from '../../packages/combat-core/add-prism-project-rules-v57.mjs';
import {ADD_PRISM_SET,ADD_PRISM_DAMAGE_SET} from '../../packages/combat-core/add-prism-v45.mjs';
const axes=['SCALE_X','SCALE_Y','SCALE_Z'];
const sourceScaledMembers=['EFFECT6','EFFECT7','EFFECT8','EFFECT10','EFFECT11','EFFECT12'];
function checkRaw(profile){
 for(const member of sourceScaledMembers)assert.deepEqual(axes.map(k=>profile.effectSets[ADD_PRISM_SET].raw[member][k]),[1.5,1.5,1.5]);
 assert.deepEqual(axes.map(k=>profile.effectSets[ADD_PRISM_DAMAGE_SET].raw.EFFECT0[k]),[1.5,1.5,1.5]);
 assert.equal(profile.effectSets[ADD_PRISM_SET].raw.EFFECT9.SCALE_X,undefined,'initial flash remains source default1');
}
for(const id of ['LP','MM','DE'])for(const [skillId,baseOnly] of [[29003,false],[29029,false],[29003,true]])for(const mutation of [false,true])
test(`${id} Prism${skillId} ${baseOnly?'unupgraded original test catalog':'production max-level catalog'} ${mutation?'mutation':'normal'} births and owner restore derive project scale1 while raw stays1.5`,()=>{
 const {sim,a,b,profile}=originalAddFixture(id,{skillId});a.mp=a.mpMax;a.sourceAdd.dp=8000;a.sourceAdd.mutation=3;b.hp=b.hpMax=9999999;
 if(baseOnly){
  // Production intentionally auto-upgrades29003 to29029. Exercise the other
  // original executor with a separate unupgraded catalog, preserving every
  // original remaining skill/raw/state/pose value and the production profile.
  const unupgraded=structuredClone(sim.profileFor(a));unupgraded.skillCatalog=unupgraded.skillCatalog.filter(skill=>skill.replacesSkillId!==29003);
  sim.profiles[id]=unupgraded;sim.configureLoadout([{skillId},...Array(7).fill(null)],a.id);
 }
 const activeProfile=sim.profileFor(a),actualSkillId=baseOnly?29003:29029;
 assert.equal(a.loadout[0].skillId,actualSkillId);assert.equal(a.loadout[0].requestedSkillId,skillId);
 checkRaw(profile);const before=JSON.stringify(profile.effectSets);
 if(mutation){a.sourceAdd.formation=true;sim.step(1/60,{});}
 sim.drainEvents();const born=[];let openingWire,openingIds;
 for(let frame=0;frame<130;frame++){
  sim.step(1/60,frame===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  for(const e of sim.drainEvents())if(e.type==='effectStarted'&&[ADD_PRISM_SET,ADD_PRISM_DAMAGE_SET].includes(e.setName))born.push(e);
  const opening=sim.state.effects.filter(e=>e.setName===ADD_PRISM_SET&&sourceScaledMembers.includes(e.definitionMember)||e.setName===ADD_PRISM_DAMAGE_SET);
  if(!openingWire&&opening.length===7){
   for(const e of opening)assert.deepEqual(axes.map(k=>e.definition[k]),[1,1,1],e.name+' opening instance');
   openingWire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:frame+1})));openingIds=new Set(opening.map(e=>e.id));
  }
 }
 const exact=sim.state.effects.filter(e=>e.setName===ADD_PRISM_SET&&sourceScaledMembers.includes(e.definitionMember)||e.setName===ADD_PRISM_DAMAGE_SET);
 assert.ok(openingWire,'both named-set helpers coexist during their original opening phase');
 assert.ok(born.length>0&&born.every(event=>event.skillId===actualSkillId),'record actual original/existing-max executor identity, not only requested alias');
 assert.equal(exact.length,6,'the short DAMAGE helper has naturally retired by the sustained phase');
 for(const id of openingIds)assert.ok(born.some(event=>event.effectId===id&&axes.every(k=>event.definition[k]===1)),'each sustained/member or short damage helper actually starts at project scale1');
 for(const e of exact){
  assert.deepEqual(axes.map(k=>e.definition[k]),[1,1,1],e.name+' actual project instance');
  assert.ok(born.some(event=>event.effectId===e.id&&axes.every(k=>event.definition[k]===1)),e.name+' actual presentation birth uses the instance override');
 }
 assert.equal(exact.find(e=>e.definitionMember==='EFFECT12').name,'DamageEffect_Particle_Prism_Debuff'+(mutation?'_Use_Mutation':''));
 const wire=JSON.parse(JSON.stringify(encodeOwnedState(sim,a.id,{epoch:1,frameSeq:130}))),prior=structuredClone(wire);
 validateOwnedState(wire);validateOwnedReferences(wire,a,activeProfile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 assert.ok(wire.effects.every(e=>!Object.hasOwn(e,'definition')),'owner never supplies an arbitrary scale definition');
 validateOwnedState(openingWire);validateOwnedReferences(openingWire,a,activeProfile,sim.map,{actors:sim.state.actors,profiles:sim.profiles});
 sim.state.effects=[];sim.state.nextEffectId=500000;applyOwnedState(sim,a.id,openingWire);
 const restoredOpening=sim.state.effects.filter(e=>openingIds.has(e.networkId));assert.equal(restoredOpening.length,7);
 for(const e of restoredOpening)assert.deepEqual(axes.map(k=>e.definition[k]),[1,1,1],e.name+' opening reconstructed instance');
 const ids=new Set(exact.map(e=>e.id));sim.state.effects=[];applyOwnedState(sim,a.id,wire);
 const restored=sim.state.effects.filter(e=>ids.has(e.networkId));assert.equal(restored.length,6);
 for(const e of restored)assert.deepEqual(axes.map(k=>e.definition[k]),[1,1,1],e.name+' reconstructed instance');
 for(let i=0;i<5;i++)sim.step(1/60,{}, {snapshot:false});
 assert.ok(sim.state.effects.some(e=>e.sourceAddPrismAnimation),'original typed controller survives restoration');
 assert.deepEqual(wire,prior);checkRaw(profile);assert.equal(JSON.stringify(profile.effectSets),before,'raw profile never mutated by overlay or restore');
});
test('Prism project rule only changes its exact named sets, members, equipped skill and Add professions',()=>{
 const {profile}=originalAddFixture('LP',{skillId:29003}),definition=profile.effectSets[ADD_PRISM_SET].raw.EFFECT10;
 for(const effect of [{setName:'another-set',skillId:29003},{setName:ADD_PRISM_SET,skillId:29022}])
  assert.equal(addPrismProjectDefinition(profile,effect,definition),definition);
 assert.equal(addPrismProjectDefinition({target:{unitClass:101}},{setName:ADD_PRISM_SET,skillId:29003},definition),definition);
 const foreign={NAME:'another-effect',SCALE_X:1.5};
 assert.equal(addPrismProjectDefinition(profile,{setName:ADD_PRISM_SET,skillId:29003},foreign),foreign);
 assert.equal(addPrismProjectDefinition(profile,{setName:ADD_PRISM_SET,skillId:29003},profile.effectSets[ADD_PRISM_SET].raw.EFFECT9),profile.effectSets[ADD_PRISM_SET].raw.EFFECT9);
});
