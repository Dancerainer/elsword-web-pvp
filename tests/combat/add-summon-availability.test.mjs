import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addRecastResourcePlan} from '../../packages/combat-core/add-recasts.mjs';
import {addCastState} from '../../packages/combat-core/add-skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/mm-profile.json',import.meta.url)));
const plan={mode:'cast',mpCost:300,dpCost:0,mutationCost:0,cooldown:180,resourceMpInsufficient:true,resourceDpInsufficient:false,resourceMutationInsufficient:false};
test('Apocalypse live summon finish bypasses initial resource/CD gates for both target skill generations without mutation',()=>{
 for(const id of [29601,29604])for(const state of ['APOCALYPSE_START','APOCALYPSE_WAIT','APOCALYPSE_ATTACK_A','APOCALYPSE_ATTACK_B','APOCALYPSE_ATTACK_C','APOCALYPSE_ATTACK_A_EMERGENCY']){
  const actor={professionId:'MM',mp:0,cooldowns:{[id]:179},sourceAddSummon:{kind:'apocalypse',state}},skill=profile.skillCatalog.find(s=>s.skillId===id),before=structuredClone(actor);
  const result=addRecastResourcePlan(actor,skill,plan,{profile});
  assert.equal(result.mode,'apocalypse-finish');assert.equal(result.ignoreCooldown,true);assert.equal(result.allowAir,true);assert.equal(result.allowStateCancel,true);
  assert.equal(result.mpCost,0);assert.equal(result.dpCost,0);assert.equal(result.mutationCost,0);assert.equal(result.resourceMpInsufficient,false);assert.deepEqual(actor,before);
 }
});
test('MM target memo41 refunds actual MP once and never consumes a roll for a free activation',()=>{
 for(const id of [29013,29035]){
  const skill=profile.skillCatalog.find(s=>s.skillId===id),branch=skill.branches.find(b=>b.id==='memo-41');
  assert.equal(branch.memoTypeName,'MI_REGENERATE_1');assert.deepEqual(branch.parameters,[.25,.33]);
  let roll=.249999,rolls=0;const emitted=[],actor={id:'mm',professionId:'MM',mp:0,mpMax:330,sourceAdd:{formation:false},skillContext:{traitPolicy:{branchId:branch.id,mpRefundChance:branch.parameters[0],mpRefundFraction:branch.parameters[1]}}};
  const sim={profileFor:()=>profile,rng:()=>{rolls++;return roll;},emit:(...args)=>emitted.push(args),spawnSet:()=>{},state:{effects:[]}};
  addCastState(sim,actor,skill,{mode:'generator-fire',mpCost:100});assert.equal(actor.mp,33);assert.equal(rolls,1);assert.equal(emitted.length,1);
  roll=.25;addCastState(sim,actor,skill,{mode:'generator-fire',mpCost:100});assert.equal(actor.mp,33);assert.equal(rolls,2);
  for(const plan of [{mode:'generator-select',mpCost:100},{mode:'generator-switch',mpCost:100},{mode:'generator-fire',mpCost:0},{mode:'generator-fire',mpCost:100,ignoreCooldown:true}])addCastState(sim,actor,skill,plan);
  assert.equal(rolls,2);assert.equal(actor.mp,33);assert.equal(emitted.length,1);
  roll=0;actor.mp=325;addCastState(sim,actor,skill,{mode:'generator-fire',mpCost:100});assert.equal(actor.mp,330);assert.equal(rolls,3);
 }
});
test('A finishing, absent or foreign summon never grants a free ordinary Hyperactive cast',()=>{
 const skill=profile.skillCatalog.find(s=>s.skillId===29604);
 for(const sourceAddSummon of [null,{kind:'apocalypse',state:'APOCALYPSE_FINISH_ATTACK'},{kind:'apocalypse',state:'APOCALYPSE_DIE_ATTACK'},{kind:'another-summon',state:'APOCALYPSE_WAIT'}])
  assert.equal(addRecastResourcePlan({professionId:'MM',sourceAddSummon},skill,plan,{profile}),plan);
 assert.equal(addRecastResourcePlan({professionId:'LP',sourceAddSummon:{kind:'apocalypse',state:'APOCALYPSE_WAIT'}},skill,plan,{profile}),plan);
 assert.equal(addRecastResourcePlan({professionId:'MM',sourceAddSummon:{kind:'apocalypse',state:'APOCALYPSE_WAIT'}},profile.skillCatalog.find(s=>s.skillId===29017),plan,{profile}),plan);
});
