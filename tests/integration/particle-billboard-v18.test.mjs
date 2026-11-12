import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core';
import {nativeBillboardRotationToRef} from '../../apps/web/particle-billboard.mjs';

// Independent scalar rotation, following the original GetMatrix row-vector
// order: local roll -> pitch -> yaw, then billboard rotation. No renderer
// quaternion/matrix implementation generates the expected coordinates.
const turn=(v,[pitch,yaw,roll])=>{
 const [x,y,z]=[pitch,yaw,roll].map(a=>a*Math.PI/180),[a,b,c]=v;
 const rx=a*Math.cos(z)-b*Math.sin(z),ry=a*Math.sin(z)+b*Math.cos(z);
 const py=ry*Math.cos(x)-c*Math.sin(x),pz=ry*Math.sin(x)+c*Math.cos(x);
 return [rx*Math.cos(y)+pz*Math.sin(y),py,-rx*Math.sin(y)+pz*Math.cos(y)];
};
const close=(actual,expected)=>actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<2e-6,`${actual} vs ${expected}`));
for(const camera of [[0,0,0],[13,27,-9],[-22,157,11]])for(const angles of [[0,0,0],[0,0,90],[18,36,123]])
test(`BT_ALL keeps local rotation before view transpose: camera ${camera}, local ${angles}`,()=>{
 const world=Quaternion.RotationYawPitchRoll(camera[1]*Math.PI/180,camera[0]*Math.PI/180,camera[2]*Math.PI/180);
 const view=Matrix.Identity();Matrix.FromQuaternionToRef(world,view);view.transposeToRef(view);
 const transposed=Matrix.Identity();view.transposeToRef(transposed);
 const billboard=Quaternion.FromRotationMatrix(transposed),result=new Quaternion();
 for(const reverse of [false,true]){
  nativeBillboardRotationToRef(billboard,angles,reverse,result,new Quaternion());
  const matrix=Matrix.Identity();Matrix.FromQuaternionToRef(result,matrix);
  const v=[1.25,-.75,.25],renderLocal=[-angles[0],-(angles[1]+(reverse?180:0)),angles[2]];
  close(Vector3.TransformCoordinates(Vector3.FromArray(v),matrix).asArray(),turn(turn(v,renderLocal),camera));
 }
});
