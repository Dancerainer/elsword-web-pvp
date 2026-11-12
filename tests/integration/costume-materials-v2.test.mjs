import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,PBRMaterial} from '@babylonjs/core';
import {loadPoseContainer,readGlb} from '../helpers/babylon-assets.mjs';
import {createActorView} from '../../apps/web/actor-presentation.mjs';
import {styleCharacter} from '../../apps/web/lighting.mjs';
import {createCostumeAssetCache,prepareCostumeView,publishCostume} from '../../apps/web/costume-view.mjs';

const file=url=>new URL('../../artifacts/'+url.replace(/^\/assets\//,''),import.meta.url);
const json=url=>JSON.parse(readFileSync(file(url)));
for(const profession of ['LK','RF','VC','RS','BM','IS'])test(profession+' material-aware costume closure: cape sides, laser mounts, luminous wings and animated arm ornaments',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;engine.getCaps().maxVertexUniformVectors=1024;
  try{
    const cache=createCostumeAssetCache({data:async url=>json(url),loadContainer:(base,name)=>loadPoseContainer(scene,file(base+name),{materials:true})});
    const base='/assets/'+profession.toLowerCase()+'/',manifest=json(base+'manifest.json');
    const source=await loadPoseContainer(scene,file(base+manifest.runtimeGlb)),view=createActorView(source,scene,'actor');
    for(const id of ['officer','nasod','royal','solace']){
      const assets=await cache.load(profession,id),appearance=prepareCostumeView(view,assets,profession,scene,styleCharacter);
      publishCostume(view,appearance);appearance.update({awakening:{remaining:0}},.4);
      const meshes=child=>child.meshes.filter(m=>m.getTotalVertices());
      const count=['LK','RS','IS'].includes(profession)&&id==='nasod'?2:id==='solace'?2:id==='royal'?0:1;
      assert.equal(appearance.attachments.length,count);
      assert.equal(appearance.particles.length,id==='royal'?2:0);
      for(let i=0;i<appearance.attachments.length;i++){
        const child=appearance.attachments[i],row=assets.entry.attachments[i];
        const owner=row.owner==='body'?appearance.body:appearance.accessories.find(a=>a.itemId===row.owner).normal.view;
        assert.equal(child.view.root.parent,owner.nodesBySourceName.get(row.bone),'nested original equipment bone, not actor bone');
        assert.equal(Boolean(child.clip),id==='solace'&&i===1,'only declared skin SubEquip has an animation controller');
        for(const m of meshes(child.view)){
          assert.equal(m.renderOutline,false);assert.equal(m.material.unlit,true);
          assert.ok(m.material.pluginManager.getPlugin('NativeEffectRealColor'));
          assert.equal(m.material.forceDepthWrite,row.normal.renderProfile.depthWrite);
        }
        if(row.itemId===130892||row.itemId===130895){
          assert.ok(meshes(child.view).some(m=>m.getTotalVertices()>3),'actual laser geometry');
          assert.equal(meshes(child.view)[0].material.transparencyMode,PBRMaterial.PBRMATERIAL_ALPHATESTANDBLEND);
        }
      }
      if(id==='officer')for(const mode of ['normal','awakened'])for(const m of meshes(appearance.accessories[0][mode].view)){
        assert.equal(m.material.backFaceCulling,true,'front/back authored cape surfaces must not both draw');
        assert.equal(m.material.unlit,false);assert.equal(m.renderOutline,true);
      }
      if(id==='solace')for(const mode of ['normal','awakened'])for(const m of meshes(appearance.accessories[0][mode].view)){
        assert.equal(m.material.backFaceCulling,false);assert.equal(m.material.disableDepthWrite,true);assert.equal(m.material.forceDepthWrite,false);
        assert.equal(m.material.unlit,true);assert.equal(m.renderOutline,false);
        const alpha=engine.alphaState;alpha.setAlphaBlendFunctionParameters(1,0,1,0);
        m.material.onBindObservable.notifyObservers(m);
        assert.deepEqual(alpha._blendFunctionParameters.slice(0,4),[770,772,770,772],'SRCALPHA / DESTALPHA');
        m.material.onUnBindObservable.notifyObservers(m);assert.deepEqual(alpha._blendFunctionParameters.slice(0,4),[1,0,1,0]);
      }
      for(const m of view.meshes)if(m.getTotalVertices())assert.ok(m.computeWorldMatrix(true).asArray().every(Number.isFinite));
      const extra=appearance.attachments.map(a=>a.view);publishCostume(view,null);assert.ok(extra.every(v=>v.disposed));
    }
    view.dispose();
  }finally{scene.dispose();engine.dispose();}
});

test('cape export retains original texture/material slots, with explicit single-sided surfaces',()=>{
  for(const character of ['elsword','raven']){
    const entry=json('/assets/costumes/manifest.json').characters[character].officer;
    for(const mode of ['normal','awakened']){
      const glb=readGlb(file('/assets/costumes/'+character+'/officer/'+entry.accessories[0].models[0][mode].glb));
      assert.ok(glb.json.images.length>0);
      assert.ok(glb.json.materials.every(m=>m.doubleSided===false));
      assert.ok(glb.json.meshes.every(m=>m.primitives.every(p=>p.attributes.TEXCOORD_0!==undefined)));
    }
  }
});
