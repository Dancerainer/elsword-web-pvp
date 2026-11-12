import {Engine,Node,Scene} from '@babylonjs/core';
/** Babylon9.29 isEnabled reads two cached booleans. Its public effective-state
 * observable also covers ancestors/reparenting. The game can opt in only with
 * the constructor-default provider captured immediately after new Scene, and
 * stock Node/public Scene add-remove membership (no silent array/flag writes).
 * appendOnlyMembership additionally promises that validated node methods and
 * observable getters stay unchanged, and existing array prefixes are never
 * silently reordered/replaced while retaining their identity and length.
 * Unknown/custom providers retain the original full, ordered filter. */
const installed=new WeakMap();
const stockEnabled=Node.prototype.isEnabled,stockSetEnabled=Node.prototype.setEnabled,
 stockEffective=Object.getOwnPropertyDescriptor(Node.prototype,'onEffectiveEnabledStateChangedObservable')?.get,
 stockOwn=Object.getOwnPropertyDescriptor(Node.prototype,'onEnabledStateChangedObservable')?.get,
 stockAddMesh=Scene.prototype.addMesh,stockRemoveMesh=Scene.prototype.removeMesh,stockGetNodes=Scene.prototype.getNodes,
 stockAddTransform=Scene.prototype.addTransformNode,stockRemoveTransform=Scene.prototype.removeTransformNode;
