import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createEffectsView} from '../helpers/effects-view-ready.mjs';
import {bmSampledFixture} from '../helpers/bm-sampled-commands-v2.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectPresentationPolicy,DEFAULT_EFFECT_QUALITY,FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
import {bmProfile} from '../helpers/bm-fixture.mjs';
const index=JSON.parse(readFileSync(new URL('../../artifacts/bm/fx/index.json',import.meta.url)));

test('BM dynamic air command sets use the same full presentation policy as original basic commands',()=>{
  const policy=createEffectPresentationPolicy(bmProfile,DEFAULT_EFFECT_QUALITY);
  for(const setName of ['EffectSet_RST_DashJump_X','EffectSet_RST_DashJump_XZ']){
    assert.ok(policy.comboSets.has(setName));assert.equal(policy.effect({setName,skillId:null}),FULL_EFFECT_QUALITY);
    assert.equal(policy.effect({setName,skillId:24016}),DEFAULT_EFFECT_QUALITY);
  }
});

test('BM first X original parent and its nested blue burst are emitted during the short attack lifetime',()=>{
  const policy=createEffectPresentationPolicy(bmProfile,DEFAULT_EFFECT_QUALITY),born=[];
  const runtime=createEffectRuntime({index,effectQuality:policy.effect({setName:'EffectSet_RST_DashJump_X',skillId:null}),onBirth:p=>born.push(p.name)});
  runtime.add('RST_DashJumpX_AP01');for(let i=0;i<12;i++)runtime.step(1/60,{});
  for(const name of ['RST_DashJumpX_AP01','RST_DashJumpX_AP01_1','RST_DashJumpX_AP01_2','RST_DashJumpX_AP01_3'])assert.ok(born.includes(name),name);
});

test('BM second X emits all four original slash layers before its .3-second owner expires',()=>{
  const policy=createEffectPresentationPolicy(bmProfile,DEFAULT_EFFECT_QUALITY),born=[];
  const runtime=createEffectRuntime({index,effectQuality:policy.effect({setName:'EffectSet_RST_DashJump_XZ',skillId:null}),onBirth:p=>born.push(p.name)});
  for(const name of ['RST_ShockWave_Pro01','RST_ShockWave_Pro02','RST_ShockWave_Pro01D','RST_ShockWave_Pro03'])runtime.add(name);
  for(let i=0;i<18;i++)runtime.step(1/60,{});
  for(const name of ['RST_ShockWave_Pro01','RST_ShockWave_Pro02','RST_ShockWave_Pro01D','RST_ShockWave_Pro03'])assert.ok(born.includes(name),name);
});

for(const facing of [1,-1])test(`BM sampled XX dispatches real blue-burst and slash draw geometry, facing ${facing}`,async t=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;new FreeCamera('bm-air',new Vector3(0,33,19),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>loadPoseContainer(target,resolve('artifacts/bm',file)));
  const f=bmSampledFixture({facing,passives:[],gap:4000});
  const profile={...bmProfile,states:{},skillCatalog:[],buffTemplates:{},sourceLiteralResources:[],
    resourceOnlyEffectSets:['EffectSet_RST_DashJump_X','EffectSet_RST_DashJump_XZ'],
    effectSets:Object.fromEntries(['EffectSet_RST_DashJump_X','EffectSet_RST_DashJump_XZ'].map(n=>[n,bmProfile.effectSets[n]])),
    damageEffects:Object.fromEntries(['DamageEffect_RBM_DashJump_X','DamageEffect_RST_DashJump_XZ'].map(n=>[n,bmProfile.damageEffects[n]]))};
  const poses=Object.fromEntries([...new Set(Object.values(index.templates).map(t=>t.poseData).filter(Boolean))]
    .map(path=>[path,JSON.parse(readFileSync(resolve('artifacts/bm',path)))]));
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,effectQuality:DEFAULT_EFFECT_QUALITY,loadout:[],
    samplers:{effectAnchorSampler:f.sim.effectAnchorSampler,effectBoneSampler:f.sim.effectBoneSampler}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  const draws=new Set(),quads=new Set(),births=new Set(),step=f.sim.step.bind(f.sim);
  f.sim.step=(...args)=>{
    const result=step(...args);
    for(const event of f.sim.drainEvents()){if(event.type==='effectStarted')births.add(event.name);view.event(event,f.sim.state);}
    view.step(1/60,f.sim.state);view.render();
    const shown=view.proof({includeDraws:true}).nativeParticleDraws;
    for(const batch of shown.batches)quads.add(batch.name);
    for(const sample of shown.samples){assert.ok(sample.meshes.every(mesh=>mesh.world.every(Number.isFinite)));draws.add(sample.name);}
    return result;
  };
  const key=facing>0?'RIGHT':'LEFT';f.press(key);f.down(key);f.step();f.press('UP');f.up(key);f.step(5);f.press('X');
  f.at(.21);f.press('X');f.wait('RBM_DASH_JUMP_COMBO_XZ');f.wait('RSI_WAIT');f.step(180);
  for(const name of ['DamageEffect_RBM_DashJump_X','DamageEffect_RST_DashJump_XZ'])assert.ok(births.has(name),name);
  for(const name of ['RST_DashJumpX_AP01_3','RST_ShockWave_Pro01','RST_ShockWave_Pro01D','RST_ShockWave_Pro02'])assert.ok(draws.has(name),name+' source mesh actually draws');
  for(const name of ['RST_DashJumpX_AP01','RST_DashJumpX_AP01_1','RST_DashJumpX_AP01_2','RST_ShockWave_Pro03'])
    assert.ok([...quads].some(q=>q.startsWith('native-particle:'+name+'|')),name+' source plane actually draws');
  assert.equal(view.proof().activeEffectParents,0);assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeParticles,0);
  assert.deepEqual(view.proof().unsupported,[]);
});
