/** Source contact and death are separate Shock producers. Pool expectations
 * come from the declarations/count cap, never the browser's cold counts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {collectEffectMeshBudget,collectEffectTemplates} from '../../apps/web/effect-prewarm.mjs';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {addFixture} from '../helpers/add-fixture.mjs';
import {originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const profile=PROFESSION_PROFILES.LP,manifest=read('artifacts/lp/manifest.json');
const index={templates:Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/lp/'+p).templates))};
const projectile='DamageEffect_SA_APT_Conqueror_Projectile',shock=projectile+'_Shock';
test('source Conqueror finite contact plus death prepares both Shock branches, including delayed original tails',()=>{
 const raw=profile.damageEffects[projectile].raw;
 assert.equal(raw.DAMAGE_TIME,1);assert.equal(raw.DAMAGE_DATA.NO_DAMAGE,1);assert.equal(raw.DAMAGE_DATA.RE_ATTACK,undefined);
 assert.equal(raw.HIT_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,shock);assert.equal(raw.DIE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,shock);
 assert.equal(profile.damageEffects[shock].raw.TIME_PARTICLE5.PARTICLE_NAME,'ADD_QUAKE_BUSTER_05');
 for(const effectQuality of [{level:'medium',particleDivisor:8},{level:'high',particleDivisor:1}])for(const targetCount of [1,3]){
  const result=collectEffectMeshBudget(profile,index,[{skillId:29008}],{effectQuality,targetCount});
  for(const name of ['ADD_Pulse_Bullet_DummyAttackBox_Die','ADD_QUAKE_BUSTER_05','ADD_PHASE_SHIFT_ATTACK_03'])
   assert.equal(result.demands.get(name).effectSetInstances,15*(1+targetCount),'15 source projectiles × one DIE plus finite frozen opposing-actor contacts');
  assert.equal(result.demands.get('ADD_QUAKE_BUSTER_05').drawCount,2);
  assert.equal(result.demands.get('ADD_QUAKE_BUSTER_LOOP01').effectSetInstances,15,'flight attachments do not gain a second carrier');
 }
 const medium=collectEffectMeshBudget(profile,index,[{skillId:29008}],{effectQuality:{level:'medium',particleDivisor:8}});
 assert.equal(medium.demands.get('ADD_QUAKE_BUSTER_05').views,420);
 assert.equal(medium.demands.get('ADD_PHASE_SHIFT_ATTACK_03').views,60);
 const changed=structuredClone(profile);delete changed.damageEffects[projectile].raw.DAMAGE_TIME;
 const unsupported=collectEffectMeshBudget(changed,index,[{skillId:29008}]);
 assert.equal(unsupported.demands.get('ADD_QUAKE_BUSTER_05').burstUpperBound,false);
 assert.equal(unsupported.demands.get('ADD_QUAKE_BUSTER_LOOP01').effectSetInstances,15);
});
for(const [facing,targetProfession]of [[-1,'LP'],[1,'DE']])test(`Garpai near contact ${facing}/${targetProfession} uses real source poses and both original Shock routes without any battle-tick clone`,async t=>{
 const ownerSamplers=originalAddSamplers('LP'),targetSamplers=originalAddSamplers(targetProfession);
 const {sim,a,b}=addFixture('LP',{skillId:29008,targetProfession,samplers:{...ownerSamplers,
  defenderSampler:(actor,...rest)=>(actor.id==='target'?targetSamplers:ownerSamplers).defenderSampler(actor,...rest)}});
 const x=2052.04736328125,gap=401.0433349609375;
 for(const actor of [a,b])Object.assign(actor,{y:2840,z:0,lineId:6,lastTouchLineId:6,grounded:true,vx:0,vy:0,inputLock:0});
 a.x=x;a.facing=facing;b.x=x+gap*facing;b.facing=-facing;
 for(const actor of [a,b])actor.landPosition=[actor.x,actor.y,actor.z];
 a.mp=a.mpMax;a.sourceAdd.dp=8000;a.sourceAdd.mutation=3;b.hp=b.hpMax=9999999;
 sim.drainEvents();
 const focusedProfile={...profile,states:{},skillCatalog:profile.skillCatalog.filter(s=>s.skillId===29008),buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[],sourceLiteralResources:[]};
 const names=collectEffectTemplates(focusedProfile,index,a.loadout),focused={templates:Object.fromEntries([...names].map(n=>[n,index.templates[n]]))};
 const effectPoses=Object.fromEntries(Object.values(focused.templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/lp/'+v.poseData)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=2048;const scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('conqueror-source-contact-tail-v57',new Vector3(20,32,50),scene);
 const began=performance.now(),view=await createEffectsView({scene,engine,index:focused,profile:focusedProfile,effectPoses,
  loadout:a.loadout,effectQuality:{level:'medium',particleDivisor:8},samplers:ownerSamplers,
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file))});
 await view.prewarmActors([a],{targetActors:sim.state.actors});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const prepared=view.proof().meshInstances,preparedQuads=view.proof().quadDrawSlots,prewarmMs=performance.now()-began,children=new Map(),born=new Set(),peaks={};
 let sourcePoseSeen=false;
 for(let frame=0;frame<720;frame++){
  sim.step(dt,frame===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  for(const e of sim.drainEvents()){
   if(e.type==='effectStarted'&&e.name===projectile)born.add(e.effectId);
   if(e.type==='damageSecondaryCreated'&&e.name===shock){const group=children.get(e.parentEffectId)??[];group.push(e.field);children.set(e.parentEffectId,group);}
   view.event(e,sim.state);
  }
  sourcePoseSeen||=sim.state.effects.some(e=>e.name===projectile&&e.sourceShadowMesh);
  view.step(dt,sim.state);view.render();
  for(const [name,count]of Object.entries(view.proof({includeDraws:true}).nativeParticleDraws.counts))peaks[name]=Math.max(peaks[name]??0,count);
  assert.equal(view.proof().meshInstances,prepared,`source near-hit/death/tail frame${frame} must reuse prepared views`);
  assert.equal(view.proof().quadDrawSlots,preparedQuads,`source near-hit/death/tail frame${frame} must reuse prepared whole-sequence planes`);
 }
 assert.equal(born.size,15);assert.equal(sourcePoseSeen,true);
 assert.equal([...children.values()].flat().filter(n=>n==='HIT_DAMAGE_EFFECT0').length,15);
 assert.equal([...children.values()].flat().filter(n=>n==='DIE_DAMAGE_EFFECT0').length,15);
 assert.ok([...children.values()].some(list=>list.includes('HIT_DAMAGE_EFFECT0')&&list.includes('DIE_DAMAGE_EFFECT0')),'actual source contact exercises both child factories for one parent');
 assert.ok((peaks.ADD_QUAKE_BUSTER_05??0)>0);assert.ok((peaks.ADD_PHASE_SHIFT_ATTACK_03??0)>0);
 assert.equal(view.performance().fxRuntimeMeshCreates,0);assert.deepEqual(view.proof().coldMeshTemplates,{});
 assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeParticles,0);
 t.diagnostic(JSON.stringify({facing,targetProfession,originalPoseGeometry:true,preparedViews:prepared,preparedQuadSlots:preparedQuads,prewarmMs,
  projectiles:born.size,hitChildren:[...children.values()].flat().filter(n=>n==='HIT_DAMAGE_EFFECT0').length,
  dieChildren:[...children.values()].flat().filter(n=>n==='DIE_DAMAGE_EFFECT0').length,
  particlePeaks:Object.fromEntries(Object.entries(peaks).filter(([name])=>['ADD_QUAKE_BUSTER_05','ADD_PHASE_SHIFT_ATTACK_03'].includes(name))),runtimeMeshCreates:0,gpuMeasured:false}));
});
