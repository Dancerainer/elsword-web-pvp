import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,MeshBuilder,Vector3} from '@babylonjs/core';
import {RenderingGroup} from '@babylonjs/core/Rendering/renderingGroup.js';
import {compareNativeTransparentSubMeshes,setNativeSequenceRenderOrder,nativeSequenceRenderOrder} from '../../apps/web/native-sequence-render-order.mjs';

test('real Babylon submeshes retain a whole native sequence despite crossing mesh bounds',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const make=(name,z)=>{const m=MeshBuilder.CreatePlane(name,{},scene);m.alphaIndex=14;m.position.z=z;m.computeWorldMatrix(true);return m;};
    const farFirst=make('far-first',1),farSecond=make('far-second',20),near=make('near',10);
    const camera=[0,0,0];
    setNativeSequenceRenderOrder([farFirst],{emitterId:1,position:[0,0,-1500],cameraPosition:camera,particleOrder:1});
    setNativeSequenceRenderOrder([farSecond],{emitterId:1,position:[0,0,-1500],cameraPosition:camera,particleOrder:2});
    setNativeSequenceRenderOrder([near],{emitterId:2,position:[0,0,-500],cameraPosition:camera,particleOrder:3});
    const submeshes=[farFirst,farSecond,near].map(m=>{const s=m.subMeshes[0];s._alphaIndex=m.alphaIndex;s._distanceToCamera=Vector3.Distance(s.getBoundingInfo().boundingSphere.centerWorld,Vector3.Zero());return s;});
    assert.deepEqual([...submeshes].sort(RenderingGroup.defaultTransparentSortCompare).map(s=>s.getMesh().name),['far-second','near','far-first'],'old particle bounds split and reverse the sequence');
    assert.deepEqual([...submeshes].sort(compareNativeTransparentSubMeshes).map(s=>s.getMesh().name),['far-first','far-second','near']);
    assert.equal(nativeSequenceRenderOrder(farFirst).distance,15);
    assert.equal(nativeSequenceRenderOrder(near).distance,5);
  }finally{scene.dispose();engine.dispose();}
});

test('sequence list order, repeated mesh draws and children remain consecutive',()=>{
  const make=(name)=>({name,uniqueId:100,alphaIndex:13});
  const camera=[0,0,0],position=[0,0,0];
  const rows=[];
  for(const particleOrder of [2,1])for(const drawOrder of [1,0]){
    const children=[make(`${particleOrder}:${drawOrder}:0`),make(`${particleOrder}:${drawOrder}:1`)];
    setNativeSequenceRenderOrder(children,{emitterId:7,position,cameraPosition:camera,particleOrder,drawOrder});
    for(const m of children)rows.push({_alphaIndex:13,_distanceToCamera:99,getMesh:()=>m});
  }
  assert.deepEqual(rows.reverse().sort(compareNativeTransparentSubMeshes).map(s=>s.getMesh().name),['1:0:0','1:0:1','1:1:0','1:1:1','2:0:0','2:0:1','2:1:0','2:1:1']);
});

test('layer priority, native emitter movement and ordinary map ordering are preserved',()=>{
  const mesh={uniqueId:1},other={uniqueId:2};
  const a={_alphaIndex:13,_distanceToCamera:2,getMesh:()=>mesh},b={_alphaIndex:14,_distanceToCamera:99,getMesh:()=>other};
  setNativeSequenceRenderOrder([mesh],{emitterId:1,position:[100,0,0],cameraPosition:[0,0,0]});
  assert.ok(compareNativeTransparentSubMeshes(a,b)<0);
  b._alphaIndex=13;assert.ok(compareNativeTransparentSubMeshes(a,b)>0);
  setNativeSequenceRenderOrder([mesh],{emitterId:1,position:[10000,0,0],cameraPosition:[0,0,0]});
  assert.ok(compareNativeTransparentSubMeshes(a,b)<0);
  assert.throws(()=>setNativeSequenceRenderOrder([mesh],{emitterId:1,position:[NaN,0,0],cameraPosition:[0,0,0]}),/Non-finite/);
});
