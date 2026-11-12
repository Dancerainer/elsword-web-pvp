/** Actual character/effect GLB hierarchy and production pose/display. Texture
 * I/O uses a ready white pixel under NullEngine; no original GPU/RGBA claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
import {createInputBuffer} from '../../apps/web/input-buffer.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
const root=resolve(import.meta.dirname,'../..'),assets=resolve(process.env.ELESIS_ASSET_ROOT??resolve(root,'artifacts')),dt=1/60;
const read=p=>JSON.parse(readFileSync(resolve(assets,'ca',p),'utf8'));
const wave='DamageEffect_SCA_Combo_ZZZ_Projectile01';
for(const facing of [-1,1])test(`CA ${facing}: original character second-X pose has no wave; landing third-X and Finish reach real particle display`,async t=>{
 const f=elesisFixture('CA',{gap:5000,facing}),{sim,a,profile}=f,{effectIndex,effectPoses,samplers,characterPose}=elesisAssets('CA');
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('ca-v58-display',new Vector3(0,0,10),scene);
 const manifest=read('manifest.json'),container=await loadPoseContainer(scene,resolve(assets,'ca',manifest.runtimeGlb));
 let shared=null;if(manifest.sharedCharacterAnimations?.clips.length){shared=await loadPoseContainer(scene,resolve(assets,'ca',manifest.sharedCharacterAnimations.glb));
  installSharedCharacterAnimations(container,shared,manifest.sharedCharacterAnimations.clips);}
 const actor=createActorView(container,scene,'ca-original-v58',.01,characterPose),templates={},queue=[];
 for(const name of [wave,wave+'_Uppercut',wave+'_Finish']){
  const raw=profile.damageEffects[name].raw;queue.push(raw.MAIN_EFFECT_NAME);
  for(const[key,e]of Object.entries(raw))if(/^(?:START|TIME|HIT|PASSIVE)_PARTICLE\d+$/.test(key))queue.push(e.PARTICLE_NAME);
 }
 for(const name of queue){if(templates[name])continue;const template=effectIndex.templates[name];assert.ok(template,name);templates[name]=template;
  for(const key of ['TraceParticleList','FinalParticleList'])queue.push(...(template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[])));}
 const view=await createEffectsView({scene,engine,index:{templates},effectPoses,samplers,
  profile:{...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]},
  effectQuality:{level:'high',particleDivisor:1},assetBase:'/assets/ca/',
  loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(assets,'ca',file))});
 t.after(()=>{view.clear();actor.dispose();container.dispose();shared?.dispose();scene.dispose();engine.dispose();});
 const input=createInputBuffer({sampledLevels:true}),events=[],waveIds=new Set(),poseFrames=new Map();let uppercutDraws=0,finishDraws=0;
 function step(){sim.step(dt,{[a.id]:input.consume(sim.state.time+dt)},{snapshot:false});
  actor.root.position.set(a.x*.01,a.y*.01,-a.z*.01);actor.root.rotation.y=a.facing<0?Math.PI:0;
  assert.equal(sampleAnimation(actor,a.animationName,a.animationTime,a.animationLoop,a.presentationTransition),true,a.animationName);
  assert.ok(actor.nodesBySourceName.get('Bip01').computeWorldMatrix(true).asArray().every(Number.isFinite));
  poseFrames.set(a.animationName,(poseFrames.get(a.animationName)??0)+1);
  for(const e of sim.drainEvents()){
   events.push(e);if(e.type==='effectStarted'&&e.name?.startsWith(wave)){waveIds.add(e.effectId);view.event(e,sim.state);}
   else if(waveIds.has(e.effectId))view.event(e,sim.state);
  }
  view.step(dt,sim.state);view.render();
  const draws=view.proof({includeDraws:true}).nativeParticleDraws;
  if(sim.state.effects.some(e=>e.name===wave+'_Uppercut'&&!e.dead)&&draws.sequences.length)uppercutDraws++;
  if(sim.state.effects.some(e=>e.name===wave+'_Finish'&&!e.dead)&&draws.sequences.length)finishDraws++;
 }
 const edge=(key,on)=>{input[on?'down':'up'](key,sim.state.time+.001);step();},tap=key=>{edge(key,true);edge(key,false);};
 const until=(p,label,max=300)=>{for(let n=0;n<max&&!p();n++)step();assert.ok(p(),label+': '+a.state+'@'+a.animationTime);};
 step();const forward=facing>0?'RIGHT':'LEFT';tap(forward);edge(forward,true);tap('UP');for(let n=0;n<4;n++)step();tap('X');tap('X');
 until(()=>a.state==='ESI_DASH_JUMP_COMBO_SDK_XX','second X');for(let n=0;n<2;n++)step();
 assert.ok(poseFrames.get('DashJumpCombo_XX')>0,'actual original second-X GLB clip sampled');
 assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name?.startsWith(wave)).length,0);
 assert.equal(view.count,0,'second-X pose does not masquerade as a launched effect');
 tap('X');until(()=>a.state==='ESI_DASH_JUMP_COMBO_SDK_XXX','third X after support');assert.equal(a.grounded,true);
 for(let n=0;n<80;n++)step();assert.ok(poseFrames.get('DashJumpCombo_SDK_XXX')>0);
 assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name===wave+'_Uppercut').length,1);assert.ok(uppercutDraws>0,'actual original Uppercut particles reach render');
 edge(forward,false);until(()=>a.state==='RSI_WAIT','third-X recovery');
 // Isolated contact/display fixture: actual END pose and its recovered native
 // producer, while the physical full chain is independently tested in combat.
 sim.enter(a,'ESI_DASH_COMBO_SCA_ZZZ_END','v58-original-Finish-display');for(let n=0;n<150;n++)step();
 assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name===wave+'_Finish').length,1);assert.ok(finishDraws>0);
 assert.equal(scene.meshes.some(m=>m.name.includes('SCA_Combo_ZZZ_Projectile_Finish_AttackBoX')&&m.getTotalVertices()>0&&m.isEnabled()),false,'DrawCount0 original helper stays invisible');
 assert.equal(view.count,0);assert.equal(view.performance().fxEmitters,0);assert.equal(actor.missing.size,0);
});
