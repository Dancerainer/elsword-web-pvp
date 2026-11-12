import test from 'node:test';
import assert from 'node:assert/strict';
import {AssetContainer,DrawWrapper,Engine,FreeCamera,Material,MaterialDefines,MaterialPluginBase,
  MeshBuilder,MultiMaterial,NullEngine,PBRMaterial,Scene,Vector3} from '@babylonjs/core';
import {createActorView} from '../../apps/web/actor-presentation.mjs';
import {installOwnedFxMaterialUpdates} from '../../apps/web/fx-owned-material-updates.mjs';

const dirty='_markAllSubMeshesAsDirty',stock=Material.prototype[dirty];
function fixture(){
  const engine=new NullEngine(),scene=new Scene(engine);
  engine.getCaps().maxVertexUniformVectors=1024;scene.skipFrustumClipping=true;
  new FreeCamera('camera',new Vector3(0,0,-10),scene);
  const source=new PBRMaterial('source',scene),container=new AssetContainer(scene);
  source.metallic=.23;source.roughness=.72;source.backFaceCulling=false;
  container.materials.push(source);
  for(let i=0;i<3;i++){const mesh=MeshBuilder.CreateBox('part-'+i,{},scene);mesh.material=source;container.meshes.push(mesh);}
  container.removeAllFromScene();
  const backgroundMaterial=new PBRMaterial('background',scene),background=[];
  for(let i=0;i<12;i++){const mesh=MeshBuilder.CreateBox('background-'+i,{},scene);mesh.material=backgroundMaterial;background.push(mesh);}
  const view=createActorView(container,scene,'fx-fixture'),material=view.meshes[0].material;
  assert.notEqual(material,source);assert.equal(view.ownedMaterials.includes(material),true);
  assert.ok(view.meshes.every(mesh=>mesh.material===material));
  return {engine,scene,source,container,view,material,background,dispose(){view.dispose();container.dispose();scene.dispose();engine.dispose();}};
}
function trackedDefines(label,trace){
  const defines=new MaterialDefines();defines.markAsProcessed();
  for(const name of ['markAllAsDirty','markAsImageProcessingDirty','markAsTexturesDirty','markAsFresnelDirty',
    'markAsMiscDirty','markAsPrePassDirty','markAsLightDirty','markAsAttributesDirty']){
    const original=defines[name];defines[name]=function(...args){trace.push(label+':'+name);return Reflect.apply(original,this,args);};
  }
  return defines;
}
function wrappers(f,{material=f.material,meshes=f.view.meshes}={}){
  const trace=[],all=[];material._materialContext={owner:'fixture'};
  for(const mesh of meshes){
    const sub=mesh.subMeshes[0];sub.resetDrawCache();
    const make=(label,context,defines=trackedDefines(label,trace))=>{
      const wrapper=new DrawWrapper(f.engine,false);wrapper.materialContext=context;wrapper.defines=defines;
      all.push(wrapper);return wrapper;
    };
    sub._drawWrappers=[make(mesh.name+':main',material._materialContext),null,
      make(mesh.name+':other-context',{other:true}),make(mesh.name+':pass',material._materialContext),
      make(mesh.name+':empty',material._materialContext,null),make(mesh.name+':no-dirty',material._materialContext,{shader:'empty'})];
  }
  return {trace,all,reset(){trace.length=0;for(const wrapper of all)wrapper.defines?.markAsProcessed?.();},
    snapshot(){return all.map(wrapper=>wrapper.defines instanceof MaterialDefines?
      Object.fromEntries(Object.entries(wrapper.defines).filter(([key,value])=>key.startsWith('_')&&typeof value==='boolean')):null);}};
}
function observeResets(scene){
  const original=scene.resetCachedMaterial;let count=0;
  scene.resetCachedMaterial=function(...args){count++;return Reflect.apply(original,this,args);};
  return {count:()=>count,clear(){count=0;},restore(){scene.resetCachedMaterial=original;}};
}
function install(f,optimized){
  if(!optimized)return null;
  const defaultMaterial=f.scene._defaultMaterial,materialCount=f.scene.materials.length;
  const handle=installOwnedFxMaterialUpdates(f.view);
  assert.equal(handle.proof().installed,1,'real PBR clone with the seven built-in plugins must opt in');
  assert.equal(f.scene._defaultMaterial,defaultMaterial,'the default-material guard must not instantiate a lazy material');
  assert.equal(f.scene.materials.length,materialCount);
  return handle;
}
function paired(run){
  const results=[];
  for(const optimized of [false,true]){
    const f=fixture();try{results.push(run(f,optimized));}finally{f.dispose();}
  }
  assert.deepEqual(results[1],results[0]);return results[1];
}

