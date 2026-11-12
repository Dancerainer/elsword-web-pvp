import test from 'node:test';
import assert from 'node:assert/strict';
import mm from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import source from '../../contracts/add-installation-power-source-v56.json' with {type:'json'};
import {initializeAddPassives} from '../../packages/combat-core/add-passives.mjs';
import {addEvents} from '../../packages/combat-core/add-skills.mjs';
import {startAddFury,tickAddFury} from '../../packages/combat-core/add-fury.mjs';
import {startAddCommandFury} from '../../packages/combat-core/add-command-fury-2016.mjs';
import {startAddStarfall,startAddShootingChaser,tickAddStarfall,tickAddShootingChaser,addShootingChaserContact,
 STARFALL_CARRIER,CHASER_ATTACKER,CHASER_SETS} from '../../packages/combat-core/add-analysis-skills.mjs';
import {addDamageModifiers} from '../../packages/combat-core/add-nasod.mjs';
import {addDynamoEvents} from '../../packages/combat-core/add-dynamo-skills.mjs';
import {startAddMagnetron,fireAddMagnetronAll,MAGNETRON_PROJECTILE} from '../../packages/combat-core/add-magnetron.mjs';
import {addInstallationFactoryActor2016} from '../../packages/combat-core/add-installation-power-2016.mjs';
const f=Math.fround,base=2,expected=f(base*f(1.15)); // original SA15[3], one FMUL/FSTP
const nativeValues={abilityValue:(values,level)=>values[level],increasingRate:value=>value-1};
test('original29409 scalar and per-factory classification are independent frozen inputs',()=>{
 assert.equal(source.freeze,'c3be320c07b5f2158b513093010d22dcb15491ee');
 assert.deepEqual(source.parameter.levels,[1.05,1.1,1.15]);assert.equal(source.getter.target,'0x31f31bd0');
 assert.equal(source.getter.body.bytesHex,'518d81c45c00008b480433c88b400833c1890424d9042459c3');
 const raw=mm.skillCatalog.find(s=>s.skillId===29409).raw.SA_DAMAGE_REL;
 assert.deepEqual([raw[1],raw[2],raw[3]],[1.05,1.1,1.15]);
 assert.deepEqual(source.factories.filter(row=>row.consumer.startsWith('explicit')).map(row=>row.entry).sort(),
  ['0x32740500','0x32761ac0','0x32766960','0x32768200']);
});
function fixture({formed=false,learned=true}={}){
 const policy=initializeAddPassives(mm,{nativeValues,passiveIds:learned?[29409]:[]});
 const a={id:'add',professionId:'MM',state:'RSI_WAIT',team:0,stateSerial:7,x:0,y:0,z:0,facing:1,hp:1000,
  lineId:1,skillId:null,skillScale:base,skillContext:{},passivePolicy:policy,
  sourceAdd:{formation:formed,dp:4000,mutation:3,generator:{skillId:29017}},sourceAddCombat:{}};
 const b={id:'enemy',team:1,x:200,y:0,z:0,hp:1000},effects=[];
 const sim={state:{actors:[a,b],effects,nextEffectId:1},map:{lines:[{lineId:1,start:[0,0,0],end:[1000,0,0]}]},profileFor:()=>mm,
  note(){},emit(){},fire(_actor,_id,t,before,after,fn){if(before<t&&after>=t)fn();},
  effectAnchorSampler:(_definition,actor)=>({position:[actor.x,actor.y+80,actor.z]}),effectBoneSampler:()=>[0,80,0],
  createEffect(actor,definition,options={}){const e={id:this.state.nextEffectId++,ownerId:actor.id,name:definition.NAME,
   powerMultiplier:actor.skillScale,skillId:actor.skillId,definition,lifeTimeSeconds:2,
   birthAnchor:options.birthAnchor??{position:[actor.x,actor.y,actor.z],rotation:[0,0,0],facing:1}};effects.push(e);return e;},
  spawnSet(actor,name){return this.createEffect(actor,{NAME:name});}};
 return {sim,a,b,effects};
}
const roots={activator:'DamageEffect_AAT_Dynamo_Factory_Projectile',fury:'Mesh_ADD_Ultimate_Fury_Attack_Dron',starfall:STARFALL_CARRIER,chaser:CHASER_ATTACKER};
function start(kind,sim,a){
 if(kind==='activator'){a.skillId=29013;a.state='ANSI_SA_AAT_INSTALLATION_DRONE_ACTIVATOR';addEvents(sim,a,.49,.51);}
 if(kind==='fury'){a.skillId=29017;startAddFury(sim,a,{consumeMutation:(actor,n)=>{actor.sourceAdd.mutation-=n;return n;}});}
 if(kind==='starfall'){a.skillId=29016;startAddStarfall(sim,a,{consumeMutation:(actor,n)=>{actor.sourceAdd.mutation-=n;return n;}});}
 if(kind==='chaser'){a.skillId=29018;startAddShootingChaser(sim,a);}
}
for(const kind of Object.keys(roots))for(const formed of [false,true])test(`${kind} factory snapshots original29409 once, formed=${formed}`,()=>{
 const {sim,a,effects}=fixture({formed});start(kind,sim,a);
 const born=effects.filter(e=>e.name===roots[kind]);assert.ok(born.length);assert.ok(born.every(e=>e.powerMultiplier===expected));
 assert.equal(a.skillScale,base,'factory scalar does not overwrite the owner getter');
 a.sourceAdd.formation=false;a.skillScale=9;
 for(const e of born){assert.equal(e.powerMultiplier,expected);assert.equal(addDamageModifiers(a,{APPLIED_SKILL_ID:e.skillId}).damageMultiplier,1);}
 if(kind==='fury'){
  a.sourceAdd.generator={skillId:29017};sim.createEffect(a,{NAME:'DAMAGE_EFFECT_Ultimate_Fury_Generate'});
  tickAddFury(sim,a,.01);tickAddFury(sim,a,.01);
  const beams=effects.filter(e=>e.sourceAddFury?.role==='beam');assert.ok(beams.length);assert.ok(beams.every(e=>e.powerMultiplier===expected));
 }
 if(kind==='starfall'){
  assert.equal(a.sourceAddNative[0].power,expected);const attacks=[];
  tickAddStarfall(sim,a,1,{selectTarget:()=>sim.state.actors[1],attackCarrier:r=>attacks.push(r)});
  assert.ok(attacks.length);assert.ok(attacks.every(r=>r.power===expected));
 }
 if(kind==='chaser'){
  assert.equal(a.sourceAddNative[0].power,expected);const target=sim.state.actors[1];
  for(let i=0;i<3;i++)addShootingChaserContact(sim,a,target,born[0],[200,80,0]);
  tickAddShootingChaser(sim,a,1);
  const group=effects.find(e=>e.name===CHASER_SETS[2]);assert.ok(group);assert.equal(group.powerMultiplier,f(expected*3));
 }
});
for(const kind of Object.keys(roots))test(`${kind} factory does not grant an unselected passive`,()=>{
 const {sim,a,effects}=fixture({learned:false});start(kind,sim,a);assert.ok(effects.some(e=>e.name===roots[kind]));
 assert.ok(effects.every(e=>e.powerMultiplier===base));
});
test('configuration roots and Magnetron use direct getter rather than a fabricated Offense Mode multiplier',()=>{
 for(const state of ['ANSI_A_AAT_RUSHING_DRONE_DYNAMO','ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO','ANSI_A_AMM_COUNTDOWN_BOMB_DYNAMO','ANSI_A_AMM_FLICK_DISC_DYNAMO']){
  const {sim,a,effects}=fixture();a.state=state;addDynamoEvents(sim,a,0,.7);assert.ok(effects.length,state);assert.ok(effects.every(e=>e.powerMultiplier===base),state);
 }
 const {sim,a,b,effects}=fixture();a.skillId=29205;startAddMagnetron(sim,a);assert.equal(a.sourceAddCombat.magnetron.power,base);
 a.skillScale=9;fireAddMagnetronAll(sim,a,b);const shots=effects.filter(e=>e.name===MAGNETRON_PROJECTILE);assert.equal(shots.length,3);
 assert.ok(shots.every(e=>e.powerMultiplier===f(base*1.2000000476837158)),'marker scalar is separate and uses saved birth power');
});
test('ordinary command Fury and another career never receive the installation factory multiplier',()=>{
 const {sim,a,effects}=fixture();startAddCommandFury(sim,a);assert.equal(effects.length,3);assert.ok(effects.every(e=>e.powerMultiplier===base));
 const foreign={...a,professionId:'DE'};assert.equal(addInstallationFactoryActor2016(foreign),foreign);
});
