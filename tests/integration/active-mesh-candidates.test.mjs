import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,FreeCamera,Vector3,MeshBuilder,TransformNode} from '@babylonjs/core';
import {installActiveMeshCandidates} from '../../apps/web/active-mesh-candidates.mjs';

test('dormant pool bypasses readiness checks and waking/disposing preserves visible candidates',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('camera',new Vector3(0,0,-10),scene);
  const root=new TransformNode('pool',scene),sleeping=MeshBuilder.CreateBox('sleeping',{},scene),map=MeshBuilder.CreateBox('map',{},scene);
  sleeping.parent=root;root.setEnabled(false);
  let checked=0;const ready=sleeping.isReady;sleeping.isReady=function(...args){checked++;return ready.apply(this,args);};
  const original=scene.getActiveMeshCandidates,filter=installActiveMeshCandidates(scene);
  assert.equal(installActiveMeshCandidates(scene),filter);
  try{
    scene.render();assert.equal(checked,0);assert.deepEqual(filter.proof(),{inspected:2,skipped:1,candidates:1});
    root.setEnabled(true);scene.render();assert.ok(checked>0);assert.equal(filter.proof().candidates,2);
    sleeping.dispose();scene.render();assert.deepEqual(scene.getActiveMeshCandidates().data,[map]);
    filter.dispose();assert.equal(scene.getActiveMeshCandidates,original);
  }finally{scene.dispose();engine.dispose();}
});

test('custom provider ordering and camera-specific candidate changes remain authoritative',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const a=MeshBuilder.CreateBox('a',{},scene),b=MeshBuilder.CreateBox('b',{},scene),c=MeshBuilder.CreateBox('c',{},scene);
  let source=[c,b,a];scene.getActiveMeshCandidates=()=>({data:source,length:source.length});
  const filter=installActiveMeshCandidates(scene);
  try{
    b.setEnabled(false);assert.deepEqual(scene.getActiveMeshCandidates().data,[c,a]);
    source=[b,a];b.setEnabled(true);assert.deepEqual(scene.getActiveMeshCandidates().data,[b,a]);
  }finally{filter.dispose();scene.dispose();engine.dispose();}
});