test('private PBR dirty flags, draw-wrapper contexts, alpha crossings and cache resets match Babylon oracle',()=>{
  const rows=paired((f,optimized)=>{
    const w=wrappers(f),cache=observeResets(f.scene),handle=install(f,optimized),rows=[];
    for(const flag of [0,Material.TextureDirtyFlag,Material.LightDirtyFlag,Material.FresnelDirtyFlag,
      Material.AttributesDirtyFlag,Material.MiscDirtyFlag,Material.PrePassDirtyFlag,Material.ImageProcessingDirtyFlag,
      Material.AllDirtyFlag,Material.MiscDirtyFlag|Material.PrePassDirtyFlag]){
      w.reset();cache.clear();f.material.markAsDirty(flag);
      rows.push({flag,defines:w.snapshot(),trace:[...w.trace],resets:cache.count()});
    }
    for(const alpha of [.944444855,.8,.8,1]){
      w.reset();cache.clear();f.material.alpha=alpha;
      rows.push({alpha:f.material.alpha,defines:w.snapshot(),trace:[...w.trace],resets:cache.count(),
        transparencyMode:f.material.transparencyMode,alphaMode:f.material.alphaMode,metallic:f.material.metallic,roughness:f.material.roughness});
    }
    if(handle)assert.ok(handle.proof().scopedCalls>0);
    cache.restore();return rows;
  });
  assert.equal(rows.at(-4).resets,1);assert.equal(rows.at(-3).resets,0);assert.equal(rows.at(-2).resets,0);assert.equal(rows.at(-1).resets,1);
});

test('actual NullEngine PBR readiness and subsequent alpha dirtiness match the unmodified prototype',async()=>{
  const snapshots=[];
  for(const optimized of [false,true]){
    const f=fixture();try{
      install(f,optimized);await f.scene.whenReadyAsync();f.scene.render();
      const defines=f.view.meshes.map(mesh=>mesh.subMeshes[0].materialDefines);
      assert.ok(defines.every(Boolean));for(const value of defines)value.markAsProcessed();
      f.material.alpha=.944444855;
      snapshots.push(defines.map(value=>({shader:value.toString(),misc:value._areMiscDirty,prePass:value._arePrePassDirty,dirty:value.isDirty})));
    }finally{f.dispose();}
  }
  assert.deepEqual(snapshots[1],snapshots[0]);
});

test('private traversal visits only owned meshes but keeps current scene order after removeMesh swaps',()=>{
  paired((f,optimized)=>{
    const w=wrappers(f),handle=install(f,optimized);
    // The last FX mesh moves before the others when an unrelated early mesh is removed.
    f.scene.removeMesh(f.background[0]);w.reset();
    let visits=0;const list=f.scene.meshes,iterator=list[Symbol.iterator];
    Object.defineProperty(list,Symbol.iterator,{configurable:true,value:function*(){for(const mesh of Reflect.apply(iterator,this,[])){visits++;yield mesh;}}});
    try{f.material.markAsDirty(Material.AllDirtyFlag);}finally{delete list[Symbol.iterator];}
    if(optimized){assert.equal(visits,0);assert.equal(handle.proof().visitedMeshes,3);}
    else assert.equal(visits,list.length);
    return {defines:w.snapshot(),trace:w.trace};
  });
});

