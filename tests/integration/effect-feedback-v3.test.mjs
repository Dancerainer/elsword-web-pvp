import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectPresentationPolicy,FULL_EFFECT_QUALITY,DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {createAwakeningEffects} from '../../apps/web/awakening-effects.mjs';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,profile,visualIndex,poses,fixtureRoot,index as collisionIndex} from '../helpers/rf-passive-fixture-v12.mjs';

const pose=JSON.parse(readFileSync(resolve(fixtureRoot,'artifacts/rf/runtime-pose.json')));
function closure(roots){const names=new Set(roots);for(const name of names){const template=visualIndex.templates[name];assert.ok(template,name);
  for(const field of ['TraceParticleList','FinalParticleList'])for(const child of template.repeated?.[field]??[])names.add(child);}return names;}
async function viewFixture(t,simulation,damageNames,roots){
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('feedback-camera',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resolve(fixtureRoot,'artifacts/rf',file)));
  const names=closure(roots),index={...visualIndex,templates:Object.fromEntries([...names].map(name=>[name,visualIndex.templates[name]]))};
  const bounded={...profile,states:{},skillCatalog:[],buffTemplates:{},effectSets:{},
    damageEffects:Object.fromEntries(damageNames.map(name=>[name,profile.damageEffects[name]])),resourceOnlyEffectSets:[],resourceOnlyTemplates:[...names]};
  const view=await createEffectsView({scene,engine,index,profile:bounded,effectPoses:poses,effectQuality:DEFAULT_EFFECT_QUALITY,
    samplers:{effectAnchorSampler:simulation.effectAnchorSampler,effectBoneSampler:simulation.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});return view;
}

test('presentation uses frozen combo bindings and leaves all catalog skill states at medium',()=>{
  const policy=createEffectPresentationPolicy(profile,DEFAULT_EFFECT_QUALITY);
  for(const skill of profile.skillCatalog)for(const state of skill.states??[])assert.deepEqual(policy.actor({state,skillId:skill.skillId}),
    skill.skillId===24010?{level:'medium',particleDivisor:16}:DEFAULT_EFFECT_QUALITY);
  for(const state of ['RSI_COMBO_Z','RSI_COMBO_XXX','RRF_DASH_JUMP_COMBO_X','RSI_STANDUP_ATTACK_FRONT'])
    assert.deepEqual(policy.actor({state,skillId:null}),FULL_EFFECT_QUALITY,state);
  for(const setName of ['EffectSet_RRF_DashJumpX','EffectSet_A_RF_XXX','EffectSet_A_RRF_ZZXfrontXX']){
    assert.deepEqual(policy.effect({setName,skillId:null}),FULL_EFFECT_QUALITY);
    assert.deepEqual(policy.effect({setName,skillId:24206}),DEFAULT_EFFECT_QUALITY,'skill owner cannot be promoted by a reused set');}
  assert.deepEqual(policy.effect({setName:'EffectSet_A_RRF_EnchantHand',skillId:24206}),DEFAULT_EFFECT_QUALITY);
});

test('a full combo emitter preserves its dense trace descendants while simultaneous active emitters retain 1/8',()=>{
  const names=closure(['Raven_Hand_Fire05']),index={templates:Object.fromEntries([...names].map(name=>[name,visualIndex.templates[name]]))};
  const runtime=createEffectRuntime({index,effectQuality:DEFAULT_EFFECT_QUALITY});
  const combo=runtime.add('Raven_Hand_Fire05',{effectQuality:FULL_EFFECT_QUALITY,triggerCount:16});
  const active=runtime.add('Raven_Hand_Fire05',{triggerCount:16});
  for(let i=0;i<12;i++)runtime.step(1/60,{});
  assert.equal(combo.count,16);assert.equal(active.count,2);
  const child=[...runtime.emitters.values()].find(e=>e.options.parentParticleId&&e.quality.particleDivisor===1);
  assert.ok(child);runtime.clear();assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});

