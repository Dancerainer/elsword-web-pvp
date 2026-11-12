/** Web transport invariants with a renderer-free actor fixture. These are not
 * target-client combat trajectories or a claim of authoritative anti-cheat. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {initializeAddSystems,syncAddAwakening,applyAddTimeRing,advanceAddSystems,tryAddTimeRingRevive,ADD_FORMATION_SENTINEL} from '../../packages/combat-core/add-systems.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,
  encodeCriticalAction,mergeOwnedActionActor} from '../../packages/online/owned-state.mjs';
import {startAddApocalypse,tickAddSummons} from '../../packages/combat-core/add-summons.mjs';
const base=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const source=JSON.parse(readFileSync(new URL('../../contracts/add-systems-source-v1.json',import.meta.url)));
const map={sceneId:'add-wire-fixture',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
function fixture(profession='LP'){
  // The stable RF constructor supplies only the ordinary wire container; Add
  // declarations and resource state are explicitly supplied below. No RF
  // combat rules serve as Add expected answers.
  const sim=createSimulation({profile:base,map,preset:{passives:[],guildPassives:[]},actors:[
    {id:'a',team:0,position:[0,0,0],lineId:0},{id:'seal',team:0,position:[0,0,0],lineId:0},
    {id:'enemy',team:1,position:[1000,0,0],lineId:0}]});
  const profiles={RF:base};
  for(const [id,unitClass]of Object.entries({LP:122,MM:123,DE:126}))profiles[id]={...base,profileId:'wire-'+id,
    target:{unitClass,unitType:9},components:source.components,skillCatalog:Object.entries(source.skills).map(([id,raw])=>({skillId:Number(id),raw})),
  };
  const a=sim.actor('a'),seal=sim.actor('seal');
  for(const [actor,id]of [[a,profession],[seal,'DE']]){
    actor.professionId=id;actor.profileId=profiles[id].profileId;actor.loadout=[{skillId:29213},{skillId:29013},{skillId:29035}];
    if(id!=='RF')initializeAddSystems(actor);
  }
  sim.profiles=profiles;sim.profileFor=actor=>profiles[actor.professionId];
  const context={actors:sim.state.actors,profiles};
  const report=()=>JSON.parse(JSON.stringify(encodeOwnedState(sim,'a',{epoch:2,frameSeq:10})));
  const check=value=>{const checked=validateOwnedState(value);validateOwnedReferences(checked,a,profiles[profession],map,context);return checked;};
  const receive=value=>applyOwnedState(sim,'a',check(value));
  return {sim,a,seal,profiles,report,check,receive};
}
const ring=(f,overrides={})=>({remaining:16.5,hp:f.a.hpMax*.5,mp:100,
  dp:f.a.sourceAdd?1234.5:null,mutation:f.a.sourceAdd?3:null,wayOfSword:null,sourceActorId:'seal',...overrides});

test('Output Exchange memo is only a learned LP source factor',()=>{
  const f=fixture();f.a.passivePolicy={skillLevels:{29403:3}};
  f.a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,outputExchangeFactor:357};
  const packet=f.report();f.receive(packet);assert.equal(f.a.sourceAddCombat.outputExchangeFactor,357);
  for(const id of ['MM','DE']){const other=fixture(id),p=other.report();other.a.passivePolicy={skillLevels:{29403:3}};
    p.actor.sourceAddCombat=packet.actor.sourceAddCombat;assert.throws(()=>other.check(p),/output-exchange-source/);}
  f.a.passivePolicy={skillLevels:{}};assert.throws(()=>f.check(packet),/output-exchange-source/);
});

test('Output Exchange DP behavior uses the original factor/template/value triple',()=>{
 const f=fixture();f.profiles.LP.buffTemplates={...f.profiles.LP.buffTemplates,335:{raw:{}}};
 f.profiles.LP.buffFactors={...f.profiles.LP.buffFactors,357:{raw:{BUFF_TEMPLET_ID:335,BEHAVIOR:{BBT_CHANGE_HYPER_CHARGE_SPEED:{BUFF_CHANGE_TYPE:3,PERCENT:{3:1.4}}}}}};
 // The declaration is JSON double; the Buff percentage consumer
 // stores binary32. This explicit wire fixture follows that numeric boundary.
 const expectedDpGain=Math.fround(1.4);assert.notEqual(expectedDpGain,1.4);
 f.a.buffs=[{schemaVersion:1,templateId:335,factorId:357,skillLevel:3,accumulationLimit:1,resistance:0,durationMultiplier:1,
  behaviors:[{type:72,kind:'addDpGain',value:expectedDpGain,changeType:3}],finalizers:[{kind:'time',remaining:99999,sourceDuration:99999}],displayer:{}}];
 const p=f.report();f.receive(p);assert.equal(f.a.buffs[0].behaviors[0].value,expectedDpGain);
 p.actor.buffs[0].behaviors[0].value=1.4;assert.throws(()=>f.check(p),/add-dp-buff/,'raw double cannot replace the exact binary32 Buff value');
 p.actor.buffs[0].behaviors[0].value=1.3;assert.throws(()=>f.check(p),/add-dp-buff/);
 p.actor.buffs[0].behaviors[0].value=9;assert.throws(()=>f.check(p),/actor-shape/);
});

test('Apocalypse snapshot and NPC-effect identity survive owner restoration with strict class/power bounds',()=>{
 const f=fixture('MM'),g=JSON.parse(readFileSync(new URL('../../contracts/add-apocalypse-source-v1.json',import.meta.url))).tables;
 f.profiles.MM.summonDeclarations={apocalypse:{globals:g}};
 f.profiles.MM.skillCatalog.push({skillId:29604,maxLevel:1,raw:{SA_EFFECTIVE_TIME:{1:60},SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE:{1:1.2}}});
 f.a.loadout.push({skillId:29604});f.a.skillId=29604;f.a.skillScale=1.2;f.a.stateSerial=5;
 f.sim.summonPoseSampler=n=>({position:n.position,facing:n.facing,rotation:[0,n.yaw,n.aimZ]});f.sim.summonAnimationDuration=()=>2.5;
 assert.equal(startAddApocalypse(f.sim,f.a),true);
 const set='EffectSet_SI_HA_AMM_Apocalypse_Start_Hit',name='apocalypse-wire-fixture';
 f.profiles.MM.effectSets={...f.profiles.MM.effectSets,[set]:{raw:{EFFECT1:{NAME:name,BONE_NAME:'Core'}}}};
 const e=f.sim.createEffect(f.a,{NAME:name,BONE_NAME:'Core'},{setName:set,clock:'custom'});
 e.definitionMember='EFFECT1';e.sourceAddSummonSerial=5;e.sourceAddSummonStateSerial=1;
 e.birthAnchor={position:[300,0,0],facing:1,rotation:[0,0,0],customPosition:true};
 const packet=f.report();f.receive(packet);assert.deepEqual(f.a.sourceAddSummon,packet.actor.sourceAddSummon);
 assert.equal(f.sim.state.effects.find(row=>row.networkId===e.id).sourceAddSummonSerial,5);
 for(const change of [p=>p.actor.sourceAddSummon.hpMax++,p=>p.actor.sourceAddSummon.targetId='seal',
  p=>p.actor.sourceAddSummon.skillScale=99,p=>p.actor.sourceAddSummon.cooldowns.APOCALYPSE_ATTACK_C=13,
  p=>p.actor.sourceAddSummon.unknown=true,p=>p.effects[0].sourceAddSummonStateSerial=0,
  p=>p.effects[0].powerMultiplier=99,p=>p.effects[0].birthAnchor.rotation=[1,2]]){
  const bad=structuredClone(packet);change(bad);assert.throws(()=>f.check(bad),/summon|actor-shape/);
 }
 const foreign=fixture('LP'),bad=foreign.report();bad.actor.sourceAddSummon=packet.actor.sourceAddSummon;assert.throws(()=>foreign.check(bad),/summon-profession/);
 const clear=structuredClone(packet);delete clear.actor.sourceAddSummon;clear.effects=[];f.receive(clear);assert.equal(f.a.sourceAddSummon,undefined);
});

test('compact Always wire preserves historical birth and rebuilds live NPC bones, including late and pending effects',()=>{
 for(const active of [false,true]){
  const f=fixture('MM'),set='EffectSet_SI_HA_AMM_Apocalypse_Always',name='ADD_APOCALYPSE_Cube001';
  const g=JSON.parse(readFileSync(new URL('../../contracts/add-apocalypse-source-v1.json',import.meta.url))).tables;
  f.profiles.MM.summonDeclarations={apocalypse:{globals:g,visual:set}};
  f.profiles.MM.skillCatalog.push({skillId:29604,maxLevel:1,raw:{SA_EFFECTIVE_TIME:{1:60},SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE:{1:1.2}}});
  f.a.loadout.push({skillId:29604});f.a.skillId=29604;f.a.skillScale=1.2;f.a.stateSerial=5;
  const sample=n=>({position:[n.position[0]+n.animationTime,n.position[1],n.position[2]],facing:n.facing,rotation:[0,n.yaw,n.aimZ],
   matrix:[1,0,0,0,0,1,0,0,0,0,1,0,n.position[0]+n.animationTime,n.position[1],n.position[2],1]});
  // Artificial matrices test transport identity only. The real 38-member
  // native-pose audit verifies every production matrix separately.
  f.sim.summonPoseSampler=sample;f.sim.summonAnimationDuration=()=>2.5;startAddApocalypse(f.sim,f.a);
  const definition={NAME:name,BONE_NAME:'Dummy_B01',TRACE_MORE:1,TRACE_MATRIX:1,EFFECT_TYPE:8};
  f.profiles.MM.effectSets={...f.profiles.MM.effectSets,[set]:{raw:{EFFECT0:definition}}};
  f.profiles.MM.effectTemplates={...f.profiles.MM.effectTemplates,[name]:{kind:'particle',fields:{}}};
  const e=f.sim.createEffect(f.a,definition,{setName:set,clock:'custom'});
  Object.assign(e,{definitionMember:'EFFECT0',sourceAddSummonSerial:5,sourceAddSummonStateSerial:1,active,
   birthAnchor:{...sample(f.a.sourceAddSummon),customPosition:true}});
  const birth=structuredClone(e.birthAnchor);f.a.sourceAddSummon.animationTime=.3;f.a.sourceAddSummon.position[0]+=80;
  e.currentAnchor={...sample(f.a.sourceAddSummon),customPosition:true};e.sourcePosedAnchor=structuredClone(e.currentAnchor);
  const live=structuredClone(e.currentAnchor),packet=f.report();
  assert.equal(packet.effects[0].sourceAddSummonPose,true);assert.deepEqual(packet.effects[0].birthAnchor,birth);
  assert.equal(packet.effects[0].currentAnchor,undefined);assert.equal(packet.effects[0].sourcePosedAnchor,undefined);
  f.sim.state.effects=[];f.sim.state.nextEffectId=9000;f.receive(packet);
  const restored=f.sim.state.effects.find(row=>row.networkId===e.id);
  assert.deepEqual(restored.birthAnchor,birth);assert.deepEqual(restored.currentAnchor,live);assert.deepEqual(restored.sourcePosedAnchor,live);
  for(const alter of [p=>p.effects[0].definitionMember='EFFECT99',p=>p.effects[0].definition={NAME:name,BONE_NAME:'Bip01'},
   p=>p.effects[0].sourceAddSummonSerial=6,p=>p.effects[0].currentAnchor=live,p=>delete p.effects[0].birthAnchor]){
   const bad=structuredClone(packet);alter(bad);assert.throws(()=>f.check(bad),/summon|effect/);
  }
  f.sim.summonPoseSampler=()=>null;assert.throws(()=>f.receive(packet),/pose-bone-required/);
  f.sim.summonPoseSampler=undefined;assert.throws(()=>f.receive(packet),/pose-sampler-required/);
 }
});

test('scaled Storm direct instance survives real owner encode/validation/reconstruction with different effect IDs',()=>{
  const f=fixture(),name='DamageEffect_ALP_Psychic_Storm_Loop';
  // Minimal frozen definition container; exact scalar/bone contract is tested
  // independently, and the native-resource QA exercises the complete catalog.
  f.profiles.LP.damageEffects={...base.damageEffects,[name]:{raw:{}}};
  const e=f.sim.createEffect(f.a,{NAME:name,SCALE_X:1.93,SCALE_Y:1.93,SCALE_Z:1.93,BONE_NAME:'Bip01_Footsteps'},{clock:'custom'});
  e.sourceAddStormSize=1.93;
  const packet=f.report();assert.equal(packet.effects[0].definition,undefined);
  f.sim.state.effects=[];f.sim.state.nextEffectId=9000;f.receive(packet);
  const restored=f.sim.state.effects.find(row=>row.networkId===e.id);
  assert.ok(restored);assert.notEqual(restored.id,e.id);
  assert.deepEqual(restored.definition,e.definition);
  for(const change of [p=>p.effects[0].sourceAddStormSize=99,p=>p.effects[0].name='unrelated']){
    const value=structuredClone(packet);change(value);assert.throws(()=>f.check(value),/storm/);
  }
});

test('Fury beam wire restores absolute link size and rejects foreign targets or identities',()=>{
  const f=fixture('MM'),name='DamageEffect_AMM_Ultimate_Fury_Dynamo',mesh='fury-wire-source-mesh';
  f.profiles.MM.damageEffects={...base.damageEffects,[name]:{raw:{MAIN_EFFECT_NAME:mesh}}};
  f.profiles.MM.effectTemplates={...base.effectTemplates,[mesh]:{initialSize:[1,.5,.5],fields:{}}};
  const e=f.sim.createEffect(f.a,{NAME:name,SCALE_X:.4,SCALE_Y:2,SCALE_Z:2},{clock:'custom'});
  e.skillId=29017;e.sourceAddLinkScale=.4;e.sourceAddFury={role:'beam',index:0,group:2,targetId:'enemy'};
  const packet=f.report();f.sim.state.effects=[];f.receive(packet);
  const restored=f.sim.state.effects.find(row=>row.networkId===e.id);assert.deepEqual(restored.definition,e.definition);
  for(const change of [p=>p.effects[0].sourceAddFury.targetId='seal',p=>p.effects[0].sourceAddFury.targetId='missing',
    p=>p.effects[0].sourceAddFury.group=-1,p=>p.effects[0].sourceAddFury.injected=true,
    p=>p.effects[0].sourceAddLinkScale=11,p=>p.effects[0].skillId=29035]){
    const value=structuredClone(packet);change(value);assert.throws(()=>f.check(value),/Fury/);
  }
  const foreign=fixture('LP'),p=foreign.report();p.effects=packet.effects;assert.throws(()=>foreign.check(p),/Fury/);
});

test('enhanced Rushing Drone explosion restores original target radius without peer scalar',()=>{
 const f=fixture('MM'),name='DamageEffect_AAT_Rushing_Drone_Explosion';f.profiles.MM.professionId='mm';
 f.profiles.MM.skillCatalog.push({skillId:29219,maxLevel:1,raw:{SA_PROJECTILE_SIZE:{1:1.3}}});
 f.profiles.MM.damageEffects={...f.profiles.MM.damageEffects,[name]:{raw:{}}};
 const e=f.sim.createEffect(f.a,{NAME:name,SCALE_X:1.3,SCALE_Y:1.3,SCALE_Z:1.3},{clock:'custom'});e.skillId=29219;
 const p=f.report();f.sim.state.effects=[];f.receive(p);
 assert.deepEqual(f.sim.state.effects.find(row=>row.networkId===e.id).definition,e.definition);
});

test('Phase snapshot and LP Stasis preserve only exact source-owned recast fields',()=>{
  for(const id of ['LP','MM','DE']){
    const f=fixture(id);f.a.loadout.push({skillId:29216});f.profiles[id].skillCatalog.push({skillId:29216,raw:{SA_EFFECTIVE_TIME:{1:8.8}}});
    f.a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,phase:{position:[1,2,3],remaining:8.8,group:1,skillId:29216}};
    const p=f.report();f.receive(p);assert.deepEqual(f.a.sourceAddCombat,p.actor.sourceAddCombat);
    const bad=structuredClone(p);bad.actor.sourceAddCombat.phase.remaining=8.81;assert.throws(()=>f.check(bad),/actor-shape/);
    f.a.loadout=[];assert.throws(()=>f.check(p),/phase-source/);
  }
  const f=fixture();f.a.loadout.push({skillId:29007});f.a.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,
    stasis:{remaining:15,hitValue:2500,damageValue:100,group:3,skillId:29007,powerMultiplier:1.2}};
  const p=f.report();f.receive(p);assert.deepEqual(f.a.sourceAddCombat,p.actor.sourceAddCombat);
  const other=fixture('MM'),q=other.report();q.actor.sourceAddCombat=p.actor.sourceAddCombat;other.a.loadout.push({skillId:29007});
  assert.throws(()=>other.check(q),/stasis-source/);
  p.actor.sourceAddCombat.stasis=null;f.receive(p);assert.equal(f.a.sourceAddCombat.stasis,null);
});

for(const profession of ['LP','MM','DE'])test(`${profession} wire round trip preserves DP/mutation, formation phase and cast counters`,()=>{
  const f=fixture(profession),s=f.a.sourceAdd;
  Object.assign(s,{dp:3750.5,mutation:4,formationPending:true,lastHitStep:44,lastReceivedStep:43});syncAddAwakening(f.a);
  f.a.sourceAddCombat={pulseCount:4,pulseOrder:[2,1,6,5,4,3],stormDuration:.8};
  f.a.sourceTimeRing=ring(f);f.a.sourceTimeSickness=0;
  const packet=f.report();assert.equal(packet.actor.awakening.remaining,ADD_FORMATION_SENTINEL);
  assert.doesNotThrow(()=>f.check(packet));
  f.a.sourceAdd.dp=0;f.a.sourceAddCombat.pulseOrder=[];f.receive(packet);
  assert.deepEqual(f.a.sourceAdd,packet.actor.sourceAdd);assert.deepEqual(f.a.sourceAddCombat,packet.actor.sourceAddCombat);
  assert.deepEqual(f.a.sourceTimeRing,packet.actor.sourceTimeRing);
  packet.actor.sourceAdd.dp=999;assert.equal(f.a.sourceAdd.dp,3750.5,'wire application detaches mutable state');
});

test('Add malformed nested ranges, unknown options and invalid permutations fail before mutation',()=>{
  const changes=[s=>s.dp=8000.1,s=>s.dp=-1,s=>s.mutation=1.5,s=>s.mutation=7,s=>s.formation='true',
    s=>s.lastHitStep=-2,s=>s.lastReceivedStep=.5,s=>s.switchCooldown=Infinity,s=>s.version='newer',
    s=>s.dpGainBonus=999,s=>s.generator={skillId:29013,phase:'injected',generation:1,remaining:10},
    s=>s.generator={skillId:29013,phase:'ready',generation:0,remaining:10},
    s=>s.generator={skillId:29013,phase:'ready',generation:1,remaining:10,targets:['enemy']}];
  for(const change of changes){const f=fixture('MM'),before=f.sim.snapshot(),p=f.report();change(p.actor.sourceAdd);
    assert.throws(()=>f.receive(p),/actor-shape|invalid-owner-number/);assert.deepEqual(f.sim.snapshot(),before);}
  for(const extra of [{pulseCount:9},{pulseCount:.5},{pulseOrder:[1,1,2,3,4,5]},
    {pulseOrder:[1,2]},{pulseOrder:[0,1,2,3,4,5]},{stormDuration:2.81},{unbounded:1}]){
    const f=fixture(),p=f.report();p.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,...extra};
    assert.throws(()=>f.check(p),/actor-shape/);
  }
});

test('Add class isolation rejects omitted state, ordinary soul/core and mismatched formation mirror',()=>{
  const changes=[p=>delete p.actor.sourceAdd,p=>p.actor.awakening.gauge=50,p=>p.actor.awakening.orbs=1,
    p=>p.actor.awakening.remaining=1,p=>p.actor.core.level=1,p=>p.actor.sourceAdd.switchCooldown=5.1,
    p=>{p.actor.sourceAdd.formation=true;p.actor.awakening.remaining=99999;}];
  for(const change of changes){const f=fixture(),p=f.report();change(p);assert.throws(()=>f.check(p),/add-/);}
  const f=fixture('RF'),p=f.report(),add=fixture().report().actor.sourceAdd;p.actor.sourceAdd=add;
  assert.throws(()=>f.check(p),/add-profession/);delete p.actor.sourceAdd;
  p.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8};assert.throws(()=>f.check(p),/add-profession/);
});

test('generator requires MM, equipped target identity and per-generator source lifetime',()=>{
  const f=fixture('MM'),p=f.report();p.actor.sourceAdd.generator={skillId:29013,phase:'firing',generation:12,remaining:30};
  assert.doesNotThrow(()=>f.check(p));p.actor.sourceAdd.generator.remaining=30.01;assert.throws(()=>f.check(p),/add-generator/);
  p.actor.sourceAdd.generator={skillId:29035,phase:'ready',generation:13,remaining:45};assert.doesNotThrow(()=>f.check(p));
  f.a.loadout=[];assert.throws(()=>f.check(p),/add-generator/);
  for(const id of ['LP','DE']){const other=fixture(id),q=other.report();q.actor.sourceAdd.generator=p.actor.sourceAdd.generator;
    assert.throws(()=>other.check(q),/add-generator/);}
});

test('storm duration is checked against the frozen skill declaration, not just a broad number',()=>{
  const f=fixture(),p=f.report();p.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:2.8};
  assert.throws(()=>f.check(p),/add-storm/);
  f.profiles.LP.skillCatalog.push({skillId:29011,executor:'PsychicStorm',raw:{SA_EFFECTIVE_TIME_HYPER:{1:2}}});
  assert.doesNotThrow(()=>f.check(p));p.actor.sourceAddCombat.stormDuration=1.8;assert.throws(()=>f.check(p),/add-storm/);
});

test('storm mutation duration and size must form a target-declared pair for zero through three points',()=>{
  const f=fixture(),p=f.report();f.profiles.LP.skillCatalog.find(skill=>skill.skillId===29009).executor='PsychicStorm';
  for(let count=0;count<=3;count++){
    p.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8+.2+.235*count,stormSize:1+.31*count};
    assert.doesNotThrow(()=>f.check(p));
    p.actor.sourceAddCombat.stormSize=1.1;assert.throws(()=>f.check(p),/storm-duration/);
  }
  p.actor.sourceAddCombat.stormSize=1.94;assert.throws(()=>f.check(p),/actor-shape/);
});

test('Nasod target is an optional enemy identity shared by all Add classes',()=>{
  for(const id of ['LP','MM','DE']){
    const f=fixture(id),p=f.report();p.actor.sourceAddCombat={pulseCount:0,pulseOrder:[],stormDuration:.8,nasodTargetId:'enemy',nasodFlag:true};
    assert.doesNotThrow(()=>f.check(p));
    for(const target of ['a','seal','missing']){p.actor.sourceAddCombat.nasodTargetId=target;assert.throws(()=>f.check(p),/nasod-target/);}
    p.actor.sourceAddCombat.nasodTargetId=null;p.actor.sourceAddCombat.nasodFlag=false;assert.doesNotThrow(()=>f.check(p));
    p.actor.sourceAddCombat.nasodTargetId='';assert.throws(()=>f.check(p),/actor-shape/);
  }
});

for(const profession of ['RF','LP'])test(`time seal supports ${profession}, checks saved pools and verifies same-team equipped DE`,()=>{
  const f=fixture(profession);f.a.sourceTimeRing=ring(f);f.seal.hp=0;const p=f.report();
  assert.doesNotThrow(()=>f.check(p),'dead caster can have applied a still-live seal');
  for(const override of [{hp:f.a.hpMax+1},{mp:f.a.mpMax+1},{sourceActorId:'enemy'},
    {sourceActorId:'unknown'},{wayOfSword:1},profession==='RF'?{dp:0,mutation:0}:{dp:null,mutation:null}]){
    const q=structuredClone(p);Object.assign(q.actor.sourceTimeRing,override);assert.throws(()=>f.check(q),/time-ring/);
  }
  f.seal.team=1;assert.throws(()=>f.check(p),/time-ring-source/);f.seal.team=0;
  f.seal.loadout=[];assert.throws(()=>f.check(p),/time-ring-source/);
});

test('ring and sickness containers reject unknown payloads and recursive history forgery',()=>{
  const f=fixture(),p=f.report();p.actor.sourceTimeRing=ring(f);p.actor.sourceTimeSickness=120;
  for(const [key,value]of [['remaining',16.6],['hp',-1],['mutation',6.5],['dp',8001],['sourceActorId',''],['teleport',[1,2,3]]]){
    const q=structuredClone(p);q.actor.sourceTimeRing[key]=value;assert.throws(()=>f.check(q),/actor-shape/);
  }
  const q=structuredClone(p);q.actor.sourceTimeSickness=120.1;assert.throws(()=>f.check(q),/actor-shape/);
  p.actions=[{id:1,frameSeq:1,actor:{sourceAdd:{...p.actor.sourceAdd,dp:Infinity}},effects:[]}];
  assert.throws(()=>f.check(p),/actor-shape|invalid-owner-number/);
});

test('earlier critical samples cannot inherit later seal, sickness or first-cast state',()=>{
  const f=fixture(),earlier=encodeCriticalAction(f.report(),{id:1,frameSeq:1});
  f.a.sourceTimeRing=ring(f);f.a.sourceTimeSickness=12;f.a.sourceAddCombat={pulseCount:3,pulseOrder:[1,2,3,4,5,6],stormDuration:.8};
  const current=f.report(),merged=mergeOwnedActionActor(current.actor,earlier.actor);
  for(const key of ['sourceTimeRing','sourceTimeSickness','sourceAddCombat'])assert.equal(Object.hasOwn(merged,key),false,key);
  current.actions=[earlier];assert.doesNotThrow(()=>f.check(current));
  const ended=f.report();for(const key of ['sourceTimeRing','sourceTimeSickness','sourceAddCombat'])delete ended.actor[key];
  f.receive(ended);for(const key of ['sourceTimeRing','sourceTimeSickness','sourceAddCombat'])assert.equal(Object.hasOwn(f.a,key),false,key);
});

test('local DE cast changes only its own actor and emits an exact serializable delivery notice',()=>{
  const f=fixture('DE');f.sim.networkOwnerId='a';const remote=structuredClone(f.seal);
  assert.equal(applyAddTimeRing(f.sim,f.a,{skillId:29213}),1);assert.deepEqual(f.seal,remote);
  const p=f.report();assert.deepEqual(p.actor.sourceTimeRingNotice,{serial:1,remaining:16.5,position:[0,0,0],skillId:29213});
  assert.doesNotThrow(()=>f.check(p));
  advanceAddSystems(f.a,20,{profile:f.profiles.DE});assert.equal(f.a.sourceTimeRingNotice.remaining,0);
  applyAddTimeRing(f.sim,f.a,{skillId:29213});assert.equal(f.a.sourceTimeRingNotice.serial,2);
  const before=structuredClone(f.a);assert.equal(applyAddTimeRing(f.sim,f.seal,{skillId:29213}),0);assert.deepEqual(f.a,before);
});

function castNotice(f,{serial=1,epoch=1,remaining=16.5,position=[0,0,0]}={}){
  f.seal.sourceTimeRingNotice={serial,remaining,position,skillId:29213};
  return encodeOwnedState(f.sim,'seal',{epoch,frameSeq:20+serial});
}
const receiveNotice=(f,p,options={})=>{
  const verified=validateOwnedState(p);validateOwnedReferences(verified,f.seal,f.profiles.DE,map,{actors:f.sim.state.actors,profiles:f.profiles});
  return applyOwnedState(f.sim,'seal',verified,options);
};

test('DE notice delivery reaches the local non-Add teammate once after the animation event has passed',()=>{
  const f=fixture('RF');f.sim.networkOwnerId='a';f.a.cooldowns={24000:40};
  f.profiles.RF.skillCatalog=[...f.profiles.RF.skillCatalog,{skillId:24000,type:0}];
  const p=castNotice(f);p.actor.fired=['time-ring'];p.actor.stateTime=3;
  receiveNotice(f,p,{presentationAge:2});assert.equal(f.a.sourceTimeRing.remaining,14.5);assert.equal(f.a.cooldowns[24000],16);
  const saved=structuredClone(f.a.sourceTimeRing);f.a.mp=0;receiveNotice(f,p);
  assert.deepEqual(f.a.sourceTimeRing,saved);assert.equal(f.a.cooldowns[24000],16);
  f.a.hp=0;assert.equal(tryAddTimeRingRevive(f.sim,f.a),true);assert.equal(f.a.sourceTimeSickness,120);
  receiveNotice(f,p);assert.equal(f.a.sourceTimeRing,null,'repeated notice cannot resurrect consumed ring');
});

test('notice receipts survive JSON snapshots and reject old epoch, serial and historical pose replay',()=>{
  const f=fixture('LP');f.sim.networkOwnerId='a';let p=castNotice(f,{serial:2,epoch:3});
  receiveNotice(f,p,{endMissing:false});assert.equal(f.a.sourceTimeRing,undefined,'critical collision history is not buff delivery');
  receiveNotice(f,p);f.sim.state=JSON.parse(JSON.stringify(f.sim.snapshot()));
  f.a=f.sim.actor('a');f.seal=f.sim.actor('seal');f.a.sourceTimeRing=null;
  receiveNotice(f,p);assert.equal(f.a.sourceTimeRing,null);
  receiveNotice(f,castNotice(f,{serial:1,epoch:3}));assert.equal(f.a.sourceTimeRing,null);
  receiveNotice(f,castNotice(f,{serial:99,epoch:2}));assert.equal(f.a.sourceTimeRing,null);
  receiveNotice(f,castNotice(f,{serial:1,epoch:4}));assert.equal(f.a.sourceTimeRing.remaining,16.5,'clean new life may restart serial');
});

test('delivery uses cast position once and consumes expired, out-of-range, enemy or sick notices',()=>{
  for(const reason of ['expired','range','enemy','sick']){
    const f=fixture();f.sim.networkOwnerId='a';const p=castNotice(f);
    if(reason==='range')f.a.x=701;if(reason==='enemy')f.a.team=1;if(reason==='sick')f.a.sourceTimeSickness=2;
    f.seal.x=9000;receiveNotice(f,p,{presentationAge:reason==='expired'?16.5:0});assert.equal(f.a.sourceTimeRing,undefined,reason);
    f.a.x=0;f.a.team=0;f.a.sourceTimeSickness=0;receiveNotice(f,p);assert.equal(f.a.sourceTimeRing,undefined,'same notice cannot be retried after eligibility changes');
  }
});

test('notice schema and class gate cannot inject arbitrary recipient state or an arbitrary skill',()=>{
  const f=fixture('DE'),p=f.report();p.actor.sourceTimeRingNotice={serial:1,remaining:16.5,position:[0,0,0],skillId:29213};
  for(const changes of [{serial:0},{remaining:17},{position:[0,0]},{position:[1e8,0,0]},{skillId:29214},{hp:99999}]){
    const q=structuredClone(p);Object.assign(q.actor.sourceTimeRingNotice,changes);assert.throws(()=>f.check(q),/actor-shape/);
  }
  const other=fixture('LP'),q=other.report();q.actor.sourceTimeRingNotice=p.actor.sourceTimeRingNotice;
  assert.throws(()=>other.check(q),/notice-source/);f.a.loadout=[];assert.throws(()=>f.check(p),/notice-source/);
});

for(const casterFirst of [false,true])test(`room baseline applies time seal after all local life replacements, casterFirst=${casterFirst}`,()=>{
  const f=fixture('RF');f.sim.networkOwnerId='a';const sync=createLocalOwnershipSync();
  const packet=castNotice(f),snapshot=JSON.parse(JSON.stringify(f.sim.snapshot()));
  if(casterFirst)snapshot.actors.sort((a,b)=>Number(b.id==='seal')-Number(a.id==='seal'));
  const value={snapshot,ownership:{mode:'local-owner-v1',actors:Object.fromEntries(snapshot.actors.map(a=>[a.id,{epoch:1}]))},
    owners:{seal:packet},pvp:{phase:'fight',fightTime:1,players:snapshot.actors.map(a=>({id:a.id,alive:true,connected:true,lockUntil:null,invincibleUntil:null}))}};
  sync.reconcile(f.sim,value,'a');const a=f.sim.actor('a');assert.ok(a.sourceTimeRing);assert.equal(a.sourceTimeRing.remaining,16.5);
  const saved=structuredClone(a.sourceTimeRing);sync.reconcile(f.sim,value,'a');assert.deepEqual(a.sourceTimeRing,saved);
  assert.equal(f.sim.deferAddTimeRingNotices,false);assert.equal(f.sim.pendingAddTimeRingNotices,undefined);
});

test('failed room validation clears deferred seal delivery before a later valid report',()=>{
  const f=fixture('RF');f.sim.networkOwnerId='a';const sync=createLocalOwnershipSync();
  const packet=castNotice(f),snapshot=JSON.parse(JSON.stringify(f.sim.snapshot()));snapshot.actors.sort((a,b)=>Number(b.id==='seal')-Number(a.id==='seal'));
  const value={snapshot,ownership:{mode:'local-owner-v1',actors:{seal:{epoch:1}}},owners:{seal:packet},pvp:{phase:'fight',fightTime:1,players:[]}};
  assert.throws(()=>sync.reconcile(f.sim,value,'a'),/invalid-life-epoch/);
  assert.equal(f.sim.actor('a').sourceTimeRing,undefined);assert.equal(f.sim.pendingAddTimeRingNotices,undefined);assert.equal(f.sim.deferAddTimeRingNotices,false);
});