test('material/scene block flags, direct builtin dirty callbacks, and missing wrappers retain oracle behavior',()=>{
  paired((f,optimized)=>{
    const w=wrappers(f),cache=observeResets(f.scene);install(f,optimized);const rows=[];
    for(const block of ['scene','material','neither']){
      f.scene.blockMaterialDirtyMechanism=block==='scene';f.material._blockDirtyMechanism=block==='material';
      w.reset();cache.clear();f.material.markAsDirty(Material.AllDirtyFlag);
      rows.push({block,defines:w.snapshot(),trace:[...w.trace],resets:cache.count()});
    }
    for(const callback of [Material._AllDirtyCallBack,Material._ImageProcessingDirtyCallBack,Material._TextureDirtyCallBack,
      Material._FresnelDirtyCallBack,Material._MiscDirtyCallBack,Material._PrePassDirtyCallBack,Material._LightsDirtyCallBack,
      Material._AttributeDirtyCallBack,Material._FresnelAndMiscDirtyCallBack,Material._TextureAndMiscDirtyCallBack]){
      w.reset();cache.clear();f.material[dirty](callback);rows.push({defines:w.snapshot(),trace:[...w.trace],resets:cache.count()});
    }
    const subMeshes=f.view.meshes[1].subMeshes;f.view.meshes[1].subMeshes=null;
    try{w.reset();f.material.markAsDirty(Material.AllDirtyFlag);rows.push({defines:w.snapshot(),trace:[...w.trace]});}
    finally{f.view.meshes[1].subMeshes=subMeshes;cache.restore();}
    return rows;
  });
});

for(const sharing of ['direct','render-pass','default-material'])test(sharing+' sharing restores full traversal and dirty-marks the external mesh',()=>{
  paired((f,optimized)=>{
    const handle=install(f,optimized),external=MeshBuilder.CreateBox('external',{},f.scene);
    if(sharing==='direct')external.material=f.material;
    if(sharing==='render-pass')external.setMaterialForRenderPass(f.engine.currentRenderPassId,f.material);
    if(sharing==='default-material'){f.scene.defaultMaterial=f.material;external.material=null;}
    const w=wrappers(f,{meshes:[...f.view.meshes,external]});w.reset();f.material.markAsDirty(Material.AllDirtyFlag);
    if(handle){assert.equal(handle.proof().active,0);assert.equal(f.material[dirty],stock);}
    assert.ok(w.trace.some(row=>row.startsWith('external:main:')));
    return {defines:w.snapshot(),trace:w.trace};
  });
});

test('a missing private meshMap entry does not omit an owned render-pass/base-material mesh',()=>{
  paired((f,optimized)=>{
    const handle=install(f,optimized),mesh=f.view.meshes[1];
    mesh.setMaterialForRenderPass(12,f.material);mesh.setMaterialForRenderPass(12,undefined);
    assert.equal(f.material.meshMap[mesh.uniqueId],undefined,'Babylon pass removal can erase the base-material map entry');
    const w=wrappers(f);w.reset();f.material.markAsDirty(Material.AllDirtyFlag);
    if(handle)assert.equal(handle.proof().active,1);
    return {defines:w.snapshot(),trace:w.trace};
  });
});

test('MultiMaterial, extra plugins, source aliases and replaced meshMap are conservative fallbacks',()=>{
  class ExtraPlugin extends MaterialPluginBase{constructor(material){super(material,'fixture-extra',210,{},true,true);}}
  for(const mutate of [f=>new MultiMaterial('unrelated-multi',f.scene),f=>new ExtraPlugin(f.material),
    f=>{f.view.meshes[0].material=f.source;},f=>{f.material.meshMap={...f.material.meshMap};}]){
    const f=fixture();try{
      const handle=install(f,true);mutate(f);f.material.markAsDirty(Material.AllDirtyFlag);
      if(f.view.meshes[0].material===f.source){
        assert.equal(Object.hasOwn(f.source,dirty),false,'a shared source material must never receive the adapter');
      }else{assert.equal(handle.proof().active,0);assert.equal(f.material[dirty],stock);}
    }finally{f.dispose();}
  }
  for(const mutate of [f=>new MultiMaterial('existing-multi',f.scene),f=>new ExtraPlugin(f.material),
    f=>{f.scene.defaultMaterial=f.material;},f=>{f.scene.useMaterialMeshMap=false;}]){
    const f=fixture();try{mutate(f);const h=installOwnedFxMaterialUpdates(f.view);assert.equal(h.proof().installed,0);h.release();}
    finally{f.dispose();}
  }
});

