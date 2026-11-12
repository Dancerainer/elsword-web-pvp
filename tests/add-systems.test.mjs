import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ADD_DP_MAX,ADD_MUTATION_MAX,ADD_FORMATION_SENTINEL,initializeAddSystems,validateAddState,
  syncAddAwakening,changeAddDp,addFormationAvailability,startAddFormation,beginAddFormation,activateAddFormation,stopAddFormation,createAddResourcePools,
  gainAddMutation,consumeAddMutation,addSkillResourceCost,commitAddSkillResources,addHitResources,
  addHitMpMultiplier,addNaturalMpRecoveryRate,applyAddCooldownProc,
  advanceAddSystems,applyAddTimeRing,tryAddTimeRingRevive,validateAddTimeRingState} from '../packages/combat-core/add-systems.mjs';
const source=JSON.parse(readFileSync(new URL('../contracts/add-systems-source-v1.json',import.meta.url)));
const skill=id=>{const raw=source.skills[id];return {skillId:id,raw,type:raw.m_eType,maxLevel:1,
  mpCost:raw.m_MPConsumption?.['1']??0,cooldown:raw.m_SkillCoolTime?.['1']??0};};
const profile={components:source.components,skillCatalog:Object.keys(source.skills).map(Number).map(skill)};
const actor=(professionId='LP',extra={})=>{const a={id:'a',professionId,hp:1000,hpMax:1000,mp:300,mpMax:500,
  team:1,x:0,y:0,z:0,skillId:null,skillScale:1,skillContext:{level:1},cooldowns:{},
  equipmentAttributes:{addDpGainBonus:.5,addDpConsumptionReduction:.5},...extra};initializeAddSystems(a);return a;};
const simulate=(actors=[actor()])=>({state:{actors},events:[],profileFor:()=>profile,presetFor:()=>({gameMode:'PVP'}),emit(type,id,details){this.events.push({type,id,...details});}});
const opts={profile};

test('source second activations never repeat initial DP gain, mutation payload or Overlimit MP recovery',()=>{
  for(const mode of ['phase-return','quicksilver-back','stasis-release'])for(const formed of [false,true]){
    const a=actor('DE'),s={skillId:29201,type:7,maxLevel:1,raw:{m_MPConsumption:{1:100},SA_USE_DP_REL_AT_FORMATION_MODE:{1:1}}};
    Object.assign(a.sourceAdd,{dp:3000,mutation:4,formation:formed});a.mp=100;
    const plan={...addSkillResourceCost(a,s,{profile,mpCost:10}),mode,dpCost:0,mutationCost:0};
    const before=structuredClone({resource:a.sourceAdd,mp:a.mp,scale:a.skillScale,context:a.skillContext});
    assert.equal(commitAddSkillResources(a,s,plan,opts),plan);
    assert.deepEqual({resource:a.sourceAdd,mp:a.mp,scale:a.skillScale,context:a.skillContext},before);
    assert.throws(()=>commitAddSkillResources(a,s,{...plan,formation:!formed},opts),/Stale/);
  }
});

test('target Overlimit attack DP adds 15 percentage points; received DP stays separate',()=>{
  const a=actor('DE',{passivePolicy:{skillLevels:{29410:4}}});
  const data={DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1.52}};
  addHitResources(a,data,{profile,step:1});assert.ok(Math.abs(a.sourceAdd.dp-200.64)<.001);
  a.sourceAdd.dp=0;addHitResources(a,data,{profile,kind:'received',damage:100,step:1});assert.equal(a.sourceAdd.dp,1200);
  assert.equal(addHitMpMultiplier(a,data,'hit',opts),1);
  a.sourceAdd.formation=true;
  assert.equal(addHitMpMultiplier(a,data,'hit',opts),1.15);assert.equal(addHitMpMultiplier(a,data,'received',opts),1.15);
  const before=a.sourceAdd.dp;addHitResources(a,data,{profile,step:2});assert.ok(Math.abs(before-a.sourceAdd.dp-60.8)<.001);
  assert.equal(addHitMpMultiplier(actor('MM'),data,'hit',opts),1);
});

