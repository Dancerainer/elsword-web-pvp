import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,MeshBuilder,Matrix,Vector3} from '@babylonjs/core';
import {RenderingGroup} from '@babylonjs/core/Rendering/renderingGroup.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import {nativeTransparentLayer,setNativeTransparentLayer,setNativeMapTransparentLayers,
  NATIVE_UNIT_LAYER,installNativeParticleMatrixBuffer,uploadNativeParticleMatrices} from '../../apps/web/native-effect-draw-order-v3.mjs';
import {particlesInNativeDrawOrder} from '../../apps/web/particle-draw-order.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {fileURLToPath} from 'node:url';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const fields=JSON.parse(read('contracts/rf-fx-index.json')).templates;
const close=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-5,`${actual} vs ${expected}`));

test('finite layers preserve source actor/world/effect order, unlike adding to Babylon default',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),mesh=MeshBuilder.CreatePlane('default',{},scene);
  try{
    assert.equal(mesh.alphaIndex,Number.MAX_VALUE);
    assert.equal(mesh.alphaIndex+13,mesh.alphaIndex,'a DEFAULT+Layer offset silently disappears');
    const define=read('.cache/native-source-runtime/X2Lib/X2Define.h');
    const body=define.slice(define.indexOf('XL_GAME_BASE'),define.indexOf('enum X2_DIALOG_LAYER'));
    const names=body.split(/\r?\n/).map(line=>line.match(/^\s*(XL_[A-Z_0-9]+)\s*(?:=\s*1)?\s*,/)?.[1]).filter(Boolean);
    assert.equal(names.length,24);
    names.forEach((name,i)=>assert.equal(nativeTransparentLayer('X2_LAYER.'+name),i+1,name));
    assert.match(read('.cache/matrix-source-v18/KTDGObject.cpp'),/m_Layer\s*=\s*0\s*;/);
    assert.match(read('.cache/native-source-runtime/X2Lib/X2GameUnit.cpp'),/SetLayer\(\s*XL_UNIT_0\s*\)/);
    assert.match(read('.cache/matrix-source-v18/KTDGManager.cpp'),/GetLayer\(\)\s*<\s*_Right.m_pObject->GetLayer\(\)/);
    assert.equal(NATIVE_UNIT_LAYER,11);
    assert.equal(setNativeTransparentLayer([mesh],NATIVE_UNIT_LAYER),11);
    assert.equal(mesh.alphaIndex,11);
    assert.equal(nativeTransparentLayer(null),0);
    assert.throws(()=>nativeTransparentLayer('X2_LAYER.XL_GUESSED'),/Unconfirmed/);
  }finally{scene.dispose();engine.dispose();}
});

test('actual converted map descendants inherit manifest native layers, including authored background layers',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const map=JSON.parse(read('artifacts/scene/sander-garpai-rock-pvp/manifest.json'));
  const container=await loadPoseContainer(scene,fileURLToPath(new URL('../../artifacts/scene/sander-garpai-rock-pvp/scene.glb',import.meta.url)));
  try{
    const meshes=container.meshes.filter(mesh=>mesh.getTotalVertices()>0);
    assert.equal(setNativeMapTransparentLayers(meshes,map),meshes.length);
    assert.ok(meshes.length>0);
    const layers=new Set(meshes.map(mesh=>mesh.alphaIndex));
    assert.deepEqual([...layers].sort((a,b)=>a-b),[5,6]);
    assert.ok(meshes.every(mesh=>mesh.alphaIndex<NATIVE_UNIT_LAYER),'source map transparent layers draw before source unit layer');
  }finally{container.dispose();scene.dispose();engine.dispose();}
});

