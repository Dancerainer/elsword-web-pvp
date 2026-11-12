/** Original ranges/times and independently stated endpoint arithmetic. These
 * verify the Web shared-instance adapter, not an original-client RNG trace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeGMSpawnRotation,validateGMSpawnRotation,sampleGMSpawnRotation,GM_SPAWN_EFFECT,GM_SPAWN_SET,GM_SPAWN_TEMPLATE}
 from '../../packages/combat-core/gm-sword-spawn-instance.mjs';
import {xCrashMeshTransform} from '../../packages/combat-core/xcrash-mesh-transform.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState,encodeCriticalAction} from '../../packages/online/owned-state.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url))),profile=read('packages/combat-core/gm-profile.json'),
 source=read('contracts/gm-dash-xx-spawn-rotation-v37.json'),template=profile.effectTemplates[GM_SPAWN_TEMPLATE];
function instance(){
 const e={id:4,name:GM_SPAWN_EFFECT,setName:GM_SPAWN_SET,mainEffectName:GM_SPAWN_TEMPLATE,definition:{},meshLifetimeElapsed:1.005};
 let calls=0;assert.equal(initializeGMSpawnRotation(e,profile,()=>[.25,.75][calls++]),true);return {e,calls};
}
test('GM source contract retains both original random ranges and event times; one birth consumes exactly two Web draws',()=>{
 assert.equal(source.source.sha256,'b3927c83e113e3b931f29ca5058063a63440a85d2c211bf335cb1fd4054757d5');
 assert.equal(template.declarationSha256,'6cbbe31389c5ee1afee7db0c086e7bb14d98e046dfbd2910b048d7ac09e39752');
 assert.deepEqual(source.rotateEvents,[
  {property:'Rotate',start:0,end:0,fade:false,value:[0,{random:[0,50]},0]},
  {property:'Rotate',start:.01,end:2,fade:true,value:[0,{random:[3600,7200]},0]}]);
 assert.deepEqual(template.events.filter(e=>e.property==='Rotate'),source.rotateEvents);
 const {e,calls}=instance();assert.equal(calls,2);assert.equal(e.sourceGMSpawnRotation.initialYaw,12.5);assert.equal(e.sourceGMSpawnRotation.endYaw,6300);
 assert.equal(initializeGMSpawnRotation(e,profile,()=>assert.fail('restored instance cannot draw again')),false);
 const foreign={...e};delete foreign.sourceGMSpawnRotation;foreign.name='unproved-random-mesh';
 assert.equal(initializeGMSpawnRotation(foreign,profile,()=>assert.fail('another mesh cannot consume combat RNG')),false);
});
test('GM yaw sampling preserves time-zero, exact fade boundaries and original literal mesh scale',()=>{
 const {e}=instance();
 for(const [time,yaw] of [[0,12.5],[.005,12.5],[.01,12.5],[1.005,3156.25],[2,6300],[4,6300]])
  assert.ok(Math.abs(sampleGMSpawnRotation(e,time)[1]-yaw)<1e-8);
 const anchor={position:[100,200,300],rotation:[0,180,0],facing:-1},before=structuredClone(template),t=xCrashMeshTransform(template,e,anchor,{literal:true});
 assert.deepEqual(t.position,[100,200,300]);assert.deepEqual(t.scale,[.5,.5,.5]);assert.ok(Math.abs(t.rotation[1]-3336.25)<1e-8);
 assert.deepEqual(template,before,'resolving instance values cannot rewrite the original profile');
 const unsupported={...e,name:'other',sourceGMSpawnRotation:undefined};delete unsupported.sourceGMSpawnRotation;
 assert.equal(xCrashMeshTransform(template,unsupported,anchor,{literal:true}),null,'other random meshes retain the explicit capability gap');
});
test('production effect runtime uses shared GM local rotation and source clock while preserving its random channel compilation',()=>{
 const runtime=createEffectRuntime({index:{templates:{[GM_SPAWN_TEMPLATE]:template}},seed:7}),position=[10,20,30];
 const emitter=runtime.add(GM_SPAWN_TEMPLATE,{position,sourceControl:()=>({position,velocity:[0,0,0],nowLifeTime:1.005,animationTime:.125,localRotation:[0,3156.25,0]})});
 assert.ok(emitter);runtime.step(1/60,{});
 const p=[...runtime.particles.values()][0];assert.deepEqual(p.values.Rotate,[0,3156.25,0]);assert.equal(p.age,1.005);assert.equal(p.meshAnimationTime,.125);
 assert.equal(p.channels.get('Rotate').length,2,'the original compiled channel and its presentation draws remain intact');
 assert.notEqual(p.channels.get('Rotate')[0].value[1],12.5,'the independently seeded cosmetic endpoint cannot replace the saved combat endpoint');
 runtime.clear();
 const bad=runtime.add(GM_SPAWN_TEMPLATE,{position,sourceControl:()=>({position,velocity:[0,0,0],nowLifeTime:0,animationTime:0,localRotation:[0,NaN,0]})});
 assert.ok(bad);assert.throws(()=>runtime.step(1/60,{}),{name:'TypeError',message:/shared GM/});runtime.clear();
});
test('strict GM instance schema rejects unknown fields, other careers, nonbinary32 values and source-template changes',()=>{
 const {e}=instance();validateGMSpawnRotation(e,profile);
 for(const mutate of [x=>x.sourceGMSpawnRotation.extra=1,x=>x.sourceGMSpawnRotation.initialYaw=-1,x=>x.sourceGMSpawnRotation.endYaw=7201,
  x=>x.sourceGMSpawnRotation.initialYaw=Infinity,x=>x.sourceGMSpawnRotation.initialYaw=.1,x=>x.sourceGMSpawnRotation.version='unknown',
  x=>x.name='DamageEffect_SA_SDK_BRANDISH_BREAKER_START',x=>x.setName='other',x=>x.mainEffectName='other']){
  const bad=structuredClone(e);mutate(bad);assert.throws(()=>validateGMSpawnRotation(bad,profile),TypeError);
 }
 assert.throws(()=>validateGMSpawnRotation(e,{...profile,target:{...profile.target,unitClass:125}}),TypeError);
 const changed={...profile,effectTemplates:{...profile.effectTemplates,[GM_SPAWN_TEMPLATE]:{...template,events:template.events.map(event=>event.property==='Rotate'?{...event,start:.02}:event)}}};
 assert.throws(()=>validateGMSpawnRotation(e,changed),/original GM/);
});
test('real GM owner codec retains shared endpoints through critical samples and receiver-local effect IDs',()=>{
 const map={sceneId:'gm-shared-source-wire',lines:[{lineId:0,start:[-1000,0,0],end:[1000,0,0],type:'LINE_TYPE.LT_NORMAL'}]},
  sim=createSimulation({profile,map,preset:{passives:[],guildPassives:[]},actors:[{id:'gm',position:[0,0,0],lineId:0}]}),a=sim.actor('gm');
 sim.spawnSet(a,GM_SPAWN_SET,1);const e=sim.state.effects.find(e=>e.name===GM_SPAWN_EFFECT);assert.ok(e.sourceGMSpawnRotation,'actual core effect creation initializes the instance');
 const packet=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1}),before=structuredClone(packet),context={actors:sim.state.actors,profiles:sim.profiles};
 const check=p=>{const value=validateOwnedState(p);validateOwnedReferences(value,a,profile,map,context);return value;};check(packet);
 const action=encodeCriticalAction(packet,{id:1,effectIds:new Set([e.id])});check({...packet,actions:[action]});
 assert.deepEqual(action.effects.find(row=>row.id===e.id).sourceGMSpawnRotation,e.sourceGMSpawnRotation);
 sim.state.effects=[];sim.state.nextEffectId=9000;applyOwnedState(sim,a.id,check(packet));
 assert.deepEqual(sim.state.effects.find(row=>row.networkId===e.id).sourceGMSpawnRotation,e.sourceGMSpawnRotation);assert.deepEqual(packet,before);
 const bad=structuredClone(packet);bad.effects.find(row=>row.id===e.id).sourceGMSpawnRotation.extra=1;
 assert.throws(()=>check(bad),/gm-spawn/);
});