test('Time Control uses original BF669 interval, with no parallel description-derived continuous MP channel',()=>{
  for(const [level,expected] of [[1,.5],[2,.75],[3,1]]){
    const a=actor('DE',{passivePolicy:{skillLevels:{29411:level}}});
    assert.equal(addNaturalMpRecoveryRate(a,profile),0);a.sourceAdd.formationPending=true;
    assert.equal(addNaturalMpRecoveryRate(a,profile),0);a.sourceAdd.formation=true;a.sourceAdd.formationPending=false;
    assert.equal(addNaturalMpRecoveryRate(a,profile),0);
    assert.equal(addNaturalMpRecoveryRate(a,{skillCatalog:[]}),0,'this retired adapter never fabricates an interval object');
  }
});

test('LP Particle Storm and MM Hidden Records likewise have no continuous MP sum beside BF669',()=>{
 for(const [id,passive]of [['LP',29401],['MM',29406]])for(const [level,rate]of [[1,.5],[2,.75],[3,1]]){
  const a=actor(id,{passivePolicy:{skillLevels:{[passive]:level}}});
  assert.equal(addNaturalMpRecoveryRate(a,profile),0);a.sourceAdd.formation=true;
  assert.equal(addNaturalMpRecoveryRate(a,profile),0);assert.equal(addNaturalMpRecoveryRate(a,{skillCatalog:[]}),0);
 }
});

test('Time Control consumes explicit original sample<=chance and PvP-halved direct slot multiplier',()=>{
  const a=actor('DE',{passivePolicy:{skillLevels:{29411:3}}}),s={skillId:29019,type:7,raw:{}};
  // ADD_CORE_PASSIVES_2016: raw chance.4/factor.5 halve in PvP; the
  // native two4-slot walk multiplies by.25, not1-.5 or1-.25.
  a.loadout=[{skillId:s.skillId,level:1},...Array(7).fill(null)];a.cooldowns[s.skillId]=20;
  assert.equal(applyAddCooldownProc(a,s,{profile,sample:{supported:true,value:.201}}).applied,false);
  assert.equal(a.cooldowns[s.skillId],20);
  const result=applyAddCooldownProc(a,s,{profile,sample:{supported:true,value:Math.fround(.2)}});
  assert.equal(result.applied,true);assert.equal(a.cooldowns[s.skillId],5);
  assert.equal(applyAddCooldownProc(a,s,{profile}).unsupported,'add-time-control-source-sample-unavailable');
  for(const excluded of [{skillId:29213,type:7},{skillId:900,type:6},{skillId:29602,type:13}]){
    a.cooldowns[excluded.skillId]=20;applyAddCooldownProc(a,excluded,{profile});
    assert.equal(a.cooldowns[excluded.skillId],20);
  }
});

test('Time Control stage-sensitive unresolved skills are explicit and consume no roll',()=>{
  const a=actor('DE',{passivePolicy:{skillLevels:{29411:3}}});
  for(const id of [29022,29025,29204]){
    // Explicit original-special caller input tests the separate stage gates;
    // production type6 does not enter this source method at all.
    a.cooldowns[id]=20;const s={skillId:id,type:7,raw:{}};
    const result=applyAddCooldownProc(a,s,{profile,rng:()=>{throw Error('Unclosed stage gate');}});
    assert.equal(result.unsupported,'add-time-control-stage-unresolved-'+id);assert.equal(a.cooldowns[id],20);
    applyAddCooldownProc(a,s,{profile});
  }
  assert.equal(a.unsupported.length,3);
});

