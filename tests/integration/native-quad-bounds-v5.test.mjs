import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,Matrix,Quaternion,Vector2,Vector3} from '@babylonjs/core';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import {refreshNativeQuadBounds} from '../../apps/web/native-quad-bounds-v5.mjs';
import {installNativeParticleMatrixBuffer,uploadNativeParticleMatrices} from '../../apps/web/native-effect-draw-order-v3.mjs';

function setup(){
  const engine=new NullEngine(),scene=new Scene(engine);
  const mesh=MeshBuilder.CreatePlane('optimized',{size:1},scene),oracle=MeshBuilder.CreatePlane('Babylon-original',{size:1},scene);
  mesh.computeWorldMatrix(true);oracle.computeWorldMatrix(true);
  return {engine,scene,mesh,oracle,dispose(){scene.dispose();engine.dispose();}};
}
function bounds(mesh){
  const b=mesh.getBoundingInfo(),box=b.boundingBox,sphere=b.boundingSphere;
  return [b.minimum,b.maximum,box.minimumWorld,box.maximumWorld,box.centerWorld,box.extendSizeWorld,sphere.centerWorld]
    .flatMap(v=>v.asArray()).concat(sphere.radius,sphere.radiusWorld);
}
function close(a,b){
  assert.equal(a.length,b.length);
  for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<=1e-9*Math.max(1,Math.abs(b[i])),`${i}: ${a[i]} vs ${b[i]}`);
}
function compare(s,matrices,count){
  installNativeParticleMatrixBuffer(s.oracle,matrices);uploadNativeParticleMatrices(s.oracle,count);
  assert.equal(refreshNativeQuadBounds(s.mesh,matrices,count),true);
  close(bounds(s.mesh),bounds(s.oracle));close(bounds(s.mesh),bounds({getBoundingInfo:()=>s.mesh.subMeshes[0].getBoundingInfo()}));
}

test('exact canonical quad bounds match Babylon for translation, rotation, negative scaling, Z tilt and shear',()=>{
  const s=setup();try{
    const rows=[Matrix.Identity(),Matrix.Translation(10,-20,30),
      Matrix.Compose(new Vector3(-3,.25,8),Quaternion.RotationYawPitchRoll(.7,-.9,.25),new Vector3(-8,2,6)),
      Matrix.Compose(new Vector3(0,0,0),Quaternion.RotationYawPitchRoll(-.7,1.1,.95),new Vector3(7,-4,-12))];
    const shear=Matrix.Identity();shear.m[0]=-2;shear.m[1]=3;shear.m[2]=-4;shear.m[4]=5;shear.m[5]=-6;shear.m[6]=7;rows.push(shear);
    for(const row of rows){const data=new Float32Array(16);row.copyToArray(data);compare(s,data,1);}
    const all=new Float32Array(rows.length*16);rows.forEach((m,i)=>m.copyToArray(all,i*16));compare(s,all,rows.length);
  }finally{s.dispose();}
});

test('seeded random Float32 affine groups match the actual original thin-instance bounds without recreating objects',()=>{
  const s=setup();try{
    let seed=2016;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
    const b=s.mesh.getBoundingInfo(),box=b.boundingBox,sphere=b.boundingSphere,boxVectors=box.vectors.slice();
    for(let group=0;group<96;group++){
      const count=1+Math.floor(random()*64),matrices=new Float32Array((count+5)*16);
      for(let i=0;i<count;i++){
        const scale=new Vector3((random()-.5)*80,(random()-.5)*80,(random()-.5)*80);
        const rotate=Quaternion.RotationYawPitchRoll(random()*6,random()*6,random()*6);
        const position=new Vector3((random()-.5)*2000,(random()-.5)*2000,(random()-.5)*2000);
        Matrix.Compose(scale,rotate,position).copyToArray(matrices,i*16);
      }
      // Invalid unused capacity must never enter bounds.
      matrices.fill(NaN,count*16);compare(s,matrices,count);
      assert.strictEqual(s.mesh.getBoundingInfo(),b);assert.strictEqual(b.boundingBox,box);assert.strictEqual(b.boundingSphere,sphere);
      box.vectors.forEach((v,i)=>assert.strictEqual(v,boxVectors[i]));
    }
  }finally{s.dispose();}
});

test('movement, count growth/shrinkage and clearing preserve accurate current bounds and global submesh bounds',()=>{
  const s=setup();try{
    const capacity=new Float32Array(64);
    Matrix.Translation(5,6,7).copyToArray(capacity);compare(s,capacity,1);
    Matrix.Translation(-100,200,-300).copyToArray(capacity,16);compare(s,capacity,2);
    Matrix.Translation(1000,-2000,3000).copyToArray(capacity);compare(s,capacity,1);
    const before=bounds(s.mesh);assert.equal(refreshNativeQuadBounds(s.mesh,capacity,0),true);assert.deepEqual(bounds(s.mesh),before);
    Matrix.Compose(new Vector3(7,-9,1),Quaternion.RotationYawPitchRoll(1,2,3),new Vector3(0,0,0)).copyToArray(capacity);compare(s,capacity,1);
  }finally{s.dispose();}
});

test('active non-finite input is rejected atomically, including later rows and unused affine components',()=>{
  const s=setup();try{
    const data=new Float32Array(32);Matrix.Translation(1,2,3).copyToArray(data);Matrix.Translation(4,5,6).copyToArray(data,16);
    compare(s,data,2);const before=bounds(s.mesh);
    for(const component of [0,8,12,15,16,24,31]){
      const broken=data.slice();broken[component]=component%2?Infinity:NaN;
      assert.throws(()=>refreshNativeQuadBounds(s.mesh,broken,2),/Non-finite/);assert.deepEqual(bounds(s.mesh),before);
    }
    assert.throws(()=>refreshNativeQuadBounds(s.mesh,data,3),/matrix count/);assert.deepEqual(bounds(s.mesh),before);
  }finally{s.dispose();}
});

test('noncanonical source geometry, nonidentity base world and projective transforms use the general path',()=>{
  const s=setup();try{
    const data=new Float32Array(16);Matrix.Identity().copyToArray(data);const before=bounds(s.mesh);
    s.mesh.position.x=1;s.mesh.computeWorldMatrix(true);
    assert.equal(refreshNativeQuadBounds(s.mesh,data,1),false);
    s.mesh.position.x=0;s.mesh.computeWorldMatrix(true);
    data[3]=.1;assert.equal(refreshNativeQuadBounds(s.mesh,data,1),false);assert.deepEqual(bounds(s.mesh),before);
    data[3]=0;s.mesh.geometry.boundingBias=new Vector2(0,.1);
    assert.equal(refreshNativeQuadBounds(s.mesh,data,1),false);s.mesh.geometry.boundingBias=new Vector2(0,0);
    data[3]=0;s.mesh.setVerticesData('position',[-1,-1,0,1,-1,0,1,1,0,-1,1,0]);
    const changed=bounds(s.mesh);assert.equal(refreshNativeQuadBounds(s.mesh,data,1),false);assert.deepEqual(bounds(s.mesh),changed);
    const box=MeshBuilder.CreateBox('source-mesh',{},s.scene);assert.equal(refreshNativeQuadBounds(box,data,1),false);
  }finally{s.dispose();}
});
