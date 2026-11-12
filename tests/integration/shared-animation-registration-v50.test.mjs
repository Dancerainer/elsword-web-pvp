/** Real compact GLBs plus full/sparse source poses must retain independent
 * manifest-declared shared animation groups in both practice actor clones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {loadProfessionAssets} from '../../apps/web/load-profession-assets.mjs';
import {createActorView,sampleAnimation,placeActor,getActorNativePoints} from '../../apps/web/actor-presentation.mjs';
import {createPoseAudit} from '../../apps/web/pose-audit.mjs';
const assetRoot=resolve(import.meta.dirname,'../../artifacts');
const data=async url=>JSON.parse(readFileSync(resolve(assetRoot,url.replace(/^\/assets\//,''))));
for(const id of ['BM','RS'])test(`${id} full source pose and compact GLB register all declared shared clips and animate both clones`,async()=>{
 const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
 const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
 new FreeCamera('audit',new Vector3(0,0,20),scene);
 try{
  const assets=await loadProfessionAssets({id,data,loadContainer:(base,file)=>loadPoseContainer(scene,resolve(assetRoot,(base+file).replace(/^\/assets\//,'')))});
  const expected=assets.manifest.sharedCharacterAnimations.clips;
  const registered=new Set(assets.bodyContainer.animationGroups.map(g=>g.name));
  for(const name of expected)assert.ok(registered.has(name),'manifest-declared GLB clip '+name);
  assert.equal(registered.size,assets.bodyContainer.animationGroups.length,'no duplicated source group');
  const views=['player-1','player-2'].map(id=>createActorView(assets.bodyContainer,scene,id,.01,assets.characterPose));
  const audit=createPoseAudit(assets.characterPose);
  for(const name of ['Wait','Walk','Dash','ComboZ1','ComboX1'])for(const time of [.075,.18,.3]){
   for(const [i,view]of views.entries()){
    const actor={id:view.id,x:i*300,y:0,z:0,facing:1,animationName:name,animationTime:time,animationLoop:false,applyMotionOffset:false};
    assert.equal(sampleAnimation(view,name,time),true,name+' remains playable');placeActor(view,actor);scene.render();
    // Non-drawn attachment helpers are lazy in NullEngine. Query through the
    // real trail/attachment consumer before checking their world matrices.
    getActorNativePoints(view,[...view.nodesBySourceName.keys()]);
    const proof=audit(view,actor);assert.equal(proof.supported,true,JSON.stringify(proof));assert.ok(proof.comparedNodes>20);
    assert.ok(proof.maximumErrorNative<.02,JSON.stringify(proof));assert.ok(proof.clockDifferenceSeconds<1e-6);
   }
  }
  for(const view of views)view.dispose();
 }finally{scene.dispose();engine.dispose();}
});
