import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditCamera} from '../../tools/audit-rf-camera-v14.mjs';
import {instantiateNativeCamera} from '../../packages/native-source/camera.mjs';
import {advanceNormalCamera} from '../../apps/web/camera-follow.mjs';

test('60/90/120/144/165Hz shared display samples preserve native tracking and quantify viewport lag',async()=>{
  const {report}=await auditCamera();
  assert.equal(report.targetClientMeasured,false);
  assert.equal(report.sameDisplayedActorWiring,true);
  assert.deepEqual(report.rows.map(r=>r.hz),[60,90,120,144,165]);
  for(const row of report.rows)assert.deepEqual(row.metrics.v14Native,row.metrics.v12Native);
  for(const frame of report.impulses){
    assert.ok(Math.abs(frame.v14BackgroundFirstFramePixels)<Math.abs(frame.v13BackgroundFirstFramePixels)/10);
    assert.equal(frame.v13TrackingSeconds,0);assert.ok(frame.v14TrackingSeconds>0);
  }
});

test('all-axis tracking keeps original zero elapsed/overrun semantics and ignores a stale direct configuration',async()=>{
  const bytes=readFileSync(new URL('../../artifacts/native/camera.wasm',import.meta.url));
  const bridge=await instantiateNativeCamera(bytes),origin={eye:[0,0,1500],target:[0,100,0]};
  const policy={trackingSeconds:.3,targetTrackingSeconds:0,horizontalFollow:'direct'};
  let state=advanceNormalCamera(bridge,origin,policy,0,null);
  const points={eye:[300,0,1500],target:[300,100,0]};
  state=advanceNormalCamera(bridge,points,policy,0,state);
  assert.deepEqual(state.eye,origin.eye);assert.deepEqual(state.target,origin.target);
  assert.equal(state.eyeSeconds,Math.fround(.3));
  state=advanceNormalCamera(bridge,points,policy,.4,state);
  // Independent binary32 parsing of the original divide/multiply, rather
  // than writing the rounded decimal 400 as if .3 were exactly representable.
  const displacement=Math.fround(Math.fround(300/Math.fround(.3))*Math.fround(.4));
  assert.deepEqual(state.eye,[displacement,0,1500]);assert.deepEqual(state.target,[displacement,100,0]);
  assert.equal(state.eyeSeconds,0,'original UpdateCamera consumes whole dt without a guessed clamp');
});
