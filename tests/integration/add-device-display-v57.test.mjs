/** Real converted GLBs and production display, under NullEngine with isolated
 * texture I/O. These are Web regression observations, not original GPU data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {ADD_FACTORY_DRONES} from '../../packages/combat-core/add-factory.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const manifest=read('artifacts/mm/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/mm/'+p).templates));
async function present(t,profile,names){
 const templates={},queue=[...names];for(const n of queue){if(templates[n])continue;const value=all[n];assert.ok(value,n);templates[n]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));}
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/mm/'+v.poseData)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;const scene=new Scene(engine);scene.useRightHandedSystem=true;
 new FreeCamera('device-display-v57',new Vector3(0,0,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('MM'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/mm/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/mm',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,scene};
}
function roots(scene,name){return scene.transformNodes.filter(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled());}
function near(actual,expected,tolerance=1e-4){assert.equal(actual.length,expected.length);actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<tolerance,`${actual} != ${expected}`));}
for(const skillId of [29035,29016,29017,29018])test(`MM factory ${skillId} real movement drives existing main and passive anchors without caster snap`,async t=>{
 const {sim,a,profile}=originalAddFixture('MM',{skillId}),name=ADD_FACTORY_DRONES[skillId],damage=profile.damageEffects[name].raw;
 const entries=Object.entries(damage).filter(([k])=>/^PASSIVE_PARTICLE\d+$/.test(k)).map(([,e])=>e);
 const {view,scene}=await present(t,profile,[damage.MAIN_EFFECT_NAME,...entries.map(e=>e.PARTICLE_NAME)]);a.sourceAdd.dp=8000;a.mp=a.mpMax;
 const ids=new Set();function step(input={}){sim.step(dt,input,{snapshot:false});for(const e of sim.drainEvents()){
  if(e.type==='effectStarted'&&e.name===name){ids.add(e.effectId);view.event(e,sim.state);}else if(ids.has(e.effectId))view.event(e,sim.state);
 }view.step(dt,sim.state);view.render();}
 step({add:{pressed:['A'],held:['A']}});for(let i=0;i<150;i++)step();
 const e=sim.state.effects.find(e=>e.name===name&&!e.dead);assert.ok(e);const shown=roots(scene,damage.MAIN_EFFECT_NAME);assert.ok(shown.length>0);
 const start=[...e.currentAnchor.position];for(let i=0;i<55;i++)step({add:{held:['RIGHT']}});
 assert.ok(e.currentAnchor.position[0]-start[0]>100,'real owner movement advanced original follower');
 shown.forEach(n=>near(n.position.asArray(),[e.currentAnchor.position[0]*.01,e.currentAnchor.position[1]*.01,-e.currentAnchor.position[2]*.01]));
 const actual=view.sourceMeshClocks().find(row=>row.effectId===e.id);assert.ok(actual);assert.equal(actual.animationTime,e.animationTime);
 const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
 for(const entry of entries){const template=all[entry.PARTICLE_NAME];
  if(template.fields.TriggerTime!==undefined&&e.elapsed>template.fields.TriggerTime+template.fields.Lifetime)continue;
  const sample=originalAddSamplers('MM').effectBoneSampler(e,a,entry.BONE_NAME).map((n,i)=>n+(entry[['OFFSET_X','OFFSET_Y','OFFSET_Z'][i]]??0)),rows=sequences.filter(r=>r.name===entry.PARTICLE_NAME);
  assert.ok(rows.length>0,entry.PARTICLE_NAME);assert.ok(rows.some(row=>row.position.every((n,i)=>Math.abs(n-sample[i])<1e-4)),`${entry.PARTICLE_NAME}/${entry.BONE_NAME}: ${JSON.stringify(rows)} != ${sample}`);}
});
test('Prism field uses its original independently posed helper nodes and finite visible particle attachments',async t=>{
 const {sim,a,profile}=originalAddFixture('MM',{skillId:29003});a.sourceAdd.dp=8000;a.mp=a.mpMax;
 for(let i=0;i<160;i++)sim.step(dt,i===0?{add:{pressed:['A'],held:['A']}}:{},{snapshot:false});
 const e=sim.state.effects.find(e=>e.name==='DamageEffect_Particle_Prism_Debuff');assert.ok(e?.sourceArcPose?.animationName);
 const members=sim.state.effects.filter(row=>row.setName===e.setName&&!row.dead),names=members.map(row=>row.mainEffectName??row.name);
 const {view,scene}=await present(t,profile,names);
 for(const row of members)view.event({type:'effectStarted',actorId:a.id,effectId:row.id,name:row.name,setName:row.setName,skillId:row.skillId,definition:row.definition,
  birthAnchor:row.birthAnchor,ownerStateSerial:row.ownerStateSerial,deleteConditions:row.deleteConditions,sourceBoneTargetMeshBound:row.sourceBoneTargetMeshId!==undefined},sim.state);
 for(let i=0;i<20;i++)view.step(dt,sim.state);view.render();assert.equal(roots(scene,e.mainEffectName).length,0,'helper-only source carrier is not invented as visible geometry');
 const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
 for(const row of members.filter(row=>row.sourceBoneTargetMeshId&&['AN_PARTICLE_PRISM_04','AN_PARTICLE_PRISM_01','AN_PARTICLE_PRISM_02'].includes(row.name))){
  const matched=sequences.filter(s=>s.name===row.name);assert.ok(matched.length>0,row.name);
  assert.ok(matched.some(s=>s.position.every((n,i)=>Math.abs(n-row.currentAnchor.position[i])<1e-4)),'source helper attachment has a visible original sequence');
 }
});
