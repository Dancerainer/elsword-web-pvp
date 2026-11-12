/** Finite source bursts; budget expectations are independent source counts,
 * never a count captured from the implementation's first playback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile,vcEffectPoses} from '../helpers/vc-fixture.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const contract=JSON.parse(readFileSync(new URL('../../contracts/vc-harpoon-source-v4.json',import.meta.url)));
const quality={level:'medium',particleDivisor:8};
const budget=skillId=>collectEffectMeshBudget(vcProfile,index,skillId?[{skillId}]:[],{effectQuality:quality});

test('native zero loop cap still prepares the first child because source checks the cap after successful creation',()=>{
  const cpp=contract.sourceFiles.find(row=>row.path==='X2Lib/X2DamageEffect.cpp');
  assert.ok(cpp.fragments.some(row=>row.start===2290&&row.end===2309),'source freezes increment then removal, after CreateInstance');
  // Deliberate boundary fixture, not an original VC declaration. Native first
  // creates the child, increments uiCreateCount, then tests cap <= count; cap0
  // therefore retires the declaration after the first successful child.
  const profile={...vcProfile,skillCatalog:[],states:{Fixture:{raw:{NAME:'Parent'}}},buffTemplates:{},effectSets:{},
    resourceOnlyEffectSets:[],resourceOnlyTemplates:[],sourceLiteralResources:[],damageEffects:{Parent:{raw:{
      MAIN_EFFECT_NAME:'ParentMesh',CREATE_DAMAGE_EFFECT0:{DAMAGE_EFFECT_NAME:'Child',EVENT_TIME:0,LOOP_INTERVAL:.1,LOOP_END_TIME:1,LOOP_END_COUNT:0}}},
    Child:{raw:{MAIN_EFFECT_NAME:'ChildMesh'}}}};
  const fixtureIndex={templates:Object.fromEntries(['ParentMesh','ChildMesh'].map(name=>[name,{name,kind:'mesh',glb:'boundary-fixture.glb',
    fields:{LifeType:'LT_TIME',LifeTime:1,DrawCount:1},events:[]}]))};
  const actual=collectEffectMeshBudget(profile,fixtureIndex,[],{effectQuality:quality});
  assert.equal(actual.demands.get('ChildMesh').views,1);
});

test('equipped Harpoon reserves eight source loop children per branch, while resource-only preparation does not reserve unequipped bursts',()=>{
  const raw=contract.damageEffects.RAVEN_HARPOON_SPEAR_SHELL_EXPLOSION_Sub_Damage_Ultimate.raw;
  for(const key of ['CREATE_DAMAGE_EFFECT1','CREATE_DAMAGE_EFFECT2'])
    assert.deepEqual([raw[key].EVENT_TIME,raw[key].LOOP_INTERVAL,raw[key].LOOP_END_COUNT,raw[key].LOOP_END_TIME],[0,.13,10,1.3]);
  assert.equal(contract.templates.RWT_SA_HARPOON_SPEAR_EXPLOSION_Ultimate.fields.LifeTime,1);
  // Literal times 0,.13,.26,.39,.52,.65,.78,.91 fit before the one-second
  // carrier expires. Both branches share the Add_Flame main mesh.
  const actual=budget(24031);assert.deepEqual(actual.unsupported,[]);
  assert.equal(actual.demands.get('Mesh_Harpoon_Spear_Shell_Explosion_Add_Flame').views,16);
  assert.equal(actual.demands.get('Raven_HarpoonSpearSton1').effectSetInstances,8);
  assert.equal(budget().demands.has('Mesh_Harpoon_Spear_Shell_Explosion_Add_Flame'),false);
});

test('equipped Giga reserves the finite sixteen source columns and the two finishing directions',()=>{
  assert.deepEqual(contract.compiledBurstLimits.giga,{maxLoopCount:8,flameTimesPerLoop:[.01,.24],
    flameEffectSet:'EffectSet_Raven_Giga_Prominence_Flame',finishStoneCount:2,finishFlameCountPerBranch:2,overheatSmokeCount:1});
  const actual=budget(24021),base=budget();assert.deepEqual(actual.unsupported,[]);
  assert.equal(actual.demands.get('RWT_GIGA_PROMINENCE_FireTail').effectSetInstances,16,'fixed-source eight loops, .01 and .24 each');
  assert.equal(base.demands.get('RWT_GIGA_PROMINENCE_FireTail').effectSetInstances,1,'resource union does not allocate the equipped burst');
  for(const name of ['RWT_GIGA_PROMINENCE_Flame_01','RWT_GIGA_PROMINENCE_OverHit_Flame_01'])
    assert.equal(actual.demands.get(name).effectSetInstances,2,'normal and overheat are alternative branches with two directions each');
});

test('real Giga normal/overheat casts reuse the equipped burst pools on every battle packet',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=2048;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('giga-pool-v4',new Vector3(0,33,20),scene);
  let fixture=vcFixture({skillId:24021,passives:[]});
  const view=await createEffectsView({scene,engine,index,profile:vcProfile,effectPoses:vcEffectPoses,effectQuality:quality,
    assetBase:'/assets/vc/',loadContainer:async(_base,file)=>loadPoseContainer(scene,resolve('artifacts/vc',file)),
    samplers:{effectAnchorSampler:(...a)=>fixture.sim.effectAnchorSampler(...a),effectBoneSampler:(...a)=>fixture.sim.effectBoneSampler(...a)}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  for(const heat of [false,true]){
    view.clear();fixture=vcFixture({skillId:24021,passives:[],position:[-600,3080,0],gap:500});
    const {sim}=fixture;sim.drainEvents();await view.prewarmActors(sim.state.actors);
    const prepared=view.proof().meshInstances,births=[];let columns=0;
    for(let frame=0;frame<900;frame++){
      sim.step(1/60,frame===0||heat&&frame<90&&frame%2===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
      for(const event of sim.drainEvents()){
        if(event.type==='effectStarted')births.push(event.name);
        if(event.type==='effectSet'&&event.name==='EffectSet_Raven_Giga_Prominence_Flame')columns++;
        view.event(event,sim.state);
      }
      view.step(1/60,sim.state);view.render();
      assert.equal(view.proof().meshInstances,prepared,`no synchronous Giga mesh clone at frame ${frame}, heat=${heat}`);
    }
    assert.equal(columns,16);assert.equal(births.filter(name=>name==='RAVEN_GIGA_PROMINENCE_FINISH_STONE').length,2);
    assert.equal(births.filter(name=>name==='RAVEN_GIGA_PROMINENCE_FINISH'+(heat?'_OVERHEAT':'')).length,2);
    assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeParticles,0);assert.equal(view.proof().activeEmitters,0);
  }
});
