/** Production effect view with real DE poses/particle declarations. NullEngine
 * uses completed one-pixel texture I/O, so this is not a GPU/pixel acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial,PBRMaterial} from '@babylonjs/core';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const json=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const dt=1/60,name='DamageEffect_ATT_Stardust_Shower_Ball';
test('actual Stardust Ball produces six real particle layers that follow its descending original mesh and retire',async t=>{
 const f=originalAddFixture('DE',{skillId:29021}),{sim,a,b,profile}=f;a.mp=a.mpMax;b.x=5000;
 const raw=profile.damageEffects[name].raw,visual=json('artifacts/de/fx/index.json');
 const names=new Set([raw.MAIN_EFFECT_NAME,...Object.entries(raw).filter(([key])=>/^(PASSIVE|TIME)_PARTICLE\d+$/.test(key)).map(([,v])=>v.PARTICLE_NAME)]);
 const templates=Object.fromEntries([...names].map(n=>[n,visual.templates[n]]));
 const effectPoses=Object.fromEntries([...new Set(Object.values(templates).map(t=>t.poseData).filter(Boolean))].map(p=>[p,json('artifacts/de/'+p)]));
 for(const template of Object.values(templates))for(const texture of Object.values(template.textures??{}))
  assert.ok(existsSync(resolve(import.meta.dirname,'../../artifacts/de',texture.file)),'actual sealed texture exists');
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('stardust-source',new Vector3(0,0,10),scene);
 t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{});t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
 const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index:{...visual,templates},profile:bounded,effectPoses,
  samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},effectQuality:{level:'high',particleDivisor:1},
  loadContainer:(_,file)=>loadPoseContainer(scene,resolve(import.meta.dirname,'../../artifacts/de',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});let first=null,observedBefore=null,observedAfter=null;
 for(let i=0;i<230;i++){
  sim.step(dt,i===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  for(const e of sim.drainEvents()){
   if(e.type==='effectStarted'&&e.name===name&&first===null)first=e.effectId;
   if(e.effectId===first)view.event(e,sim.state);
  }
  view.step(dt,sim.state);view.render();
  const ball=sim.state.effects.find(e=>e.id===first);
  if(ball?.sourceShadowMesh.globalTime>.3&&ball.sourceShadowMesh.globalTime<.4){
   const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
   const layers=sequences.filter(e=>/ATT_Stardust_Shower_Ball_P0[1-6]$/.test(e.name));
   assert.equal(new Set(layers.map(e=>e.name)).size,6,'all six original PASSIVE layers were constructed');
   observedBefore={y:ball.currentAnchor.position[1],positions:layers.map(e=>e.position[1])};
  }
  if(ball?.sourceShadowMesh.globalTime>.53&&ball.sourceShadowMesh.globalTime<.59){
   const layers=view.proof({includeDraws:true}).nativeParticleDraws.sequences.filter(e=>/ATT_Stardust_Shower_Ball_P0[1-6]$/.test(e.name));
   observedAfter={y:ball.currentAnchor.position[1],positions:layers.map(e=>e.position[1])};
   assert.ok(view.proof({includeDraws:true}).nativeParticleDraws.counts['ATT_Stardust_Shower_Ball_P01']>0,'native ball particles reach render batches');
  }
 }
 assert.ok(observedBefore&&observedAfter,'both sides of the original .5 velocity event are presented');
 assert.ok(observedAfter.y<observedBefore.y-100);
 assert.ok(observedAfter.positions.every(y=>y<observedBefore.y-100),'attachment sequences descend with the original core bone');
 assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeEmitters,0);
 assert.equal(view.proof().unsupported.some(n=>n.endsWith(':bone')||n.endsWith(':dsl')),false);
});
