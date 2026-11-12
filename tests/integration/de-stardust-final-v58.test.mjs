import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {addPlayerFeedbackVisuals} from '../../packages/combat-assets/player-feedback-visuals-v45.mjs';
import {addStardustParticleScale} from '../../apps/web/add-stardust-particle-scale-v58.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const source=read('contracts/de-stardust-final-visual-v58.json'),raw=read('artifacts/de/fx/index.json');
const index=addPlayerFeedbackVisuals(raw,'DE'),BIG=source.scale.effect;

test('both final Stardust phases use the already measured identical original mesh and retain their own declarations',()=>{
 for(const row of source.poseBindings){
  const template=index.templates[row.target],pose=read('artifacts/de/'+template.poseData);
  assert.equal(template.declarationSha256,row.targetDeclaration);
  assert.equal(pose.observedClock.sourceSha256,row.meshSha256);
  assert.equal(pose.observedClock.ticksPerSecond,4800);
  assert.deepEqual(template.fields,raw.templates[row.target].fields);
  assert.deepEqual(template.events,raw.templates[row.target].events);
  assert.equal(raw.templates[row.target].poseData,null,'raw source index is not mutated');
 }
});

test('the final ball inherits 3x only for passive entries, preserving ordinary balls and TIME particles',()=>{
 const profile=read('packages/combat-core/de-profile.json'),entry=profile.damageEffects[BIG].raw.PASSIVE_PARTICLE0;
 const definition=profile.effectSets[source.scale.set].raw.EFFECT1,parent={name:BIG,definition};
 assert.deepEqual(addStardustParticleScale(entry,parent,{passive:true}),[4.5,4.5,4.5]);
 assert.deepEqual(addStardustParticleScale(entry,parent,{timed:true}),[1.5,1.5,1.5]);
 assert.deepEqual(addStardustParticleScale(entry,{...parent,name:'DamageEffect_ATT_Stardust_Shower_Ball'},{passive:true}),[1.5,1.5,1.5]);
});

test('actual original End set creates visible final-ball passive meshes at 4.5 scale and clears after its source lifetime',async t=>{
 const {sim,a,b,profile}=originalAddFixture('DE');b.x=4500;
 const rawDamage=profile.damageEffects[BIG].raw;
 const names=[rawDamage.MAIN_EFFECT_NAME,...Object.entries(rawDamage).filter(([key])=>/^(PASSIVE|TIME)_PARTICLE\d+$/.test(key)).map(([,e])=>e.PARTICLE_NAME)];
 const templates=Object.fromEntries(names.map(name=>[name,index.templates[name]]));
 const poses=Object.fromEntries([...new Set(names.map(name=>templates[name].poseData).filter(Boolean))].map(file=>[file,read('artifacts/de/'+file)]));
 const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{[BIG]:profile.damageEffects[BIG]},
  resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('final-rain',new Vector3(0,30,10),scene);
 const view=await createEffectsView({scene,engine,index:{...index,templates},profile:bounded,effectPoses:poses,
  samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},effectQuality:{level:'high',particleDivisor:1},
  loadContainer:(_,file)=>loadPoseContainer(scene,resolve(import.meta.dirname,'../../artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 sim.spawnSet(a,source.scale.set,1);const seen=new Set();let shown=0,finalId=null;
 for(let i=0;i<180;i++){
  sim.step(1/60,{}, {snapshot:false});
  for(const event of sim.state.events)if(!seen.has(event.eventId)){
   seen.add(event.eventId);if(event.type==='effectStarted'&&event.name===BIG){finalId=event.effectId;view.event(event,sim.state);}
   if(event.type==='effectEnded'&&event.effectId===finalId)view.event(event,sim.state);
  }
  view.step(1/60,sim.state);view.render();
  for(const sample of view.proof({includeDraws:true}).nativeParticleDraws.samples.filter(row=>/ATT_Stardust_Shower_Ball_P0[1-6]$/.test(row.name))){
   shown++;assert.deepEqual(sample.scale,[4.5,4.5,4.5]);assert.ok(sample.meshes.length>0);
  }
 }
 assert.ok(finalId!==null&&shown>0,'real End set, original Dummy01 pose and passive GLBs must produce visible final rain');
 assert.equal(view.proof().activeEffectParents,0,'source End lifetime retires the final-ball parent');
});
