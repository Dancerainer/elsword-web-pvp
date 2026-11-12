/** Real target2016 effect declarations and converted assets, sampled through
 * production presentation. Explicit packets test Web ownership, not original
 * client trajectories, shader pixels, or guessed skill callback timing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const root=resolve(import.meta.dirname,'../..');
const assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts'));
const read=file=>JSON.parse(readFileSync(file));
const actor=professionId=>({id:'owner',professionId,x:0,y:0,z:0,hp:100,facing:1,
 stateSerial:1,animationTime:0,awakening:{remaining:0},buffs:[]});
const anchor=position=>({position:[...position],rotation:[0,0,0],facing:1,customPosition:true});
function closure(index,names){
 const templates={},queue=[...names];
 for(const name of queue){if(templates[name])continue;const t=index.templates[name];assert.ok(t,name);templates[name]=t;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(t.repeated?.[key]??(t.fields[key]?[t.fields[key]]:[])));
 }
 return {templates};
}
async function setup(t,profession,names,samplers={}){
 const folder=profession.toLowerCase(),sourceProfile=read(resolve(root,'packages/combat-core/'+folder+'-profile.json'));
 const sourceIndex=read(resolve(assets,folder,'fx/index.json'));
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('v37-effect-ownership',new Vector3(0,0,10),scene);
 const index=closure(sourceIndex,names),effectPoses=Object.fromEntries(Object.values(index.templates).filter(t=>t.poseData)
  .map(t=>[t.poseData,read(resolve(assets,folder,t.poseData))]));
 const profile={...sourceProfile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
 const view=await createEffectsView({scene,engine,index,profile,effectPoses,samplers,
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/'+folder+'/',
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assets,folder,file))});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});return {view,scene,profile,index,sourceIndex};
}
function birth(name,effectId=1,definition={},extra={}){
 return {type:'effectStarted',actorId:'owner',effectId,name,definition,
  birthAnchor:anchor([0,0,0]),ownerStateSerial:1,deleteConditions:[],...extra};
}
const steps=(view,state,count)=>{for(let i=0;i<count;i++)view.step(1/60,state);};

test('late Blood Cutter weapon samples its NPC age and stops when that exact carrier disappears',async t=>{
 const name='DamageEffect_SI_SA_SCA_BLOOD_CUTTER',main='BLOOD_CUTTER_Weapon';
 const {view,scene,index}=await setup(t,'CA',[main]);
 assert.equal(index.templates[main].fields.LifeTime,2);
 const point=anchor([700,150,0]),a=actor('CA'),e={id:9,ownerId:a.id,name,mainEffectName:main,active:true,
  definition:{SCALE_X:1.5,SCALE_Y:1.5,SCALE_Z:1.5},elapsed:1.25,meshLifetimeElapsed:1.25,animationTime:1.25,
  sourceElesisBloodCutter:{origin:[0,0,0],direction:[1,0,0]},sourceSkillMeshControl:true,
  sourcePosedAnchor:point,currentAnchor:point,birthAnchor:anchor([0,0,0])};
 const state={actors:[a],effects:[e]},before=structuredClone(state);
 view.event(birth(name,e.id,e.definition,{birthAnchor:e.birthAnchor,skillId:28023}),state);
 view.step(1/60,state);view.render();
 assert.deepEqual(view.sourceMeshClocks(),[{name:main,effectId:e.id,animationTime:1.25,globalTime:1.25}],
  'late delivery never restarts the original two-second visual clock');
 assert.deepEqual(state,before,'presentation only samples the carrier');
 const roots=scene.transformNodes.filter(n=>n.name.startsWith('fx-'+main+'-')&&n.name.endsWith('-world')&&n.isEnabled());
 assert.equal(roots.length,1);assert.deepEqual(roots[0].position.asArray().map(n=>n||0),[7,1.5,0]);
 e.sourcePosedAnchor=e.currentAnchor=anchor([1100,150,0]);e.elapsed=e.meshLifetimeElapsed=e.animationTime=1.95;
 view.step(1/60,state);view.render();assert.deepEqual(roots[0].position.asArray().map(n=>n||0),[11,1.5,0]);
 assert.deepEqual(view.sourceMeshClocks(),[{name:main,effectId:e.id,animationTime:1.95,globalTime:1.95}]);
 state.effects=[];view.step(1/60,state);view.step(1/60,state);view.render();
 assert.equal(view.count,0);assert.equal(view.performance().fxActiveParents,0);
 assert.ok(roots.every(n=>!n.isEnabled()),'NPC retirement revokes its visible mesh');
});

test('Blood Cutter stop releases every source projectile sequence without shortening particle lifetimes',async t=>{
 const raw=read(resolve(root,'packages/combat-core/ca-profile.json')).effectSets.EffectSet_SI_SA_SCA_BLOOD_CUTTER_Projectile.raw;
 const definitions=Object.entries(raw).filter(([k])=>/^EFFECT\d+$/.test(k)).map(([,d])=>d);
 const names=definitions.filter(d=>d.EFFECT_TYPE===8).map(d=>d.NAME);
 assert.equal(names.length,7);
 const {view,index}=await setup(t,'CA',names),state={actors:[actor('CA')],effects:[]};
 for(const t of Object.values(index.templates))assert.ok(t.kind==='particle'&&t.fields.Lifetime>0&&t.fields.Lifetime<=.4);
 for(let cycle=0;cycle<8;cycle++){
  definitions.filter(d=>d.EFFECT_TYPE===8).forEach((d,i)=>view.event(birth(d.NAME,cycle*10+i+1,d),state));
  steps(view,state,40);assert.ok(view.count>0,'original recurring projectile trails are visible');
  definitions.filter(d=>d.EFFECT_TYPE===8).forEach((_d,i)=>view.event({type:'effectEnded',effectId:cycle*10+i+1,reason:'original-stop-effect-set'},state));
  steps(view,state,80);assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
 }
});

test('Blaze Wing main has visible original passive meshes on the moving helper and all sequences retire',async t=>{
 const name='DamageEffect_SBH_Blaze_Wing_Main',p=read(resolve(root,'packages/combat-core/bh-profile.json'));
 const damage=p.damageEffects[name].raw,main=damage.MAIN_EFFECT_NAME;
 const entries=Object.entries(damage).filter(([key])=>/^PASSIVE_PARTICLE\d+$/.test(key)).map(([,e])=>e);
 assert.equal(entries.length,4);
 const samplers={effectBoneSampler:e=>e.currentAnchor.position};
 const {view,index}=await setup(t,'BH',[main,...entries.map(e=>e.PARTICLE_NAME)],samplers);
 assert.equal(index.templates[main].fields.DrawCount,0,'carrier is intentionally invisible');
 const point=anchor([0,100,0]),e={id:1,ownerId:'owner',name,mainEffectName:main,definition:{TRACE:1},
  currentAnchor:point,sourcePosedAnchor:point,birthAnchor:point,active:true},state={actors:[actor('BH')],effects:[e]};
 view.event(birth(name,1,e.definition,{birthAnchor:point,skillId:28017}),state);steps(view,state,12);
 assert.ok(view.count>1,'visible passive particles surround the invisible attack helper');
 e.currentAnchor=e.sourcePosedAnchor=anchor([750,100,0]);view.step(1/60,state);view.render();
 const sequences=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
 for(const row of sequences.filter(row=>entries.some(entry=>entry.PARTICLE_NAME===row.name)))
  assert.deepEqual(row.position,[750,100,0],'passives sample their exact moving helper, not a caster hand');
 state.effects=[];view.event({type:'effectEnded',effectId:1,reason:'template-life-time'},state);steps(view,state,100);
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
});

test('Reverse Stigma mark keeps original emission until an explicit saved-handle stop, then fully retires',async t=>{
 const name='ADE_PE03M_L',{view,index}=await setup(t,'DE',[name]),state={actors:[actor('DE')],effects:[]};
 const template=index.templates[name];assert.equal(template.fields.Emitrate,4);assert.equal(template.fields.Lifetime,.35);
 assert.equal(template.fields.TriggerCount,undefined);assert.equal(template.fields.TriggerTime,undefined);
 for(let cycle=0;cycle<12;cycle++){
  const id=cycle+1;view.event(birth(name,id,{TRACE:1}),state);steps(view,state,180);
  assert.ok(view.count>0,'each source particle is finite but the marked sequence keeps emitting');
  // The combat record may have retired. Stop still addresses the saved
  // effect identity, which remains owned by production presentation.
  view.event({type:'effectEnded',effectId:id,reason:'add-stigma-mark-ended'},state);steps(view,state,120);
  assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
 }
});

test('Reverse Stigma RETURN original six-child burst retires with no time override',async t=>{
 const name='ADE_RE_ST_RETURN_P00M',{view,index}=await setup(t,'DE',[name]),state={actors:[actor('DE')],effects:[]};
 assert.equal(index.templates[name].fields.Lifetime,1);assert.equal(index.templates[name].fields.TriggerCount,1);
 assert.equal(index.templates[name].repeated.TraceParticleList.length,6);
 for(let cycle=0;cycle<12;cycle++){
  view.event(birth(name,cycle+1,{TRACE_MORE:1}),state);steps(view,state,25);assert.ok(view.count>0);
  steps(view,state,215);assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(view.performance().fxActiveParents,0);
 }
});
