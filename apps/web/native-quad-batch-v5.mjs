import {Engine,Vector3} from '@babylonjs/core';
import {RenderingGroup} from '@babylonjs/core/Rendering/renderingGroup.js';
import {compareNativeTransparentSubMeshes,nativeSequenceRenderOrder} from './native-sequence-render-order.mjs';

const positions=[-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0];
const uvs=[0,1,1,1,1,0,0,0],indices=[0,1,2,0,2,3];
const same=(actual,expected)=>actual?.length===expected.length&&expected.every((n,i)=>actual[i]===n);

/** Only the renderer's immutable, single-face source quad is eligible. Ordinary
 * world meshes and PT_MESH/PT_SKINMESH never enter this registry. */
function canonicalQuad(mesh){
  return mesh?.subMeshes?.length===1&&mesh.getTotalVertices()===4&&
    same(mesh.getVerticesData('position'),positions)&&same(mesh.getVerticesData('uv'),uvs)&&
    same(mesh.getIndices(),indices);
}

/** Babylon 9.29's transparent hook runs before sorting. Reproduce its sort
 * preprocessing, merge only consecutive compatible draws, then let its normal
 * material/draw path run. The remaining first submesh retains the first native
 * sequence identity, so Babylon's second sort preserves every barrier.
 *
 * upload(batch,{matrices,colors,count}) must synchronously upload the supplied
 * active prefix, set thinInstanceCount and refresh its bounds. It must preserve
 * batch's original CPU buffers/count. Scratch buffers belong to this adapter;
 * callers should reuse GPU buffer capacity instead of reallocating per upload.
 * Original GPU contents and the exact queue are restored in render's finally,
 * including for multiple cameras, maintained queues and draw exceptions.
 */
const sceneBatchers=new WeakMap();

// RF and LK preload into one scene. Installing a wrapper per profession made
// both wrappers fail their layout guard, silently disabling all merging. Own
// the render hook once and route each registered batch to its original uploader.
export function createNativeQuadBatcher({scene,upload}){
  if(typeof upload!=='function')throw new TypeError('Native quad batch upload callback required');
  let shared=sceneBatchers.get(scene);
  if(!shared){
    const owners=new Set(),registrations=new WeakMap();
    const batcher=createSceneQuadBatcher({scene,upload:(batch,data)=>registrations.get(batch.mesh).upload(batch,data)});
    shared={owners,registrations,batcher};sceneBatchers.set(scene,shared);
  }
  const owner={upload,meshes:new Set()};shared.owners.add(owner);let disposed=false;
  return {
    register(batch){
      if(disposed||!shared.batcher.register(batch))return false;
      shared.registrations.get(batch.mesh)?.meshes.delete(batch.mesh);
      shared.registrations.set(batch.mesh,owner);owner.meshes.add(batch.mesh);return true;
    },
    beginFrame(){if(!disposed)shared.batcher.beginFrame();},
    // Queue statistics are scene totals. Report them once so the profession
    // aggregator does not count the same draws and merge time twice.
    performance(){return !disposed&&shared.owners.values().next().value===owner?shared.batcher.performance():
      {inputDraws:0,outputDraws:0,mergedDraws:0,mergeMs:0,fallbacks:0,fallbackReason:null};},
    dispose(){
      if(disposed)return;disposed=true;
      shared.batcher.beginFrame();
      for(const mesh of owner.meshes){shared.batcher.unregister(mesh);shared.registrations.delete(mesh);}
      owner.meshes.clear();shared.owners.delete(owner);
      if(!shared.owners.size){shared.batcher.dispose();sceneBatchers.delete(scene);}
    },
  };
}