function getterFor(node,key){for(let p=node;p;p=Object.getPrototypeOf(p)){const d=Object.getOwnPropertyDescriptor(p,key);if(d)return d.get;}return null;}
export function installActiveMeshCandidates(scene,{sceneMeshProvider=null,appendOnlyMembership=false}={}){
  if(installed.has(scene))return installed.get(scene);
  const original=scene.getActiveMeshCandidates,result={data:[],length:0};
  const requested=typeof sceneMeshProvider==='function'&&original===sceneMeshProvider,
   records=new Map(),enabled=new Set(),ordinals=new Map(),sorted=[],observers=[];
  const stats={requests:0,indexRequests:0,fallbackRequests:0,transitionFallbacks:0,membershipRebuilds:0,
   appendUpdates:0,appendInspections:0,committedTransitions:0,fullInspections:0,liveVisits:0,nodeSamples:0,enabledEvents:0,mode:'fallback'};
  let inspected=0,skipped=0,disposed=false,dirty=true,hardDirty=true,sortedDirty=true,indexSafe=false,signature=null,pendingTransition=false,transitionScheduled=false,disposeObserver=null;
  const compatible=()=>requested&&scene instanceof Scene&&Engine.Version==='9.29.0'&&
   Node.prototype.isEnabled===stockEnabled&&Node.prototype.setEnabled===stockSetEnabled&&
   Object.getOwnPropertyDescriptor(Node.prototype,'onEffectiveEnabledStateChangedObservable')?.get===stockEffective&&
   Object.getOwnPropertyDescriptor(Node.prototype,'onEnabledStateChangedObservable')?.get===stockOwn&&
   scene.addMesh===stockAddMesh&&scene.removeMesh===stockRemoveMesh&&scene.getNodes===stockGetNodes;
  function markTransition(){
    // A descendant notification can re-enter candidates before its parent has
    // emitted its own notification. Keep the literal filter authoritative for
    // the rest of this notification turn; a normal later RAF uses the index.
    pendingTransition=true;
    if(!transitionScheduled){transitionScheduled=true;queueMicrotask(()=>{pendingTransition=false;transitionScheduled=false;});}
  }
  function update(node){
    stats.enabledEvents++;markTransition();
    if(node.isEnabled!==stockEnabled||ordinals.has(node)&&node.setEnabled!==stockSetEnabled){indexSafe=false;dirty=true;return;}
    if(!ordinals.has(node))return;
    stats.nodeSamples++;const active=node.isEnabled(),had=enabled.has(node);
    if(active===had)return;
    if(active)enabled.add(node);else enabled.delete(node);sortedDirty=true;
  }
  function untrack(node){const row=records.get(node);if(!row)return;
    row.effective.remove(row.effectiveObserver);row.own.remove(row.ownObserver);records.delete(node);enabled.delete(node);sortedDirty=true;
  }
  function clearTracking(){for(const node of records.keys())untrack(node);enabled.clear();ordinals.clear();sorted.length=0;sortedDirty=true;}
  function track(node){
    if(!(node instanceof Node)||node.isEnabled!==stockEnabled||ordinals.has(node)&&node.setEnabled!==stockSetEnabled||
      getterFor(node,'onEffectiveEnabledStateChangedObservable')!==stockEffective||getterFor(node,'onEnabledStateChangedObservable')!==stockOwn)return false;
    if(!records.has(node)){
      const effective=node.onEffectiveEnabledStateChangedObservable,own=node.onEnabledStateChangedObservable;
      records.set(node,{effective,own,effectiveObserver:effective.add(()=>update(node),-1,true),ownObserver:own.add(()=>update(node),-1,true)});
    }
    if(ordinals.has(node)){stats.nodeSamples++;if(node.isEnabled())enabled.add(node);else enabled.delete(node);}
    return true;
  }
  const changed=()=>!signature||dirty||signature.meshes!==scene.meshes||signature.meshesLength!==scene.meshes.length||
    signature.transforms!==scene.transformNodes||signature.transformsLength!==scene.transformNodes.length||
    signature.lights!==scene.lights||signature.lightsLength!==scene.lights.length||signature.cameras!==scene.cameras||signature.camerasLength!==scene.cameras.length||
    signature.skeletons!==scene.skeletons||signature.skeletonsLength!==scene.skeletons.length;
  // Stock addMesh/addTransformNode only append. Removals always request a full
  // rebuild (mesh splice changes ordinals; transform removal swaps the tail).
  // Delayed add notifications often arrive after an earlier length check has
  // already indexed the new nodes: those turns need no repeated scene scan.
  function appendMembers(source){
    // This extra opt-in requires existing nodes to retain their validated
    // enabled methods/getters. Unknown consumers still fully revalidate every
    // membership change, including instance-method replacement without events.
    if(!appendOnlyMembership||hardDirty||!signature||!indexSafe||scene.addTransformNode!==stockAddTransform||scene.removeTransformNode!==stockRemoveTransform||
      signature.meshes!==scene.meshes||signature.meshesLength>scene.meshes.length||
      signature.transforms!==scene.transformNodes||signature.transformsLength>scene.transformNodes.length||
      signature.lights!==scene.lights||signature.lightsLength!==scene.lights.length||
      signature.cameras!==scene.cameras||signature.camerasLength!==scene.cameras.length||
      signature.skeletons!==scene.skeletons||signature.skeletonsLength!==scene.skeletons.length)return false;
    for(let i=signature.meshesLength;i<source.length;i++){
      const mesh=source.data[i];stats.appendInspections++;
      if(ordinals.has(mesh))return false;
      ordinals.set(mesh,i);if(!track(mesh))return false;
      sortedDirty=true;
    }
    for(let i=signature.transformsLength;i<scene.transformNodes.length;i++){
      stats.appendInspections++;if(!track(scene.transformNodes[i]))return false;
    }
    signature.meshesLength=scene.meshes.length;signature.transformsLength=scene.transformNodes.length;
    dirty=false;stats.appendUpdates++;return true;
  }
  function rebuild(source){
    dirty=false;hardDirty=false;stats.membershipRebuilds++;stats.fullInspections+=source.length;ordinals.clear();enabled.clear();sortedDirty=true;indexSafe=true;
    signature={meshes:scene.meshes,meshesLength:scene.meshes.length,transforms:scene.transformNodes,transformsLength:scene.transformNodes.length,
      lights:scene.lights,lightsLength:scene.lights.length,cameras:scene.cameras,camerasLength:scene.cameras.length,skeletons:scene.skeletons,skeletonsLength:scene.skeletons.length};
    for(let i=0;i<source.length;i++){const mesh=source.data[i];if(ordinals.has(mesh)){indexSafe=false;break;}ordinals.set(mesh,i);}
    // Non-mesh nodes also participate in recursive enabled notifications. Their
    // listeners only guard reentrant queries; they never become candidates.
    const nodes=new Set(scene.getNodes());
    for(const node of records.keys())if(!nodes.has(node))untrack(node);
    if(indexSafe)for(const node of nodes)if(!track(node)){indexSafe=false;break;}
    if(!indexSafe)clearTracking();
  }
  function fallback(source,mode='fallback'){
    stats.mode=mode;stats.fallbackRequests++;stats.fullInspections+=source.length;
    let count=0;inspected=source.length;skipped=0;
    for(let i=0;i<source.length;i++){
      const mesh=source.data[i];
      if(!mesh.isEnabled()){skipped++;continue;}
      result.data[count++]=mesh;
    }
    result.length=count;result.data.length=count;return result;
  }
  function candidates(){
    const source=original.call(scene);stats.requests++;
    if(disposed||!compatible())return fallback(source);
    if(source.data!==scene.meshes||source.length!==scene.meshes.length){dirty=true;return fallback(source,'fallback-provider-shape');}
    if(changed()&&!appendMembers(source))rebuild(source);
    if(!indexSafe)return fallback(source,'fallback-membership');
    if(pendingTransition){stats.transitionFallbacks++;return fallback(source,'fallback-transition');}
    if(sortedDirty){sorted.length=0;for(const mesh of enabled)sorted.push(mesh);sorted.sort((a,b)=>ordinals.get(a)-ordinals.get(b));sortedDirty=false;}
    let count=0;for(const mesh of sorted)result.data[count++]=mesh;
    result.length=count;result.data.length=count;inspected=source.length;skipped=source.length-count;
    stats.indexRequests++;stats.liveVisits+=count;stats.mode='indexed';return result;
  }
  scene.getActiveMeshCandidates=candidates;
  const api={
    /** Explicit outer-frame boundary, called only after synchronous game pose,
     * FX and hierarchy updates have returned, immediately before scene.render.
     * Never call this from a Node/Scene observer or inside an enabled/reparent
     * mutation: those reentrant snapshots still require the literal filter.
     * Later render callbacks can raise a fresh transition and fall back again.
     * No native prototype, notification, or original render check is changed. */
    commitEnabledChanges(){
      if(!disposed&&pendingTransition){pendingTransition=false;stats.committedTransitions++;}
    },
    proof:()=>({inspected,skipped,candidates:result.length,...(requested?{tracking:{...stats,trackedNodes:records.size,trackedMeshes:ordinals.size,enabled:enabled.size,released:disposed}}:{})}),dispose(){
    if(disposed)return;disposed=true;
    if(scene.getActiveMeshCandidates===candidates)scene.getActiveMeshCandidates=original;
    for(const [observable,observer]of observers)observable.remove(observer);
    observers.length=0;clearTracking();
    if(disposeObserver)scene.onDisposeObservable.remove?.(disposeObserver);
    result.data.length=0;result.length=0;installed.delete(scene);
  }};
  if(compatible())for(const [added,removed]of [['onNewMeshAddedObservable','onMeshRemovedObservable'],['onNewTransformNodeAddedObservable','onTransformNodeRemovedObservable'],
    ['onNewLightAddedObservable','onLightRemovedObservable'],['onNewCameraAddedObservable','onCameraRemovedObservable'],['onNewSkeletonAddedObservable','onSkeletonRemovedObservable']]){
    observers.push([scene[added],scene[added].add(()=>{if(!disposed)dirty=true;})],
      [scene[removed],scene[removed].add(node=>{if(!disposed){dirty=true;hardDirty=true;untrack(node);}})]);
  }
  disposeObserver=scene.onDisposeObservable.addOnce(()=>api.dispose());if(!disposed)installed.set(scene,api);return api;
}