test('version/prototype/callback changes and unknown callbacks restore the original path',()=>{
  const changes=[
    {object:Engine,key:'Version',descriptor:{configurable:true,get:()=> '9.30.0'}},
    {object:Material.prototype,key:dirty,descriptor:{configurable:true,writable:true,value:function(callback){return stock.call(this,callback);}}},
    {object:Material,key:'_MiscDirtyCallBack',descriptor:{configurable:true,writable:true,value:defines=>defines.markAsMiscDirty()}},
    {object:Scene,key:'DefaultMaterialFactory',descriptor:{configurable:true,writable:true,value:scene=>new PBRMaterial('custom-default',scene)}}
  ];
  for(const change of changes){
    const f=fixture(),descriptor=Object.getOwnPropertyDescriptor(change.object,change.key);
    try{
      const handle=install(f,true);Object.defineProperty(change.object,change.key,change.descriptor);
      f.material.markAsDirty(Material.AllDirtyFlag);assert.equal(handle.proof().active,0);
      assert.equal(f.material[dirty],Material.prototype[dirty]);
      assert.equal(installOwnedFxMaterialUpdates(f.view).proof().installed,0);
    }finally{
      if(descriptor)Object.defineProperty(change.object,change.key,descriptor);else delete change.object[change.key];
      f.dispose();
    }
  }
  paired((f,optimized)=>{
    const w=wrappers(f),handle=install(f,optimized);let calls=0;
    f.material[dirty](defines=>{calls++;defines.markAllAsDirty();});
    if(handle)assert.equal(handle.proof().active,0);
    return {calls,defines:w.snapshot(),trace:w.trace};
  });
});

test('define callback exceptions propagate with original partial dirtiness and cache reset ordering',()=>{
  paired((f,optimized)=>{
    const w=wrappers(f),cache=observeResets(f.scene);install(f,optimized);
    w.all[2].defines.markAsMiscDirty=()=>{throw Error('define failure');};
    cache.clear();assert.throws(()=>{f.material.alpha=.94;},/define failure/);
    const result={alpha:f.material.alpha,defines:w.snapshot(),trace:w.trace,resets:cache.count()};cache.restore();return result;
  });
});

test('a borrowed wrapper and a reentrant builtin callback restore original dispatch',()=>{
  paired((f,optimized)=>{
    const handle=install(f,optimized),other=f.background[0].material;
    const w=wrappers(f,{material:other,meshes:f.background});
    const method=f.material[dirty];method.call(other,Material._AllDirtyCallBack);
    if(handle)assert.equal(handle.proof().active,0);
    return {defines:w.snapshot(),trace:w.trace};
  });
  paired((f,optimized)=>{
    const w=wrappers(f),handle=install(f,optimized),defines=w.all[0].defines;
    const original=defines.markAsMiscDirty;let recursed=false;
    defines.markAsMiscDirty=function(){
      const result=Reflect.apply(original,this,[]);
      if(!recursed){recursed=true;f.material[dirty](Material._AllDirtyCallBack);}
      return result;
    };
    f.material[dirty](Material._MiscDirtyCallBack);
    if(handle)assert.equal(handle.proof().active,0);
    return {defines:w.snapshot(),trace:w.trace};
  });
});

test('dispose and external replacements release only adapter-owned methods and retain clone resource ownership',()=>{
  const f=fixture();
  try{
    const handle=install(f,true),ownArray=f.view.ownedMaterials,owned=f.material,source=f.source;
    const descriptor=Object.getOwnPropertyDescriptor(f.view,'ownedMaterials');
    assert.equal(descriptor.enumerable,false);assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);
    f.view.dispose();assert.equal(handle.proof().released,true);assert.equal(handle.proof().active,0);
    assert.equal(Object.hasOwn(owned,dirty),false);assert.equal(ownArray.length,0);
    assert.equal(f.container.materials[0],source);assert.equal(source[dirty],stock);
    assert.equal(f.scene.materials.includes(owned),false);f.view.dispose();
  }finally{f.dispose();}
  const g=fixture();try{
    const originalDispose=g.view.dispose,handle=install(g,true),externalDirty=function(){},externalDispose=function(){};
    g.material[dirty]=externalDirty;g.view.dispose=externalDispose;handle.release();
    assert.equal(g.material[dirty],externalDirty);assert.equal(g.view.dispose,externalDispose);
    delete g.material[dirty];g.view.dispose=originalDispose;
  }finally{g.dispose();}
  const h=fixture();try{
    const handle=install(h,true);h.scene.removeMesh(h.view.meshes[0]);
    assert.equal(handle.proof().released,true);assert.equal(h.material[dirty],stock);
  }finally{h.dispose();}
});
