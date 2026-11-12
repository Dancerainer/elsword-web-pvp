import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addEvents,spendAddCommandProjectileResource} from '../../packages/combat-core/add-skills.mjs';
import {markAddStigma,tickAddStigma,returnAddStigma} from '../../packages/combat-core/add-stigma.mjs';
const read=id=>JSON.parse(readFileSync(new URL('../../packages/combat-core/'+id+'-profile.json',import.meta.url)));
const profiles={LP:read('lp'),MM:read('mm'),DE:read('de')};
function commandFixture(profession,state){
 const profile=profiles[profession],a={id:'add',professionId:profession,state,skillId:null,stateSerial:3,animationTime:0,sourceAdd:{dp:0,formation:false},skillScale:1};
 const sim={state:{effects:[]},profileFor:()=>profile,events:[],sets:[],
  fire:(_,id,time,before,after,fn)=>{if(before<time&&after>=time)fn();},note:()=>{},emit(type,id,data){this.events.push({type,id,...data});},
  spawnSet(_,name){this.sets.push(name);},createEffect:()=>({powerMultiplier:1})};
 return {sim,a};
}
for(const profession of ['LP','MM','DE'])for(const [state,time,name]of [
 ['RSI_COMBO_X',.333,'EffectSet_AN_Combo_X_Projectile'],
 ['RSI_COMBO_XX',.47,'EffectSet_AN_Combo_XX_Projectile'],
 ['RSI_COMBO_XXX',.41,profession==='DE'?'EffectSet_ADE_Combo_XXX_Projectile':'EffectSet_AN_Combo_XXX_Projectile'],
 ['ANSI_COMBO_ZZX',.2,'EffectSet_AN_Combo_ZZX_Attack'],
 ['ANSI_COMBO_ZZXX',.3,'EffectSet_AN_Combo_ZZXX_Projectile'],
])test(profession+' '+state+' emits at its qualified threshold before any previous hit or DP gain',()=>{
 const {sim,a}=commandFixture(profession,state);
 addEvents(sim,a,0,time-.0001);assert.deepEqual(sim.sets,[]);
 addEvents(sim,a,time-.0001,time);assert.deepEqual(sim.sets,[name]);assert.equal(a.sourceAdd.dp,0);
 assert.equal(sim.events.at(-1).amount,0);assert.equal(sim.events.at(-1).declaredAmount,2);
});
test('literal command DP spend remains bounded and formation resource rejection remains separate',()=>{
 for(const amount of [0,.5,1,2,10]){
  const a={sourceAdd:{dp:amount,formation:false}};assert.equal(spendAddCommandProjectileResource(a),true);
  assert.equal(a.sourceAdd.dp,Math.fround(Math.max(0,amount-2)));
 }
 const formed={sourceAdd:{dp:1,formation:true}};
 assert.equal(spendAddCommandProjectileResource(formed),false);assert.equal(formed.sourceAdd.dp,1);
 assert.equal(spendAddCommandProjectileResource({}),false);
});
test('target2016 DE XXX intentionally gives big flinch while other Add careers use the launched common explosion',()=>{
 const de=profiles.DE.damageEffects.DamageEffect_ADE_Combo_XXX_Explosion.raw.DAMAGE_DATA;
 assert.equal(de.REACT_TYPE,2);assert.equal(de.FORCE_DOWN,7);assert.equal(de.DAMAGE.MAGIC,2.25);
 assert.equal(Object.hasOwn(de,'BACK_SPEED_Y'),false);
 for(const id of ['LP','MM']){const raw=profiles[id].damageEffects.DamageEffect_AN_Combo_XXX_Explosion.raw.DAMAGE_DATA;
  assert.equal(raw.REACT_TYPE,5);assert.equal(raw.BACK_SPEED_X,1500);assert.equal(raw.BACK_SPEED_Y,1300);}
});
function stigmaFixture(){
 const profile=profiles.DE,a={id:'de',professionId:'DE',team:0,hp:100,x:0,y:0,z:0,stateSerial:8,facing:1,
  loadout:[{skillId:29025}],sourceAdd:{dp:0,formation:false}};
 const b={id:'enemy',team:1,hp:100,x:200,y:0,z:0,lineId:1,buffs:[]};
 const sim={state:{actors:[a,b],effects:[],nextEffectId:11},map:{lines:[{lineId:1}]},profileFor:()=>profile,events:[],
  spawnSet(caster,setName){this.state.effects.push({id:this.state.nextEffectId++,ownerId:caster.id,setName});},
  emit(type,actorId,data){this.events.push({type,actorId,...data});},
  grantBuff:()=>null,effectAnchorSampler:()=>({position:[200,80,0]}),createEffect:()=>({}),note:()=>{}};
 return {sim,a,b};
}
for(const terminal of ['timeout','return','owner-death','target-death'])test('Stigma '+terminal+' stops the actual mark emitter after its collision record already retired',()=>{
 const {sim,a,b}=stigmaFixture();assert.equal(markAddStigma(sim,a,b),true);
 assert.deepEqual(sim.state.localOwnerAddStigmaDisplays[0].effectIds,[11]);
 sim.state.effects=[];
 if(terminal==='return')returnAddStigma(sim,a);
 else{if(terminal==='owner-death')a.hp=0;if(terminal==='target-death')b.hp=0;tickAddStigma(sim,a,6);}
 const ends=sim.events.filter(e=>e.type==='effectEnded');
 assert.deepEqual(ends.map(e=>[e.actorId,e.effectId,e.reason]),[['de',11,'add-stigma-mark-ended']]);
 assert.deepEqual(sim.state.localOwnerAddStigmaDisplays,[]);
});
test('Stigma local emitter handles survive a trusted simulation snapshot and never end another owner',()=>{
 const {sim,a,b}=stigmaFixture();markAddStigma(sim,a,b);
 sim.state.localOwnerAddStigmaDisplays.push({ownerId:'other',targetId:b.id,effectIds:[29]});
 sim.state=structuredClone(sim.state);sim.state.effects=[];tickAddStigma(sim,sim.state.actors[0],6);
 assert.deepEqual(sim.state.localOwnerAddStigmaDisplays,[{ownerId:'other',targetId:b.id,effectIds:[29]}]);
 assert.deepEqual(sim.events.filter(e=>e.type==='effectEnded').map(e=>e.effectId),[11]);
});
test('Stigma a new owner epoch clearing logical mark cannot strand the retired main emitter',()=>{
 const {sim,a,b}=stigmaFixture();markAddStigma(sim,a,b);sim.state.effects=[];
 a.sourceAddStigma=null;tickAddStigma(sim,a,0);
 assert.deepEqual(sim.events.filter(e=>e.type==='effectEnded').map(e=>e.effectId),[11]);
 assert.deepEqual(sim.state.localOwnerAddStigmaDisplays,[]);
});
