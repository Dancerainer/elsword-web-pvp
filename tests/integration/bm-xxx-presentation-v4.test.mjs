/** Actual source assets in production presentation; NullEngine is not GPU evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {bmSampledFixture,bmProfile} from '../helpers/bm-feedback-fixture-v4.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/bm/fx/index.json',import.meta.url))),setName='EffectSet_A_RF_XXX';
const effectPoses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/bm',path)))]));

test('BM shared XXX remains an original command under the existing quality policy',()=>{
  const policy=createEffectPresentationPolicy(bmProfile,DEFAULT_EFFECT_QUALITY);
  assert.ok(policy.comboSets.has(setName));assert.equal(policy.effect({setName,skillId:null}),FULL_EFFECT_QUALITY);
  assert.equal(index.templates.RAVEN_RF_XXX_ATTACK_BOX.glb,'../rf/fx/meshes/DummyAttackBox_50x50x50.glb');
});

for(const facing of[-1,1])test(`BM XXX dispatches original blast particles and retires actual presentation handles, facing ${facing}`,async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('bm-xxx',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/bm',file)));
  // Isolate the blast's own lifecycle from common target-hit emitters.
  const f=bmSampledFixture({facing,passives:[],gap:4000});
  const profile={...bmProfile,states:{},skillCatalog:[],buffTemplates:{},sourceLiteralResources:[],
    resourceOnlyEffectSets:[setName],effectSets:{[setName]:bmProfile.effectSets[setName]},
    damageEffects:{DamageEffect_RF_XXX:bmProfile.damageEffects.DamageEffect_RF_XXX}};
  const view=await createEffectsView({scene,engine,index,profile,effectPoses,
    nativeRandom:f.native.effectRandom,effectQuality:DEFAULT_EFFECT_QUALITY,loadout:[],samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const quads=new Set(),meshes=new Set(),particles=new Set(),step=f.sim.step.bind(f.sim);
  f.sim.step=(...args)=>{
    const result=step(...args);for(const event of f.sim.drainEvents())view.event(event,f.sim.state);
    view.step(1/60,f.sim.state);view.render();
    const draws=view.proof({includeDraws:true}).nativeParticleDraws;
    for(const name of Object.keys(draws.counts))particles.add(name);
    for(const batch of draws.batches)quads.add(batch.name);
    for(const sample of draws.samples)meshes.add(sample.name);
    return result;
  };
  f.press('X');f.press('X');f.wait('RSI_COMBO_XX');f.press('X');f.wait('RSI_COMBO_XXX');f.wait('RSI_WAIT');f.step(180);
  for(const name of ['Raven_ReadyS_P01','Raven_ReadyS_P02','Raven_ReadyS_P03','Raven_ReadyS_P05'])
    assert.ok(meshes.has(name)||[...quads].some(q=>q.startsWith('native-particle:'+name+'|')),name+' original blast actually emits drawing data; '+JSON.stringify({particles:[...particles],unsupported:view.proof().unsupported}));
  assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeEmitters,0,JSON.stringify(view.proof({includeDraws:true}).nativeParticleDraws.sequences));assert.equal(view.proof().activeParticles,0);
  assert.deepEqual(view.proof().unsupported,['stretch-orientation'],
    'the reused RF closure retains its existing unimplemented source stretch orientation; no guessed orientation');
});
