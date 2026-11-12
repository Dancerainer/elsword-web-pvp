import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine,Scene,TransformNode,Vector3,Quaternion,MeshBuilder,Animation,AnimationGroup} from '@babylonjs/core';
import {setVector3Exact,setQuaternionExact} from '../../apps/web/transform-values.mjs';
import {placeActor,sampleAnimation} from '../../apps/web/actor-presentation.mjs';

test('exact component writes preserve signed zero and every numeric value without dirtying identical vectors',()=>{
  const v=new Vector3(1,2,3),q=new Quaternion(0,-0,0,1);
  for(const values of [[1,2,3],[1,2,-0],[-0,0,Number.MIN_VALUE],[Infinity,-Infinity,NaN]]){
    setVector3Exact(v,...values);assert.deepEqual(v.asArray(),values);v._isDirty=false;
    setVector3Exact(v,...values);assert.equal(v._isDirty,false);
  }
  for(const values of [[0,-0,0,1],[-0,0,0,1],[1,2,3,4]]){
    setQuaternionExact(q,...values);assert.deepEqual(q.asArray(),values);q._isDirty=false;
    setQuaternionExact(q,...values);assert.equal(q._isDirty,false);
  }
});

test('unchanged actor root leaves descendant matrices and bounds stable, but movement and facing update exactly',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),root=new TransformNode('world',scene),mesh=MeshBuilder.CreateBox('child',{},scene);mesh.parent=root;
  try{
    let updates=0;mesh.onAfterWorldMatrixUpdateObservable.add(()=>updates++);
    const view={root,bip01:null},actor={x:200,y:300,z:0,facing:1};
    placeActor(view,actor);scene.incrementRenderId();mesh.computeWorldMatrix();const before=updates,matrix=mesh.getWorldMatrix().asArray().slice();
    for(let i=0;i<120;i++){placeActor(view,actor);scene.incrementRenderId();mesh.computeWorldMatrix();}
    assert.equal(updates,before);assert.deepEqual(mesh.getWorldMatrix().asArray(),matrix);
    placeActor(view,{...actor,x:201,facing:-1});scene.incrementRenderId();mesh.computeWorldMatrix();assert.ok(updates>before);
    assert.deepEqual(root.position.asArray(),[2.0100000000000002,3,-0]);assert.equal(root.rotation.y,Math.PI);
  }finally{scene.dispose();engine.dispose();}
});

test('constant native SRT channels do not force world updates as the original animation clock advances',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),bone=new TransformNode('bone',scene),mesh=MeshBuilder.CreateBox('mesh',{},scene);mesh.parent=bone;
  bone.rotationQuaternion=Quaternion.Identity();
  try{
    const group=new AnimationGroup('idle',scene);
    for(const [property,value,type]of [['position',new Vector3(2,3,4),Animation.ANIMATIONTYPE_VECTOR3],['scaling',new Vector3(1,1,1),Animation.ANIMATIONTYPE_VECTOR3],['rotationQuaternion',Quaternion.Identity(),Animation.ANIMATIONTYPE_QUATERNION]]){
      const animation=new Animation(property,property,60,type);animation.setKeys([{frame:0,value:value.clone()},{frame:60,value:value.clone()}]);group.addTargetedAnimation(animation,bone);
    }
    const view={clips:new Map([['idle',group]]),group:null,resetBindPose(){}};let updates=0;mesh.onAfterWorldMatrixUpdateObservable.add(()=>updates++);
    sampleAnimation(view,'idle',0,true);scene.incrementRenderId();mesh.computeWorldMatrix();const before=updates;
    for(let i=1;i<120;i++){sampleAnimation(view,'idle',i/120,true);scene.incrementRenderId();mesh.computeWorldMatrix();assert.deepEqual(bone.position.asArray(),[2,3,4]);}
    assert.equal(updates,before);assert.equal(view.sample.sourceTime,119/120);
  }finally{scene.dispose();engine.dispose();}
});
