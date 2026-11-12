import test from 'node:test';
import assert from 'node:assert/strict';
import lp from '../../packages/combat-core/lp-profile.json' with {type:'json'};
import mm from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import de from '../../packages/combat-core/de-profile.json' with {type:'json'};
import {applyAddEnergyBoomMutation} from '../../packages/combat-core/add-mutation-2016.mjs';
import {addInstanceDefinition,validateAddStormEffectState} from '../../packages/combat-core/add-effect-state.mjs';
import {startAddFury,tickAddFury,assignAddFuryTargets} from '../../packages/combat-core/add-fury.mjs';
import {startAddCommandFury,ADD_COMMAND_FURY_BEAM} from '../../packages/combat-core/add-command-fury-2016.mjs';
import {validateAddFuryEffectState} from '../../packages/combat-core/add-linked-effect-state.mjs';
import {addStasisDamageObserved,addStasisMultiplier,addStasisRefund,addRecastStateStart,addRecastEvents,tickAddRecasts} from '../../packages/combat-core/add-recasts.mjs';
import {addOriginalRandomQ} from '../../packages/combat-core/add-random-table-2016.mjs';
import {fireAddConqueror} from '../../packages/combat-core/add-conqueror-2016.mjs';
import {addSkillResourceCost,consumeAddMutation} from '../../packages/combat-core/add-systems.mjs';
import {startAddMagnetron} from '../../packages/combat-core/add-magnetron.mjs';
import {initializeAddStardust,endAddStardust,tickAddStardust} from '../../packages/combat-core/add-analysis-skills.mjs';
const f=Math.fround;
function fixture(p=lp){
 const a={id:'add',professionId:p.professionId.toUpperCase(),state:'RSI_WAIT',stateSerial:7,team:0,x:0,y:0,z:0,facing:1,hp:1000,hpMax:1000,mp:300,mpMax:400,skillScale:1,skillId:null,skillContext:{},passivePolicy:{skillLevels:{}},cooldowns:{},sourceAdd:{formation:true,dp:4000,mutation:3,generator:{skillId:29017}},sourceAddCombat:{pulseCount:0,pulseOrder:[],stormDuration:.8,stormSize:1}};
 const b={id:'enemy',team:1,x:300,y:0,z:0,hp:1000},events=[],notes=[],bones=[];
 const sim={state:{seed:2016,nextEffectId:1,effects:[],actors:[a,b]},map:{lines:[{lineId:1,start:[0,0,0],end:[1000,0,0]}]},profileFor:()=>p,
  emit:(type,id,payload)=>events.push({type,id,...payload}),note:(...v)=>notes.push(v),effectAnchorSampler:(e,actor)=>({position:[actor.x,actor.y,actor.z],rotation:[0,0,0]}),
  effectBoneSampler:(e,actor,bone)=>{bones.push(bone);return [10,0,0];},
  createEffect(actor,definition,options={}){const raw=p.damageEffects[definition.NAME]?.raw,main=raw?.MAIN_EFFECT_NAME??definition.NAME,template=p.effectTemplates[main],e={id:this.state.nextEffectId++,name:definition.NAME,ownerId:actor.id,skillId:actor.skillId??null,ownerStateSerial:actor.stateSerial,powerMultiplier:actor.skillScale??1,definition:{...definition},birthAnchor:options.birthAnchor??{position:[actor.x,actor.y,actor.z],rotation:[0,0,0]},...options,mainEffectName:main,lifeTimeSeconds:template?.fields?.LifeTime??1,damage:raw,sourceShadowMesh:{maxLifeTime:template?.fields?.LifeTime??1}};this.state.effects.push(e);return e;},
  spawnSet(actor,name){return this.createEffect(actor,{NAME:name},{setName:name});},
  fire(actor,id,time,before,after,fn){if(before<time&&after>=time&&!actor.fired?.includes(id)){(actor.fired??=[]).push(id);fn();}},
  skillAvailability:()=>({mpCost:150})};a.lineId=1;a.lastTouchLineId=1;
 return {sim,a,b,events,notes,bones,p};
}
test('Energy Boom changes this instance lifetime and dimensions, pays one after creation, preserves damage scalar',()=>{
 const {sim,a}=fixture();a.skillId=29026;const e=sim.createEffect(a,{NAME:'DamageEffect_SI_SA_AN_Energy_Boom_Projectile'}),before=e.lifeTimeSeconds;
 assert.equal(applyAddEnergyBoomMutation(sim,a,e,{consumeMutation:consumeAddMutation}),true);
 assert.equal(a.sourceAdd.mutation,2);assert.equal(e.lifeTimeSeconds,f(before*1.4));assert.equal(e.sourceShadowMesh.maxLifeTime,f(before*1.4));assert.equal(e.definition.SCALE_X,1.5);assert.equal(e.powerMultiplier,1);
 assert.equal(addInstanceDefinition(lp,e,{NAME:e.name}).SCALE_Y,1.5);assert.throws(()=>validateAddStormEffectState({...e,skillId:29008},lp));
 const mutation=a.sourceAdd.mutation;assert.equal(applyAddEnergyBoomMutation(sim,a,null,{consumeMutation:consumeAddMutation}),false);assert.equal(a.sourceAdd.mutation,mutation);
});
test('Fury original two-target loop overwrites without break; fourth row with only three candidates stays untouched',()=>{
 const rows=Array.from({length:4},()=>({targetId:null}));assignAddFuryTargets(rows,rows,[{id:'a'},{id:'b'}]);assert.deepEqual(rows.map(r=>r.targetId),['b','a','a','a']);
 for(const r of rows)r.targetId=null;assignAddFuryTargets(rows,rows,[{id:'a'},{id:'b'},{id:'c'}]);assert.deepEqual(rows.map(r=>r.targetId),['a','b','c',null]);
});
test('Installation Fury pays exactly three for four real records, uses AttackDummy04 and counts only first three attempts',()=>{
 const {sim,a,bones}=fixture(mm);a.skillId=29017;sim.createEffect(a,{NAME:'DAMAGE_EFFECT_Ultimate_Fury_Generate'});
 startAddFury(sim,a,{consumeMutation:consumeAddMutation});assert.equal(a.sourceAdd.mutation,0);
 let drones=sim.state.effects.filter(e=>e.sourceAddFury?.role==='drone');assert.equal(drones.length,4);
 tickAddFury(sim,a,.1);assert.equal(sim.state.effects.filter(e=>e.sourceAddFury?.role==='beam').length,0,'assignment applies after current-loop attack attempts');
 tickAddFury(sim,a,.1);assert.equal(sim.state.effects.filter(e=>e.sourceAddFury?.role==='beam').length,4);assert.ok(bones.includes('AttackDummy04'));assert.ok(Math.abs(drones[0].sourceAddFury.activeElapsed-.3)<1e-6);
 for(const e of sim.state.effects.filter(e=>e.sourceAddFury))validateAddFuryEffectState(e,'MM',sim.state.actors);
 const f2=fixture(mm);f2.a.sourceAdd.mutation=2;startAddFury(f2.sim,f2.a,{consumeMutation:consumeAddMutation});assert.equal(f2.a.sourceAdd.mutation,2);assert.equal(f2.sim.state.effects.length,3);
});
test('Command Fury uses three Weapon03..05 drones and dedicated command DD, independent of installation29017',()=>{
 const {sim,a}=fixture(mm);assert.equal(startAddCommandFury(sim,a),true);assert.equal(sim.state.effects.length,3);
 assert.ok(sim.state.effects.every(e=>e.skillId===null));tickAddFury(sim,a,.01);tickAddFury(sim,a,.01);
 const beams=sim.state.effects.filter(e=>e.name===ADD_COMMAND_FURY_BEAM);assert.equal(beams.length,3);
 for(const e of sim.state.effects)validateAddFuryEffectState(e,'MM',sim.state.actors);
 const dd=mm.damageEffects.DamageEffect_ANSI_AMM_COMBO_ZZXX_Attack.raw.DAMAGE_DATA;assert.equal(dd.DAMAGE.PHYSIC,.27);assert.equal(dd.PVP_RATE,.6);assert.equal(dd.ATTACK_TYPE,2);assert.equal(dd.USED_SKILL_ID,undefined);
 tickAddFury(sim,a,2);assert.ok(sim.state.effects.every(e=>e.dead));
});
test('Stasis has independent A and weighted B caps; burst reaches2x but mesh size caps1.5; refund uses current cost',()=>{
 const {sim,a}=fixture();a.state='ANSI_SA_APT_STASIS_FIELD';a.skillId=29007;addRecastStateStart(sim,a);
 addStasisDamageObserved(a,600);addStasisDamageObserved(a,100,{received:true});assert.equal(a.sourceAddCombat.stasis.damageValue,500);
 assert.equal(addStasisMultiplier(a.sourceAddCombat.stasis,a.hpMax),2);assert.ok(Math.abs(addStasisRefund(a.sourceAddCombat.stasis,a.hpMax,150)-150)<.0001);
 a.state='ANSI_SA_APT_STASIS_FIELD_ACTIVE';addRecastStateStart(sim,a);assert.equal(a.sourceAddCombat.stasis.remaining,0);assert.equal(a.sourceAddCombat.stasis.powerMultiplier,2);
 addRecastEvents(sim,a,0,.01);addRecastEvents(sim,a,.29,.31);
 const e=sim.state.effects.find(e=>e.name==='DamageEffect_APT_Stasis_Field_Activate');assert.equal(e.powerMultiplier,2);assert.equal(e.definition.SCALE_X,1.5);assert.equal(a.sourceAddCombat.stasis,null);
 const s=fixture();s.a.state='ANSI_SA_APT_STASIS_FIELD';s.a.skillId=29007;s.a.loadout=[{skillId:29007}];addRecastStateStart(s.sim,s.a);s.a.mp=0;tickAddRecasts(s.sim,s.a,15);assert.ok(Math.abs(s.a.mp-50)<.00001);
});
test('Conqueror original table stays indexed, has exact known first Q values and consumes ordinary mutation before15 attempts',()=>{
 assert.equal(addOriginalRandomQ(0),47);assert.equal(addOriginalRandomQ(1),24);assert.equal(addOriginalRandomQ(32000),47);assert.equal(addOriginalRandomQ(-1),addOriginalRandomQ(31999));
 const {sim,a}=fixture();a.skillId=29008;a.sourceAdd.formation=false;fireAddConqueror(sim,a,{consumeMutation:consumeAddMutation});
 assert.equal(sim.state.effects.length,15);assert.equal(a.sourceAdd.mutation,0);const seed=2016;
 const r=sim.state.effects[0].birthAnchor.rotation;assert.deepEqual(r,[0,2*addOriginalRandomQ(seed)-135,2*addOriginalRandomQ(seed,15)-135]);
 const again=fixture();again.a.skillId=29008;fireAddConqueror(again.sim,again.a,{hyper:true,consumeMutation:consumeAddMutation});assert.equal(again.sim.state.effects.length,4);assert.equal(again.sim.state.effects.at(-1).name,'DamageEffect_SA_APT_Conqueror_Hyper');
});
test('Activator half-price is exact eight-ID mapping, timer-only and excludes Activator itself',()=>{
 const {a}=fixture(mm);a.sourceAdd.formation=false;a.sourceAddDroneMark={remaining:1,targetId:'already-dead'};
 for(const id of [29203,29205,29208,29209,29210,29211,29218,29219]){const s=mm.skillCatalog.find(s=>s.skillId===id);if(!s)continue;assert.equal(addSkillResourceCost(a,s,{profile:mm,mpCost:40,cooldown:2}).mpCost,20);}
 const own=mm.skillCatalog.find(s=>s.skillId===29013);assert.notEqual(addSkillResourceCost(a,own,{profile:mm,mpCost:40,cooldown:2}).mpCost,20);
});
test('Magnetron with an existing valid marker releases all holders and clears ordinary feedback throttle',()=>{
 const {sim,a}=fixture(mm);a.skillId=29205;a.sourceAddDroneMark={remaining:3,targetId:'enemy',targetEpoch:0};startAddMagnetron(sim,a);
 const shots=sim.state.effects.filter(e=>e.name==='DamageEffect_SA_APT_Magnetron_Dynamo_Projectile');assert.equal(shots.length,3);assert.ok(shots.every(e=>e.sourceAddLockOn.targetId==='enemy'&&e.sourceAddMarkedDrone.unlockRemaining===f(.1)));assert.equal(a.sourceAddCombat.magnetron.ready,0);
});
test('Stardust real main exit activates persistent shower without invented followup states; timer emits finite End',()=>{
 const {sim,a}=fixture(de);a.skillId=29021;a.state='ANSI_SA_ATT_STARDUST_SHOWER';initializeAddStardust(sim,a,{consumeMutation:consumeAddMutation});assert.equal(a.sourceAddNative[0].active,false);
 endAddStardust(sim,a);assert.equal(a.sourceAddNative[0].active,true);assert.ok(sim.state.effects.some(e=>e.name==='Mesh_ATT_Stardust_Shower_Drop'));
 a.state='RSI_WAIT';tickAddStardust(sim,a,.1);assert.ok(sim.state.effects.some(e=>e.name==='DamageEffect_ATT_Stardust_Shower_Ball'));
 tickAddStardust(sim,a,4);assert.equal(a.sourceAddNative.length,0);assert.ok(sim.state.effects.some(e=>e.setName==='EffectSet_ATT_Stardust_Shower_End'));
 assert.equal(de.skillCatalog.find(s=>s.skillId===29021).supported,true);
});
