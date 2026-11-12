import {Engine,Scene,Material,PBRMaterial,PBRBRDFConfiguration,PBRClearCoatConfiguration,
  PBRIridescenceConfiguration,PBRAnisotropicConfiguration,PBRSheenConfiguration,
  PBRSubSurfaceConfiguration,DetailMapConfiguration} from '@babylonjs/core';

const dirtyName='_markAllSubMeshesAsDirty';
const originalDirty=Material.prototype[dirtyName],originalMark=Material.prototype.markAsDirty;
const originalAlpha=Object.getOwnPropertyDescriptor(Material.prototype,'alpha');
const originalReady=PBRMaterial.prototype.isReadyForSubMesh;
const originalDefaultMaterialFactory=Scene.DefaultMaterialFactory;
const pluginTypes=[['brdf',PBRBRDFConfiguration],['clearCoat',PBRClearCoatConfiguration],
  ['iridescence',PBRIridescenceConfiguration],['anisotropy',PBRAnisotropicConfiguration],
  ['sheen',PBRSheenConfiguration],['subSurface',PBRSubSurfaceConfiguration],['detailMap',DetailMapConfiguration]];
const callbackNames=['_AllDirtyCallBack','_ImageProcessingDirtyCallBack','_TextureDirtyCallBack',
  '_FresnelDirtyCallBack','_MiscDirtyCallBack','_PrePassDirtyCallBack','_LightsDirtyCallBack',
  '_AttributeDirtyCallBack','_FresnelAndMiscDirtyCallBack','_TextureAndMiscDirtyCallBack','_RunDirtyCallBacks'];
const callbacks=new Map(callbackNames.map(name=>[name,Material[name]]));
const callbackSet=new Set(callbacks.values());
const sceneOwners=new WeakMap();

function compatibleRuntime(){
  const alpha=Object.getOwnPropertyDescriptor(Material.prototype,'alpha');
  if(!(Engine.Version==='9.29.0'&&Material.prototype[dirtyName]===originalDirty&&
    Material.prototype.markAsDirty===originalMark&&alpha?.get===originalAlpha?.get&&alpha?.set===originalAlpha?.set&&
    PBRMaterial.prototype.isReadyForSubMesh===originalReady&&Scene.DefaultMaterialFactory===originalDefaultMaterialFactory))return false;
  for(const [name,callback]of callbacks)if(typeof callback!=='function'||Material[name]!==callback)return false;
  return true;
}
function builtinPluginsOnly(material){
  const manager=material.pluginManager;
  if(!manager||manager._plugins?.length!==pluginTypes.length)return false;
  if(!pluginTypes.every(([key,Type])=>Object.getPrototypeOf(material[key]??{})===Type.prototype))return false;
  for(const list of [manager._plugins,manager._activePlugins,manager._activePluginsForExtraEvents]){
    if(!Array.isArray(list))return false;
    for(const plugin of list)if(!pluginTypes.some(([key])=>material[key]===plugin))return false;
  }
  return true;
}
function restore(object,name,descriptor){
  if(descriptor)Object.defineProperty(object,name,descriptor);else delete object[name];
}

/** Only effects-view's private FX clone owner may opt in, after plugin setup,
 * with createActorView's exact, immutable ownedMaterials array identity.
 * Body/costume materials and arbitrary externally shared materials are excluded.
 * Babylon's public material/alpha/dirty APIs and callback flags stay intact;
 * only this instance's private submesh traversal uses its private view meshes.
 *
 * meshMap is checked in place on every request, and observed external sharing
 * permanently restores the original path. It is not a general reverse index:
 * Babylon render-pass removal can erase a direct mesh's map entry. Therefore
 * callers MUST retain the private-clone ownership contract and never lend these
 * materials outside the view. Any scene MultiMaterial or default-material alias
 * also disables this path. This is deliberately not a general material adapter.
 * Candidate membership/order follows CURRENT scene.meshes (removeMesh swaps).
 * Native indexOf checks replace the expensive full-scene JS submesh traversal.
 */
