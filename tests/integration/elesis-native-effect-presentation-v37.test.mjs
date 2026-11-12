/** Actual Native skill casts feeding production effects presentation. Texture
 * I/O is replaced by a ready white pixel; source GLB hierarchy/pose and original
 * map/collision WASM remain real. This is not original-client/GPU acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..'),assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
async function present(t,profession,effectNames){
 const {profile,effectIndex,effectPoses,samplers}=elesisAssets(profession),templates={},queue=[];
 for(const name of effectNames){const raw=profile.damageEffects[name]?.raw;
  queue.push(raw?.MAIN_EFFECT_NAME??name);
  for(const [key,entry]of Object.entries(raw??{}))if(/^(?:PASSIVE|START|TIME|HIT)_PARTICLE\d+$/.test(key))queue.push(entry.PARTICLE_NAME);
 }
 for(const name of queue){if(templates[name])continue;const template=effectIndex.templates[name];assert.ok(template,name);templates[name]=template;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[])));
 }
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('native-v37-effect-owner',new Vector3(0,0,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers,
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/'+profession.toLowerCase()+'/',
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assets,profession.toLowerCase(),file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,scene};
}
function drive(f,view,names,frames,observe=()=>{}){
 const handles=new Set(),births=[],hits=[];
 for(let i=0;i<frames;i++){
  f.sim.step(1/60,i===0?{[f.a.id]:{pressed:['A'],held:['A']}}:{},{snapshot:false});
  const events=f.sim.drainEvents();
  for(const event of events){
   if(event.type==='effectStarted'&&names.has(event.name)){handles.add(event.effectId);births.push(event);view.event(event,f.sim.state);}
   else if(event.type==='effectEnded'&&handles.has(event.effectId)||['effectStartParticles','effectTimedParticles'].includes(event.type)&&handles.has(event.effectId))view.event(event,f.sim.state);
   else if(event.type==='hit'&&event.origin?.skillId===f.a.loadout[0].skillId){hits.push(event);view.event(event,f.sim.state);}
  }
  view.step(1/60,f.sim.state);view.render();observe({frame:i,view,handles,births,hits});
 }
 return {handles,births,hits};
}

for(const facing of [-1,1])test(`BH ${facing}: normal Blazing Wing skill dispatch produces visible passive meshes, real contact and complete cleanup`,async t=>{
 const names=new Set(['DamageEffect_SBH_Blaze_Wing_Main','DamageEffect_SBH_Blaze_Wing_Sub']);
 const f=elesisFixture('BH',{skillId:28017,gap:350,facing}),{view,scene}=await present(t,'BH',names);f.sim.drainEvents();
 let positive=0,meshFrames=0;
 const {births,hits}=drive(f,view,names,420,()=>{
  if(view.count>2)positive++;
  if(scene.transformNodes.some(n=>n.name.startsWith('fx-EffectSet_SA_SBH_BLAZE_WING_Start')&&n.name.endsWith('-world')&&n.isEnabled()))meshFrames++;
 });
 assert.equal(births.filter(e=>e.name==='DamageEffect_SBH_Blaze_Wing_Main').length,1);
 assert.equal(births.filter(e=>e.name==='DamageEffect_SBH_Blaze_Wing_Sub').length,1);
 assert.ok(positive>10);assert.ok(meshFrames>10,'actual PT_SKINMESH passive geometry reaches production render');
 assert.ok(hits.some(e=>e.targetId===f.b.id&&e.amount>0),'source native body/effect geometry accepts real hits');
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
 assert.ok(!view.proof().unsupported.some(note=>/:(?:bone|geometry|animation-rate)$/.test(note)));
});

for(const facing of [-1,1])test(`CA ${facing}: real Blood Cutter projectile has source target-matrix trails and no residual emitter`,async t=>{
 const f=elesisFixture('CA',{skillId:28023,gap:1800,facing}),raw=f.profile.effectSets.EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile.raw;
 const names=new Set(Object.entries(raw).filter(([key])=>/^EFFECT\d+$/.test(key)).map(([,entry])=>entry.NAME));
 const {view,scene}=await present(t,'CA',names);f.sim.drainEvents();let matrixFrames=0,flightFrames=0,tiltedPlaneFrames=0;
 const {births}=drive(f,view,names,360,()=>{
  const carrier=f.sim.state.effects.find(e=>e.name==='DamageEffect_SI_SA_SCA_BLOOD_CUTTER'&&e.active);
  if(carrier?.elapsed>.13&&carrier.elapsed<1.8){
   const children=f.sim.state.effects.filter(e=>e.sourceBoneTargetMeshId===carrier.id&&e.definition.TRACE_MATRIX===1);
   assert.equal(children.length,7);assert.ok(children.every(e=>e.currentAnchor?.matrix?.length===16));flightFrames++;
   if(scene.transformNodes.some(n=>n.name.startsWith('fx-BLOOD_CUTTER_W_P02-')&&n.name.endsWith('-world')&&n.isEnabled()&&n.isWorldMatrixFrozen))matrixFrames++;
   const plane=scene.meshes.find(n=>n.name.startsWith('native-particle:BLOOD_CUTTER_W_P05|')&&n.thinInstanceCount>0);
   const matrix=plane?._thinInstanceDataStorage?.matrixData;
   if(matrix&&(Math.abs(matrix[8])>1e-5||Math.abs(matrix[10])>1e-5))tiltedPlaneFrames++;
  }
 });
 // The original caster preparation also reuses four projectile particle
 // names. Keep both in production presentation, but count by exact source
 // set identity so preparation is never mistaken for a duplicate NPC birth.
 const projectileSet='EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile',preparationSet='EffectSet_SI_SA_SCA_BLOOD_CUTTER_FX';
 const projectileBirths=births.filter(e=>e.setName===projectileSet),preparationBirths=births.filter(e=>e.setName===preparationSet);
 const projectileNames=Object.entries(raw).filter(([key])=>/^EFFECT\d+$/.test(key)).map(([,entry])=>entry.NAME);
 const sharedPreparationNames=Object.entries(f.profile.effectSets[preparationSet].raw).filter(([key,entry])=>/^EFFECT\d+$/.test(key)&&names.has(entry.NAME)).map(([,entry])=>entry.NAME);
 assert.equal(projectileBirths.length,8,'exact NPC source group births its main and seven bound members once');
 assert.deepEqual(projectileBirths.map(e=>e.name).sort(),projectileNames.sort());
 assert.equal(new Set(projectileBirths.map(e=>e.effectId)).size,8,'each original NPC member has a distinct instance');
 assert.deepEqual(preparationBirths.map(e=>e.name).sort(),sharedPreparationNames.sort(),'four same-name caster members remain distinct and visible');
 assert.equal(births.length,projectileBirths.length+preparationBirths.length,'no third source set masquerades as an NPC birth');
 assert.ok(flightFrames>20);assert.ok(matrixFrames>10,'source mesh-frame matrix reaches PT_SKINMESH trail roots');
 assert.ok(tiltedPlaneFrames>10,'source target bone spin/pitch reaches BT_NONE circle planes instead of remaining horizontal');
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
});