test('target fields stay separate from fixed-source max/sentinel and user options',()=>{
  assert.equal(source.components.USE_DP_BY_ENABLE_FORMATION_MODE,2000);
  assert.equal(source.components.DP_RATE_BY_FORMATION_MODE_USE_MP,4);
  assert.equal(source.buffFactors['474'].FINALIZER.BFT_TIME.NORMAL_TIME['1'],16.5);
  assert.equal(source.buffFactors['501'].BEHAVIOR.BBT_RESET_SKILL_COOL_TIME.FIX_VALUE['1'],-24);
  assert.equal(source.buffFactors['683'].FINALIZER.BFT_TIME.NORMAL_TIME['1'],120);
  assert.equal(source.targetClientMeasured,false);assert.equal(source.reference.commit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
  assert.equal(ADD_DP_MAX,8000);assert.equal(ADD_MUTATION_MAX,6);assert.equal(ADD_FORMATION_SENTINEL,99999);
});
test('starts with no free DP/mutation/orb even if ordinary old awakening options exist',()=>{
  const a=actor();assert.equal(a.sourceAdd.dp,0);assert.equal(a.sourceAdd.mutation,0);assert.equal(a.awakening.orbs,0);
  a.equipmentAttributes={awakeningChargeBonus:5,awakeningDurationBonus:5};
  changeAddDp(a,100,opts);assert.equal(a.sourceAdd.dp,100);changeAddDp(a,-40,opts);assert.equal(a.sourceAdd.dp,60);
});
test('equipment +50%/-50% scales once and caps at 8000/0',()=>{
  const a=actor();changeAddDp(a,100,opts);assert.equal(a.sourceAdd.dp,150);
  changeAddDp(a,-40,opts);assert.equal(a.sourceAdd.dp,130);
  changeAddDp(a,8000,opts);assert.equal(a.sourceAdd.dp,8000);changeAddDp(a,-20000,opts);assert.equal(a.sourceAdd.dp,0);
});

test('LP target BCT_PERCENT DP buff multiplies the final socket channel without affecting consumption',()=>{
  const a=actor();a.buffs=[{factorId:357,behaviors:[{kind:'addDpGain',value:1.4}]}];
  changeAddDp(a,100,opts);assert.ok(Math.abs(a.sourceAdd.dp-210)<.0001);
  changeAddDp(a,-100,opts);assert.ok(Math.abs(a.sourceAdd.dp-160)<.0001);
  a.buffs=[];changeAddDp(a,100,opts);assert.ok(Math.abs(a.sourceAdd.dp-310)<.0001);
});

test('Rushing Drone enhanced/base spend one mutation only for the implemented formed second projectile context',()=>{
 for(const [id,formed,context]of [[29208,true,true],[29219,true,true],[29208,false,true],[29219,true,false]]){
  const a=actor('MM'),s={skillId:id,type:6,maxLevel:1,raw:id===29219?{m_DeleteSkillIDByUpgrade:29208}:{}};
  Object.assign(a.sourceAdd,{formation:formed,dp:4000,mutation:3});if(!context)a.skillContext=null;
  const plan=addSkillResourceCost(a,s,{profile});commitAddSkillResources(a,s,plan,opts);
  const spend=formed&&context?1:0;assert.equal(a.sourceAdd.mutation,3-spend);assert.equal(a.skillScale,1);
  if(spend)assert.equal(a.skillContext.addMutationSpent,1);
 }
});
test('formation exact threshold, sourced sentinel, one mutation and fresh-only 5s cooldown',()=>{
  const a=actor();a.sourceAdd.dp=1999;assert.equal(startAddFormation(a,opts),false);
  a.sourceAdd.dp=2000;assert.equal(startAddFormation(a,opts),true);assert.equal(a.sourceAdd.dp,1500);
  assert.equal(a.sourceAdd.mutation,1);assert.equal(a.awakening.remaining,99999);assert.equal(a.sourceAdd.switchCooldown,5);
  assert.equal(startAddFormation(a,opts),false);assert.equal(stopAddFormation(a,opts),true);
  assert.equal(a.awakening.remaining,0);assert.equal(a.sourceAdd.switchCooldown,5);
  a.sourceAdd.dp=4000;advanceAddSystems(a,5,opts);assert.equal(addFormationAvailability(a,profile).available,true);
});
test('formation state-start payment is separate from the .46 buff flag event',()=>{
  const a=actor();a.sourceAdd.dp=2000;assert.equal(beginAddFormation(a,opts),true);
  assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);assert.equal(a.sourceAdd.formation,false);
  assert.equal(a.sourceAdd.formationPending,true);assert.equal(a.sourceAdd.switchCooldown,0);assert.equal(a.awakening.remaining,99999);
  assert.equal(beginAddFormation(a,opts),false);advanceAddSystems(a,.2,opts);assert.equal(a.sourceAdd.formation,false);
  assert.equal(activateAddFormation(a,opts),true);assert.equal(a.sourceAdd.switchCooldown,5);assert.equal(a.sourceAdd.formationPending,false);
  assert.equal(activateAddFormation(a,opts),false);assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);
});
test('interrupted pending formation has no refunded or repeated resource gain',()=>{
  const a=actor();a.sourceAdd.dp=2000;beginAddFormation(a,opts);stopAddFormation(a,{...opts,reason:'interrupted'});
  assert.equal(activateAddFormation(a,opts),false);assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);assert.equal(a.awakening.remaining,0);
});
test('Add resource pools keep fractional DP, floor mutation and clear active state',()=>{
  const a=actor('MM'),[dp,mutation]=createAddResourcePools();a.sourceAdd.dp=4001;a.sourceAdd.mutation=5;a.sourceAdd.formation=true;
  a.sourceAdd.generator={skillId:29013,phase:'ready',generation:1,remaining:30};
  dp.write(a,dp.read(a)*.5);mutation.write(a,mutation.read(a)*.5);
  assert.equal(a.sourceAdd.dp,2000.5);assert.equal(a.sourceAdd.mutation,2);assert.equal(a.sourceAdd.formation,false);
  assert.equal(a.sourceAdd.generator,null);assert.equal(a.awakening.remaining,0);assert.equal(dp.read(actor('RF')),null);
});
test('target Formation factor explicitly declares single 1.2 melee/range multipliers',()=>{
  const b=source.buffFactors['315'].BEHAVIOR;
  assert.equal(b.BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_MELEE_ATTACK.PERCENT['1'],1.2);
  assert.equal(b.BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_RANGE_ATTACK.PERCENT['1'],1.2);
});
test('DP, not elapsed ordinary awakening time, owns formation lifetime',()=>{
  const a=actor();a.sourceAdd.dp=4000;startAddFormation(a,opts);advanceAddSystems(a,100000,opts);
  assert.equal(a.awakening.remaining,99999);assert.equal(a.sourceAdd.formation,true);
  changeAddDp(a,-10000,opts);assert.equal(a.sourceAdd.formation,false);assert.equal(a.awakening.remaining,0);
});
test('LP target Nasod Armor passive reduces entry cost, never the activation threshold',()=>{
  const a=actor('LP',{passivePolicy:{skillLevels:{29400:4}}});a.sourceAdd.dp=2000;startAddFormation(a,opts);
  assert.equal(a.sourceAdd.dp,1625); // 1000 * .75 * .5
});
test('DE Control Time additive reduction composes with user -50%',()=>{
  const a=actor('DE',{passivePolicy:{skillLevels:{29411:3}}});a.sourceAdd.dp=4000;changeAddDp(a,-1000,opts);
  assert.equal(a.sourceAdd.dp,3600); // 1 - .50 - (1 - .90)
});
test('mutation cap and original Transform once-per-positive-request MP restore',()=>{
  const a=actor('MM',{mp:0,passivePolicy:{skillLevels:{29405:4}}});assert.equal(gainAddMutation(a,6,opts),6);
  // Original32744ac0 returns7094 once, not7094 times the requested count.
  assert.equal(a.mp,15);assert.equal(gainAddMutation(a,1,opts),0);assert.equal(a.mp,15);
});
test('Mind Circle recovery selects MP in formation and DP in dissolution',()=>{
  const a=actor('DE',{mp:0,passivePolicy:{skillLevels:{29413:3}}});a.sourceAdd.mutation=6;a.sourceAdd.formation=true;
  assert.equal(consumeAddMutation(a,2,opts),2);assert.equal(a.mp,30);a.sourceAdd.formation=false;
  assert.equal(consumeAddMutation(a,1,opts),0);assert.equal(consumeAddMutation(a,1,{...opts,allowDissolution:true}),1);assert.equal(a.sourceAdd.dp,450);
});
test('normal MP special consumes no DP and recovers 4 raw DP per MP with option',()=>{
  const a=actor();a.mp=200;const s=skill(29000),plan=addSkillResourceCost(a,s,opts);
  assert.equal(plan.mpCost,100);assert.equal(plan.dpCost,0);a.mp-=plan.mpCost;commitAddSkillResources(a,s,plan,opts);
  assert.equal(a.mp,100);assert.equal(a.sourceAdd.dp,600);
});
test('V61 raw fixed skill FP cost ignores equipment reduction in dissolution and remains waived in formation',()=>{
  const a=actor();a.sourceAdd.dp=3000;const s=skill(29002),plan=addSkillResourceCost(a,s,opts);
  assert.equal(plan.dpCost,1200);assert.equal(plan.mpCost,230);
  a.mp-=230;commitAddSkillResources(a,s,plan,opts);assert.equal(a.sourceAdd.dp,1800);
  a.sourceAdd.formation=true;assert.equal(addSkillResourceCost(a,s,opts).dpCost,0);
});
test('DE formation switches MP to raw DP and target Overlimit restores MP',()=>{
  const a=actor('DE',{mp:0,passivePolicy:{skillLevels:{29410:4}}});a.sourceAdd.dp=8000;a.sourceAdd.formation=true;
  const s=skill(29019),plan=addSkillResourceCost(a,s,opts);
  assert.equal(plan.mpCost,0);assert.equal(plan.dpCost,4000);assert.equal(plan.cooldown,s.cooldown*1.5);
  commitAddSkillResources(a,s,plan,opts);assert.equal(a.sourceAdd.dp,4000);assert.equal(a.mp,40);
});
test('trait-adjusted MP input determines DP conversion once; query has no mutation',()=>{
  const a=actor('DE');a.sourceAdd.formation=true;a.sourceAdd.dp=8000;
  const before=JSON.stringify(a),p=addSkillResourceCost(a,skill(29019),{profile,mpCost:160,cooldown:10});
  assert.equal(p.dpCost,3200);assert.equal(JSON.stringify(a),before);
});
test('unaffordable/stale plans throw before DP/mutation mutation',()=>{
  const a=actor();a.sourceAdd.dp=600;const s=skill(29002),p=addSkillResourceCost(a,s,opts);
  a.sourceAdd.dp=599;const before=JSON.stringify(a);assert.throws(()=>commitAddSkillResources(a,s,p,opts));assert.equal(JSON.stringify(a),before);
  a.sourceAdd.dp=8000;a.sourceAdd.formation=true;assert.throws(()=>commitAddSkillResources(a,s,p,opts));
});
test('complete mutation numeric payload spends at accepted cast and changes actual skillScale',()=>{
  const a=actor();a.sourceAdd.dp=4000;a.sourceAdd.formation=true;a.sourceAdd.mutation=6;
  const s=skill(29028),p=addSkillResourceCost(a,s,opts);a.mp-=p.mpCost;commitAddSkillResources(a,s,p,opts);
  assert.equal(a.sourceAdd.mutation,2);assert.equal(a.skillContext.addMutationSpent,4);assert.equal(a.skillScale,1.4);
});
test('unknown mutation payload never spends without an effect consumer',()=>{
  const a=actor();a.sourceAdd.formation=true;a.sourceAdd.dp=4000;a.sourceAdd.mutation=6;
  const s=skill(29000);commitAddSkillResources(a,s,addSkillResourceCost(a,s,opts),opts);
  assert.equal(a.sourceAdd.mutation,6);assert.equal(a.skillScale,1);
});

