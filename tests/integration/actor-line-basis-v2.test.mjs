import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createNativeSamplers} from '../../packages/combat-assets/index.mjs';
import {actorWorldQuaternion,authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';
import {createPoseLibrary,samplePose,transform} from '../../tools/assets/character/sample_pose.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createActorView,sampleAnimation,placeActor} from '../../apps/web/actor-presentation.mjs';
import {createPoseAudit} from '../../apps/web/pose-audit.mjs';

const root=new URL('../../',import.meta.url),json=file=>JSON.parse(readFileSync(new URL(file,root)));
const runtime=json('artifacts/rf/runtime-pose.json');
// Full unpruned original-key skeleton is an independent input from the runtime
// helper subset. Expected world points below use analytic XZ geometry, not
// the new quaternion/basis helper or sampler world-matrix implementation.
const source=createPoseLibrary(JSON.parse(gunzipSync(readFileSync(new URL('artifacts/rf/pose-tracks.json.gz',root)))));
const ship=json('artifacts/scene/besma-air-ship-pvpmap/collision.json');
const corridor=json('artifacts/scene/peita-spiral-corridor-pvp/collision.json');
const straight=json('artifacts/scene/sander-garpai-rock-pvp/collision.json');
const sampler=map=>createNativeSamplers({characterPose:runtime,effectIndex:{templates:{}},effectPoses:{},profile:{},map});
const near=(actual,expected,epsilon=1e-8)=>actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<=epsilon,`${i}: ${value} != ${expected[i]}`));
const actor=(overrides={})=>({id:'authored-lane-pose',lineId:14,lastTouchLineId:14,facing:1,x:2020,y:960,z:200,
  animationName:'ComboZ1',animationTime:.12,animationLoop:false,consumeRootTranslation:true,...overrides});
function expectedWorldPoint(local,a,map){
  const line=map.lines.find(line=>line.lineId===(a.lineId??a.lastTouchLineId));
  const dx=line.end[0]-line.start[0],dz=line.end[2]-line.start[2],length=Math.hypot(dx,dz),nx=dx/length,nz=dz/length;
  return [a.x+a.facing*(nx*local[0]-nz*local[2]),a.y+local[1],a.z+a.facing*(nz*local[0]+nx*local[2])];
}
function localPose(a){return samplePose(source,a.animationName,a.animationTime,{rootTranslationOverride:[0,null,0]});}

test('real RF attack/defender helpers and named bone anchors share authored diagonal world placement',()=>{
  const currentSampler=sampler(ship);
  for(const facing of [-1,1])for(const [animationName,animationTime] of [['Wait',.2],['ComboZ1',.12],['SI_A_RRF_HELL_DIVE',.8]]){
    const current=actor({facing,animationName,animationTime}),local=localPose(current);
    const attacks=currentSampler.collisionSampler(current,{raw:{}}),defenders=currentSampler.defenderSampler(current);
    assert.ok(attacks.length>0&&defenders.length>0);
    for(const shape of [...attacks,...defenders]){
      near(shape.center??shape.start,expectedWorldPoint(transform(local.get(shape.source.helper),[0,0,0]),current,ship));
      if(shape.kind==='line'){
        const endName=shape.source.helper.replace(/START(\d+)(?:_.+)?$/,'END$1');
        near(shape.end,expectedWorldPoint(transform(local.get(endName),[0,0,0]),current,ship));
      }
    }
    for(const bone of ['Dummy2_Lhand','Bip01_Head']){
      const result=currentSampler.effectAnchorSampler({definition:{BONE_NAME:bone}},current);
      near(result.position,expectedWorldPoint(transform(local.get(bone),[0,0,0]),current,ship));
    }
    const head=currentSampler.effectAnchorSampler({definition:{BONE_NAME:'_HEAD_BONE'}},current),expected=expectedWorldPoint(transform(local.get('Bip01_Head'),[0,0,0]),current,ship);
    expected[1]+=70;near(head.position,expected);
  }
});

test('same actor clock/position on a new map basis invalidates the character pose cache; airborne keeps remembered lane',()=>{
  let map=ship;const currentSampler=sampler(()=>map),current=actor();
  const before=currentSampler.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},current).position;
  map=corridor;
  const after=currentSampler.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},current).position;
  assert.notDeepEqual(before,after,'line yaw must be part of the actor pose cache key');
  near(after,expectedWorldPoint(transform(localPose(current).get('Dummy2_Lhand'),[0,0,0]),current,map));
  near(currentSampler.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},{...current,lineId:null}).position,after);
});

test('authored +X lanes preserve exact old helper/anchor output and literal facing quaternions',()=>{
  const lineId=straight.lines[0].lineId,legacy=sampler(undefined),mapped=sampler(straight);
  for(const facing of [-1,1]){
    const current=actor({facing,lineId,lastTouchLineId:lineId});
    assert.deepEqual(actorWorldQuaternion(current,straight),facing<0?[0,1,0,0]:[0,0,0,1]);
    assert.deepEqual(mapped.collisionSampler(current,{raw:{}}),legacy.collisionSampler(current,{raw:{}}));
    assert.deepEqual(mapped.defenderSampler(current),legacy.defenderSampler(current));
    assert.deepEqual(mapped.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},current),legacy.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},current));
  }
});

test('actual server per-scene runtime uses the assigned map for actor helper transforms',async()=>{
  const assets=await loadServerCombatAssets({root:fileURLToPath(root),assetRoot:fileURLToPath(new URL('artifacts/',root))});
  for(const sceneId of ['besma-air-ship-pvpmap','peita-spiral-corridor-pvp']){
    const selected=assets.forScene(sceneId),{samplers}=await selected.createRuntime(),current=actor({animationName:'Wait',animationTime:.2});
    near(samplers.effectAnchorSampler({definition:{BONE_NAME:'Dummy2_Lhand'}},current).position,
      expectedWorldPoint(transform(localPose(current).get('Dummy2_Lhand'),[0,0,0]),current,selected.map));
  }
});

test('converted RF display pose on an authored diagonal agrees with complete native source pose audit',async()=>{
  const engine=new NullEngine();engine.getCaps().maxVertexUniformVectors=1024;
  const scene=new Scene(engine);scene.useRightHandedSystem=true;scene.skipFrustumClipping=true;
  new FreeCamera('test',new Vector3(0,0,10),scene);
  try{
    const container=await loadPoseContainer(scene,fileURLToPath(new URL('artifacts/rf/rf-runtime.glb',root)));
    const view=createActorView(container,scene,'lane-display',.01,runtime),audit=createPoseAudit(runtime,{map:ship});
    for(const facing of [-1,1]){
      const current=actor({facing});sampleAnimation(view,current.animationName,current.animationTime,false);
      placeActor(view,current,.01);view.root.rotation.y=authoredLineBasis(current,ship).rendererYawRadians;
      scene.render();
      const result=audit(view,current,.01);
      assert.equal(result.supported,true);assert.ok(result.maximumErrorNative<.001,JSON.stringify(result));
    }
    view.dispose();container.dispose();
  }finally{scene.dispose();engine.dispose();}
});
