import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader,PBRMaterial,Texture} from '@babylonjs/core';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {loadPoseContainer,readGlb} from '../helpers/babylon-assets.mjs';
import {profile,visualIndex,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';

test('real SCA model samplers survive PT_MESH Texture events across explosion, hit and ready templates',{timeout:10000},async t=>{
  const names=['Raven_Explosion2_P02','RF_HitP04','Raven_ReadyS_P02'];
  const index={...visualIndex,templates:Object.fromEntries(names.map(name=>[name,visualIndex.templates[name]]))};
  const original=readGlb(resolve(fixtureRoot,'artifacts/rf/fx/meshes/SCA_CRIMSON_BREAK_P01.glb'));
  const material=original.json.materials[0],texture=original.json.textures[material.pbrMetallicRoughness.baseColorTexture.index];
  const image=original.json.images[texture.source],sourceName=image.name;
  assert.equal(sourceName,'ELK_WIND_SLICER_01.dds','actual embedded original mesh sampler');
  assert.equal(image.mimeType,'image/png');
  const imageView=original.json.bufferViews[image.bufferView];
  assert.ok(imageView.byteLength>8,'original GLB contains its actual source image, not just a material label');
  assert.deepEqual(Array.from(original.binary.subarray(imageView.byteOffset??0,(imageView.byteOffset??0)+8)),[137,80,78,71,13,10,26,10]);
  names.forEach(name=>{
    assert.equal(index.templates[name].fields.Mesh,'SCA_CRIMSON_BREAK_P01.Y');
    assert.ok(index.templates[name].events.some(event=>event.property.toUpperCase()==='TEXTURE'&&event.value!==sourceName),'authored plane-style Texture differs from the model material');
    for(const field of ['ChangeTexXET','MultiTexXET','AniXET'])assert.equal(index.templates[name].fields[field],undefined);
  });
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  t.after(()=>{scene.dispose();engine.dispose();});
  new FreeCamera('source-material-consumer',new Vector3(0,0,10),scene);
  // NullEngine cannot complete hardware texture compilation. This test checks
  // the actual clone/update consumer only, and makes no GPU-pixel assertion.
  t.mock.method(PBRMaterial.prototype,'forceCompilationAsync',async()=>{});
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,target)=>{
    const container=await loadPoseContainer(target,resolve(fixtureRoot,'artifacts/rf',file));
    // Headless geometry loader omits images. Reattach the independently read
    // original material sampler; this is a consumer test, not a GPU pixel test.
    // A real, unloaded Texture clones the source sampler metadata without a
    // hardware upload or network request. RawTexture would make the headless
    // GLTF loader wait on a texture that NullEngine never marks GPU-ready.
    const sourceTexture=new Texture(null,target);sourceTexture.name=sourceName;
    const m=new PBRMaterial(sourceName,target);m.albedoTexture=sourceTexture;
    for(const mesh of container.meshes)if(mesh.getTotalVertices()>0)mesh.material=m;
    container.materials.push(m);return container;
  });
  const bounded={...profile,states:{},skillCatalog:[],damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({scene,engine,index,profile:bounded,effectPoses:poses,samplers:{},loadout:[]});
  try{
    const samplersBeforeUpdate=new Map();
    const state={actors:[{id:'rf',facing:1,hp:100,awakening:{remaining:0}}],effects:[]};
    for(const [effectId,name] of names.entries())view.event({type:'effectStarted',effectId:effectId+1,actorId:'rf',name,definition:{},birthAnchor:{position:[0,0,0],facing:1}},state);
    for(let frame=0;frame<8;frame++){view.step(1/60,state);view.render();
      const active=scene.meshes.filter(m=>m.getTotalVertices()>0&&m.isEnabled()&&m.name.startsWith('fx-'));
      assert.ok(active.length>0);
      for(const mesh of active){
        const sampler=mesh.material.albedoTexture;
        assert.equal(sampler.name,sourceName,'actual model clones keep original sampler metadata');
        assert.equal(sampler.url,null,'Initial Texture must not create a replacement resource request');
        if(!samplersBeforeUpdate.has(mesh.material))samplersBeforeUpdate.set(mesh.material,sampler);
        assert.equal(sampler,samplersBeforeUpdate.get(mesh.material),'every later mesh update retains its own cloned source sampler');
      }
    }
    assert.ok(names.every(name=>view.proof({includeDraws:true}).nativeParticleDraws.counts[name]>0));
    assert.ok(samplersBeforeUpdate.size>=names.length,'independent actual mesh material clones were exercised');
    t.diagnostic(JSON.stringify({sourceSampler:sourceName,embeddedImageBytes:imageView.byteLength,
      updatedMaterialClones:samplersBeforeUpdate.size,templates:names,shaderCompilationMocked:true,gpuMeasured:false}));
    for(let frame=0;frame<60;frame++){view.step(1/60,state);view.render();}
    assert.equal(view.count,0,'original short explosion lifetimes retire the sequences');
  }finally{view.clear();}
});