test('all awakening thresholds retain source-density four bone flames under the medium skill setting',()=>{
  const templates=Object.fromEntries(['HyperBoostRightBlack','HyperBoostLeftBlack'].map(name=>[name,visualIndex.templates[name]]));
  const samplers=createNativeSamplers({profile,characterPose:pose,effectIndex:collisionIndex,effectPoses:poses});
  for(const remaining of [9,14,30,60,90]){
    const actor={id:'rf',hp:100,x:2022.98,y:2840,z:0,facing:1,state:'RSI_WAIT',animationName:'Wait',animationTime:0,awakening:{remaining}};
    const runtime=createEffectRuntime({index:{templates},effectQuality:DEFAULT_EFFECT_QUALITY}),aura=createAwakeningEffects({runtime,samplers,maxHyperModeTime:30});
    let emptySteadyFrames=0;for(let i=0;i<120;i++){aura.step({actors:[actor]});runtime.step(1/60,{actors:[actor]});if(i>=12&&runtime.count===0)emptySteadyFrames++;}
    assert.equal(emptySteadyFrames,0,String(remaining));assert.equal(aura.proof().emitters,4);
    assert.ok([...runtime.emitters.values()].every(e=>e.divisor===1));actor.awakening.remaining=0;aura.step({actors:[actor]});assert.equal(runtime.count,0);
  }
});

test('actual XCrash first scratch receives source-timed particles before .2 seconds, and finite stage stops them',async t=>{
  const simulation=await make({skillId:24010,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});simulation.drainEvents();
  const view=await viewFixture(t,simulation,['DamageEffect_SA_RRF_XCrash1'],['RRF_XCrash_ScrachDummy01','XCrash_ScrachP01']);
  let bornAt=null,firstAt=null,peak=0;
  for(let i=0;i<180;i++){
    simulation.step(1/60,i===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
    for(const event of simulation.drainEvents())if(event.name==='DamageEffect_SA_RRF_XCrash1'){
      if(event.type==='effectStarted')bornAt=simulation.state.time;view.event(event,simulation.state);}
    view.step(1/60,simulation.state);view.render();const active=view.proof({includeDraws:true}).nativeParticleDraws.counts.XCrash_ScrachP01??0;
    peak=Math.max(peak,active);if(active&&firstAt===null)firstAt=simulation.state.time;
  }
  assert.ok(bornAt!==null&&firstAt!==null);assert.ok(firstAt-bornAt<.2,JSON.stringify({bornAt,firstAt}));assert.ok(peak>=6);
  assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
});

test('replayed original Enchant Hand birth keeps one passive group and every unbounded hand emitter is stopped',async t=>{
  const simulation=await make({skillId:24206,passives:[],positions:[[2022.98,2840,0],[1000,2840,0]]});simulation.drainEvents();
  const raw=profile.damageEffects.DamageEffect_A_RRF_EnchantHand.raw;
  assert.equal(visualIndex.templates[raw.MAIN_EFFECT_NAME].fields.LifeTime,.25);
  assert.equal(visualIndex.templates.EnchantHand_PM.fields.TriggerCount,undefined,'original stop is owned by the .25s parent');
  const roots=[raw.MAIN_EFFECT_NAME,...Object.entries(raw).filter(([key])=>/^PASSIVE_PARTICLE\d+$/.test(key)).map(([,entry])=>entry.PARTICLE_NAME)];
  const view=await viewFixture(t,simulation,['DamageEffect_A_RRF_EnchantHand'],roots);
  let duplicate=0,peak=0;
  for(let i=0;i<300;i++){
    simulation.step(1/60,i===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
    for(const event of simulation.drainEvents())if(event.name==='DamageEffect_A_RRF_EnchantHand'){
      view.event(event,simulation.state);if(event.type==='effectStarted'){const before=view.proof();view.event(structuredClone(event),simulation.state);
        assert.equal(view.proof().activeEmitters,before.activeEmitters,'duplicate identity must not overwrite the native sequence handles');duplicate++;}}
    view.step(1/60,simulation.state);view.render();peak=Math.max(peak,view.count);
  }
  assert.equal(duplicate,1);assert.ok(peak>0);assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
});
