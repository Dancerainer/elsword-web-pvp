/** Original declarations are expectations; this fixture tests only Web NPC
 * scheduling/ownership boundaries. Native-pose QA is a separate artifact. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startAddApocalypse,finishAddApocalypse,tickAddSummons,validateAddSummonState,npcHitTargets,
 applyAddSummonDamage,triggerAddApocalypseEmergency} from '../../packages/combat-core/add-summons.mjs';
import {addSummonCombatActor,computeAddSummonHitDamage} from '../../packages/combat-core/add-summon-damage.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/add-apocalypse-source-v1.json',import.meta.url)));
function fixture(){
 const owner={id:'mm',professionId:'MM',team:0,x:0,y:0,z:0,facing:1,lineId:0,stateSerial:7,skillId:29604,skillScale:1.2,
  hp:1000,hpMax:2000,mp:100,sourceAdd:{dp:4000,mutation:3,formation:true},loadout:[{skillId:29604}],
  buffBaseStats:{physicalAttack:100,magicAttack:200,physicalDefence:20,magicDefence:40,criticalRate:50,criticalAttack:1.5},
  stats:{magicAttack:9999},buffs:[{behaviors:[{kind:'stat',stat:'magicAttack',value:99}]}],
  awakening:{remaining:99999},formulaRules:{combatLevel:99,attributeSemantics:'source-equipment-pvp-baseline-and-final-options'}};
 const g=source.tables,sets=new Set(Object.values(g).flatMap(s=>Object.values(s.EFFECT_SET_LIST_EX??{}).map(r=>r['1'])));
 for(const suffix of ['A_Projectile','B_Projectile','C'])sets.add('EffectSet_SI_HA_AMM_Apocalypse_Attack_'+suffix+'_PVP');
 const p={target:{unitClass:123},summonDeclarations:{apocalypse:{globals:g}},skillCatalog:[{skillId:29604,maxLevel:1,raw:{SA_EFFECTIVE_TIME:{1:60},SA_ULTIMATE_STRENGTHENED_SKILL_POWERRATE:{1:1.2}}}],
  effectSets:Object.fromEntries([...sets].map(name=>[name,{raw:{EFFECT1:{NAME:name+'-fixture',BONE_NAME:'Core',START_TIME:0}}}]))};
 const sim={state:{actors:[owner,{id:'target',team:1,x:300,y:0,z:0,hp:1000}],effects:[]},events:[],map:{lines:[{lineId:0,start:[-2000,0,0],end:[2000,0,0]}]},
  profileFor:()=>p,emit(type,id,data){this.events.push({type,id,...data});},note(){},
  summonPoseSampler:(npc)=>({position:[npc.position[0],npc.position[1]+37,npc.position[2]],rotation:[0,npc.yaw,npc.aimZ],facing:npc.facing}),
  summonDefenderSampler:npc=>[{center:npc.position,radius:10}],
  summonAnimationDuration:(npc,state)=>state.endsWith('START')?2.433333396911621:state.includes('FINISH')||state==='APOCALYPSE_DIE_ATTACK'?2.5:state.includes('_C')?3.8333332538604736:state.includes('_B')?3.299999952316284:2.8333332538604736,
  createEffect(actor,definition,opts){const e={id:this.state.effects.length+1,ownerId:actor.id,skillId:actor.skillId,powerMultiplier:actor.skillScale,definition,...opts};this.state.effects.push(e);return e;}};
 return {sim,owner,p};
}
test('source callbacks are ten original prototypes and 2016 AI priorities/Cooldowns are fixed',()=>{
 assert.equal(source.callbacks.length,10);assert.equal(source.source.sha256,'88829766340a21abb208a2edb2c81347e49e1ca38b61f7fc57e345ccea0f6eb9');
 assert.deepEqual(Object.values(source.tables.APOCALYPSE_WAIT.EVENT_PROCESS).map(r=>r['2']),['APOCALYPSE_ATTACK_C','APOCALYPSE_ATTACK_B','APOCALYPSE_ATTACK_A']);
 assert.deepEqual([4,5,6].map(n=>source.tables.INIT_STATE[n].STATE_COOL_TIME),[3,7,12]);
});
test('original Start emits six sourced hit sets, then original PvP C callback, using NPC anchors',()=>{
 const {sim,owner,p}=fixture();assert.equal(startAddApocalypse(sim,owner),true);
 assert.equal(owner.sourceAddSummon.hpMax,2000);assert.equal(owner.sourceAddSummon.position[0],300);
 for(let i=0;i<720;i++){tickAddSummons(sim,owner,1/120);validateAddSummonState(owner.sourceAddSummon,{owner,profile:p,actors:sim.state.actors});}
 const starts=sim.state.effects.filter(e=>e.setName.endsWith('_Start_Hit'));
 assert.equal(starts.length,6);assert.ok(sim.state.effects.some(e=>e.setName.endsWith('_Attack_C_PVP')));
 for(const e of sim.state.effects){assert.equal(e.sourceAddSummonSerial,7);assert.equal(e.powerMultiplier,1.2);assert.ok(e.birthAnchor.customPosition);}
});
test('HP loss touches only NPC pool and selects original DIE state without FINISH teleport',()=>{
 const {sim,owner}=fixture();startAddApocalypse(sim,owner);tickAddSummons(sim,owner,2.5);
 const target=npcHitTargets(sim)[0].actor,s=owner.sourceAddSummon,position=[...s.position],before={hp:owner.hp,mp:owner.mp,resource:structuredClone(owner.sourceAdd)};
 assert.equal(applyAddSummonDamage(sim,target,9999),true);assert.equal(s.hp,0);assert.equal(s.state,'APOCALYPSE_DIE_ATTACK');assert.deepEqual(s.position,position);
 assert.deepEqual({hp:owner.hp,mp:owner.mp,resource:owner.sourceAdd},before);
 tickAddSummons(sim,owner,2.5);assert.equal(owner.sourceAddSummon,null);
});
test('manual finish moves source X+150, emergency source callback moves +20 and owner gate blocks remote mutation',()=>{
 const {sim,owner}=fixture();startAddApocalypse(sim,owner);assert.equal(triggerAddApocalypseEmergency(sim,owner),true);
 assert.equal(owner.sourceAddSummon.position[0],20);assert.equal(owner.sourceAddSummon.state,'APOCALYPSE_ATTACK_A_EMERGENCY');
 assert.equal(finishAddApocalypse(sim,owner,'recast'),true);assert.equal(owner.sourceAddSummon.position[0],150);
 sim.networkOwnerId='target';const before=structuredClone(owner.sourceAddSummon);tickAddSummons(sim,owner,1);assert.deepEqual(owner.sourceAddSummon,before);
});

test('NPC-only empty buff creates original Always displayer and retires on NPC removal',()=>{
 const {sim,owner,p}=fixture(),name='EffectSet_SI_HA_AMM_Apocalypse_Always';
 p.buffFactors={443:{raw:{BUFF_TEMPLET_ID:414}}};p.buffTemplates={414:{raw:{DISPLAYER:{BDT_EFFECT_SET:{1:name}}}}};
 p.effectSets[name]={raw:{EFFECT0:{NAME:'cube-fixture',BONE_NAME:'Dummy_B01',TRACE_MATRIX:1}}};
 const buffs=structuredClone(owner.buffs);startAddApocalypse(sim,owner);
 const visual=sim.state.effects.find(e=>e.setName===name);assert.ok(visual);assert.deepEqual(visual.deleteConditions,[3]);
 assert.deepEqual(owner.buffs,buffs);finishAddApocalypse(sim,owner);assert.equal(visual.dead,undefined);
 tickAddSummons(sim,owner,2.5);assert.equal(visual.dead,true);assert.equal(visual.endReason,'summon-ended');
});
test('independent summon damage freezes declared base channels and requires explicit deterministic critical roll',()=>{
 const {owner}=fixture(),a=addSummonCombatActor(owner),b={stats:{physicalDefence:0,magicDefence:0},formulaRules:{combatLevel:99}};
 assert.equal(a.stats.magicAttack,200);assert.equal(a.awakening.remaining,0);assert.deepEqual(a.buffs,[]);assert.equal(a.passivePolicy,null);
 const data={DAMAGE_TYPE:1,DAMAGE:{MAGIC:2},PVP_RATE:.5};
 assert.equal(computeAddSummonHitDamage({attacker:a,defender:b,data,powerMultiplier:1.2}).amount,240);
 owner.stats.magicAttack=123456;assert.equal(computeAddSummonHitDamage({attacker:addSummonCombatActor(owner),defender:b,data,powerMultiplier:1.2}).amount,240);
 const native={evaluate:o=>({amount:o.amount*(o.roll<o.criticalRate?o.criticalAttack:1),critical:o.roll<o.criticalRate})};
 assert.throws(()=>computeAddSummonHitDamage({attacker:a,defender:b,data,nativeCritical:native}),/deterministic/);
 assert.equal(computeAddSummonHitDamage({attacker:a,defender:b,data,nativeCritical:native,roll:.49}).amount,300);
 assert.equal(computeAddSummonHitDamage({attacker:a,defender:b,data,nativeCritical:native,roll:.5}).amount,200);
});
