/** Three independent source-charge fixtures, actual production mesh/plane world
 * matrices. Texture I/O alone is isolated for NullEngine. No GPU pixel claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {addStasisDamageObserved} from '../../packages/combat-core/add-recasts.mjs';
import {nativeSequenceRenderOrder} from '../../apps/web/native-sequence-render-order.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const manifest=read('artifacts/lp/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/lp/'+p).templates));
const firstSets=['EffectSet_SA_APT_Stasis_Field_Start','EffectSet_SA_APT_Stasis_Field_Attack','EffectSet_SA_APT_STASIS_FIELD_Loop'],active='EffectSet_SA_APT_Stasis_Field_Activate';
const norms=m=>[0,4,8].map(i=>Math.hypot(...m.slice(i,i+3)));
async function capture(gain){
 const {sim,a,b,profile}=originalAddFixture('LP',{skillId:29007});a.mp=a.mpMax;b.x=2000;
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('stasis-phase-v61',new Vector3(0,31,12),scene);
 const templates={},queue=[...firstSets,active,'DamageEffect_APT_Stasis_Field_Activate'],seen=new Set();
 while(queue.length){const n=queue.shift();if(seen.has(n))continue;seen.add(n);
  const raw=profile.effectSets[n]?.raw??profile.damageEffects[n]?.raw;
  if(raw){if(raw.MAIN_EFFECT_NAME)queue.push(raw.MAIN_EFFECT_NAME);for(const v of Object.values(raw))if(v&&typeof v==='object')queue.push(v.NAME??v.PARTICLE_NAME??v.DAMAGE_EFFECT_NAME);continue;}
  const value=all[n];if(!value)continue;templates[n]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));
 }
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/lp/'+v.poseData)]));
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('LP'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/lp/',
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/lp',file))});
 const ids=new Set(),sets=new Set([...firstSets,active]),parentSets=new Map();
 function step(input={}){sim.step(dt,input,{snapshot:false});for(const event of sim.drainEvents()){
  if(event.type==='effectStarted'&&(sets.has(event.setName)||event.name==='DamageEffect_APT_Stasis_Field_Activate')){ids.add(event.effectId);parentSets.set(event.effectId,event.setName);view.event(event,sim.state);}else if(ids.has(event.effectId))view.event(event,sim.state);
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});scene.render();}
 const sample=(second=false)=>{const proof=view.proof({includeDraws:true}).nativeParticleDraws,
  sequences=new Map(proof.sequences.map(e=>[e.id,e.effectParentId]));return {draws:proof.samples.filter(p=>!second||parentSets.get(p.effectParentId)===active).map(p=>({name:p.name,age:p.age,scale:p.scale,size:p.size,world:p.meshes.map(m=>norms(m.world))})),
  planes:Object.fromEntries(scene.meshes.filter(m=>m.name.startsWith('native-particle:')&&m.thinInstanceCount>0&&
   (!second||parentSets.get(sequences.get(nativeSequenceRenderOrder(m)?.emitterId))===active)).map(m=>[m.name,{count:m.thinInstanceCount,world:norms(Array.from(m._thinInstanceDataStorage.matrixData.slice(0,16)))}])),
  definitions:sim.state.effects.filter(e=>ids.has(e.id)).map(e=>({name:e.name,setName:e.setName,size:e.sourceAddStasisSize??null,scale:['X','Y','Z'].map(k=>e.definition['SCALE_'+k]??1)}))};};
 try{
  for(let i=0;i<60;i++)step();step({add:{pressed:['A'],held:['A']}});const first=[];
  for(let i=0;i<110;i++){step();if([12,24,36,48,60,72,84,96].includes(i))first.push(sample());}
  for(let i=0;i<300&&!sim.skillAvailability(a.id,0).available;i++)step();assert.equal(sim.skillAvailability(a.id,0).available,true);
  if(gain){addStasisDamageObserved(a,a.hpMax*gain);if(gain===.5)addStasisDamageObserved(a,a.hpMax*.1,{received:true});}
  step({add:{pressed:['A'],held:['A']}});const second=[];
  for(let i=0;i<36;i++){step();if([6,12,20,26,32].includes(i))second.push(sample(true));}
  return {gain,first,second,templates:Object.keys(templates)};
 }finally{view.clear();scene.dispose();engine.dispose();}
}
test('Stasis first-cast world layers stay authored; only second-cast world/plane dimensions grow1.25/1.5',async t=>{
 const captures=[];for(const gain of [0,.25,.5])captures.push(await capture(gain));
 mkdirSync(resolve(root,'runtime/v61/stasis-matrix'),{recursive:true});writeFileSync(resolve(root,'runtime/v61/stasis-matrix/phases.json'),JSON.stringify(captures,null,2));
 const [base,low,max]=captures;assert.deepEqual(low.first,base.first);assert.deepEqual(max.first,base.first);
 const firstLayers=new Set(base.first.flatMap(s=>[...s.draws.map(p=>p.name),...Object.keys(s.planes)]));
 assert.ok(firstLayers.size>5,'all sampled visible initial layers, rather than a collider marker');
 for(const s of base.first)for(const p of s.draws){
  assert.ok(p.scale.every(n=>n===1),'first-cast emitters retain original unamplified group scale: '+p.name);
  if(/^ADD_STASIS_FIELD_Start0[1-4]$/.test(p.name))for(const world of p.world)for(let axis=0;axis<3;axis++)
   assert.ok(Math.abs(world[axis]/(p.size[axis]*.01)-1)<1e-5,'actual first main world size equals authored Size, without an extra1.5: '+p.name);
 }
 for(const cap of [low,max]){const ratio=cap.gain===.25?1.25:1.5;let meshes=0,planes=0;
  for(let i=0;i<base.second.length;i++){
   const s=base.second[i],g=cap.second[i];
   for(let k=0;k<s.draws.length;k++){const before=s.draws[k],after=g.draws[k];assert.equal(after?.name,before.name);assert.equal(after.world.length,before.world.length);
    for(let j=0;j<before.world.length;j++)for(let axis=0;axis<3;axis++){if(before.world[j][axis]<1e-8)continue;
     assert.ok(Math.abs(after.world[j][axis]/before.world[j][axis]-ratio)<1e-4,`${before.name} axis${axis}`);meshes++;}
   }
   for(const [name,before]of Object.entries(s.planes)){const after=g.planes[name];assert.ok(after,name);assert.equal(after.count,before.count);
    for(let axis=0;axis<2;axis++){if(before.world[axis]<1e-8)continue;assert.ok(Math.abs(after.world[axis]/before.world[axis]-ratio)<1e-4,`${name} plane axis${axis}`);planes++;}}
  }
  assert.ok(meshes>5&&planes>5);t.diagnostic(JSON.stringify({size:ratio,firstVisibleLayers:[...firstLayers],actualMeshAxes:meshes,actualPlaneAxes:planes}));
 }
});
