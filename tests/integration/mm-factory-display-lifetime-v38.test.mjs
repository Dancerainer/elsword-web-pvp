/** Actual Native MM inputs and production NullEngine factory presentation.
 * Original declarations independently bind mode/particle durations. Neither
 * the mode nor its visible handles are reset to satisfy the retirement checks.
 * White-pixel texture I/O and NullEngine are not original-client/GPU evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..'),assetRoot=resolve(root,'artifacts'),dt=1/60;
const json=file=>JSON.parse(readFileSync(resolve(root,file),'utf8'));
const contract=json('contracts/mm-factory-display-lifetime-v38.json');
const original=json('contracts/add-systems-source-v1.json');
const manifest=json('artifacts/mm/manifest.json');
const allTemplates=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes]
 .map(file=>json('artifacts/mm/'+file).templates));

async function present(t,profile,display){
 const raw=profile.damageEffects[display.effectName].raw,templates={},queue=[raw.MAIN_EFFECT_NAME];
 for(const [key,v]of Object.entries(raw))if(/^(?:PASSIVE|TIME|HIT|START)_PARTICLE\d+$/.test(key))queue.push(v.PARTICLE_NAME);
 for(const name of queue){if(templates[name])continue;const template=allTemplates[name];assert.ok(template,name);templates[name]=template;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[])));
 }
 assert.deepEqual(Object.keys(templates).sort(),[...display.retainedVisualTemplateNames].sort(),'original display closure is exact');
 assert.equal(raw.MAIN_EFFECT_NAME,display.mainEffectName);assert.equal(templates[display.mainEffectName].fields.LifeTime,999);
 for(const [name,life]of Object.entries(display.particleLifetimes))assert.equal(templates[name].fields.Lifetime,life);
 assert.equal(Math.max(...Object.values(display.particleLifetimes)),contract.originalMaximumParticleLifetimeSeconds);
 const effectPoses=Object.fromEntries([...new Set(Object.values(templates).map(v=>v.poseData).filter(Boolean))]
  .map(file=>[file,json('artifacts/mm/'+file)]));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('factory-mode-lifetime',new Vector3(0,0,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('MM'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/mm/',
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assetRoot,'mm',file))});
 // Resource disposal happens only after all natural-lifetime assertions.
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,scene};
}

for(const skillId of [29016,29018])test(`MM ${skillId}: attacks retire first; original 30-second selected factory and finite tail then end without reset`,async t=>{
 const display=contract.displays[skillId],f=originalAddFixture('MM',{skillId}),{sim,a,profile}=f,{view,scene}=await present(t,profile,display);
 assert.equal(contract.originalDurationSeconds,30);assert.equal(contract.testGraceSeconds,5);
 const originalTimes=original.buffFactors[366].FINALIZER.BFT_TIME.NORMAL_TIME;
 assert.ok(Object.values(originalTimes).every(v=>v===30));
 assert.equal(profile.buffFactors[366].raw.BUFF_TEMPLET_ID,342);
 assert.deepEqual(profile.buffFactors[366].raw.FINALIZER.BFT_TIME.NORMAL_TIME,originalTimes);
 a.sourceAdd.dp=8000;a.mp=a.mpMax;sim.drainEvents();
 const displayIds=new Set(),ends=[];let selectedAt=null,modeEndedAt=null,controllerStarted=false,fired=false,hits=0;
 function step(input={}){
  sim.step(dt,input,{snapshot:false});
  for(const e of sim.drainEvents()){
   if(e.type==='addGeneratorSelected'&&e.actorId===a.id){assert.equal(e.skillId,skillId);assert.equal(e.remaining,30);selectedAt??=sim.state.time;}
   if(e.type==='addGeneratorFired'&&e.actorId===a.id)fired=true;
   if(e.type==='addGeneratorEnded'&&e.actorId===a.id){assert.equal(e.reason,'timeout');modeEndedAt??=sim.state.time;}
   if(e.type===(skillId===29016?'addStarfallStarted':'addChaserStarted')&&e.actorId===a.id)controllerStarted=true;
   if(e.type==='hit'&&e.actorId===a.id&&e.targetId===f.b.id&&e.origin?.skillId===skillId&&e.amount>0)hits++;
   if(e.type==='effectStarted'&&e.actorId===a.id&&e.name===display.effectName){displayIds.add(e.effectId);view.event(e,sim.state);}
   else if(displayIds.has(e.effectId)&&['effectEnded','effectStartParticles','effectTimedParticles'].includes(e.type)){
    if(e.type==='effectEnded')ends.push(e);view.event(e,sim.state);
   }
  }
  view.step(dt,sim.state);view.render();
 }
 function until(predicate,bound,label){for(let i=0;i<bound&&!predicate();i++)step();assert.ok(predicate(),label);}
 until(()=>sim.skillAvailability(a.id,0).available,180,'normal source idle accepts a skill');
 step({add:{pressed:['A'],held:['A']}});
 assert.equal(a.sourceAdd.generator?.skillId,skillId);assert.notEqual(selectedAt,null);
 until(()=>sim.skillAvailability(a.id,0).available,300,'selection action and its source cooldown complete');
 assert.equal(sim.skillAvailability(a.id,0).mode,'generator-fire');step({add:{pressed:['A'],held:['A']}});
 assert.equal(fired,true);const firedAt=sim.state.time;
 until(()=>sim.state.time-firedAt>=display.attackStageTestSeconds,Math.ceil(display.attackStageTestSeconds/dt)+1,'earlier attack observation reached');
 assert.equal(controllerStarted,true);assert.ok(hits>0,'real Native attack contacts occurred before retirement');
 assert.equal((a.sourceAddNative??[]).length,0,'the attack controller has retired independently of the mode');
 const remaining=sim.state.effects.filter(e=>e.ownerId===a.id&&e.skillId===skillId&&!e.dead);
 assert.equal(remaining.length,1,'only the selected factory display remains after the attack');
 assert.equal(remaining[0].name,display.effectName);assert.equal(remaining[0].mainEffectName,display.mainEffectName);
 assert.ok(remaining[0].active&&displayIds.has(remaining[0].id));
 assert.equal(a.sourceAdd.generator.skillId,skillId);assert.ok(a.sourceAdd.generator.remaining>0&&a.sourceAdd.generator.remaining<30);
 assert.ok(view.count>0&&scene.transformNodes.some(n=>n.name.startsWith('fx-'+display.mainEffectName+'-')&&n.name.endsWith('-world')&&n.isEnabled()),
  'the legitimate still-selected mode retains its actual original mesh');
 assert.equal(ends.length,0,'the active mode has not been forcibly stopped to pass attack cleanup');
 until(()=>sim.state.time-selectedAt>=contract.originalDurationSeconds+contract.testGraceSeconds,
  Math.ceil((contract.originalDurationSeconds+contract.testGraceSeconds)/dt)+1,'same simulation reaches original mode expiry plus bounded tail allowance');
 assert.equal(a.sourceAdd.generator,null);assert.notEqual(modeEndedAt,null);
 assert.ok(modeEndedAt-selectedAt>=contract.originalDurationSeconds-2*dt,'no early mode destruction');
 assert.ok(modeEndedAt-selectedAt<contract.originalDurationSeconds+contract.testGraceSeconds,'mode expires within the source-bound observation');
 assert.ok(a.sourceAdd.dp>0,'expiry was not simulated by draining its DP');
 assert.ok(!sim.state.effects.some(e=>e.ownerId===a.id&&e.skillId===skillId&&!e.dead));
 assert.equal(displayIds.size,1);assert.equal(ends.length,1);assert.equal(ends[0].reason,'add-factory-generation-ended');
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
 assert.equal(Object.keys(view.proof().draws?.counts??{}).some(n=>display.retainedVisualTemplateNames.includes(n)),false);
});