test('Psychic Storm consumes at most three points only in formation and supplies duration/size payload without damage inflation',()=>{
  for(const points of [0,1,2,3,6])for(const formation of [false,true]){
    const a=actor();Object.assign(a.sourceAdd,{dp:4000,mutation:points,formation});
    const s=skill(29009),plan=addSkillResourceCost(a,s,opts),before=structuredClone(a);
    assert.deepEqual(a,before,'resource query must not consume mutation');a.mp-=plan.mpCost;commitAddSkillResources(a,s,plan,opts);
    const used=formation?Math.min(points,3):0;
    assert.equal(a.sourceAdd.mutation,points-used);assert.equal(a.skillContext.addMutationSpent??0,used);assert.equal(a.skillScale,1);
  }
  const a=actor();Object.assign(a.sourceAdd,{dp:4000,mutation:6,formation:true});a.skillContext=null;
  const s=skill(29009);commitAddSkillResources(a,s,addSkillResourceCost(a,s,opts),opts);assert.equal(a.sourceAdd.mutation,6,'no context means no duration/size consumer');
});
test('MM first install is DP-only mode selection; repeated skill uses SA_MP_CONSUMPTION',()=>{
  const a=actor('MM');a.sourceAdd.dp=1000;
  const s=skill(29013),p=addSkillResourceCost(a,s,opts);assert.equal(p.mode,'generator-select');assert.equal(p.mpCost,0);assert.equal(p.dpCost,600);
  commitAddSkillResources(a,s,p,opts);assert.equal(a.sourceAdd.generator.remaining,30);
  const fire=addSkillResourceCost(a,s,opts);assert.equal(fire.mode,'generator-fire');assert.equal(fire.mpCost,100);assert.equal(fire.dpCost,0);
  a.mp-=fire.mpCost;commitAddSkillResources(a,s,fire,opts);assert.equal(a.sourceAdd.generator.phase,'firing');assert.equal(a.sourceAdd.dp,400);
});
test('MM switching selects a new generation and gains one mutation; passive reduces fire MP',()=>{
  const a=actor('MM',{passivePolicy:{skillLevels:{29407:3}}});a.sourceAdd.dp=5000;
  for(const id of [29013,29016]){const s=skill(id),p=addSkillResourceCost(a,s,opts);commitAddSkillResources(a,s,p,opts);}
  assert.equal(a.sourceAdd.generator.skillId,29016);assert.equal(a.sourceAdd.generator.generation,2);assert.equal(a.sourceAdd.mutation,1);
  assert.equal(addSkillResourceCost(a,skill(29016),opts).mpCost,160);
});
test('MM enhanced activator has target 45s lifetime and expires without affecting formation',()=>{
  const a=actor('MM');a.sourceAdd.dp=5000;a.sourceAdd.formation=true;const s=skill(29035);
  commitAddSkillResources(a,s,addSkillResourceCost(a,s,opts),opts);assert.equal(a.sourceAdd.generator.remaining,45);
  advanceAddSystems(a,45,opts);assert.equal(a.sourceAdd.generator,null);assert.equal(a.sourceAdd.formation,true);
});
test('attack and receive DP gates are distinct from each other and from MP gates',()=>{
  const a=actor();a.lastCombatResourceStep=10;
  const d={DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1.5}};
  addHitResources(a,d,{...opts,step:10});assert.equal(a.sourceAdd.dp,180);
  addHitResources(a,d,{...opts,step:10});assert.equal(a.sourceAdd.dp,180);
  addHitResources(a,d,{...opts,step:10,kind:'received',damage:100});assert.equal(a.sourceAdd.dp,1380);
  addHitResources(a,d,{...opts,step:10,kind:'received',damage:100});assert.equal(a.sourceAdd.dp,1380);
});
test('formation command damage drains DP with user option; unknown DPR and mixed do not guess',()=>{
  const a=actor();a.sourceAdd.formation=true;a.sourceAdd.dp=4000;
  addHitResources(a,{DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:1,DAMAGE:{MAGIC:2}},opts);assert.equal(a.sourceAdd.dp,3920);
  addHitResources(a,{DYNAMO_PARTICLE_RATE_TYPE:{$symbol:'DPRT_SPECIAL'},DAMAGE_TYPE:1,DAMAGE:{MAGIC:2}},opts);
  addHitResources(a,{DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:2,DAMAGE:{PHYSIC:2,MAGIC:3}},opts);assert.equal(a.sourceAdd.dp,3920);
});
test('time ring records self/allies within 700 and excludes enemy/dead/sick',()=>{
  const a=actor('DE'),b=actor('LK',{id:'b',x:700}),c=actor('LK',{id:'c',x:701}),enemy=actor('RF',{id:'enemy',team:2}),sick=actor('LP',{id:'sick',sourceTimeSickness:1});
  const sim=simulate([a,b,c,enemy,sick]);assert.equal(applyAddTimeRing(sim,a,skill(29213)),2);
  assert.equal(a.sourceTimeRing.hp,500);assert.equal(b.sourceTimeRing.remaining,16.5);assert.equal(c.sourceTimeRing,undefined);assert.equal(sick.sourceTimeRing,undefined);
});
test('ring cooldown excludes itself, wedding and hyper; target -24 does not reset all',()=>{
  const a=actor('DE');a.cooldowns={29000:40,29213:30,900:99,29602:120};
  const sim=simulate([a]);applyAddTimeRing(sim,a,skill(29213));assert.deepEqual(a.cooldowns,{29000:16,29213:30,900:99,29602:120});
});
test('ring lethal interception consumes once, preserves position/life epoch and applies 120s sickness',()=>{
  const a=actor('DE',{mp:144,lifeEpoch:4});a.sourceAdd.dp=4567;a.sourceAdd.mutation=4;
  const sim=simulate([a]);applyAddTimeRing(sim,a,skill(29213));a.x=33;a.mp=3;a.sourceAdd.dp=1;a.sourceAdd.mutation=0;
  assert.equal(tryAddTimeRingRevive(sim,a,{damage:1000}),true);assert.equal(a.hp,500);assert.equal(a.mp,144);
  assert.equal(a.sourceAdd.dp,4567);assert.equal(a.sourceAdd.mutation,4);assert.equal(a.x,33);assert.equal(a.lifeEpoch,4);
  assert.equal(a.sourceTimeRing,null);assert.equal(a.sourceTimeSickness,120);assert.equal(tryAddTimeRingRevive(sim,a,{damage:1000}),false);
});
test('ring nonlethal, expiry and sickness have distinct lifecycle',()=>{
  const a=actor('DE');const sim=simulate([a]);applyAddTimeRing(sim,a,skill(29213));assert.equal(tryAddTimeRingRevive(sim,a,{damage:999}),false);
  advanceAddSystems(a,16.5,opts);assert.equal(a.sourceTimeRing,null);assert.equal(tryAddTimeRingRevive(sim,a,{damage:1000}),false);
  a.sourceTimeSickness=120;advanceAddSystems(a,20,opts);assert.equal(a.sourceTimeSickness,100);
});

