/** Actual converted VC assets; verifies simulator/render ownership, not original-client timing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile,vcEffectIndex,vcEffectPoses} from '../helpers/vc-fixture.mjs';
import {activateVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';

for(const ending of ['expiry','death','network-retirement'])test(`VC overheat ${ending} retires actual long-lived meshes without pool growth`,async t=>{
  const f=vcFixture(),engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('vc-lifetime',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  const names=['RVC_OverHeat_Object_Start','RVC_OverHeat_Main_Effect','RVC_OverHeat_Object_End'];
  const profile={...vcProfile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({scene,engine,profile,index:{...vcEffectIndex,templates:Object.fromEntries(names.map(n=>[n,vcEffectIndex.templates[n]]))},
    effectPoses:vcEffectPoses,samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  function tick(frames){for(let i=0;i<frames;i++){f.sim.step(1/60,{}, {snapshot:false});for(const e of f.sim.drainEvents())view.event(e,f.sim.state);view.step(1/60,f.sim.state);}}
  let warmed;
  for(let cycle=0;cycle<(ending==='death'?1:4);cycle++){
    activateVeteranOverheat(f.sim,f.a);tick(2);
    assert.equal(view.proof().activeEffectParents,3);assert.ok(view.count>=3);
    if(ending==='death')f.a.hp=0;
    if(ending==='network-retirement'){
      // Owner snapshots can retire effects before the next buff snapshot.
      for(const id of f.a.sourceVeteranCommander.heatEffects)view.event({type:'effectEnded',effectId:id,reason:'network-owner-effect-ended'},f.sim.state);
    }
    tick(18*60);
    assert.equal(view.count,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
    assert.equal(view.performance().fxMeshesLive,0);
    if(warmed!=null)assert.equal(view.proof().meshInstances,warmed,'later casts reuse bounded pools');
    warmed=view.proof().meshInstances;
  }
});
