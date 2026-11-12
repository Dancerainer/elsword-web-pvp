import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createNativeParticleDrawCounts} from '../../apps/web/native-particle-draw-count.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {originalAddFixture} from '../helpers/add-native-pose-fixture.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url)));
const index=read('artifacts/lp/fx/index.json'),name='ADD_PSYCHIC_STORM_L02',source=index.templates[name];

test('original Storm random DrawCount is resolved once at template load and inherited by every clone',()=>{
 assert.deepEqual(source.fields.DrawCount,{random:[2,3]});let calls=0;
 const count=createNativeParticleDrawCounts({templates:{[name]:source}},{random:()=>{calls++;return .75;}});
 assert.equal(calls,1);for(let i=0;i<100;i++)assert.equal(count(source),2);
 assert.equal(count(source,1),1,'explicit native trigger override is local');assert.equal(count(source),2);
 assert.equal(calls,1,'births/frames/overrides never reroll the parsed template');
 const max=createNativeParticleDrawCounts({templates:{[name]:source}},{random:()=>1});
 assert.equal(max(source),3,'native inclusive endpoint remains representable');
 assert.deepEqual(source.fields.DrawCount,{random:[2,3]},'original declaration remains immutable');
});

test('real Storm spark GLB loads and draws both native passes instead of disappearing through an object comparison',async t=>{
 const {sim,a,profile}=originalAddFixture('LP'),bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},damageEffects:{},
  resourceOnlyEffectSets:[],resourceOnlyTemplates:[name]};
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('storm',new Vector3(0,0,10),scene);
 const loaded=[];
 const view=await createEffectsView({scene,engine,index:{...index,templates:{[name]:source}},profile:bounded,
  effectPoses:{[source.poseData]:read('artifacts/lp/'+source.poseData)},
  samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},
  effectQuality:{level:'high',particleDivisor:1},
  loadContainer:(_,file)=>{loaded.push(file);return loadPoseContainer(scene,resolve(import.meta.dirname,'../../artifacts/lp',file));}});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const event={type:'effectStarted',actorId:a.id,effectId:123,name,definition:{NAME:name,EFFECT_TYPE:8},
  birthAnchor:{position:[0,100,0],rotation:[0,0,0],facing:1}};
 const state={...sim.state,effects:[{...event,id:123,ownerId:a.id,active:true,dead:false}]};
 view.event(event,state);let observed=0;
 for(let i=0;i<24;i++){
  view.step(1/60,state);view.render();
  const samples=view.proof({includeDraws:true}).nativeParticleDraws.samples.filter(p=>p.name===name);
  for(const sample of samples){observed++;assert.equal(sample.drawCount,2);assert.ok(sample.meshes.length>0);}
 }
 assert.equal(loaded.length,1);assert.ok(observed>0,'actual original spark emission has visible source meshes');
});
