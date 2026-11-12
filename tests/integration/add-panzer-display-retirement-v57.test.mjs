/** Current Web regression: real Garpai/input/native pose and original GLBs.
 * Texture I/O alone is replaced for NullEngine; no original GPU claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {originalAddFixture,originalAddSamplers} from '../helpers/add-native-pose-fixture.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {PANZER_RED,PANZER_BG} from '../../packages/combat-core/add-panzer-v57.mjs';
const root=resolve(import.meta.dirname,'../..'),read=p=>JSON.parse(readFileSync(resolve(root,p),'utf8')),dt=1/60;
const manifest=read('artifacts/mm/manifest.json'),all=Object.assign({},...[manifest.effectAssetIndex,...manifest.visualEffectIndexes].map(p=>read('artifacts/mm/'+p).templates));
const BG='ADD_Panzer_Buster_Aiming_01';
function roots(scene,name){return scene.transformNodes.filter(n=>n.name.startsWith('fx-'+name+'-')&&n.name.endsWith('-world')&&n.isEnabled());}
async function setup(t){
 const f=originalAddFixture('MM',{skillId:29032}),{sim,a,b,profile}=f;a.mp=a.mpMax;a.sourceAdd.dp=8000;
 const red=profile.damageEffects[PANZER_RED].raw.MAIN_EFFECT_NAME,
  members=Object.values(profile.effectSets[PANZER_BG].raw).filter(e=>e&&typeof e==='object'&&e.NAME),
  names=new Set([red,...members.map(e=>e.NAME)]),templates={},queue=[...names];
 for(const n of queue){if(templates[n])continue;const value=all[n];assert.ok(value,n);templates[n]=value;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(value.repeated?.[key]??(value.fields[key]?[value.fields[key]]:[])));}
 const effectPoses=Object.fromEntries(Object.values(templates).filter(v=>v.poseData).map(v=>[v.poseData,read('artifacts/mm/'+v.poseData)])),
  engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('panzer-retirement-v57',new Vector3(0,31,10),scene);
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers:originalAddSamplers('MM'),
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/mm/',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(root,'artifacts/mm',file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});
 const events=[],ids=new Set();
 function present(){for(const e of sim.drainEvents()){
  events.push(e);if(e.type==='effectStarted'&&(e.name===PANZER_RED||e.setName===PANZER_BG)){ids.add(e.effectId);view.event(e,sim.state);}
  else if(ids.has(e.effectId))view.event(e,sim.state);
 }view.step(dt,sim.state);view.render({actors:sim.state.actors});scene.render();}
 function step(input={}){sim.step(dt,input,{snapshot:false});present();}
 function until(predicate,input={},limit=180){for(let i=0;i<limit&&!predicate();i++)step(input);assert.ok(predicate(),'bounded original Panzer state reached');}
 return {...f,scene,view,events,red,step,present,until};
}
function visibleAim(f,owner=f.a){
 const effect=f.sim.state.effects.find(e=>e.ownerId===owner.id&&e.name===BG&&!e.dead);assert.ok(effect);
 const proof=f.view.proof({includeDraws:true}).nativeParticleDraws,shown=proof.samples.find(s=>s.name===BG&&s.effectParentId===effect.id);
 assert.ok(shown?.meshes.some(m=>m.world.length===16&&m.world.every(Number.isFinite)),'original BG has real GLB geometry and finite rendered matrices');
 assert.ok(roots(f.scene,BG).length>0);assert.equal(f.profile.effectTemplates[BG].fields.LifeTime,3);
 assert.ok(shown.age<3,'the test ends the live mesh before its original three-second lifetime');
 const descendants=roots(f.scene,BG).flatMap(n=>n.getDescendants());
 assert.ok(descendants.some(n=>/Dummy01$/.test(n.name)),'the actual original posed BG hierarchy is present');
 assert.ok(descendants.filter(n=>/Dummy\d+$/.test(n.name)).every(n=>n.computeWorldMatrix(true).asArray().every(Number.isFinite)),
  'original GLB pose nodes have finite rendered transforms; this asset uses a node hierarchy rather than Babylon Skeleton objects');return effect;
}
function retired(f,effects,owner=f.a){
 for(const e of effects)assert.ok(f.events.some(v=>v.type==='effectEnded'&&v.effectId===e.id&&v.reason==='add-panzer-aim-ended'));
 assert.ok(!f.sim.state.effects.some(e=>e.ownerId===owner.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG)));
 const ids=new Set(effects.map(e=>e.id)),proof=f.view.proof({includeDraws:true}).nativeParticleDraws;
 assert.ok(!proof.samples.some(s=>ids.has(s.effectParentId)&&[BG,f.red].includes(s.name)),'explicit source handle destruction retires the actual BG/red mesh in the same presentation packet');
}
for(const direction of ['UP','DOWN'])test(`MM real ${direction} hold/release/fire immediately retires original aiming BG and red mesh`,async t=>{
 const f=await setup(t),{a,sim,step,until,view,scene}=f;
 step({add:{pressed:['A'],held:['A']}});until(()=>a.state.endsWith('_AIMING'),{add:{held:['A']}});
 for(let i=0;i<50;i++)step({add:{held:['A',direction]}});
 const bg=visibleAim(f),aims=sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG));
 assert.ok(direction==='UP'?a.sourceAddCombat.panzer.angle>15:a.sourceAddCombat.panzer.angle< -15);
 assert.ok(roots(scene,f.red).length>0);
 until(()=>a.state.endsWith('_FIRE'));retired(f,aims);assert.equal(roots(scene,BG).length,0);assert.equal(roots(scene,f.red).length,0);
 until(()=>f.events.some(e=>e.type==='addPanzerFired'));assert.equal(f.events.filter(e=>e.type==='addPanzerFired').length,1);retired(f,aims);
 for(let i=0;i<10;i++){step();assert.equal(roots(scene,BG).length,0,'a later render cannot resurrect the retired BG');}
});
test('MM non-FIRE interruption uses the same explicit source BG destruction before natural lifetime',async t=>{
 const f=await setup(t),{a,sim,step,until,scene}=f;step({add:{pressed:['A'],held:['A']}});
 until(()=>a.state.endsWith('_AIMING'),{add:{held:['A']}});for(let i=0;i<45;i++)step({add:{held:['A']}});
 visibleAim(f);const aims=sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG));
 // Explicit current-Web interruption exercises its callback, not a claim
 // about an unverified original/UI cancel permission window.
 sim.enter(a,'RSI_WAIT','current-web-interruption');f.present();retired(f,aims);
 assert.equal(a.sourceAddCombat.panzer,undefined);assert.equal(roots(scene,BG).length,0);assert.equal(roots(scene,f.red).length,0);
 assert.ok(!f.events.some(e=>e.type==='addPanzerFired'));
});
test('one owner Panzer retirement leaves another real owner aiming BG and native pose visible',async t=>{
 const f=await setup(t),{a,b,sim,step,until,scene,view}=f;b.loadout[0]={skillId:29032,level:1,branchId:'none'};b.mp=b.mpMax;b.sourceAdd.dp=8000;
 const held={add:{held:['A']},target:{held:['A']}};step({add:{pressed:['A'],held:['A']},target:{pressed:['A'],held:['A']}});
 until(()=>a.state.endsWith('_AIMING')&&b.state.endsWith('_AIMING'),held);for(let i=0;i<45;i++)step(held);
 visibleAim(f);const other=visibleAim(f,b),aims=sim.state.effects.filter(e=>e.ownerId===a.id&&!e.dead&&(e.name===PANZER_RED||e.setName===PANZER_BG));
 sim.enter(a,'RSI_WAIT','current-web-interruption');f.present();retired(f,aims);
 const proof=view.proof({includeDraws:true}).nativeParticleDraws;assert.ok(proof.samples.some(s=>s.name===BG&&s.effectParentId===other.id));
 assert.equal(roots(scene,BG).length,1);assert.ok(roots(scene,BG)[0].getDescendants().some(n=>/Dummy01$/.test(n.name)));
});
