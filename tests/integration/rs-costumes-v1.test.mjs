import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation} from '../../apps/web/actor-presentation.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';
import {costumeCharacter,normalizeCostumePreferences,selectedCostume} from '../../packages/professions/costumes.mjs';

const file=url=>new URL('../../artifacts/'+url.replace(/^\/assets\//,''),import.meta.url);
const json=url=>JSON.parse(readFileSync(file(url)));
const contract=JSON.parse(readFileSync(new URL('../../contracts/rs-costumes-source-v1.json',import.meta.url)));

test('RS and LK share an Elsword costume preference without borrowing Raven selection',()=>{
  const preferences=normalizeCostumePreferences({elsword:'officer',raven:'solace'});
  assert.equal(costumeCharacter('RS'),'elsword');
  assert.equal(selectedCostume(preferences,'RS'),'officer');
  assert.equal(selectedCostume(preferences,'LK'),'officer');
  assert.equal(selectedCostume(preferences,'RF'),'solace');
  assert.equal(selectedCostume(preferences,'VC'),'solace');
  assert.equal(selectedCostume({},'RS'),'default');
});

test('all four actual Elsword costumes preserve RS face, rune poses, attachment bones and profession restoration',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.useRightHandedSystem=true;engine.getCaps().maxVertexUniformVectors=1024;
  try{
    const containers=new Map();
    const loadContainer=(base,name)=>{
      const key=base+name;
      if(!containers.has(key))containers.set(key,loadPoseContainer(scene,file(key)));
      return containers.get(key);
    };
    const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer});
    const manifest=json('/assets/rs/manifest.json'),pose=json('/assets/rs/'+manifest.runtimePose);
    const source=await loadContainer('/assets/rs/',manifest.runtimeGlb);
    const view=createActorView(source,scene,'rs-owner',.01,pose);
    const originalMeshes=[...view.meshes],sourceGroups=[...view.groups];
    const face=originalMeshes.find(mesh=>mesh.name==='rs-owner_Elsword_Face_render');
    assert.ok(face?.getTotalVertices()>0);
    const rsClips=['RS_DashJumpComboXa2','RS_LUNA_BLADE'];
    for(const clip of rsClips)assert.ok(view.clips.has(clip),'RS-owned clip '+clip);
    assert.equal(await cache.load('RS','default'),null);

    for(const id of ['officer','nasod','royal','solace']){
      const assets=await cache.load('RS',id);
      assert.equal(await cache.load('LK',id),assets,'one immutable Elsword asset cache across professions');
      const appearance=prepareCostumeView(view,assets,'RS',scene);
      assert.equal(view.costume??null,null,'preparation does not replace the current appearance');
      assert.equal(appearance.body.root.isEnabled(),false);
      assert.ok(originalMeshes.every(mesh=>mesh.isVisible),'offscreen preparation keeps the profession outfit visible');
      publishCostume(view,appearance);
      assert.deepEqual(originalMeshes.filter(mesh=>mesh.getTotalVertices()&&mesh.isVisible),[face]);
      assert.ok(view.meshes.includes(face),'face stays the original RS mesh object');
      assert.deepEqual(view.groups,sourceGroups,'costume never replaces RS motion owners');

      for(const clip of rsClips)for(const time of [0,.23,.57]){
        assert.equal(sampleAnimation(view,clip,time,true),true);
        appearance.update({awakening:{remaining:0}},.1);
        for(const {name}of assets.entry.poseFrames){
          const actual=appearance.body.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
          const expected=view.nodesBySourceName.get(name).computeWorldMatrix(true).asArray();
          assert.ok(actual.every((n,i)=>Number.isFinite(n)&&Math.abs(n-expected[i])<.0001),id+' / '+clip+' / '+name);
        }
      }
      const mounts=contract.sets[id].accessories.flatMap(row=>row.models);
      assert.equal(appearance.accessories.length,mounts.length);
      for(const remaining of [10,0,5]){
        appearance.update({awakening:{remaining}},.2);
        for(let index=0;index<mounts.length;index++){
          const row=appearance.accessories[index],mount=mounts[index];
          assert.equal(!!row.awakened,!!mount.awakened,'Hyper capability comes from original item');
          if(row.awakened)assert.equal(row.awakened.view.root.isEnabled(),remaining>0);
          if(row.normal)assert.equal(row.normal.view.root.isEnabled(),remaining===0||!mount.awakened);
          for(const child of [row.normal,row.awakened].filter(Boolean)){
            assert.equal(child.view.root.parent,view.nodesBySourceName.get(mount.bone),'exact original attachment owner');
            assert.ok(child.view.meshes.every(mesh=>mesh.computeWorldMatrix(true).asArray().every(Number.isFinite)));
          }
        }
      }
      publishCostume(view,null);
      assert.equal(appearance.body.disposed,true);
      assert.deepEqual(view.meshes,originalMeshes);
      assert.ok(originalMeshes.every(mesh=>mesh.isVisible),'default restores all seven RS meshes');
    }

    const shared=await cache.load('RS','nasod');
    const second=createActorView(source,scene,'rs-second',.01,pose);
    publishCostume(view,prepareCostumeView(view,shared,'RS',scene));
    publishCostume(second,prepareCostumeView(second,shared,'RS',scene));
    view.costume.update({awakening:{remaining:10}},.2);
    second.costume.update({awakening:{remaining:0}},.2);
    assert.equal(view.costume.accessories[0].awakened.view.root.isEnabled(),true);
    assert.equal(second.costume.accessories[0].awakened.view.root.isEnabled(),false);
    assert.notEqual(view.costume.body.root,second.costume.body.root,'shared geometry has independent actor clones');
    const previous=view.costume,replacement=prepareCostumeView(view,await cache.load('RS','solace'),'RS',scene);
    assert.equal(previous.body.disposed,false);
    publishCostume(view,replacement);
    assert.equal(previous.body.disposed,true,'publishing a replacement releases the prior costume');
    second.dispose();view.dispose();
    assert.equal(replacement.body.disposed,true,'actor disposal owns the active costume');
    assert.ok(source.meshes.every(mesh=>!mesh.isDisposed()),'RS source survives disposal');
    assert.ok(shared.bodyContainer.meshes.every(mesh=>!mesh.isDisposed()),'shared costume source survives disposal');
  }finally{scene.dispose();engine.dispose();}
});
