/** Real Babylon9.29 public-event semantics vs the previous ordered filter. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,TransformNode,FreeCamera,Vector3,HemisphericLight,Observable} from '@babylonjs/core';
import {installActiveMeshCandidates} from '../../apps/web/active-mesh-candidates.mjs';
const turn=()=>Promise.resolve(),later=()=>new Promise(resolve=>setTimeout(resolve,4));
function fixture(t,{SceneType=Scene}={}){
 const engine=new NullEngine(),scene=new SceneType(engine),provider=scene.getActiveMeshCandidates;
 const handle=installActiveMeshCandidates(scene,{sceneMeshProvider:provider});
 t.after(()=>{handle.dispose();scene.dispose();engine.dispose();});
 const query=()=>{const value=scene.getActiveMeshCandidates();return value.data.slice(0,value.length);},
  expected=()=>{const value=provider.call(scene),out=[];for(let i=0;i<value.length;i++)if(value.data[i].isEnabled())out.push(value.data[i]);return out;},
  equal=()=>assert.deepEqual(query(),expected());
 return {engine,scene,provider,handle,query,expected,equal,box:name=>MeshBuilder.CreateBox(name,{},scene)};
}
test('explicit fresh-Scene provider indexes dormant pools while default unknown calls keep the original path',async t=>{
 const f=fixture(t),root=new TransformNode('sleeping-parent',f.scene),live=[];
 for(let n=0;n<400;n++){const mesh=f.box('pooled-'+n);mesh.parent=root;}
 root.setEnabled(false);for(let n=0;n<5;n++)live.push(f.box('live-'+n));
 assert.deepEqual(f.query(),live);await later();f.equal();await turn();f.equal();
 const before=f.handle.proof().tracking;
 for(let n=0;n<80;n++)assert.deepEqual(f.query(),live);
 const after=f.handle.proof().tracking;
 assert.equal(after.mode,'indexed');assert.equal(after.membershipRebuilds,before.membershipRebuilds);
 assert.equal(after.fullInspections,before.fullInspections,'unchanged frames must not re-filter the400 dormant meshes');
 assert.equal(after.nodeSamples,before.nodeSamples);assert.equal(after.liveVisits-before.liveVisits,80*5);
 root.setEnabled(true);f.equal();assert.equal(f.handle.proof().tracking.mode,'fallback-transition');await turn();f.equal();assert.equal(f.query().length,405);
});
test('indexed native rendering still bypasses only disabled readiness and retains enabled material/geometry checks',async t=>{
 const f=fixture(t),root=new TransformNode('pool',f.scene),sleeping=f.box('sleeping'),map=f.box('map');sleeping.parent=root;root.setEnabled(false);
 new FreeCamera('camera',new Vector3(0,0,-10),f.scene);new HemisphericLight('light',new Vector3(0,1,0),f.scene);
 const geometry=sleeping.geometry,material=sleeping.material,count=f.scene.meshes.length,ready=sleeping.isReady;let calls=0;
 sleeping.isReady=function(...args){calls++;return ready.apply(this,args);};
 f.scene.render();assert.equal(calls,0);assert.equal(f.handle.proof().tracking.mode,'indexed');
 root.setEnabled(true);await turn();f.scene.render();assert.ok(calls>0);assert.deepEqual(f.query(),[sleeping,map]);
 assert.equal(sleeping.geometry,geometry);assert.equal(sleeping.material,material);assert.equal(f.scene.meshes.length,count);
});
test('real parent toggles, reparenting and transform-only child notifications preserve reentrant native snapshots',async t=>{
 const f=fixture(t),parent=f.box('mesh-parent'),child=f.box('child'),other=f.box('other'),dummy=new TransformNode('dummy-child',f.scene),off=new TransformNode('off',f.scene);
 child.parent=parent;dummy.parent=parent;off.setEnabled(false);f.equal();await turn();
 let calls=0;child.onEffectiveEnabledStateChangedObservable.add(()=>{calls++;f.equal();});
 dummy.onEffectiveEnabledStateChangedObservable.add(()=>{calls++;f.equal();});
 parent.onEnabledStateChangedObservable.add(()=>{calls++;f.equal();});
 parent.setEnabled(false);f.equal();await turn();assert.deepEqual(f.query(),[other]);
 parent.setEnabled(true);await turn();f.equal();assert.ok(calls>=6);
 child.parent=off;f.equal();await turn();assert.deepEqual(f.query(),[parent,other]);
 child.parent=null;f.equal();await turn();assert.deepEqual(f.query(),[parent,child,other]);
 const late=new TransformNode('late-dummy',f.scene);late.parent=parent;f.equal();late.onEffectiveEnabledStateChangedObservable.add(()=>f.equal());
 parent.setEnabled(false);await turn();f.equal();
});
test('late add events, synchronous remove and same-length remove/readd rebuild exact provider ordinals',async t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b'),c=f.box('c');f.equal();
 f.scene.removeMesh(b);f.scene.addMesh(b);assert.deepEqual(f.query(),[a,c,b],'newMeshAdded has not fired yet');
 await later();assert.deepEqual(f.query(),[a,c,b],'late original add notifications cannot resurrect old order');
 b.setEnabled(false);f.equal();await turn();assert.deepEqual(f.query(),[a,c]);
 f.scene.removeMesh(a);const d=f.box('d');assert.deepEqual(f.query(),[c,d]);
 c.dispose();assert.deepEqual(f.query(),[d]);await later();f.equal();
});
test('standard-provider duplicate identities and unsupported enabled methods fall back without losing duplicates',async t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b');f.equal();
 f.scene.addMesh(a);assert.deepEqual(f.query(),[a,b,a]);assert.equal(f.handle.proof().tracking.mode,'fallback-membership');
 f.scene.removeMesh(a);assert.deepEqual(f.query(),[b,a]);
 const enabled=b.isEnabled;b.isEnabled=()=>false;const c=f.box('c');assert.deepEqual(f.query(),[a,c]);assert.equal(f.handle.proof().tracking.mode,'fallback-membership');
 b.isEnabled=enabled;f.scene.removeMesh(c);c.dispose();await turn();f.equal();assert.equal(f.handle.proof().tracking.mode,'indexed');
});
test('current public array identity and length changes are checked before returning cached candidates',t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b');f.equal();
 f.scene.meshes=[b,a];assert.deepEqual(f.query(),[b,a]);
 const c=f.box('c');assert.deepEqual(f.query(),[b,a,c]);
});
test('fresh constructor arrow with an unknown provider shape uses the literal ordered fallback',t=>{
 class AlternateScene extends Scene{_getDefaultMeshCandidates(){return this.externalCandidates??super._getDefaultMeshCandidates();}}
 const f=fixture(t,{SceneType:AlternateScene}),a=f.box('a'),b=f.box('b'),c=f.box('c');
 f.scene.externalCandidates={data:[c,a,c,b],length:4};b.setEnabled(false);assert.deepEqual(f.query(),[c,a,c]);
 assert.equal(f.handle.proof().tracking.mode,'fallback-provider-shape');
 f.scene.externalCandidates=null;f.equal();
});
test('two actual cameras admit enable changes between camera evaluations without changing readiness/culling',async t=>{
 const f=fixture(t),a=f.box('a'),b=f.box('b'),camA=new FreeCamera('A',new Vector3(0,0,-10),f.scene),camB=new FreeCamera('B',new Vector3(0,0,-10),f.scene);
 new HemisphericLight('light',new Vector3(0,1,0),f.scene);f.scene.activeCameras=[camA,camB];f.equal();await turn();
 const observed=[];f.scene.onBeforeCameraRenderObservable.add(camera=>{b.setEnabled(camera===camB);f.equal();observed.push({camera:camera.name,meshes:f.query()});});
 f.scene.render();assert.deepEqual(observed.map(r=>r.camera),['A','B']);assert.deepEqual(observed[0].meshes,[a]);assert.deepEqual(observed[1].meshes,[a,b]);
 await turn();f.equal();assert.equal(f.handle.proof().tracking.mode,'indexed');
});
test('unknown custom providers preserve ordering, duplicates, context and changes on every query',t=>{
 const engine=new NullEngine(),scene=new Scene(engine),captured=scene.getActiveMeshCandidates,a=MeshBuilder.CreateBox('a',{},scene),b=MeshBuilder.CreateBox('b',{},scene),c=MeshBuilder.CreateBox('c',{},scene);
 let source=[c,b,a,c],calls=0;scene.getActiveMeshCandidates=function getActiveMeshCandidates(){assert.equal(this,scene);calls++;return {data:source,length:source.length};};
 const custom=scene.getActiveMeshCandidates,handle=installActiveMeshCandidates(scene,{sceneMeshProvider:captured});
 t.after(()=>{handle.dispose();scene.dispose();engine.dispose();});
 b.setEnabled(false);assert.deepEqual(scene.getActiveMeshCandidates().data,[c,a,c]);source=[b,a,a];b.setEnabled(true);assert.deepEqual(scene.getActiveMeshCandidates().data,[b,a,a]);
 assert.equal(calls,2);handle.dispose();assert.equal(scene.getActiveMeshCandidates,custom);
});
test('unknown scene mocks use only the original filter and can cleanly dispose',()=>{
 const onDisposeObservable=new Observable(),a={isEnabled:()=>true},b={isEnabled:()=>false},scene={onDisposeObservable,getActiveMeshCandidates:()=>({data:[a,b,a],length:3})},original=scene.getActiveMeshCandidates;
 const handle=installActiveMeshCandidates(scene,{sceneMeshProvider:original});assert.deepEqual(scene.getActiveMeshCandidates().data,[a,a]);
 assert.equal(handle.proof().tracking.mode,'fallback');handle.dispose();assert.equal(scene.getActiveMeshCandidates,original);
});
test('manual release detaches node/scene listeners, is idempotent and preserves a replacement provider',async t=>{
 const f=fixture(t),a=f.box('a'),root=new TransformNode('root',f.scene);a.parent=root;f.equal();
 assert.equal(a.onEffectiveEnabledStateChangedObservable.hasObservers(),true);assert.equal(root.onEffectiveEnabledStateChangedObservable.hasObservers(),true);
 const replacement=()=>({data:[a],length:1});f.scene.getActiveMeshCandidates=replacement;f.handle.dispose();f.handle.dispose();
 assert.equal(f.scene.getActiveMeshCandidates,replacement);assert.equal(a.onEffectiveEnabledStateChangedObservable.hasObservers(),false);assert.equal(root.onEffectiveEnabledStateChangedObservable.hasObservers(),false);
 assert.equal(f.handle.proof().tracking.trackedNodes,0);await later();
 f.scene.getActiveMeshCandidates=f.provider;const next=installActiveMeshCandidates(f.scene,{sceneMeshProvider:f.provider});
 f.handle.dispose();assert.equal(installActiveMeshCandidates(f.scene),next);next.dispose();assert.equal(f.scene.getActiveMeshCandidates,f.provider);
});
test('Scene disposal releases tracked state before queued add notifications can run',async()=>{
 const engine=new NullEngine(),scene=new Scene(engine),provider=scene.getActiveMeshCandidates,handle=installActiveMeshCandidates(scene,{sceneMeshProvider:provider});
 MeshBuilder.CreateBox('late',{},scene);scene.getActiveMeshCandidates();scene.dispose();assert.equal(handle.proof().tracking.trackedNodes,0);await later();assert.equal(handle.proof().tracking.trackedNodes,0);engine.dispose();
});
test('deterministic256-operation enable/remove/readd/reparent/dispose trace matches the old ordered filter at each step',async t=>{
 const f=fixture(t),parents=[new TransformNode('p0',f.scene),new TransformNode('p1',f.scene),f.box('mesh-parent')],meshes=[];
 for(let n=0;n<24;n++){const mesh=f.box('m'+n);mesh.parent=parents[n%parents.length];meshes.push(mesh);}f.equal();
 let seed=201657;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let n=0;n<256;n++){
  const at=random(meshes.length),mesh=meshes[at],parent=parents[random(parents.length)];
  switch(random(6)){
   case 0:mesh.setEnabled(!mesh.isEnabled(false));break;
   case 1:parent.setEnabled(!parent.isEnabled(false));break;
   case 2:mesh.parent=random(2)?parent:null;break;
   case 3:if(f.scene.meshes.includes(mesh))f.scene.removeMesh(mesh);else f.scene.addMesh(mesh);break;
   case 4:mesh.dispose();meshes[at]=f.box('replacement-'+n);break;
   case 5:{const observer=parent.onEffectiveEnabledStateChangedObservable.add(()=>f.equal());parent.setEnabled(!parent.isEnabled(false));parent.onEffectiveEnabledStateChangedObservable.remove(observer);break;}
  }
  f.equal();await turn();f.equal();
  if(n%32===0){await later();f.equal();}
 }
});
