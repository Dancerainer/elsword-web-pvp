import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {collectEffectTemplates,collectEffectMeshBudget,createEffectPrewarmPlanner} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {make,profile,visualIndex,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const quality={level:'medium',particleDivisor:8},slots=[{skillId:24010}];

test('original XCrash callback-only damage roots and their deferred child are prewarmed',()=>{
  const source=JSON.parse(readFileSync(new URL('../../contracts/rf-xcrash-source-v14.json',import.meta.url)));
  assert.equal(source.functions.find(row=>row.name==='SI_SA_RRF_X_CRASH_FrameMove').bodySha256,'d7e85f20667903eefda7324ef15cff66f7b822cfdba94a68fa845a3008fd1f0b');
  assert.equal(profile.damageEffects.RRF_X_CRASH_NODAMAGE.raw.CREATE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,'RRF_X_CRASH3');
  assert.equal(profile.damageEffects.RRF_X_CRASH_NODAMAGE_HYPER.raw.CREATE_DAMAGE_EFFECT0.DAMAGE_EFFECT_NAME,'RRF_X_CRASH3_HYPER');
  assert.equal(profile.damageEffects.RRF_X_CRASH3.raw.MAIN_EFFECT_NAME,'Raven_RRF_X_Crash3');
  const actual=collectEffectTemplates(profile,visualIndex,slots);
  assert.ok(actual.has('Raven_RRF_SI_SA_X_Crash_Mesh03'),'the callback-created main body must exist before the cast');
  assert.ok(actual.has('Raven_RRF_X_Crash3'),'its .03s CREATE_DAMAGE child must exist before the cast');
});

test('actual XCrash HIT mesh budget covers source descendants and parallel opposing targets',()=>{
  // Frozen target declarations: two one-contact punch sources plus the fire
  // source's .36s life / .07s hit gap. Keep one boundary contact: 1+1+7=9.
  // RF_HitP04 emits up to2 particles at1/8, and DrawCount=2: 9*2*2=36.
  const first=profile.damageEffects.DamageEffect_SA_RRF_XCrash1_Damage.raw.DAMAGE_DATA;
  const second=profile.damageEffects.DamageEffect_SA_RRF_XCrash2_Damage.raw.DAMAGE_DATA;
  const fire=profile.damageEffects.DamageEffect_SA_RRF_XCrash_Fire_Damage.raw;
  assert.equal(first.RE_ATTACK,0);assert.equal(second.RE_ATTACK,0);
  assert.equal(fire.DAMAGE_DATA.RE_ATTACK,1);assert.equal(fire.DAMAGE_DATA.HIT_GAP,.07);
  assert.equal(visualIndex.templates[fire.MAIN_EFFECT_NAME].fields.LifeTime,.36);
  assert.deepEqual([visualIndex.templates.RF_HitP04.fields.NumParticles,visualIndex.templates.RF_HitP04.fields.TriggerCount,visualIndex.templates.RF_HitP04.fields.DrawCount],[10,10,2]);
  const single=collectEffectMeshBudget(profile,visualIndex,slots,{effectQuality:quality});
  assert.deepEqual(single.demands.get('RF_HitP04'),{views:36,peakParticles:2,drawCount:2,effectSetInstances:9});
  assert.equal(single.demands.get('Raven_RRF_X_Crash3').views,1);
  const multiple=collectEffectMeshBudget(profile,visualIndex,slots,{effectQuality:quality,targetCount:3});
  assert.equal(multiple.demands.get('RF_HitP04').views,108);
  const high=collectEffectMeshBudget(profile,visualIndex,slots,{effectQuality:{level:'high',particleDivisor:1}});
  assert.equal(high.demands.get('RF_HitP04').views,180,'high keeps all10 particles and both authored draw passes');
  const plan=createEffectPrewarmPlanner(profile,visualIndex,{effectQuality:quality});
  assert.equal(plan(slots).demands.get('RF_HitP04').views,36);
  assert.equal(plan(slots,{targetCount:3}).demands.get('RF_HitP04').views,108,'a roster change cannot reuse a smaller cached plan');
});

test('real native XCrash hit events reuse prepared original HIT meshes during the whole cast',async t=>{
  // Texture-free actual GLB loader isolates the model-pool path. Source map,
  // character pose, native callbacks and collision events remain real inputs.
  const sim=await make({skillId:24010,passives:[]});sim.drainEvents();
  const template=visualIndex.templates.RF_HitP04;
  const index={templates:{RF_HitP04:template,...Object.fromEntries(['AttackBox_SA_RRF_XCrash_1_2','AttackBox_SA_RRF_XCrash_Fire'].map(name=>{
    const source=visualIndex.templates[name];
    return [name,{...source,glb:undefined,fields:{...source.fields,DrawCount:0}}];
  }))}};
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('hit-pool',new Vector3(20,32,85),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,s)=>loadPoseContainer(s,resolve(fixtureRoot,'artifacts/rf',file)));
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,loadout:slots,effectQuality:quality,
    samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler}});
  try{
    const prepared=view.proof().meshInstances;assert.equal(prepared,36);
    let hits=0,peak=0;
    for(let frame=0;frame<360;frame++){
      sim.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
      for(const event of sim.drainEvents()){
        if(event.type==='hit'&&event.origin?.skillId===24010)hits++;
        view.event(event,sim.state);
      }
      view.step(1/60,sim.state);view.render();
      peak=Math.max(peak,view.proof({includeDraws:true}).nativeParticleDraws.counts.RF_HitP04??0);
      assert.equal(view.proof().meshInstances,prepared,`no synchronous clone on combat frame${frame}`);
    }
    assert.ok(hits>=2,'actual native cast must produce multiple accepted collisions');
    assert.ok(peak>2,'test must exercise multiple live HIT emitters, beyond the old single-emitter budget');
    assert.equal(view.count,0,'all original HIT particles expire');
    assert.equal(view.proof().activeEmitters,0);
  }finally{view.clear();scene.dispose();engine.dispose();}
});
