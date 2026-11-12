/** Original Stasis detonation group scale, actual converted GLBs and production
 * matrices. Native helper collision is covered independently. Texture I/O alone
 * is isolated for NullEngine; this is not framebuffer/GPU/original-client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {addStasisDamageObserved} from '../../packages/combat-core/add-recasts.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const SET='EffectSet_SA_APT_Stasis_Field_Activate',MODEL='ADD_STASIS_FIELD_ATTACK02';
const manifest=read('artifacts/lp/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/lp/'+p).templates));
async function capture(t,facing,grown){
 const f=originalAddFixture('LP',{skillId:29007}),{sim,a,b,profile}=f;a.facing=facing;b.x=2000;a.mp=a.mpMax;
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('stasis-visible-v58',new Vector3(0,31,12),scene);
 const templates={},queue=Object.values(profile.effectSets[SET].raw).filter(v=>v&&typeof v==='object'&&v.NAME).map(v=>v.NAME);
 for(const n of queue){if(templates[n])continue;const value=all[n];assert.ok(value,n);templates[n]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));}
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/lp/'+v.poseData)]));
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('LP'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/lp/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const ids=new Set();function step(input={}){sim.step(dt,input,{snapshot:false});for(const event of sim.drainEvents()){
  if(event.type==='effectStarted'&&event.setName===SET){ids.add(event.effectId);view.event(event,sim.state);}else if(ids.has(event.effectId))view.event(event,sim.state);
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});scene.render();}
 for(let i=0;i<60;i++)step();step({add:{pressed:['A'],held:['A']}});
 for(let i=0;i<90;i++)step(); // release the key and complete the first authored cast
 for(let i=0;i<300&&!sim.skillAvailability(a.id,0).available;i++)step();
 assert.equal(sim.skillAvailability(a.id,0).available,true);
 // Explicit accepted-damage observer fixture, not fabricated native damage.
 // Independent source cap: A/H=.5, B/H=.5 ->M2, visual min(M,1.5).
 if(grown){addStasisDamageObserved(a,a.hpMax*.5);addStasisDamageObserved(a,a.hpMax*.1,{received:true});}
 step({add:{pressed:['A'],held:['A']}});
 for(let i=0;i<7;i++)step();
 const proof=view.proof({includeDraws:true}).nativeParticleDraws,sample=proof.samples.find(s=>s.name===MODEL);
 assert.ok(sample?.meshes.length,'authored original Stasis mesh has actual presentation instances');
 // Start10 starts at .3 and emits at10/s. Observe after its first authored
 // emission rather than treating a not-yet-born ring as a display failure.
 for(let i=0;i<26;i++)step();
 const planes={};for(const name of ['ADD_STASIS_FIELD_ATTACK03','ADD_STASIS_FIELD_Start10']){
  const active=scene.meshes.filter(m=>m.name.startsWith('native-particle:'+name+'|')&&m.thinInstanceCount>0);
  assert.ok(active.length,'source visible detonation ring is active: '+name);
  planes[name]=active.flatMap(m=>Array.from({length:m.thinInstanceCount},(_,i)=>Array.from(m._thinInstanceDataStorage.matrixData.slice(i*16,i*16+16))));
 }
 return {sample,proof,planes,definitions:sim.state.effects.filter(e=>e.setName===SET).map(e=>({name:e.name,definition:e.definition,size:e.sourceAddStasisSize}))};
}
const norms=m=>[0,4,8].map(i=>Math.hypot(...m.slice(i,i+3)));
for(const facing of [1,-1])test(`Stasis capped charge visibly scales actual original mesh matrices1.5x, facing ${facing}`,async t=>{
 const base=await capture(t,facing,false),grown=await capture(t,facing,true);
 assert.deepEqual(base.sample.size,grown.sample.size,'same seed/age retains the authored particle Size');
 assert.deepEqual(base.sample.scale,[1,1,1]);assert.deepEqual(grown.sample.scale,[1.5,1.5,1.5]);
 const before=norms(base.sample.meshes[0].world),after=norms(grown.sample.meshes[0].world);
 for(let i=0;i<3;i++)assert.ok(Math.abs(after[i]/before[i]-1.5)<1e-5,`actual visible axis${i}: ${after[i]/before[i]}`);
 assert.equal(base.sample.meshes.length,grown.sample.meshes.length,'original DrawCount is not changed to manufacture a larger effect');
 for(const name of Object.keys(base.planes)){
  assert.equal(base.planes[name].length,grown.planes[name].length,'same authored plane emission count');
  const before=norms(base.planes[name][0]),after=norms(grown.planes[name][0]);
  // Plane normal Z is not a visible dimension. Compare actual uploaded width
  // and height buffers, not a declared collider radius or marker alone.
  for(let axis=0;axis<2;axis++)assert.ok(Math.abs(after[axis]/before[axis]-1.5)<1e-5,name+' visible plane axis'+axis);
 }
});
