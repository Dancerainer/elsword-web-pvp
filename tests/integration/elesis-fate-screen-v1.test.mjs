import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {CA_FATE_SCREEN_LAYERS,createProjectedHitController,createProjectedHitView,originalScreenBlend,projectedHitVertices} from '../../apps/web/projected-hit-effects.mjs';
import {DEFAULT_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/elesis-fate-presentation-source-v1.json',import.meta.url)));
const index={templates:source.templates},profile={target:{unitClass:125},states:{}};

test('Fate authored screen smoke starts once at full declared density and expires after five seconds',()=>{
 const c=createProjectedHitController({index,profile,project:()=>{throw Error('RHW uses original screen coordinates');}});
 for(const [i,name]of CA_FATE_SCREEN_LAYERS.entries()){
  const t=index.templates[name];assert.equal(t.fields.particleType,'PT_2D_PLANE');assert.equal(t.fields.Lifetime,5);
  assert.equal(t.fields.TriggerCount,1);assert.equal(t.fields.ResolutionConvert,true);
  assert.equal(source.effectSet['EFFECT'+(i+3)].NAME,name);
  const e={name,effectId:53+i,birthAnchor:{position:[9999,-9999,99]}};
  assert.equal(c.startEffect(e,DEFAULT_EFFECT_QUALITY),true);assert.equal(c.startEffect(e,DEFAULT_EFFECT_QUALITY),true);
 }
 c.step(.02);assert.equal(c.runtime.count,2);assert.equal(c.runtime.emitters.size,2);
 for(const p of c.runtime.particles.values())assert.deepEqual(p.position,[512,256,1]);
 for(let i=0;i<301;i++)c.step(1/60);
 assert.equal(c.runtime.count,0);assert.equal(c.runtime.emitters.size,0);
 assert.equal(createProjectedHitController({index,profile:{target:{unitClass:120}},project:()=>null}).startEffect({name:CA_FATE_SCREEN_LAYERS[0]},DEFAULT_EFFECT_QUALITY),false);
});

test('Fate ResolutionConvert scales center and size while legacy absolute screen positions stay absolute',()=>{
 const p={position:[512,256,1],values:{Size:[2048,2048,1],Rotate:[0,0,0]}};
 assert.deepEqual(projectedHitVertices(p,2048,1536,{ResolutionConvert:true}).slice(0,3),[-1024.5,2559.5,0]);
 assert.deepEqual(projectedHitVertices(p,2048,1536).slice(0,3),[-1536.5,2303.5,0]);
});

test('Fate layer10/11 smoke uses original blend factors in the world transparent queue and retires its meshes',async t=>{
 const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('camera',new Vector3(0,0,10),scene);
 const view=createProjectedHitView({index,profile,scene,engine,assetBase:'/assets/ca/'});
 t.after(()=>{view.clear();scene.dispose();engine.dispose();});await view.prewarm();
 for(const [i,name]of CA_FATE_SCREEN_LAYERS.entries())view.startEffect({name,effectId:53+i},DEFAULT_EFFECT_QUALITY);
 view.step(.02);view.render();
 for(const [i,name]of CA_FATE_SCREEN_LAYERS.entries()){
  const mesh=scene.getMeshByName('projected-hit:'+name);assert.equal(mesh.renderingGroupId,0);assert.equal(mesh.alphaIndex,10+i);
  assert.equal(mesh.getTotalVertices(),6);assert.ok(mesh.isEnabled());assert.ok(mesh.getVerticesData('position').every(Number.isFinite));
  const prior=[...engine.alphaState._blendFunctionParameters],depth=engine.getDepthBuffer();
  mesh.material.onBindObservable.notifyObservers(mesh);
  assert.deepEqual(engine.alphaState._blendFunctionParameters.slice(0,4),[770,i===0?772:774,770,i===0?772:774]);
  assert.equal(engine.getDepthBuffer(),false);mesh.material.onUnBindObservable.notifyObservers(mesh.material);
  assert.deepEqual(engine.alphaState._blendFunctionParameters,prior);assert.equal(engine.getDepthBuffer(),depth);
 }
 for(let i=0;i<301;i++)view.step(1/60);view.render();
 for(const name of CA_FATE_SCREEN_LAYERS)assert.equal(scene.getMeshByName('projected-hit:'+name).isEnabled(),false);
 assert.throws(()=>originalScreenBlend('unqualified',source.templates.SCA_FATE_SMASHER_L02.fields),/Unbound/);
});