test('zero capacity reproduces NaN transparent sorting; active-only refresh repairs movement and shrinking',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),mesh=MeshBuilder.CreatePlane('quad',{size:1},scene);
  try{
    const data=new Float32Array(8*16);
    mesh.thinInstanceSetBuffer('matrix',data,16,false);
    assert.ok(mesh.getBoundingInfo().boundingSphere.centerWorld.asArray().some(n=>!Number.isFinite(n)),
      'the production zero capacity initialization poisons bounds');
    installNativeParticleMatrixBuffer(mesh,data);
    Matrix.Translation(10,20,30).copyToArray(data,0);
    Matrix.Translation(30,40,50).copyToArray(data,16);
    uploadNativeParticleMatrices(mesh,2);mesh.computeWorldMatrix(true);
    close(mesh.getBoundingInfo().boundingSphere.centerWorld.asArray(),[20,30,40]);
    close(mesh.subMeshes[0].getBoundingInfo().boundingSphere.centerWorld.asArray(),[20,30,40]);
    Matrix.Translation(-40,5,6).copyToArray(data,0);
    uploadNativeParticleMatrices(mesh,1);mesh.computeWorldMatrix(true);
    close(mesh.subMeshes[0].getBoundingInfo().boundingSphere.centerWorld.asArray(),[-40,5,6]);
    assert.equal(mesh.thinInstanceCount,1,'unused previous matrices and zero slots are excluded');
    const grown=new Float32Array(16*16);grown.set(data);
    installNativeParticleMatrixBuffer(mesh,grown);
    assert.equal(mesh.doNotSyncBoundingInfo,false,'installation preserves normal mesh bound syncing');
    uploadNativeParticleMatrices(mesh,1);mesh.computeWorldMatrix(true);
    close(mesh.getBoundingInfo().boundingSphere.centerWorld.asArray(),[-40,5,6]);
    uploadNativeParticleMatrices(mesh,0);assert.equal(mesh.thinInstanceCount,0);
  }finally{scene.dispose();engine.dispose();}
});

test('Babylon queue and same-template native sequence order are layer first then far to near',()=>{
  const queue=[{_alphaIndex:16,_distanceToCamera:100,name:'bright'},
    {_alphaIndex:12,_distanceToCamera:1,name:'dark'},
    {_alphaIndex:13,_distanceToCamera:2,name:'near-smoke'},
    {_alphaIndex:13,_distanceToCamera:20,name:'far-smoke'}];
  queue.sort(RenderingGroup.defaultTransparentSortCompare);
  assert.deepEqual(queue.map(item=>item.name),['dark','far-smoke','near-smoke','bright']);
  const runtime={particles:new Map(),emitters:new Map([[1,{position:[100,0,0]}],[2,{position:[1000,0,0]}]])};
  for(const [id,layer,emitterId] of [[4,16,2],[2,13,1],[3,13,2],[1,12,1]])
    runtime.particles.set(id,{id,emitterId,template:{fields:{Layer:layer,DrawCount:1}},options:{},position:[0,0,0]});
  assert.deepEqual(particlesInNativeDrawOrder(runtime,[0,0,0]).map(p=>p.id),[1,3,2,4]);
});

test('XXX native dark layer and smoke cannot commute with additive explosion layers',()=>{
  assert.equal(fields.Raven_ReadyS_P01_D.fields.Layer,12);
  assert.equal(fields.Raven_ReadyS_P01_D.fields.SourceBlendMode,'D3DBLEND_SRCALPHA');
  assert.equal(fields.Raven_ReadyS_P01_D.fields.DestBlendMode,'D3DBLEND_INVSRCALPHA');
  assert.equal(fields.EnchantHand_P03.fields.Layer,13);
  assert.equal(fields.EnchantHand_P03.fields.DestBlendMode,'D3DBLEND_INVSRCALPHA');
  assert.equal(fields.EMK_BigBurst_P03.fields.Layer,14);
  assert.equal(fields.EMK_BigBurst_P03.fields.SourceBlendMode,'D3DBLEND_SRCALPHA');
  assert.equal(fields.EMK_BigBurst_P03.fields.DestBlendMode,'D3DBLEND_DESTALPHA');
  // Independent blend arithmetic on an opaque framebuffer: additive layers
  // commute before quantization, but the authored dark layer must come first.
  const dark=(background,color,alpha)=>background.map((n,i)=>color[i]*alpha+n*(1-alpha));
  const add=(background,color,alpha)=>background.map((n,i)=>Math.min(1,n+color[i]*alpha));
  const background=[.2,.3,.4],mask=[.03,.03,.03],burst=[.8,.6,.2];
  const native=add(dark(background,mask,.7),burst,.5),wrong=dark(add(background,burst,.5),mask,.7);
  assert.ok(native.some((n,i)=>Math.abs(n-wrong[i])>.1),'creation order is visibly different from source Layer order');
  close(add(add(background,[.2,.1,.2],.4),[.1,.2,.1],.3),add(add(background,[.1,.2,.1],.3),[.2,.1,.2],.4));
});
