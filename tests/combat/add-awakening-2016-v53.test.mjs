import test from 'node:test';
import assert from 'node:assert/strict';
import profile from '../../packages/combat-core/lp-profile.json' with {type:'json'};
import {addAwakeningThreshold,fireAddAwakeningAttack,addAwakeningAttackShapes} from '../../packages/combat-core/add-awakening-2016.mjs';
import {addFixture,tick} from '../helpers/add-fixture.mjs';
test('Awakening target2016 two explicit predicate inputs retain independent queue clocks and category2 cleanup',()=>{
 assert.equal(addAwakeningThreshold(0),Math.fround(.6));assert.equal(addAwakeningThreshold(1),Math.fround(.24));assert.throws(()=>addAwakeningThreshold(undefined));
 for(const input of [0,1]){const p=structuredClone(profile);p.referenceSemantics.awakening.nativePredicateInput=input;const calls=[],sim={profileFor:()=>p,fire:(a,id,t,b,e,fn)=>{if(b<t&&e>=t)fn();},spawnSet:(...x)=>calls.push(x)},a={id:'a',skillId:null,skillScale:1,sourceAdd:{formation:input===0}};
  fireAddAwakeningAttack(sim,a,0,addAwakeningThreshold(input));assert.equal(calls.length,1);assert.equal(calls[0][1],'EffectSet_AN_Hyper_Attack');assert.equal(calls[0][2],1);assert.deepEqual(calls[0][3],[2]);
 }
});
test('Awakening invisible source mesh has two native spheres and live instance scale/anchor consumption',()=>{
 const e={name:'DamageEffect_AN_Hyper',facing:1,definition:{SCALE_X:1.15,SCALE_Y:1.15,SCALE_Z:1.15},birthAnchor:{position:[200,1000,0],rotation:[0,0,0]}};
 const spheres=addAwakeningAttackShapes(e,profile);assert.equal(spheres.length,2);assert.ok(Math.abs(spheres[0].center[0]-(200-25*3.5*1.15))<.0001);assert.ok(Math.abs(spheres[1].center[0]-(200+25*3.5*1.15))<.0001);assert.equal(spheres[0].radius,Math.fround(43.30126953125*3.5*1.15));
 const raw=profile.damageEffects.DamageEffect_AN_Hyper.raw;assert.equal(raw.DAMAGE_DATA.DAMAGE.MAGIC,3);assert.equal(raw.DAMAGE_DATA.PVP_RATE,undefined);assert.equal(profile.effectTemplates.Mesh_AN_Hyper_Attack.fields.DrawCount,0);assert.equal(profile.effectSets.EffectSet_AN_Hyper_Attack.raw.EFFECT0.START_TIME,.05);
});
test('Actual Add awakening creates one source attack, damages through original two-sphere collider, and cleans on state exit',()=>{
 const {sim,a,b}=addFixture('LP',{samplers:{effectAnchorSampler:(e,a)=>({position:[a.x,a.y+(e.definition.POSITION_OFFSET_Y??0),a.z],facing:a.facing,rotation:[0,a.facing<0?180:0,0]}),defenderSampler:a=>[{kind:'sphere',center:[a.x,a.y+100,a.z],radius:35}]}});
 a.sourceAdd.dp=8000;b.x=200;const before=b.hp;assert.equal(sim.tryAwakening(a),true);tick(sim,1.5);
 const attacks=sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_AN_Hyper');assert.equal(attacks.length,1);assert.ok(b.hp<before);assert.ok(!sim.state.effects.some(e=>e.name==='DamageEffect_AN_Hyper'&&!e.dead));
});
