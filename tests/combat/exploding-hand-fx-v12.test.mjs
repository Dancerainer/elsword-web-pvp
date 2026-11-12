import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {make,visualIndex,profile,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

// Names and counts are literal target2016 START_PARTICLE declarations.
const extraName='DamageEffect_RRF_ExplosiveHand_Impact_NEW';
const names=['SA_RVC_DeadlyRaid_P02','SA_RVC_DeadlyRaid_P04','RWT_BARRAGE_ATTACK_Flame_Smoke02','RWT_BARRAGE_ATTACK_Flame_Smoke01','RWT_BARRAGE_ATTACK_Spark'];

test('keyboard X proc renders all five original explosion templates once and retires their particles',async t=>{
  const selected={...visualIndex,templates:Object.fromEntries(['Vibration_Shooting_Impact',...names].map(name=>{
    assert.ok(visualIndex.templates[name],name+' real asset is required');return [name,visualIndex.templates[name]];
  }))};
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('explosion-camera',new Vector3(0,0,10),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,targetScene)=>loadPoseContainer(targetScene,resolve(fixtureRoot,'artifacts/rf',file)));
  const s=await make({seed:30});
  // This test checks the five-template rendering route after a proc, not
  // probability distribution or original seed production. Supply a fixed
  // Web harness sample inside passive24402's source .10 chance explicitly.
  s.rng=()=>.05;
  const view=await createEffectsView({scene,engine,index:selected,profile,effectPoses:poses,
    samplers:{effectAnchorSampler:s.effectAnchorSampler,effectBoneSampler:s.effectBoneSampler}});
  try{
    s.drainEvents();let first=false,peak=0;
    for(let frame=0;frame<120;frame++){
      s.step(1/60,frame===0?{pressed:['X'],held:['X']}:{},{snapshot:false});
      const events=s.drainEvents();
      for(const e of events)view.event(e,s.state);
      view.step(1/60,s.state);view.render();peak=Math.max(peak,view.count);
      if(events.some(e=>e.type==='effectStartParticles'&&e.name===extraName)){
        assert.equal(first,false,'the first-live-frame dispatch must not repeat');first=true;
        assert.deepEqual(view.proof().startParticleEmitters,Object.fromEntries(names.map(name=>[name,1])));
        assert.equal(view.proof().batchedQuadMaterials,5,'five original texture/template batches');
        assert.ok(view.count>0,'START entries reached the actual particle runtime');
      }
    }
    assert.equal(first,true);assert.ok(peak>5);
    assert.equal(view.count,0,'source lifetimes stop particles after the short damage effect ends');
    assert.deepEqual(view.proof().startParticleEmitters,Object.fromEntries(names.map(name=>[name,1])));
    assert.ok(!view.proof().unsupported.some(value=>/start-particle-parent|Original particle attachment bone/.test(value)));
    view.clear();assert.deepEqual(view.proof().startParticleEmitters,{});
  }finally{view.clear();scene.dispose();engine.dispose();}
});