test('restoring a recorded empty DP pool releases formation before the outgoing owner report',()=>{
  const a=actor('DE'),sim=simulate([a]);applyAddTimeRing(sim,a,skill(29213));
  a.sourceAdd.dp=4000;startAddFormation(a,opts);a.hp=0;
  assert.equal(tryAddTimeRingRevive(sim,a),true);assert.equal(a.sourceAdd.dp,0);
  assert.equal(a.sourceAdd.formation,false);assert.equal(a.awakening.remaining,0);
});
test('serializable replay round trip preserves resource, event and frame-gate outcome',()=>{
  const first=actor('DE');first.sourceAdd.dp=7000;startAddFormation(first,opts);const second=JSON.parse(JSON.stringify(first));
  for(const a of [first,second]){for(let i=0;i<180;i++){advanceAddSystems(a,1/60,opts);if(i%30===0)addHitResources(a,{DYNAMO_PARTICLE_RATE_TYPE:2,DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1}},{...opts,step:i});}}
  assert.deepEqual(first,second);assert.equal(validateAddState(first.sourceAdd),true);
});
for(const [label,mutate]of Object.entries({nan:s=>s.dp=NaN,negative:s=>s.dp=-1,overflow:s=>s.dp=8001,fractional:s=>s.mutation=.5,unknown:s=>s.foo=1,
  invalidStep:s=>s.lastHitStep=1.5,injectedGenerator:s=>s.generator={skillId:29013,phase:'ready',generation:1,remaining:30,target:'enemy'},
  wrongSkill:s=>s.generator={skillId:29000,phase:'ready',generation:1,remaining:30}}))test('reject malformed network resource '+label,()=>{const s=actor().sourceAdd;mutate(s);assert.throws(()=>validateAddState(s));});
test('ring validator rejects excess duration, unknown members and invalid resources',()=>{
  const a=actor('DE'),sim=simulate([a]);applyAddTimeRing(sim,a,skill(29213));assert.equal(validateAddTimeRingState(a),true);
  for(const patch of [{remaining:99},{dp:9000},{mutation:7},{teleport:[0,0,0]}]){const b=structuredClone(a);Object.assign(b.sourceTimeRing,patch);assert.throws(()=>validateAddTimeRingState(b));}
});