export function installOwnedFxMaterialUpdates(view,{scene=view?.root?.getScene()}={}){
  const records=[],meshSet=new Set(),proof={installed:0,scopedCalls:0,visitedMeshes:0,fallbacks:0,released:false};
  let ownerRegistry=null,disposeWrapper=null,disposeDescriptor=null;
  const handle={proof:()=>({...proof,active:records.filter(record=>record.active).length}),release};
  let meshes=view?.meshes,ownedMaterials=view?.ownedMaterials,dispose=view?.dispose;
  const ownership= view&&Object.getOwnPropertyDescriptor(view,'ownedMaterials');
  if(!compatibleRuntime()||!scene||scene.useMaterialMeshMap!==true||scene.multiMaterials.length||view.disposed||
    !Array.isArray(meshes)||!Array.isArray(ownedMaterials)||!meshes.length||typeof dispose!=='function'||
    !ownership||ownership.value!==ownedMaterials||ownership.writable||ownership.configurable||
    Object.getOwnPropertyDescriptor(view,'dispose')?.configurable===false){release();return handle;}
  for(const mesh of meshes){if(mesh.getScene()!==scene||mesh.isDisposed()||!scene.meshes.includes(mesh)){release();return handle;}meshSet.add(mesh);}

  function restoreRecord(record){
    if(!record.active)return;
    record.active=false;
    if(record.material[dirtyName]===record.wrapper)restore(record.material,dirtyName,record.descriptor);
  }
  function release(){
    if(proof.released)return;proof.released=true;
    for(const record of records)restoreRecord(record);
    if(disposeWrapper&&view.dispose===disposeWrapper)restore(view,'dispose',disposeDescriptor);
    if(ownerRegistry){
      for(const mesh of meshSet)if(ownerRegistry.owners.get(mesh)===handle)ownerRegistry.owners.delete(mesh);
      if(--ownerRegistry.count===0){scene.onMeshRemovedObservable.remove(ownerRegistry.observer);sceneOwners.delete(scene);}
      ownerRegistry=null;
    }
    records.length=0;meshSet.clear();meshes=null;ownedMaterials=null;dispose=null;view=null;scene=null;
  }
  function stillOwned(material,map){
    if(proof.released||!compatibleRuntime()||view.disposed||view.meshes!==meshes||view.ownedMaterials!==ownedMaterials||
      meshes.length!==meshSet.size||meshes.some(mesh=>!meshSet.has(mesh))||!ownedMaterials.includes(material)||
      scene.useMaterialMeshMap!==true||scene.multiMaterials.length||material.getScene()!==scene||
      // Do not invoke defaultMaterial's lazy getter: the pinned stock factory
      // creates a StandardMaterial, while an existing alias can be checked directly.
      scene._hasDefaultMaterial&&scene._defaultMaterial===material||
      Object.getPrototypeOf(material)!==PBRMaterial.prototype||material.markAsDirty!==originalMark||
      material.isReadyForSubMesh!==originalReady||Object.hasOwn(material,'alpha')||
      material.meshMap!==map||!builtinPluginsOnly(material))return false;
    // Preserve the existing meshMap object; neither replace nor rebuild it.
    for(const id in map){const mesh=map[id];if(mesh&&!meshSet.has(mesh))return false;}
    return true;
  }
  try{
    for(const material of new Set(ownedMaterials)){
      const map=material?.meshMap,descriptor=material&&Object.getOwnPropertyDescriptor(material,dirtyName);
      if(!map||Object.getPrototypeOf(map)!==Object.prototype||descriptor?.configurable===false||
        material[dirtyName]!==originalDirty||!meshes.some(mesh=>mesh.material===material)||!stillOwned(material,map))continue;
      const record={material,descriptor,wrapper:null,active:true,running:false};
      const order=meshes.map(mesh=>({mesh,index:0}));
      record.wrapper=function(func){
        let valid=this===material&&!record.running&&stillOwned(material,map)&&callbackSet.has(func);
        if(valid)for(const item of order){item.index=scene.meshes.indexOf(item.mesh);if(item.index<0){valid=false;break;}}
        if(!valid){
          proof.fallbacks++;restoreRecord(record);
          const method=this===material?material[dirtyName]:Material.prototype[dirtyName];
          return Reflect.apply(method,this,[func]);
        }
        // Exact Babylon9.29 Material traversal after replacing only its mesh list.
        // Keep all guards, every draw wrapper and the material-context filter.
        const targetScene=this.getScene();
        if(targetScene.blockMaterialDirtyMechanism||this._blockDirtyMechanism)return;
        order.sort((a,b)=>a.index-b.index);
        proof.scopedCalls++;record.running=true;
        try{for(const {mesh}of order){
          proof.visitedMeshes++;
          if(!mesh.subMeshes)continue;
          for(const subMesh of mesh.subMeshes){
            const activeMaterial=subMesh.getMaterial()||(targetScene._hasDefaultMaterial?targetScene.defaultMaterial:null);
            if(activeMaterial!==this)continue;
            for(const drawWrapper of subMesh._drawWrappers){
              if(!drawWrapper||!drawWrapper.defines||!drawWrapper.defines.markAllAsDirty)continue;
              if(this._materialContext===drawWrapper.materialContext)func(drawWrapper.defines);
            }
          }
        }}finally{record.running=false;}
      };
      Object.defineProperty(material,dirtyName,{configurable:true,writable:true,enumerable:descriptor?.enumerable??false,value:record.wrapper});
      records.push(record);proof.installed++;
    }
    if(records.length){
      // One listener per scene, not one listener per prewarmed FX instance.
      ownerRegistry=sceneOwners.get(scene);
      if(!ownerRegistry){
        const registry={owners:new WeakMap(),count:0,observer:null};
        registry.observer=scene.onMeshRemovedObservable.add(mesh=>registry.owners.get(mesh)?.release());
        sceneOwners.set(scene,registry);ownerRegistry=registry;
      }
      ownerRegistry.count++;
      for(const mesh of meshes){
        const prior=ownerRegistry.owners.get(mesh);if(prior&&prior!==handle)prior.release();
        ownerRegistry.owners.set(mesh,handle);
      }
      disposeDescriptor=Object.getOwnPropertyDescriptor(view,'dispose');
      disposeWrapper=function(...args){const originalDispose=dispose;release();return Reflect.apply(originalDispose,this,args);};
      Object.defineProperty(view,'dispose',{configurable:true,writable:true,enumerable:disposeDescriptor?.enumerable??false,value:disposeWrapper});
    }else release();
    return handle;
  }catch(error){release();throw error;}
}
