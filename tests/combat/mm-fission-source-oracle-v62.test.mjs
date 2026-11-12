/** Expectations below are independently transcribed target declarations and
 * explicitly labelled existing Web rules, not generated from a runtime plan.
 * Parent task schedules this file; authoring did not execute Native/browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addDynamoEvents,applyAddDynamoDuration} from '../../packages/combat-core/add-dynamo-skills.mjs';
import {addDynamoInstanceDefinition,inheritAddFissionDroneLock,validateAddFissionSplit} from '../../packages/combat-core/add-dynamo-effect-state.mjs';
import {addDroneMarkDuration} from '../../packages/combat-core/add-target-notices.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
const profile=read('packages/combat-core/mm-profile.json'),oracle=read('contracts/mm-fission-perf-source-v62.json');
const raw=name=>profile.damageEffects[name].raw;
const entries=(object,pattern)=>Object.entries(object).filter(([key])=>pattern.test(key));
const start=(template,property)=>template.events.find(e=>e.property===property&&e.start===0&&!e.fade)?.value;
const axes=['SCALE_X','SCALE_Y','SCALE_Z'];

for(const variant of oracle.variants)test('Fission source topology: '+variant.caseId,()=>{
 const parent=raw(variant.parent),child=raw(variant.child);
 const die=entries(parent,/^DIE_DAMAGE_EFFECT\d+$/),shots=die.filter(([,r])=>r.DAMAGE_EFFECT_NAME===variant.child);
 assert.equal(shots.length,variant.childCount);
 assert.deepEqual(shots.map(([,r])=>r.ROTATE_Z??0),variant.anglesDegrees);
 assert.equal(die.length,variant.childCount+1,'The extra DIE record is one sound, never a projectile');
 assert.equal(die.at(-1)[1].DAMAGE_EFFECT_NAME,'DamageEffect_Dividing_Missile_Divide_Sound');
 for(const [member,row] of shots){
  assert.deepEqual(axes.map(k=>row[k]),[.66,.66,.66]);
  assert.equal(row.POSITION_TYPE,3);assert.equal(row.APPLY_ROTATE,0);assert.equal(row.LIFE_TIME_ONLY,1);
  assert.equal(row.INHERITLOCKONDATA,variant.marked?1:undefined);
  const e={name:variant.child,skillId:29209,sourceAddFissionSplit:{parentName:variant.parent,member}};
  validateAddFissionSplit(e,profile);
  assert.deepEqual(addDynamoInstanceDefinition(profile,e,{NAME:e.name}),{NAME:e.name,SCALE_X:.66,SCALE_Y:.66,SCALE_Z:.66});
 }
 assert.equal(parent.DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME,variant.contactExplosion);
 assert.equal(child.USE_GLOBAL_TIME,1);
 assert.deepEqual(entries(child,/^DIE_DAMAGE_EFFECT\d+$/).map(([,r])=>r.DAMAGE_EFFECT_NAME),['DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_Small']);
 for(const row of [parent,child]){
  assert.equal(row.DAMAGE_TIME,1);assert.equal(row.DAMAGE_DATA.REACT_TYPE,11);
  assert.equal(row.DAMAGE_DATA.NO_DAMAGE,undefined);assert.equal(row.DAMAGE_DATA.RE_ATTACK,undefined);
  assert.equal(entries(row,/^HIT_DAMAGE_EFFECT\d+$/).length,0,'Contact children use RT11 CREATE_DAMAGE_EFFECT_NAME, not HIT_DAMAGE_EFFECT');
  assert.deepEqual(entries(row,/^PASSIVE_PARTICLE\d+$/).map(([,p])=>p.PARTICLE_NAME),['ADD_Rushing_Drone_Loop_01','ADD_Drone_Activator_Loop_01']);
 }
 assert.equal(child.DAMAGE_DATA.CREATE_DAMAGE_EFFECT_NAME,'DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_Small');
});

test('Fission source geometry, clocks and particle draw copies are retained independently of the prewarm planner',()=>{
 for(const expected of oracle.meshDeclarations){
  const actual=profile.effectTemplates[expected.name];
  assert.equal(actual.declarationSha256,expected.declarationSha256);assert.equal(actual.fields.LifeType,'LT_TIME');
  assert.equal(actual.fields.LifeTime,expected.lifeTime);assert.deepEqual(start(actual,'Size'),expected.size);
  if(expected.velocity)assert.deepEqual(start(actual,'Velocity'),expected.velocity);
  if(expected.rotate)assert.deepEqual(start(actual,'Rotate'),expected.rotate);
  if(expected.dirSpeed)assert.equal(start(actual,'DirSpeed'),expected.dirSpeed);
  if(expected.drawCount!==undefined)assert.equal(actual.fields.DrawCount,expected.drawCount);
  if(expected.velocityStopAt)assert.deepEqual(actual.events.find(e=>e.property==='Velocity'&&e.start===.2)?.value,[0,0,0]);
 }
 for(const expected of oracle.visualSourceDeclarations){
  const actual=profile.effectTemplates[expected.name];assert.equal(actual.declarationSha256,expected.declarationSha256);
  assert.equal(actual.fields.particleType,expected.particleType);assert.deepEqual(actual.fields.DrawCount,expected.drawCount);
  assert.equal(actual.fields.Emitrate,expected.emitRate);assert.equal(actual.fields.NumParticles,expected.numParticles);
  assert.equal(actual.fields.Lifetime,expected.lifetime);
  if(expected.triggerCount!==undefined)assert.equal(actual.fields.TriggerCount,expected.triggerCount);
  if(expected.triggerTime!==undefined)assert.equal(actual.fields.TriggerTime,expected.triggerTime);
 }
 assert.equal(profile.effectTemplates.ADD_Rushing_Drone_Loop_01.fields.DrawCount,4);
});

test('Fission contact explosions preserve damage windows, scale, sound and the complete three-particle closure',()=>{
 for(const expected of oracle.contactProducers.explosions){
  const r=raw(expected.name),d=r.DAMAGE_DATA;
  assert.equal(r.ATTACK_TIME_END,.15);assert.equal(r.DAMAGE_TIME,100);assert.equal(r.USE_GLOBAL_TIME,1);
  assert.equal(d.REACT_TYPE,1);assert.equal(d.DAMAGE.PHYSIC,expected.physical);assert.equal(d.PVP_RATE,.6);
  assert.equal(d.HIT_GAP,100);assert.equal(d.RE_ATTACK,0);assert.equal(d.STOP_TIME_ATT,0);
  assert.equal(d.STOP_TIME_DEF,expected.stopDef);assert.equal(d.HIT_ADD_MP,expected.hitMp);
  assert.deepEqual(entries(r,/^START_PARTICLE\d+$/).map(([,p])=>p.PARTICLE_NAME),oracle.contactProducers.startParticles);
  assert.equal(r.SOUND0.EVENT_TIME,.01);assert.equal(r.SOUND0.FILE_NAME,'ADD_DivingMissileExplosion.ogg');
  assert.equal(entries(r,/^(?:DIE|CREATE|HIT)_DAMAGE_EFFECT\d+$/).length,0,'Explosions do not recursively split');
 }
 assert.equal(raw('DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_Big_MUC').MAIN_EFFECT_NAME,'Mesh_AMM_Dividing_Missile_Explosion_Big');
});

function callbackFixture({marked=false,formation=false,mutation=0}={}){
 const a={id:'mm',professionId:'MM',team:0,hp:100,state:'fission',facing:1,skillId:29209,skillScale:2,
  sourceAdd:{formation,mutation},passivePolicy:{add:{dynamoDurationMultiplier:1.3}}};
 const target={id:'recipient',team:1,hp:100};
 if(marked)a.sourceAddDroneMark={targetId:target.id,targetEpoch:3,remaining:7,skillId:29035};
 const seen=new Set(),created=[];let consumptionCalls=0;
 const sim={state:{actors:[a,target],effects:created},networkEpochFor:()=>3,profileFor:()=>({
  ...profile,states:{fission:{sourceState:'ANSI_A_AMM_DIVIDING_MISSILE_DYNAMO'}}}),
  fire(actor,key,time,before,after,fn){if(!seen.has(key)&&before<time&&after>=time){seen.add(key);fn();}},
  createEffect(actor,definition){const r=raw(definition.NAME),e={name:definition.NAME,definition,skillId:actor.skillId,
   powerMultiplier:actor.skillScale,lifeTimeSeconds:profile.effectTemplates[r.MAIN_EFFECT_NAME].fields.LifeTime};created.push(e);return e;},
  emit(){},note(){assert.fail('Source-complete Fission callback must not use an unsupported fallback');}};
 const consume=(actor,count)=>{consumptionCalls++;assert.equal(count,1);actor.sourceAdd.mutation--;return 1;};
 return {a,sim,created,consume,get consumptionCalls(){return consumptionCalls;}};
}
for(const v of oracle.variants)test('Fission qualified callback emits one root at animation .4 and spends at most one mutation: '+v.caseId,()=>{
 const f=callbackFixture({marked:v.marked,formation:v.formation,mutation:v.mutationSpent});
 addDynamoEvents(f.sim,f.a,0,.399,{consumeMutation:f.consume});assert.equal(f.created.length,0);
 addDynamoEvents(f.sim,f.a,.399,.401,{consumeMutation:f.consume});
 addDynamoEvents(f.sim,f.a,0,.8,{consumeMutation:f.consume});
 assert.equal(f.created.length,1);assert.equal(f.created[0].name,v.parent);assert.equal(f.consumptionCalls,v.mutationSpent);
 assert.equal(f.a.sourceAdd.mutation,0);assert.equal(f.created[0].lifeTimeSeconds,Math.fround(v.rootLifetime*1.3));
 assert.equal(f.created[0].powerMultiplier,v.marked?Math.fround(2*1.2):2);
 assert.equal(f.created[0].sourceAddLockOn?.targetId,v.marked?'recipient':undefined);
 if(v.marked)assert.equal(f.created[0].sourceAddMarkedDrone.unlockRemaining,Math.fround(.1));
});

test('Formation without mutation and unformed stored mutation do not create the eight-shot variant',()=>{
 for(const state of [{formation:true,mutation:0},{formation:false,mutation:1}]){
  const f=callbackFixture(state);addDynamoEvents(f.sim,f.a,0,.5,{consumeMutation:f.consume});
  assert.equal(f.created[0].name,'DamageEffect_ADD_Dividing_Missile_Dynamo');assert.equal(f.consumptionCalls,0);
  assert.equal(f.a.sourceAdd.mutation,state.mutation);
 }
});

test('Hidden Records modifies the parent lifetime, never the one-second child or explosion window',()=>{
 const f=callbackFixture();
 assert.equal(profile.skillCatalog.find(s=>s.skillId===29406).raw.SA_EFFECTIVE_TIME[3],1.3);
 for(const [name,seconds]of [['DamageEffect_ADD_Dividing_Missile_Dynamo_Small',1],['DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA',1],['DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_Small',1.5]]){
  const effect={name,lifeTimeSeconds:seconds};applyAddDynamoDuration(f.sim,f.a,effect);assert.equal(effect.lifeTimeSeconds,seconds);
 }
 assert.equal(addDroneMarkDuration(profile,29035),Math.fround(Math.fround(4.9)*Math.fround(1.5)));
});

test('DA children copy the accepted target identity and independent steering vectors without applying mark power again',()=>{
 const v=oracle.variants.find(v=>v.caseId==='mutation-marked');
 const parent={name:v.parent,damage:raw(v.parent),powerMultiplier:Math.fround(2*1.2),
  sourceAddMarkedDrone:{targetEpoch:3,unlockRemaining:.1},sourceAddLockOn:{targetId:'recipient',manualDirDegree:[10,20,30],useManualDir:true}};
 const children=v.anglesDegrees.map((_,i)=>({name:v.child,skillId:29209,powerMultiplier:parent.powerMultiplier,
  sourceAddFissionSplit:{parentName:parent.name,member:'DIE_DAMAGE_EFFECT'+i}}));
 for(const child of children){assert.equal(inheritAddFissionDroneLock(parent,child),true);
  assert.deepEqual(child.sourceAddLockOn,parent.sourceAddLockOn);assert.equal(child.sourceAddMarkedDrone.targetEpoch,3);
  assert.equal(child.sourceAddMarkedDrone.unlockRemaining,0);assert.equal(child.powerMultiplier,parent.powerMultiplier);}
 children[0].sourceAddLockOn.manualDirDegree[0]=999;
 assert.equal(children[1].sourceAddLockOn.manualDirDegree[0],10);assert.equal(parent.sourceAddLockOn.manualDirDegree[0],10);
 assert.equal(inheritAddFissionDroneLock({...parent,sourceAddMarkedDrone:undefined},children[0]),false);
});

test('real source-pose Fission natural retirement produces one four/eight-shot generation and retires every combat carrier',async t=>{
 // Controlled no-contact lifecycle fixture, not a player cast, network match,
 // original-client trace or rendering test. Real .4 selection is tested above.
 const {originalAddFixture}=await import('../helpers/add-native-pose-fixture.mjs');
 const {markAddDroneProjectile}=await import('../../packages/combat-core/add-drone-lock.mjs');
 for(const v of oracle.variants)await t.test(v.caseId,()=>{
  const {sim,a,b}=originalAddFixture('MM',{skillId:29209});a.skillId=29209;a.skillScale=1;
  if(v.marked)a.sourceAddDroneMark={targetId:b.id,targetEpoch:0,remaining:addDroneMarkDuration(profile,29035),skillId:29035};
  const parent=sim.createEffect(a,{NAME:v.parent},{birthAnchor:{position:[0,20000,0],facing:1,rotation:[0,0,0]}});
  applyAddDynamoDuration(sim,a,parent);if(v.marked)assert.equal(markAddDroneProjectile(sim,a,parent),true);
  const retained=new Map(),events=[],seen=new Set();let observedChildren=false;
  for(let step=0;step<240;step++){
   sim.step(1/60,{});
   for(const e of sim.state.events)if(!seen.has(e.eventId)){seen.add(e.eventId);events.push(e);}
   for(const e of sim.state.effects)if(e.sourceAddFissionSplit?.parentName===v.parent){
    retained.set(e.id,e);
    if(e.active){const shapes=sim.effectSampler(e,a);assert.equal(shapes.length,1);assert.equal(shapes[0].kind,'sphere');
     assert.equal(shapes[0].source.helper,'ATTACK_SPHERE1');
     // Original converted helper vertex radius and declared .66 scale, not
     // a radius copied from the sampler/planner under test. D3DX key-scale
     // rounding is below this tolerance; no native KSM-radius claim is made.
     assert.ok(Math.abs(shapes[0].radius-oracle.collisionShapeBoundary.vertexDerivedRadius*.66)<.005);}
   }
   if(retained.size===v.childCount&&!observedChildren){observedChildren=true;
    assert.deepEqual([...retained.values()].map(e=>e.birthAnchor.rotation[2]),v.anglesDegrees);
    for(const e of retained.values()){assert.deepEqual(axes.map(k=>e.definition[k]),[.66,.66,.66]);assert.equal(e.lifeTimeSeconds,1);}
   }
  }
  assert.equal(retained.size,v.childCount);assert.equal(observedChildren,true);
  const secondary=events.filter(e=>e.type==='damageSecondaryCreated');
  assert.equal(secondary.filter(e=>e.parentEffectId===parent.id&&e.name===v.child).length,v.childCount);
  assert.equal(secondary.filter(e=>e.parentEffectId===parent.id&&e.name==='DamageEffect_Dividing_Missile_Divide_Sound').length,1);
  assert.equal(secondary.filter(e=>retained.has(e.parentEffectId)&&e.name==='DamageEffect_AMM_Dividing_Missile_Dynamo_Explosion_Small').length,v.childCount);
  assert.equal(events.some(e=>e.type==='effectContact'&&[parent.id,...retained.keys()].includes(e.origin?.id)),false,'Elevated no-contact fixture must not mix contact and DIE producers');
  for(const id of [parent.id,...retained.keys()]){
   const ended=events.filter(e=>e.type==='effectEnded'&&e.effectId===id);assert.equal(ended.length,1);assert.equal(ended[0].reason,'template-life-time');
  }
  assert.equal(sim.state.effects.some(e=>e.skillId===29209),false,'No Fission combat identity may remain after four seconds in this no-stop fixture');
 });
});
