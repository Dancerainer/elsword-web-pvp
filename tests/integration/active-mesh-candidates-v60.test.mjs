/** Current Babylon renderer semantics; no original-client/FPS claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,TransformNode,FreeCamera,Vector3} from '@babylonjs/core';
import {installActiveMeshCandidates} from '../../apps/web/active-mesh-candidates.mjs';
const later=()=>new Promise(resolve=>setTimeout(resolve,4));
function fixture(t){
 const engine=new NullEngine(),scene=new Scene(engine),provider=scene.getActiveMeshCandidates;
 const handle=installActiveMeshCandidates(scene,{sceneMeshProvider:provider,appendOnlyMembership:true});
 t.after(()=>{handle.dispose();scene.dispose();engine.dispose();});
 const query=()=>{const r=scene.getActiveMeshCandidates();return r.data.slice(0,r.length);};
 const literal=()=>{const r=provider.call(scene),out=[];for(let i=0;i<r.length;i++)if(r.data[i].isEnabled())out.push(r.data[i]);return out;};
 return {scene,handle,query,literal,equal:()=>assert.deepEqual(query(),literal()),box:name=>MeshBuilder.CreateBox(name,{},scene)};
}
test('outer frame commit keeps recursive notification snapshots literal and avoids dormant scans after mutation returns',async t=>{
 const f=fixture(t),root=new TransformNode('fx-root',f.scene),child=f.box('child'),sibling=f.box('sibling');
 child.parent=root;sibling.parent=root;
 for(let i=0;i<400;i++)f.box('dormant-'+i).setEnabled(false);
 f.equal();await later();f.equal();
 let reentries=0;child.onEffectiveEnabledStateChangedObservable.add(()=>{f.equal();reentries++;assert.equal(f.handle.proof().tracking.mode,'fallback-transition');});
 const before=f.handle.proof().tracking;
 for(let i=0;i<24;i++){
  root.setEnabled(i%2===1); // Native descendant propagation and every observer finish here.
  const afterMutation=f.handle.proof().tracking;
  f.handle.commitEnabledChanges();f.equal();
  assert.equal(f.handle.proof().tracking.mode,'indexed');
  assert.equal(f.handle.proof().tracking.fullInspections,afterMutation.fullInspections);
 }
 assert.equal(reentries,24);
 assert.equal(f.handle.proof().tracking.committedTransitions-before.committedTransitions,24);
});
test('later callbacks inside Scene.render still use fresh conservative transition fallback',async t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b'),cameraA=new FreeCamera('A',new Vector3(0,0,-10),f.scene),cameraB=new FreeCamera('B',new Vector3(0,0,-10),f.scene);
 f.scene.activeCameras=[cameraA,cameraB];f.equal();await later();f.equal();
 const observed=[];
 f.scene.onBeforeCameraRenderObservable.add(camera=>{
  b.setEnabled(camera===cameraB);f.equal();
  observed.push({camera:camera.name,mode:f.handle.proof().tracking.mode,meshes:f.query()});
 });
 f.handle.commitEnabledChanges();f.scene.render();
 assert.deepEqual(observed.map(r=>[r.camera,r.mode]),[['A','fallback-transition'],['B','fallback-transition']]);
 assert.deepEqual(observed[0].meshes,[a]);assert.deepEqual(observed[1].meshes,[a,b]);
});
test('stock append batches retain provider order without revisiting the existing dormant pool',async t=>{
 const f=fixture(t),root=new TransformNode('dormant',f.scene);root.setEnabled(false);
 for(let i=0;i<400;i++)f.box('old-'+i).parent=root;
 f.equal();await later();f.equal();const before=f.handle.proof().tracking;
 const live=[];
 for(let i=0;i<40;i++){
  const holder=new TransformNode('new-parent-'+i,f.scene),mesh=f.box('new-'+i);mesh.parent=holder;
  if(i%3===0)holder.setEnabled(false);else live.push(mesh);
  f.handle.commitEnabledChanges();f.equal();assert.deepEqual(f.query(),live);
 }
 const appended=f.handle.proof().tracking;
 assert.equal(appended.membershipRebuilds,before.membershipRebuilds);
 assert.equal(appended.fullInspections,before.fullInspections);
 assert.equal(appended.appendInspections-before.appendInspections,80);
 assert.equal(appended.nodeSamples-before.nodeSamples,40);
 await later();f.equal();
 assert.equal(f.handle.proof().tracking.fullInspections,before.fullInspections,'late already-indexed add notifications must not rescan the pool');
});
test('removal, same-length replacement and duplicate append retain literal membership semantics',async t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b'),c=f.box('c');f.equal();await later();f.equal();
 let rebuilds=f.handle.proof().tracking.membershipRebuilds;
 f.scene.removeMesh(b);f.scene.addMesh(b);f.equal();assert.deepEqual(f.query(),[a,c,b]);
 assert.ok(f.handle.proof().tracking.membershipRebuilds>rebuilds);
 f.scene.addMesh(a);f.equal();assert.deepEqual(f.query(),[a,c,b,a]);
 assert.equal(f.handle.proof().tracking.mode,'fallback-membership');
 f.scene.removeMesh(a);f.equal();assert.deepEqual(f.query(),[c,b,a]);
 const oldParent=new TransformNode('old-parent',f.scene);a.parent=oldParent;f.equal();
 oldParent.dispose();const replacement=new TransformNode('replacement',f.scene);b.parent=replacement;replacement.setEnabled(false);
 f.handle.commitEnabledChanges();f.equal();await later();f.equal();
});
test('unsupported appended node methods are rejected before indexed candidates can omit its custom result',t=>{
 const f=fixture(t);f.box('a');f.equal();const b=f.box('custom');b.isEnabled=()=>false;
 f.equal();assert.equal(f.handle.proof().tracking.mode,'fallback-membership');
});
test('reparent after append remains notification-safe and public array replacement requires full validation',async t=>{
 const f=fixture(t),off=new TransformNode('off',f.scene);off.setEnabled(false);const a=f.box('a');f.equal();await later();f.equal();
 const b=f.box('b'),middle=new TransformNode('middle',f.scene);b.parent=middle;f.equal();
 b.onEffectiveEnabledStateChangedObservable.add(()=>{f.equal();assert.equal(f.handle.proof().tracking.mode,'fallback-transition');});
 middle.parent=off;f.handle.commitEnabledChanges();assert.deepEqual(f.query(),[a]);
 middle.parent=null;f.handle.commitEnabledChanges();assert.deepEqual(f.query(),[a,b]);
 const previous=f.handle.proof().tracking.membershipRebuilds;f.scene.meshes=[b,a];f.equal();
 assert.ok(f.handle.proof().tracking.membershipRebuilds>previous);assert.deepEqual(f.query(),[b,a]);
});
test('dispose leaves pending microtasks and explicit commits unable to retain or revive scene state',async t=>{
 const f=fixture(t),a=f.box('a');f.equal();a.setEnabled(false);f.handle.dispose();
 const proof=f.handle.proof();f.handle.commitEnabledChanges();await later();
 assert.deepEqual(f.handle.proof(),proof);assert.equal(proof.tracking.trackedNodes,0);
});
