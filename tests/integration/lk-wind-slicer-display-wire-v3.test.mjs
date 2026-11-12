/** Actual converted models/poses and host consumers; no GPU/native parity claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {lkCommandFixture} from '../helpers/lk-command-fixture.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {createLocalOwnershipSync} from '../../apps/web/input-prediction.mjs';
import {createRemoteActionConsumer} from '../../apps/web/owned-actions.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {WIND_SLICER_SET as SET,WIND_SLICER_CARRIER as CARRIER} from '../../packages/combat-core/lk-wind-slicer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),base=process.env.LK_TEST_ASSETS_ROOT??resolve(root,'artifacts');
const read=p=>JSON.parse(readFileSync(resolve(base,'lk',p)));
const fullIndex=read('fx/index.json'),DAMAGE='DamageEffect_ELK_Wind_Slicer_Projectile';
const layers=['ELK_WIND_SLICER_M01','ELK_WIND_SLICER_M02','ELK_WIND_SLICER_M03'];
async function fixture(){
  const f=await lkCommandFixture({gap:5000});f.sim.rng=()=>.99;f.sim.drainEvents();return f;
}
function spawn(sim){sim.spawnSet(sim.actor('lk'),SET);sim.step(.01,{}, {snapshot:false});return sim.drainEvents();}

test('all three real Wind Slicer layers are born, follow the flying mesh, retain particle drift, and expire',async t=>{
  const {sim,profile,actor}=await fixture(),engine=new NullEngine(),scene=new Scene(engine);
  engine.getCaps().maxVertexUniformVectors=1024;scene.useRightHandedSystem=true;
  new FreeCamera('wind-camera',new Vector3(0,30,10),scene);
  const names=[CARRIER,...layers,profile.damageEffects[DAMAGE].raw.MAIN_EFFECT_NAME];
  const index={...fullIndex,templates:Object.fromEntries(names.map(name=>[name,fullIndex.templates[name]]))};
  const presentation={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[SET],resourceOnlyTemplates:[],
    effectSets:{[SET]:profile.effectSets[SET]},damageEffects:{[DAMAGE]:profile.damageEffects[DAMAGE]}};
  const poses=Object.fromEntries([...new Set(names.map(n=>index.templates[n].poseData))].map(p=>[p,read(p)]));
  const view=await createEffectsView({scene,engine,index,profile:presentation,effectPoses:poses,
    samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler},
    effectQuality:'high',loadContainer:(_base,file)=>loadPoseContainer(scene,resolve(base,'lk',file))});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const births=spawn(sim).filter(e=>e.type==='effectStarted'&&e.setName===SET);
  assert.equal(births.length,5);assert.ok(births.every(e=>e.birthAnchor?.position?.every(Number.isFinite)));
  for(const event of births)view.event(event,sim.state);
  const initial=sim.state.effects.find(e=>e.name===CARRIER).birthAnchor.position;
  actor.x+=1800;actor.facing=-1;
  for(let n=0;n<12;n++){
    sim.step(.01,{}, {snapshot:false});for(const e of sim.drainEvents())view.event(e,sim.state);view.step(.01,sim.state);
  }
  view.render();const proof=view.proof({includeDraws:true}),target=proof.effectSetTargets[0];
  assert.ok(target.position[0]>initial[0]+299&&target.position[0]<initial[0]+301);
  assert.equal(target.lifeTime,.55);assert.ok(target.elapsed>.12&&target.elapsed<.121);
  for(const name of layers){
    assert.ok(proof.nativeParticleDraws.counts[name]>0,name+' must have visible mesh particles');
    const draw=proof.nativeParticleDraws.samples.find(s=>s.name===name);assert.ok(draw,name+' must have real model draws');
    assert.ok(draw.position[0]>initial[0]+180&&draw.position[0]<=target.position[0],name+' follows flying target, with native negative Velocity/Emitradius');
    assert.ok(Math.abs(draw.position[0]-actor.x)>1000,name+' must not follow owner');
    assert.ok(draw.meshes.every(m=>m.world.every(Number.isFinite)));
  }
  assert.ok(proof.nativeParticleDraws.samples.some(s=>layers.includes(s.name)&&s.position[0]<target.position[0]-1),
    'render must preserve particle local drift rather than overwrite every position with the target center');
  for(let n=0;n<120;n++){
    sim.step(.01,{}, {snapshot:false});for(const e of sim.drainEvents())view.event(e,sim.state);view.step(.01,sim.state);
  }
  assert.equal(view.count,0);assert.equal(view.proof().activeEffectParents,0);assert.deepEqual(view.proof().effectSetTargets,[]);
});

test('Wind Slicer active carrier rejects malformed network anchors, clocks and identities before apply',async()=>{
  const {sim,profile,map}=await fixture();spawn(sim);const good=encodeOwnedState(sim,'lk',{epoch:1,frameSeq:1});
  const changes=[e=>{e.currentAnchor=null;},e=>{e.birthAnchor=null;},e=>{e.meshLifetimeElapsed='late';},
    e=>{e.meshLifetimeElapsed=-1;},e=>{e.lifeTimeSeconds=99;},e=>{e.currentAnchor.rotation=[0,90,0];},
    e=>{e.sourceEffectSetId=1.5;},e=>{delete e.sourceEffectSetId;},e=>{e.sourceSetTargetMesh=true;}];
  for(const change of changes){const packet=structuredClone(good);change(packet.effects.find(e=>e.name===CARRIER));
    assert.throws(()=>validateOwnedState(packet),/invalid-owner-effect/);}
  const bad=structuredClone(good);bad.effects.find(e=>e.name===layers[0]).sourceTargetMeshId=123;
  assert.throws(()=>validateOwnedState(bad),/invalid-owner-effect-set-target/);
  assert.doesNotThrow(()=>validateOwnedReferences(good,sim.actor('lk'),profile,map));
  const receiver=await fixture();receiver.sim.state.nextEffectId=400;applyOwnedState(receiver.sim,'lk',good);
  receiver.sim.step(.01,{}, {snapshot:false});
  assert.ok(receiver.sim.state.effects.find(e=>e.name===CARRIER).currentAnchor.position.every(Number.isFinite));
});

test('real ownership sampling preserves Wind Slicer posed world anchors in damage-only history',async t=>{
  const source=await fixture(),receiver=await fixture(),sync=createLocalOwnershipSync({reportEvery:1});
  t.after(()=>sync.clear());source.sim.spawnSet(source.actor,SET);let chosen;
  for(let n=0;n<18;n++){
    sync.beforeStep(source.sim,'lk');source.sim.step(.01,{}, {snapshot:false});
    const report=sync.afterStep(source.sim,'lk',source.sim.drainEvents());
    for(const action of report.actions??[])if(action.effects.length===1&&action.effects[0].name===DAMAGE&&action.effects[0].elapsed>.1)chosen=action;
  }
  assert.ok(chosen,'actual transport must emit a damage-only historical sample');
  const packet=encodeOwnedState(source.sim,'lk',{epoch:0,frameSeq:18});
  validateOwnedReferences({...packet,effects:chosen.effects,actor:{...packet.actor,...chosen.actor}},source.actor,source.profile,source.map);
  const expected=chosen.effects[0].sourcePosedAnchor.position;assert.ok(expected[0]>chosen.actor.x+200);
  receiver.sim.networkOwnerId='target';receiver.actor.x+=9000;
  const sampled=[],original=receiver.sim.effectSampler;
  receiver.sim.effectSampler=(effect,...args)=>{if(effect.name===DAMAGE)sampled.push([...effect.sourcePosedAnchor.position]);return original(effect,...args);};
  const consumer=createRemoteActionConsumer({clock:()=>0});t.after(()=>consumer.clear());
  consumer.receive('lk',[chosen],0,18);assert.equal(consumer.consume(receiver.sim,'target',()=>0),1);
  assert.ok(sampled.length>0);for(const p of sampled)assert.deepEqual(p,expected);
  assert.ok(receiver.actor.x>8000,'temporary history must restore the latest remote actor');
  assert.equal(receiver.sim.state.effects.length,0,'temporary historical carrier links leave no active world effect');
});