function createSceneQuadBatcher({scene,upload}){
  if(typeof upload!=='function')throw new TypeError('Native quad batch upload callback required');
  const registered=new WeakMap(),scratch=new WeakMap(),installed=new Map();
  let disposed=false;
  const stats={inputDraws:0,outputDraws:0,mergedDraws:0,mergeMs:0,fallbacks:0,fallbackReason:null};
  const reject=reason=>{stats.fallbacks++;stats.fallbackReason=reason;};

  function candidate(subMesh){
    const mesh=subMesh.getMesh(),batch=registered.get(mesh);
    if(!batch||mesh.material!==batch.material||subMesh.getMaterial()!==batch.material||subMesh!==mesh.subMeshes?.[0]||
      !nativeSequenceRenderOrder(mesh)||!canonicalQuad(mesh)||
      !mesh.getWorldMatrix().isIdentity()||mesh.skeleton||mesh.morphTargetManager||
      mesh.visibility!==1||mesh.renderOutline||mesh.renderOverlay||mesh._edgesRenderer?.isEnabled||
      batch.material.needDepthPrePass||!Number.isInteger(batch.count)||batch.count<=0||
      !(batch.matrices instanceof Float32Array)||!(batch.colors instanceof Float32Array)||
      batch.matrices.length<batch.count*16||batch.colors.length<batch.count*4)return null;
    return batch;
  }

  function restore(state){
    const transaction=state.transaction;if(!transaction)return;
    state.transaction=null;
    const {queue,original,changed}=transaction;
    for(let i=0;i<original.length;i++)queue.data[i]=original[i];
    queue.length=original.length;
    // Restore all leads even if one upload fails; leave a real GPU upload
    // failure visible to the caller after restoring the queue and other leads.
    let failure;
    for(const batch of changed)try{upload(batch,{matrices:batch.matrices,colors:batch.colors,count:batch.count});}
      catch(error){failure??=error;}
    if(failure)throw failure;
  }

  function prepare(state){
    const group=state.group,queue=group._transparentSubMeshes;
    if(disposed||!queue?.length)return;
    const started=performance.now(),input=queue.length;
    stats.inputDraws+=input;stats.outputDraws+=input;
    // This adapter deliberately fails open on an unverified Babylon layout or
    // a render path with per-submesh clipping/order-independent transparency.
    if(Engine.Version!=='9.29.0'||group.render!==state.wrapper||
      state.render!==RenderingGroup.prototype.render||
      group._renderTransparent!==RenderingGroup.prototype._renderTransparentSorted||
      group._transparentSortCompareFn!==compareNativeTransparentSubMeshes||
      !Array.isArray(queue.data)||!Number.isInteger(queue.length)||queue.length>queue.data.length||
      scene.useOrderIndependentTransparency||scene._activeMeshesFrozenButKeepClipping||
      scene.getEngine().snapshotRendering){reject('unsupported-render-layout');return;}
    const original=queue.data.slice(0,input),sorted=original.slice();
    if(!sorted.every(s=>s&&typeof s.getMesh==='function'&&typeof s.getBoundingInfo==='function'&&typeof s.getMaterial==='function')){
      reject('unsupported-submesh-layout');return;
    }
    const camera=scene.activeCamera?.globalPosition??Vector3.Zero();
    for(const subMesh of sorted){
      subMesh._alphaIndex=subMesh.getMesh().alphaIndex;
      subMesh._distanceToCamera=Vector3.Distance(subMesh.getBoundingInfo().boundingSphere.centerWorld,camera);
    }
    sorted.sort(compareNativeTransparentSubMeshes);
    const compact=[],plans=[];
    let lead=null,run=null;
    for(const subMesh of sorted){
      const batch=candidate(subMesh);
      if(batch&&lead&&batch.material===lead.batch.material&&subMesh._alphaIndex===lead.subMesh._alphaIndex&&
        batch.mesh.sideOrientation===lead.batch.mesh.sideOrientation&&
        batch.mesh.overrideMaterialSideOrientation===lead.batch.mesh.overrideMaterialSideOrientation){
        run.push(batch);
      }else{
        compact.push(subMesh);lead=batch?{batch,subMesh}:null;run=batch?[batch]:null;
        if(run)plans.push(run);
      }
    }
    const merges=plans.filter(run=>run.length>1);
    if(!merges.length){stats.mergeMs+=performance.now()-started;return;}
    // Build every scratch result before changing the queue or any GPU buffer.
    const uploads=merges.map(run=>{
      const batch=run[0],count=run.reduce((n,b)=>n+b.count,0);
      let data=scratch.get(batch);
      if(!data||data.capacity<count){
        const capacity=2**Math.ceil(Math.log2(count));
        data={capacity,matrices:new Float32Array(capacity*16),colors:new Float32Array(capacity*4)};
        scratch.set(batch,data);
      }
      let offset=0;
      for(const source of run){
        data.matrices.set(source.matrices.subarray(0,source.count*16),offset*16);
        data.colors.set(source.colors.subarray(0,source.count*4),offset*4);offset+=source.count;
      }
      return {batch,data:{matrices:data.matrices,colors:data.colors,count}};
    });
    state.transaction={queue,original,changed:[]};
    try{
      for(const {batch,data} of uploads){state.transaction.changed.push(batch);upload(batch,data);}
      for(let i=0;i<compact.length;i++)queue.data[i]=compact[i];queue.length=compact.length;
      stats.outputDraws-=input-compact.length;stats.mergedDraws+=input-compact.length;
    }catch(error){
      restore(state);reject('merge-upload-failed');
    }finally{stats.mergeMs+=performance.now()-started;}
  }

  function install(group){
    if(disposed||installed.has(group))return;
    const state={group,render:group.render,before:group.onBeforeTransparentRendering,transaction:null};
    state.wrapper=function(...args){
      try{return state.render.apply(this,args);}
      finally{restore(state);}
    };
    state.beforeWrapper=function(){state.before?.call(this);prepare(state);};
    group.render=state.wrapper;group.onBeforeTransparentRendering=state.beforeWrapper;installed.set(group,state);
  }
  const observer=scene.onBeforeRenderingGroupObservable.add(info=>{
    if(info.renderingGroupId===0&&info.renderingManager===scene.renderingManager)
      install(info.renderingManager.getRenderingGroup(0));
  });
  return {
    register(batch){
      if(!canonicalQuad(batch?.mesh)||batch.mesh.material!==batch.material)return false;
      registered.set(batch.mesh,batch);return true;
    },
    unregister(mesh){registered.delete(mesh);},
    beginFrame(){
      for(const state of installed.values())restore(state);
      Object.assign(stats,{inputDraws:0,outputDraws:0,mergedDraws:0,mergeMs:0,fallbacks:0,fallbackReason:null});
    },
    performance(){return {...stats};},
    dispose(){
      if(disposed)return;disposed=true;scene.onBeforeRenderingGroupObservable.remove(observer);
      for(const state of installed.values()){
        restore(state);
        if(state.group.render===state.wrapper)state.group.render=state.render;
        if(state.group.onBeforeTransparentRendering===state.beforeWrapper)state.group.onBeforeTransparentRendering=state.before;
      }
      installed.clear();
    },
  };
}
