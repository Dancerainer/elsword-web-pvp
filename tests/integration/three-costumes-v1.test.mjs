/** Actual converted hierarchies and production appearance consumers, no GPU claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {composeCharacterPose,installSharedCharacterAnimations} from '../../packages/combat-assets/shared-character.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';
import {COSTUMES,normalizeCostumePreferences,selectedCostume} from '../../packages/professions/costumes.mjs';

const ids=['imperial','denif','evilTracer1'];
const file=url=>new URL('../../artifacts/'+url.replace(/^\/assets\//,''),import.meta.url);
const json=url=>JSON.parse(readFileSync(file(url)));
test('new choices round-trip in all four character preference slots',()=>{
  for(const id of ids){
    assert.ok(COSTUMES[id]);
    const saved=normalizeCostumePreferences(JSON.parse(JSON.stringify({elsword:id,raven:id,elesis:id,add:id})));
    for(const job of ['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'])assert.equal(selectedCostume(saved,job),id);
  }
  assert.throws(()=>normalizeCostumePreferences({add:'../imperial'}),/invalid-costume/);
});
for(const job of ['LK','RS','IS','RF','BM','VC','GM','BH','CA','LP','MM','DE'])test(job+' new costumes preserve faces, pose bones, awakening and disposal',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;engine.getCaps().maxVertexUniformVectors=1024;
  const containers=new Map(),load=async(base,name)=>{
    const key=base+name;if(!containers.has(key))containers.set(key,loadPoseContainer(scene,file(key)));
    return containers.get(key);
  };
  try{
    const base='/assets/'+job.toLowerCase()+'/',manifest=json(base+'manifest.json');
    const raw=json(base+manifest.runtimePose),pose=composeCharacterPose(raw,raw.sharedPose?json(base+raw.sharedPose):null);
    const source=await load(base,manifest.runtimeGlb);
    if(manifest.sharedCharacterAnimations?.clips.length)installSharedCharacterAnimations(source,await load(base,manifest.sharedCharacterAnimations.glb),manifest.sharedCharacterAnimations.clips);
    const view=createActorView(source,scene,'actor',.01,pose),original=[...view.meshes];
    const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer:load});
    const clips=[...new Set([pose.clips[0],...['wait','run','attack'].map(s=>pose.clips.find(c=>c.name.toLowerCase().includes(s))).filter(Boolean)])];
    for(const id of ids){
      const assets=await cache.load(job,id),appearance=prepareCostumeView(view,assets,job,scene);publishCostume(view,appearance);
      const shown=original.filter(m=>m.getTotalVertices()&&m.isVisible);
      assert.equal(shown.length,['RF','BM','VC'].includes(job)?2:1);
      assert.ok(shown.some(m=>/Face/i.test(m.name)));
      for(const clip of clips)for(const fraction of [0,.29,.71])for(const awake of [false,true]){
        assert.equal(sampleAnimation(view,clip.name,clip.durationSeconds*fraction,true),true);
        appearance.update({awakening:{remaining:awake?30:0}},.1);
        for(const {name}of assets.entry.poseFrames){
          const a=appearance.body.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
          const b=view.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
          assert.ok(a.every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<1e-5),name);
        }
        for(const row of appearance.accessories){
          if(row.awakened)assert.equal(row.awakened.view.root.isEnabled(),awake);
          assert.equal(row.normal.view.root.isEnabled(),!awake||!row.hasAwakened);
        }
        for(const p of appearance.particles)assert.ok(p.position().every(Number.isFinite));
        for(const n of assets.entry.weaponNodes??[])assert.ok(appearance.body.nodesBySourceName.get(n).computeWorldMatrix(true).asArray().every(Number.isFinite));
      }
      publishCostume(view,null);assert.ok(appearance.body.disposed);assert.deepEqual(view.meshes,original);
      assert.ok(original.every(m=>m.isVisible));
    }
    view.dispose();
  }finally{for(const promise of containers.values())(await promise).dispose();scene.dispose();engine.dispose();}
});
