/** Original target loop declarations + actual pose/mesh renderer. NullEngine
 * checks source transforms and lifetimes, not GPU pixels or original feel. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
const vcEffectIndex=JSON.parse(readFileSync(new URL('../../artifacts/vc/fx/index.json',import.meta.url)));
const vcEffectPoses=Object.fromEntries([...new Set(Object.values(vcEffectIndex.templates).map(t=>t.poseData).filter(Boolean))]
  .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/vc',path)))]));
const source=JSON.parse(readFileSync(new URL('../../contracts/vc-gatling-source-v4.json',import.meta.url)));
const normal='DamageEffect_SA_RWT_HellFire_Explosion',heat=normal+'_OverHit';
const vector=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<.025,`${a} != ${b}`));

test('Gatling keeps original particle curves, source scale and hidden attack box',()=>{
  for(const [name,t]of Object.entries(source.templates)){
    assert.deepEqual(vcEffectIndex.templates[name].fields,t.fields,name);
    assert.deepEqual(vcEffectIndex.templates[name].events,t.events,name);
  }
  assert.equal(source.templates.RWT_HellFire_Attack_Box.fields.DrawCount,0);
  assert.deepEqual(source.templates.RWT_HellFire_Attack_Box.events.find(e=>e.property==='Color').value,[0,0,0,0]);
  const p=source.damageEffects[normal].raw.START_PARTICLE0;
  assert.deepEqual([p.SCALE_X,p.SCALE_Y,p.SCALE_Z,p.ROTATE_Y],[.4,.5,.5,10]);
  assert.equal(source.templates.RWT_HellFireEP02.fields.Lifetime,.6);
  assert.equal(source.templates.RWT_HellFireEP01.fields.Lifetime,.9);
});

test('actual Gatling casts draw hand and explosion emitters at distinct source origins in both directions',async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('gatling-v4',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/vc',file)));
  let fixture=vcFixture();
  const profile={...vcProfile,skillCatalog:vcProfile.skillCatalog.filter(s=>s.skillId===24020)};
  const view=await createEffectsView({scene,engine,index:vcEffectIndex,profile,effectPoses:vcEffectPoses,
    effectQuality:{level:'medium',particleDivisor:8},loadout:[{skillId:24020}],
    samplers:{effectAnchorSampler:(...a)=>fixture.sim.effectAnchorSampler(...a),effectBoneSampler:(...a)=>fixture.sim.effectBoneSampler(...a)}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  for(const overheated of [false,true])for(const facing of [-1,1]){
    view.clear();fixture=vcFixture({skillId:24020,position:[-600*facing,3080,0],gap:20000,facing});
    const {sim,a}=fixture,roots=new Map(),drawn=new Set();let anchors=0,distinct=0;
    for(let frame=0;frame<720;frame++){
      sim.step(1/60,frame===0||overheated&&frame<240&&frame%2===0?{pressed:['A']}:{},{snapshot:false});
      for(const e of sim.drainEvents()){
        if(e.type==='effectStarted'&&[normal,heat].includes(e.name))roots.set(e.effectId,e);
        view.event(e,sim.state);
        if(e.type==='effectStartParticles'&&roots.has(e.effectId)){
          const sequence=view.proof({includeDraws:true}).nativeParticleDraws.sequences;
          const hand=sim.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},a).position;
          const main=roots.get(e.effectId).birthAnchor.position;
          for(const name of ['RWT_HellFireEP02','RWT_HellFireP06'])vector(sequence.findLast(s=>s.name===name).position,hand);
          for(const name of ['RWT_HellFireEP03','RWT_HellFireEP04'])vector(sequence.findLast(s=>s.name===name).position,main);
          if(Math.hypot(...hand.map((n,i)=>n-main[i]))>100)distinct++;
          assert.notDeepEqual(main,[0,0,0]);anchors++;
        }
      }
      view.step(1/60,sim.state);view.render();
      const proof=view.proof({includeDraws:true}).nativeParticleDraws;
      for(const sample of proof.samples){drawn.add(sample.name);assert.ok(sample.meshes.every(m=>m.world.every(Number.isFinite)));}
    }
    assert.equal(anchors,overheated?27:17);assert.equal(distinct,anchors);
    assert.ok(drawn.has('RWT_HellFireEP02'),'original hand mesh actually rendered; '+JSON.stringify({drawn:[...drawn],notes:view.proof().unsupported}));
    // The overheat arm is buff-owned and correctly survives the skill. Let
    // its original buff timer expire before checking complete natural cleanup.
    for(let frame=720;frame<2400;frame++){
      sim.step(1/60,{},{snapshot:false});for(const e of sim.drainEvents())view.event(e,sim.state);
      view.step(1/60,sim.state);
    }
    assert.equal(view.proof().activeEffectParents,0,'finite complete effect lifecycle');
    assert.ok(!view.proof().unsupported.some(id=>/RWT_HellFire.*:(bone|birth|texture|geometry)/.test(id)));
  }
});
