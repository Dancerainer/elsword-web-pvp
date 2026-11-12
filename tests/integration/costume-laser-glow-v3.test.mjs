import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,MeshBuilder,PBRMaterial,RawTexture,Color4,FreeCamera,Vector3} from '@babylonjs/core';
import {registerNasodLaserGlow} from '../../apps/web/costume-laser-glow.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView} from '../../apps/web/actor-presentation.mjs';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';

const file=url=>new URL('../../artifacts/'+url.replace(/^\/assets\//,''),import.meta.url);
const json=url=>JSON.parse(readFileSync(file(url)));
function texture(scene){
  // NullEngine cannot decode an embedded PNG. Supply a labelled texel; these
  // tests verify extraction identity/geometry/lifetime, not GPU appearance.
  const result=RawTexture.CreateRGBATexture(new Uint8Array([255,80,190,230]),1,1,scene,false,false);
  result.getInternalTexture().isReady=true;return result;
}
function box(scene,name){
  const mesh=MeshBuilder.CreateBox(name,{},scene);mesh.material=new PBRMaterial(name,scene);
  mesh.material.albedoTexture=texture(scene);return mesh;
}
const before=scene=>scene.onBeforeRenderObservable.notifyObservers(scene);
test('Nasod laser emits its original texture only; map, hilt and other costumes do not acquire a halo',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const map=box(scene,'map'),hilt=box(scene,'hilt'),laser=box(scene,'laser'),solace=box(scene,'solace');
    registerNasodLaserGlow({meshes:[hilt]},131646,scene);
    assert.equal(scene.getGlowLayerByName('nasod-laser-glow'),null);
    registerNasodLaserGlow({meshes:[laser]},130892,scene);
    const layer=scene.getGlowLayerByName('nasod-laser-glow');before(scene);
    assert.equal(layer.isEnabled,true);assert.equal(layer.hasMesh(laser),true);
    for(const mesh of [map,hilt,solace]){
      assert.equal(layer.hasMesh(mesh),false);
      const color=new Color4(1,1,1,1);layer.customEmissiveColorSelector(mesh,null,mesh.material,color);
      assert.deepEqual(color.asArray(),[0,0,0,0]);
      assert.equal(layer.customEmissiveTextureSelector(mesh,null,mesh.material),null);
    }
    assert.equal(layer.customEmissiveTextureSelector(laser,null,laser.material),laser.material.albedoTexture);
    const color=new Color4();layer.customEmissiveColorSelector(laser,null,laser.material,color);
    assert.deepEqual(color.asArray(),[1,1,1,1]);
    const material=laser.material,indices=laser.getIndices();laser.dispose();
    assert.equal(scene.getGlowLayerByName('nasod-laser-glow'),null,'empty inclusion must not glow all scene meshes');
    assert.equal(map.isDisposed(),false);assert.ok(indices.length);assert.equal(material.unlit,false,'no base material mutation');
  }finally{scene.dispose();engine.dispose();}
});
test('all players share one layer; hidden/cached appearances sleep, fading remains bounded, disposal removes only their lasers',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const a=box(scene,'a'),b=box(scene,'b');
    registerNasodLaserGlow({meshes:[a]},130892,scene);registerNasodLaserGlow({meshes:[b]},130895,scene);
    registerNasodLaserGlow({meshes:[a]},130892,scene);
    assert.equal(scene.effectLayers.length,1);
    const layer=scene.getGlowLayerByName('nasod-laser-glow');
    a.setEnabled(false);b.isVisible=false;before(scene);assert.equal(layer.isEnabled,false);
    b.isVisible=true;b.visibility=.25;before(scene);assert.equal(layer.isEnabled,true);
    const color=new Color4();layer.customEmissiveColorSelector(b,null,b.material,color);
    assert.deepEqual(color.asArray(),[1,1,1,.25]);
    a.dispose();assert.equal(scene.effectLayers.length,1);assert.equal(layer.hasMesh(b),true);
    b.visibility=0;before(scene);assert.equal(layer.isEnabled,false);
    b.dispose();assert.equal(scene.effectLayers.length,0);
    registerNasodLaserGlow({meshes:[box(scene,'replacement')]},130895,scene);
    assert.equal(scene.effectLayers.length,1,'clean recreation after changing costume');
  }finally{scene.dispose();engine.dispose();}
});
test('scene rendering actually schedules the laser extraction and blur passes, then sleeps when hidden',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const camera=new FreeCamera('camera',new Vector3(0,0,-5),scene);camera.setTarget(Vector3.Zero());
    const laser=box(scene,'laser');registerNasodLaserGlow({meshes:[laser]},130895,scene);
    const layer=scene.getGlowLayerByName('nasod-laser-glow');let passes=0;
    layer.mainTexture.onAfterUnbindObservable.add(()=>passes++);
    for(let i=0;i<20&&passes===0;i++){scene.render();await new Promise(resolve=>setTimeout(resolve,5));}
    assert.ok(passes>0,'production render target and postprocess dispatch, not just layer registration');
    laser.setEnabled(false);const previous=passes;scene.render();scene.render();
    assert.equal(passes,previous,'no extraction or blur pass for hidden/cached players');
  }finally{scene.dispose();engine.dispose();}
});
for(const profession of ['LK','RF','VC','RS','BM','IS'])test(profession+' actual Nasod attachment is the emission source, follows equipment, and clears on costume replacement',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;engine.getCaps().maxVertexUniformVectors=1024;
  try{
    const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer:async(base,name)=>{
      const container=await loadPoseContainer(scene,file(base+name),{materials:true});
      for(const material of container.materials)material.albedoTexture=texture(scene);
      return container;
    }});
    const base='/assets/'+profession.toLowerCase()+'/',manifest=json(base+'manifest.json');
    const source=await loadPoseContainer(scene,file(base+manifest.runtimeGlb)),view=createActorView(source,scene,'actor');
    const assets=await cache.load(profession,'nasod'),appearance=prepareCostumeView(view,assets,profession,scene,styleCharacter);
    before(scene);assert.equal(scene.getGlowLayerByName('nasod-laser-glow').isEnabled,false,'prepared offscreen');
    publishCostume(view,appearance);before(scene);
    const layer=scene.getGlowLayerByName('nasod-laser-glow');assert.equal(layer.isEnabled,true);
    const lasers=appearance.attachments.flatMap(child=>child.view.meshes).filter(m=>m.getTotalVertices());
    assert.equal(appearance.attachments.length,['LK','RS','IS'].includes(profession)?2:1);
    for(const mesh of lasers){assert.equal(layer.hasMesh(mesh),true);assert.equal(mesh.material.unlit,true);assert.equal(mesh.renderOutline,false);}
    for(const mesh of appearance.body.meshes)assert.equal(layer.hasMesh(mesh),false,'clothing and hilt are not an emitter');
    view.root.setEnabled(false);before(scene);assert.equal(layer.isEnabled,false,'lobby/cached/hidden actor');
    view.root.setEnabled(true);appearance.update({awakening:{remaining:30}},.2);before(scene);assert.equal(layer.isEnabled,true,'normal and awakening use the same laser');
    publishCostume(view,prepareCostumeView(view,await cache.load(profession,'officer'),profession,scene,styleCharacter));
    assert.equal(scene.getGlowLayerByName('nasod-laser-glow'),null);
    view.dispose();
  }finally{scene.dispose();engine.dispose();}
});
