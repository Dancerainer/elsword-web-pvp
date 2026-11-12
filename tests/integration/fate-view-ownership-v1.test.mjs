import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,PBRMaterial,Texture,RenderTargetTexture,MorphTargetManager,MorphTarget} from '@babylonjs/core';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
const counts=scene=>Object.fromEntries(['meshes','transformNodes','materials','multiMaterials','textures','morphTargetManagers','skeletons','animationGroups','geometries'].map(k=>[k,scene[k].length]));

test('actual 78-mesh Fate GLB clones own new resources in a populated scene and dispose independently',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    for(let i=0;i<400;i++){new PBRMaterial('background-'+i,scene);new Texture(null,scene);new MorphTargetManager(scene);}
    const index=JSON.parse(readFileSync(new URL('../../contracts/ca-fx-index.json',import.meta.url))),template=index.templates.SCA_FA_SMA_P02;
    const container=await loadPoseContainer(scene,new URL('../../artifacts/ca/'+template.glb,import.meta.url),{materials:true});
    const pose=JSON.parse(readFileSync(new URL('../../artifacts/ca/'+template.poseData,import.meta.url)));
    const source=container.meshes.find(m=>m.getTotalVertices()>0);assert.equal(container.materials.length,78);
    const texture=new Texture(null,scene),sharedTarget=new RenderTargetTexture('shared-fate-target',16,scene);
    source.material.albedoTexture=texture;source.material.reflectionTexture=sharedTarget;container.textures.push(texture,sharedTarget);
    const morph=new MorphTargetManager(scene);morph.addTarget(MorphTarget.FromMesh(source,'fate-morph'));source.morphTargetManager=morph;container.morphTargetManagers.push(morph);
    // First use registers shared GLB geometry in the scene; it remains owned
    // by the source container, as in the production practice view lifecycle.
    const warm=createActorView(container,scene,'fate-warm',.01,pose);warm.dispose();
    const baseline=counts(scene),views=Array.from({length:4},(_,i)=>createActorView(container,scene,'fate-'+i,.01,pose));
    const totals=counts(scene),perView=Object.fromEntries(Object.keys(baseline).map(k=>[k,(totals[k]-baseline[k])/views.length]));
    const survivingMaterial=views[1].meshes.find(m=>m.getTotalVertices()>0).material;
    for(const view of [views[0],views[2],views[3],views[1]]){
      const live=views.filter(v=>!v.disposed).length-1;view.dispose();view.dispose();
      for(const key of Object.keys(baseline))assert.equal(counts(scene)[key],baseline[key]+perView[key]*live,key);
      assert.ok(!source.isDisposed());assert.ok(!source.geometry.isDisposed());assert.ok(scene.textures.includes(sharedTarget));assert.ok(scene.textures.includes(texture));
      if(!views[1].disposed){assert.ok(scene.materials.includes(survivingMaterial));sampleAnimation(views[1],pose.clips[0].name,.2);}
    }
    assert.deepEqual(counts(scene),baseline);
    const again=createActorView(container,scene,'fate-again',.01,pose);again.dispose();assert.deepEqual(counts(scene),baseline);
    container.dispose();
  }finally{scene.dispose();engine.dispose();}
});
