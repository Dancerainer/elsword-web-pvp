import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceManualCameraDistance,nativeProjection,normalTrackingPoints,createCameraTrackingState,setCameraTracking,advanceCameraTracking} from '../../apps/web/camera-policy.mjs';

test('source manual farthest setting is 1500, with world step zero selected',()=>{
  assert.equal(referenceManualCameraDistance(),1500);
  assert.equal(referenceManualCameraDistance({zoomLevel:0}),1100);
  assert.equal(referenceManualCameraDistance({zoomLevel:1}),600);
  assert.equal(referenceManualCameraDistance({zoomLevel:2}),200);
  assert.equal(referenceManualCameraDistance({zoomLevel:-1,worldBase:25,worldSteps:[30,40,50]}),1555);
  assert.equal(referenceManualCameraDistance({zoomLevel:2,worldBase:25,worldSteps:[30,40,50]}),275);
  assert.equal(referenceManualCameraDistance({zoomLevel:0,modifyFrustum:false}),1200);
  assert.equal(referenceManualCameraDistance({zoomLevel:-1,modifyFrustum:false}),1500);
});
test('target projection divisor and source client aspect are independent',()=>{
  assert.deepEqual(nativeProjection({width:1920,height:1080}),{near:15,far:500000,verticalFovRadians:Math.PI/4,aspect:16/9});
  assert.equal(nativeProjection({width:0,height:0}).aspect,4/3);
});
test('normal camera follows source eye/look points and land limits without facing shake',()=>{
  const a={position:[100,200,30],land:0,dirVector:[1,0,0],facing:1,yRotationDegrees:0};
  const right=normalTrackingPoints(a);
  assert.deepEqual(right,{eye:[100,400,-1470],target:[100,400,30]});
  const left=normalTrackingPoints({...a,facing:-1,yRotationDegrees:180});
  assert.ok(Math.abs(left.eye[0]-100)<1e-10);
  assert.equal(left.eye[2],right.eye[2]);assert.deepEqual(left.target,right.target);
  assert.equal(normalTrackingPoints(a,{distance:1100}).target[1],400);
  assert.equal(normalTrackingPoints(a,{distance:1100,pvpHeightCompensation:true}).target[1],300);
  assert.equal(normalTrackingPoints(a,{distance:600}).target[1],400);
});
test('persistent native tracking retains real target distance and pauses exactly',()=>{
  const initial=createCameraTrackingState({eye:[0,200,-1500],target:[0,100,0]});
  const wanted={eye:[300,200,-1500],target:[300,100,0]};
  const tracking=setCameraTracking(initial,wanted);
  const next=advanceCameraTracking(tracking,.1);
  assert.deepEqual(next.eye,[100,200,-1500]);assert.deepEqual(next.target,[100,100,0]);
  assert.deepEqual(advanceCameraTracking(next,0),next);
  assert.deepEqual(initial.eye,[0,200,-1500]);
  const again=advanceCameraTracking(setCameraTracking(next,wanted),.1);
  assert.ok(Math.abs(again.target[0]-166.66666666666669)<1e-12);
  assert.equal(again.eye[2]-again.target[2],-1500);
});
test('one long native UpdateCamera step is not clamped to remaining track time',()=>{
  const initial=createCameraTrackingState({eye:[0,0,0],target:[0,0,100]});
  const next=advanceCameraTracking(setCameraTracking(initial,{eye:[300,0,0],target:[300,0,100]}),.4);
  assert.deepEqual(next.eye,[400,0,0]);assert.deepEqual(next.target,[400,0,100]);assert.equal(next.remaining,0);
});
test('separate target timer uses Time for velocity, matching SetTracking source',()=>{
  const s=createCameraTrackingState({eye:[0,0,0],target:[0,0,100]});
  const next=advanceCameraTracking(setCameraTracking(s,{eye:[300,0,0],target:[600,0,100]},{seconds:.3,targetSeconds:.1}),.1);
  assert.equal(next.eye[0],100);assert.equal(next.target[0],200);assert.equal(next.targetRemaining,0);
});
