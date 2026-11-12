import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));

// Target GameMajorParticle31 explicitly selects PT_3D_PLANE despite a leftover
// Mesh key. Fixed ParticleSystem Clone5557/Render3360 dispatch on that type.
// These are real target declarations/GLB inputs, not generated fake geometry.
for(const name of ['ADD_MM_ROCKON_01','ADD_MM_ROCKON_01_D'])test(name+' renders the declared plane instead of scaling an unrelated mesh across the screen',async t=>{
 const {sim,a,profile}=originalAddFixture('MM'),index=read('artifacts/mm/fx/index.json'),source=index.templates[name];
 assert.equal(source.fields.particleType,'PT_3D_PLANE');assert.ok(source.fields.Mesh&&source.glb);
 const templates={[name]:source},effectPoses={[source.poseData]:read('artifacts/mm/'+source.poseData)};
 const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},
  resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('mark',new Vector3(0,0,10),scene);
 const loaded=[];
 const view=await createEffectsView({scene,engine,index:{...index,templates},profile:bounded,effectPoses,
  samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},
  effectQuality:{level:'high',particleDivisor:1},
  loadContainer:(_,file)=>{loaded.push(file);return loadPoseContainer(scene,resolve(import.meta.dirname,'../../artifacts/mm',file));}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const event={type:'effectStarted',actorId:a.id,effectId:123,name,definition:{NAME:name,EFFECT_TYPE:8},
  birthAnchor:{position:[0,100,0],rotation:[0,0,0],facing:1}};
 const state={...sim.state,effects:[{...event,id:123,ownerId:a.id,active:true,dead:false}]};
 view.event(event,state);
 for(let i=0;i<17;i++){view.step(1/60,state);view.render();}
 const proof=view.proof({includeDraws:true});
 assert.ok(proof.nativeParticleDraws.counts[name]>0,'real original emission exists');
 assert.equal(proof.nativeParticleDraws.samples.filter(p=>p.name===name).length,0,'plane never uses the source mesh material/geometry');
 assert.equal(loaded.length,0,'unused Mesh text must not cause a GPU model load');
 assert.equal(proof.meshInstances,0);
 assert.equal(proof.nativeParticleDraws.batches.filter(b=>b.name.includes(name)).length,source.fields.DrawCount??1,'source whole-sequence plane passes preserved');
 for(const mesh of scene.meshes.filter(m=>m.name.startsWith('native-particle:')&&m.thinInstanceCount>0)){
  const matrix=mesh.thinInstanceGetWorldMatrices()[0];
  const width=Math.hypot(...matrix.m.slice(0,3));
  assert.ok(width>=1.5&&width<=3,'native 150–300 unit plane width maps to 1.5–3 scene units');
 }
});
