import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {BM_SCREEN_DARKEN,createProjectedHitController,createProjectedHitView,originalScreenBlend} from '../../apps/web/projected-hit-effects.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const profile=read('packages/combat-core/bm-profile.json'),source=read('contracts/bm-fx-index.json').templates[BM_SCREEN_DARKEN];
const index={templates:{[BM_SCREEN_DARKEN]:source}};

test('HA original black background keeps its RHW coordinates and three births at medium',()=>{
  assert.equal(source.declarationSha256,'7c153f5652ec78cd5a12322fcc6509b58df71a903a9d32d560c3c5f16125c602');
  assert.equal(profile.effectSets.EffectSet_SA_RBM_Extrem_Blade_Finish.raw.EFFECT20.NAME,BM_SCREEN_DARKEN);
  assert.equal(source.fields.TriggerTime,.33);assert.equal(source.fields.Emitrate,10);
  const c=createProjectedHitController({index,profile,project:()=>{throw Error('RHW must never project an actor position');}});
  const e={name:BM_SCREEN_DARKEN,effectId:52,birthAnchor:{position:[999,-999,99]}};
  assert.equal(c.startEffect(e,DEFAULT_EFFECT_QUALITY),true);c.startEffect(e,DEFAULT_EFFECT_QUALITY);
  assert.equal(c.runtime.emitters.size,1);
  c.step(.101);assert.equal(c.runtime.count,1);
  const p=[...c.runtime.particles.values()][0];assert.deepEqual(p.position,[640,480,1]);assert.equal(p.lifetime,1.03);
  c.step(.2);assert.equal(c.runtime.count,3,'density must not postpone the complete screen layer beyond TriggerTime');
  for(let i=0;i<90;i++)c.step(1/60);
  assert.equal(c.runtime.count,0);assert.equal(c.runtime.emitters.size,0);
  assert.equal(createProjectedHitController({index,profile:{...profile,target:{unitClass:100}},project:()=>null}).startEffect(e,DEFAULT_EFFECT_QUALITY),false);
});

test('HA black RHW renders beneath its original higher-layer slashes and restores blend state',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('camera',new Vector3(0,0,10),scene);
  const view=createProjectedHitView({index,profile,scene,engine,assetBase:'/assets/bm/'});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});await view.prewarm();
  view.startEffect({name:BM_SCREEN_DARKEN,effectId:52},DEFAULT_EFFECT_QUALITY);view.step(.101);view.render();
  const mesh=scene.getMeshByName('projected-hit:'+BM_SCREEN_DARKEN);
  assert.equal(mesh.renderingGroupId,0);assert.equal(mesh.alphaIndex,13);assert.equal(mesh.getTotalVertices(),6);
  assert.ok(mesh.isEnabled());assert.ok(mesh.getVerticesData('position').every(Number.isFinite));
  const before=[...engine.alphaState._blendFunctionParameters],depth=engine.getDepthBuffer();
  mesh.material.onBindObservable.notifyObservers(mesh);
  assert.deepEqual(engine.alphaState._blendFunctionParameters.slice(0,4),[774,0,774,0]);assert.equal(engine.getDepthBuffer(),false);
  assert.deepEqual(engine.alphaState._blendFunctionParameters.slice(4),before.slice(4),'unrelated render targets retain their factors');
  mesh.material.onUnBindObservable.notifyObservers(mesh.material);
  assert.deepEqual(engine.alphaState._blendFunctionParameters,before);assert.equal(engine.getDepthBuffer(),depth);
  for(let i=0;i<100;i++)view.step(1/60);view.render();assert.equal(mesh.isEnabled(),false);
  assert.equal(originalScreenBlend(BM_SCREEN_DARKEN,source.fields).destBlend,0);
  assert.throws(()=>originalScreenBlend('unqualified',{...source.fields}),/Unbound/);
  assert.throws(()=>originalScreenBlend(BM_SCREEN_DARKEN,{...source.fields,SourceBlendMode:'D3DBLEND_ONE'}),/Unbound/);
});
