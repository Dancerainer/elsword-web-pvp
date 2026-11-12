import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Constants,FreeCamera,NullEngine,PBRMaterial,Scene,Vector3} from '@babylonjs/core';
import {GLTFFileLoader,GLTFLoaderAnimationStartMode} from '@babylonjs/loaders/glTF/index.js';
import {readGlb} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {NASOD_CORE_PRESENTATION,styleNasodCore,updateNasodCorePresentation} from '../../apps/web/nasod-core-presentation.mjs';
import {nativeCharacterEdge} from '../../apps/web/native-character-edge.mjs';

const path=new URL('../../artifacts/rf/effects/Motion_Raven_RageMode_Nasod.glb',import.meta.url);
async function loadMaterials(scene){
  const {json:raw,binary}=readGlb(path),json=structuredClone(raw);
  // NullEngine omits only image IO; retain all actual source material modes,
  // mesh/material assignments, transforms and Guard/Wait animation tracks.
  for(const material of json.materials)delete material.pbrMetallicRoughness.baseColorTexture;
  delete json.textures;delete json.images;delete json.samplers;
  const loader=new GLTFFileLoader();loader.animationStartMode=GLTFLoaderAnimationStartMode.NONE;
  return loader.loadAssetContainerAsync(scene,{json,bin:{byteLength:binary.length,
    readAsync:async(offset,count)=>new Uint8Array(binary.buffer,binary.byteOffset+offset,count)}},'');
}

test('actual 33-material Nasod GLB keeps source blending and receives missing depth-write and layer',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);engine.getCaps().maxVertexUniformVectors=1024;
  t.after(()=>{scene.dispose();engine.dispose();});
  const raw=readGlb(path).json;assert.equal(raw.materials.length,33);
  assert.ok(raw.materials.every(m=>m.alphaMode==='BLEND'&&m.pbrMetallicRoughness.baseColorFactor[3]===1));
  const source=await loadMaterials(scene),a=createActorView(source,scene,'styled'),b=createActorView(source,scene,'untouched');
  const geometry=a.meshes.filter(m=>m.getTotalVertices());assert.equal(geometry.length,33);
  const materials=geometry.map(m=>m.material);assert.ok(materials.every(m=>m instanceof PBRMaterial&&!m.forceDepthWrite));
  const before=[scene.meshes.length,scene.materials.length,scene.textures.length];styleNasodCore(a);
  assert.deepEqual([scene.meshes.length,scene.materials.length,scene.textures.length],[before[0]+33,before[1]+33,before[2]],'one shared-geometry native edge pass per original surface');
  for(const mesh of geometry)assert.equal(nativeCharacterEdge(mesh).edge.geometry,mesh.geometry);
  const installed=[scene.meshes.length,scene.materials.length,scene.textures.length];styleNasodCore(a);
  assert.deepEqual([scene.meshes.length,scene.materials.length,scene.textures.length],installed,'repeated styling keeps the same edge passes');
  for(const mesh of geometry){assert.equal(mesh.alphaIndex,14);assert.equal(mesh.material.forceDepthWrite,true);
    assert.equal(mesh.material.transparencyMode,PBRMaterial.PBRMATERIAL_ALPHABLEND);assert.equal(mesh.material.alphaMode,Constants.ALPHA_COMBINE);
    assert.equal(mesh.material.alpha,1);assert.equal(mesh.material.disableDepthWrite,false);assert.equal(mesh.material.disableDepthTest,false);
    assert.equal(mesh.material.backFaceCulling,false,'native template defaults to D3DCULL_NONE');}
  assert.ok(b.meshes.filter(m=>m.getTotalVertices()).every(m=>!m.material.forceDepthWrite),'another actor/container is not mutated');
  a.dispose();b.dispose();
});

test('actual Wait/Guard edges retain original helper and near-zero bone normal scales',async t=>{
  const engine=new NullEngine(),scene=new Scene(engine);t.after(()=>{scene.dispose();engine.dispose();});
  const source=await loadMaterials(scene),pose=JSON.parse(readFileSync(new URL('../../artifacts/rf/effects/Motion_Raven_RageMode_Nasod.pose.json',import.meta.url)));
  const view=styleNasodCore(createActorView(source,scene,'core',.01,pose));
  const camera=new FreeCamera('source-camera',new Vector3(0,0,15),scene),before=[scene.meshes.length,scene.materials.length];
  for(const name of ['Wait','Guard'])for(const scale of [.01,.013,.022]){
    view.root.scaling.setAll(scale);assert.equal(sampleAnimation(view,name,.12,name==='Wait'),true);
    updateNasodCorePresentation(view,{camera,outlineColor:[.968,.443,0,1]});
    const geometry=view.meshes.filter(m=>m.getTotalVertices());
    for(const mesh of geometry){
      assert.equal(mesh.outlineWidth,1,'source camera1500 / original divisor1500 = local offset1, independent of helper/bone scale');
      const matrix=mesh.computeWorldMatrix(true),normal=Vector3.FromArray(mesh.getVerticesData('normal').slice(0,3));
      const position=Vector3.FromArray(mesh.getVerticesData('position').slice(0,3));
      // Source shader: unit * ((position + normal * nativeDistance/1500) * nativeWorld).
      // Compare the resulting delta with Babylon's local-normal expansion.
      const expected=Vector3.TransformNormal(normal,matrix);
      const expanded=Vector3.TransformCoordinates(position.add(normal.scale(mesh.outlineWidth)),matrix);
      const delta=expanded.subtract(Vector3.TransformCoordinates(position,matrix));
      assert.ok(Vector3.Distance(delta,expected)<1e-6,'same scaled-normal expansion as source shader');
      assert.deepEqual(mesh.outlineColor.asArray(),[.968,.443,0]);assert.equal(mesh.outlineAlpha,1);assert.equal(mesh.renderOutline,true);
    }
    const scales=geometry.map(mesh=>{const matrix=mesh.getWorldMatrix().m;return Math.max(Math.hypot(...matrix.slice(0,3)),Math.hypot(...matrix.slice(4,7)),Math.hypot(...matrix.slice(8,11)));});
    assert.ok(Math.min(...scales)<scale*.002,'real original pose includes .001 collapsed parts');
    assert.ok(Math.max(...scales)>scale*.8,'real original pose includes visible surface parts');
    assert.ok(Math.min(...scales)/Math.max(...scales)<.002,'collapsed normal/edge stays collapsed; no visibility threshold');
  }
  camera.position.z=30;camera.computeWorldMatrix(true);updateNasodCorePresentation(view,{camera});
  const mesh=view.meshes.find(m=>m.getTotalVertices());
  assert.equal(mesh.outlineWidth,2,'twice native distance doubles offset, preserving current helper/pose scale');
  assert.deepEqual(mesh.outlineColor.asArray(),NASOD_CORE_PRESENTATION.idleOutline.slice(0,3));
  assert.deepEqual([scene.meshes.length,scene.materials.length],before);view.dispose();
});
