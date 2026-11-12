import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instantiateNativeCamera} from '../../packages/native-source/camera.mjs';
import {advanceNormalCamera} from '../../apps/web/camera-follow.mjs';
const bytes=readFileSync(new URL('../../artifacts/native/camera.wasm',import.meta.url));
test('normal follow preserves all native axes, velocities, timers and sinks without a Point override',async()=>{
  for(const direction of [-1,1]){
    const follow=await instantiateNativeCamera(bytes),reference=await instantiateNativeCamera(bytes);
    const p={eye:[0,200,-1500],target:[0,100,0]},policy={trackingSeconds:.3,targetTrackingSeconds:0,horizontalFollow:'nativeTracking'};
    let state=advanceNormalCamera(follow,p,policy,0,null);reference.init(p);
    for(let i=1;i<=120;i++){
      const points={eye:[direction*i*20,200+i,-1500],target:[direction*i*20,100+i,0]};
      reference.setTracking({...points,eyeSeconds:.3,targetSeconds:0});const original=reference.advance(1/60);
      state=advanceNormalCamera(follow,points,policy,1/60,state);
      assert.deepEqual(state,original);
      assert.notEqual(state.eye[0],points.eye[0]);
      assert.ok(state.eyeSeconds>0,'source track stays live after each frame');
    }
  }
});
