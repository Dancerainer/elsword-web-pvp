/** Production visual retirement with original converted geometry. NullEngine
 * and ready test textures do not establish GPU/pixel or client equivalence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {bmSampledFixture,bmProfile} from '../helpers/bm-feedback-fixture-v4.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/bm/fx/index.json',import.meta.url))),set='EffectSet_RBM_BLACKHOLE';
const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/bm',path)))]));
for(const facing of [-1,1])test(`BM ${facing} skill cancel retires all three original black-hole display owners`,async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('bm-blackhole',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/bm',file)));
  const profile={...bmProfile,states:{},skillCatalog:[],buffTemplates:{},sourceLiteralResources:[],resourceOnlyTemplates:[],
    resourceOnlyEffectSets:[set],effectSets:{[set]:bmProfile.effectSets[set]},damageEffects:{RBM_BLACKHOLE:bmProfile.damageEffects.RBM_BLACKHOLE}};
  const seed=bmSampledFixture({facing,passives:[],gap:4000,skillId:24210});
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,loadout:[],nativeRandom:seed.native.effectRandom,
    samplers:{effectAnchorSampler:seed.sim.effectAnchorSampler,effectBoneSampler:seed.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  let warmed;
  for(let cycle=0;cycle<3;cycle++){
    const f=cycle===0?seed:bmSampledFixture({facing,passives:[],gap:4000,skillId:24210}),step=f.sim.step.bind(f.sim);
    f.sim.step=(...args)=>{const result=step(...args);for(const e of f.sim.drainEvents())if(e.setName===set||e.type==='effectEnded')view.event(e,f.sim.state);
      view.step(1/60,f.sim.state);view.render();return result;};
    f.zzz();f.press('X');f.wait('RBM_COMBO_ZZZX');f.at(.35);
    assert.equal(view.proof().activeEffectParents,3);assert.ok(view.count>0);
    assert.ok(view.proof().activeEmitters>0||view.performance().fxMeshesLive>0);
    if(cycle%2){f.press('Z');f.wait('RBM_COMBO_ZZZXZ');f.at(.25);assert.equal(view.proof().activeEffectParents,3);}
    f.press('A');f.step();
    assert.equal(view.proof().activeEffectParents,0);assert.equal(view.count,0);
    assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeParticles,0);
    assert.equal(view.performance().fxMeshesLive,0);
    if(warmed!=null)assert.equal(view.proof().meshInstances,warmed,'later cancellation cycles reuse a bounded visual pool');
    warmed=view.proof().meshInstances;
  }
});
