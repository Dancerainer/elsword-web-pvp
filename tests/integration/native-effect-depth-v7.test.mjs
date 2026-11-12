import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,Engine,FreeCamera,Vector3,MeshBuilder,PBRMaterial} from '@babylonjs/core';
import {GLTFFileLoader,GLTFLoaderAnimationStartMode} from '@babylonjs/loaders/glTF/index.js';
import {nativeEffectDepthProfile,nativeEffectMeshHasNoOutput} from '../../apps/web/native-effect-depth-v7.mjs';
import {installNativeEffectMaterial} from '../../apps/web/native-effect-material.mjs';
import {installNativeEffectRenderState} from '../../apps/web/effect-render-state.mjs';
import {compareNativeTransparentSubMeshes} from '../../apps/web/native-sequence-render-order.mjs';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {readGlb} from '../helpers/babylon-assets.mjs';
import {visualIndex,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

test('main mesh players, mesh particles and plane draw paths retain distinct source depth defaults',()=>{
  assert.deepEqual(nativeEffectDepthProfile({kind:'mesh',fields:{}}),{depthTest:false,depthWrite:false});
  for(const particleType of ['PT_MESH','PT_SKINMESH'])
    assert.deepEqual(nativeEffectDepthProfile({kind:'particle',fields:{particleType}}),{depthTest:true,depthWrite:true});
  assert.deepEqual(nativeEffectDepthProfile({kind:'particle',fields:{particleType:'PT_3D_PLANE',ZWriteEnable:true}}),{depthTest:true,depthWrite:false});
  for(const kind of ['mesh','particle'])for(const ZEnable of [false,true])for(const ZWriteEnable of [false,true])
    assert.deepEqual(nativeEffectDepthProfile({kind,fields:{particleType:'PT_MESH',ZEnable,ZWriteEnable}}),{depthTest:ZEnable,depthWrite:ZWriteEnable});
});

test('constant transparent helper omission rejects depth writers, nonstandard blends, random/future colours and alternate shaders',()=>{
  const original=visualIndex.templates.Raven_RRF_X_Crash3;
  assert.equal(nativeEffectMeshHasNoOutput(original),true);
  assert.equal(nativeEffectMeshHasNoOutput(visualIndex.templates.AttackBox_SA_RRF_XCrash_Fire),true);
  for(const field of [{ZWriteEnable:true},{DestBlendMode:'D3DBLEND_ZERO'},{SourceBlendMode:'D3DBLEND_ONE'},{RenderType:'RT_CARTOON_COLOR_EDGE'}])
    assert.equal(nativeEffectMeshHasNoOutput({...original,fields:{...original.fields,...field}}),false,JSON.stringify(field));
  for(const color of [{start:.1,end:.1,fade:false,value:[0,0,0,0]},
    {start:0,end:1,fade:true,value:[0,0,0,0]},
    {start:0,end:0,fade:false,value:[0,0,0,{random:[0,0]}]},
    {start:0,end:0,fade:false,value:[0,0,0,1]}])
    assert.equal(nativeEffectMeshHasNoOutput({...original,events:[{property:'Color',...color}]}),false,JSON.stringify(color));
  assert.equal(nativeEffectMeshHasNoOutput({...original,events:[...original.events,{property:'Color',start:1,end:1,fade:false,value:[1,1,1,1]}]}),false);
  assert.equal(nativeEffectMeshHasNoOutput({...original,unsupported:['unknown']}),false);
  assert.equal(nativeEffectMeshHasNoOutput({...original,kind:'particle'}),false);
  assert.equal(nativeEffectMeshHasNoOutput(visualIndex.templates.RF_HitP04),false,'legal visible explosion geometry remains');
});

test('actual source XCrash cube submitted zero colour with a rectangular depth footprint; corrected draw retains geometry with writes off',async()=>{
  const template=visualIndex.templates.Raven_RRF_X_Crash3,source=readGlb(resolve(fixtureRoot,'artifacts/rf',template.glb));
  assert.equal(source.json.accessors[0].count,36);
  assert.deepEqual(source.json.accessors[0].min,[-25,-25,-25]);
  assert.deepEqual(source.json.accessors[0].max,[25,25,25]);
  const engine=new NullEngine();engine.setAlphaMode=Engine.prototype.setAlphaMode;
  const scene=new Scene(engine);scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,-10),scene).setTarget(Vector3.Zero());
  scene.setRenderingOrder(0,null,null,compareNativeTransparentSubMeshes);
  try{
    const loader=new GLTFFileLoader();loader.animationStartMode=GLTFLoaderAnimationStartMode.NONE;
    const container=await loader.loadAssetContainerAsync(scene,{json:source.json,bin:{byteLength:source.binary.length,
      readAsync:async(offset,count)=>new Uint8Array(source.binary.buffer,source.binary.byteOffset+offset,count)}},'',undefined,template.glb);
    container.addAllToScene();const cube=container.meshes.find(m=>m.getTotalVertices()>0);
    cube.scaling.setAll(.07);cube.alphaIndex=14;
    const color=installNativeEffectMaterial(cube.material,template.fields);color.setColor([0,0,0,0]);
    cube.material.alphaMode=Engine.ALPHA_COMBINE;cube.material.backFaceCulling=false;
    installNativeEffectRenderState(cube.material,engine,{sourceBlend:770,destBlend:771,depthTest:true});
    const flame=MeshBuilder.CreatePlane('later-fire',{size:4},scene);flame.position.z=0;flame.alphaIndex=15;
    flame.material=new PBRMaterial('fire',scene);installNativeEffectMaterial(flame.material).setColor([1,.3,0,1]);
    flame.material.disableDepthWrite=true;flame.material.forceDepthWrite=false;
    let active;const draws=[];
    for(const mesh of [cube,flame]){mesh.onBeforeRenderObservable.add(()=>{active=mesh;});await mesh.material.forceCompilationAsync(mesh);}
    engine.drawElementsType=engine.drawArraysType=function(_fill,_start,vertices){draws.push({name:active.name,vertices,
      depthWrite:engine.getDepthWrite(),depthTest:engine.getDepthBuffer(),color:active.material.pluginManager.getPlugin('NativeEffectRealColor').color.slice()});};
    cube.material.forceDepthWrite=true;cube.material.disableDepthWrite=false;scene.render();
    assert.deepEqual(draws.map(d=>d.name),[cube.name,flame.name]);assert.equal(draws[0].depthWrite,true);
    assert.deepEqual(draws[0].color,[0,0,0,0]);assert.equal(draws[0].vertices,36);
    const box=cube.getBoundingInfo().boundingBox;
    for(const axis of ['x','y','z'])assert.ok(Math.abs(box.maximumWorld[axis]-box.minimumWorld[axis]-3.5)<1e-6);
    const originalPositions=Array.from(cube.getVerticesData('position'));
    const depth=nativeEffectDepthProfile(template);cube.material.forceDepthWrite=depth.depthWrite;cube.material.disableDepthWrite=!depth.depthWrite;
    draws.length=0;scene.render();assert.deepEqual(draws.map(d=>d.name),[cube.name,flame.name]);
    assert.equal(draws[0].depthWrite,false);assert.equal(draws[0].depthTest,true);
    assert.deepEqual(Array.from(cube.getVerticesData('position')),originalPositions);
  }finally{scene.dispose();engine.dispose();}
});

test('invisible source helper retains runtime identity, source clock and finite retirement',()=>{
  const template=visualIndex.templates.Raven_RRF_X_Crash3,index={templates:{[template.name]:template}};
  const runtime=createEffectRuntime({index});const emitter=runtime.add(template.name,{position:[10,20,30]});
  assert.equal(runtime.count,1);assert.equal(runtime.particles.values().next().value.name,template.name);
  runtime.step(.1,{});const particle=runtime.particles.values().next().value;
  assert.ok(particle.age>0);assert.deepEqual(particle.values.Color,[0,0,0,0]);
  for(let i=0;i<30;i++)runtime.step(1/60,{});
  assert.equal(runtime.count,0);assert.equal(runtime.emitters.size,0);
});
