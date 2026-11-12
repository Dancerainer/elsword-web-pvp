import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeAssetExclusionReason,animationSidecarEmbeddedInPose} from '../../tools/runtime-asset-policy.mjs';
test('legacy RF GLB exclusion requires an existing explicitly selected replacement and retains fallback',()=>{
  assert.ok(runtimeAssetExclusionReason('rf/rf.glb',{rfManifest:{runtimeGlb:'rf-runtime.glb'},hasRuntimeGlb:true}));
  for(const options of [{},{rfManifest:{runtimeGlb:'rf-runtime.glb'}},{rfManifest:{runtimeGlb:'rf.glb'},hasRuntimeGlb:true}])
    assert.equal(runtimeAssetExclusionReason('rf/rf.glb',options),null);
});
test('animation exclusion requires every complete clip track to equal retained pose data',()=>{
  const animation=[{name:'A',ticks_per_second:4800,ticks_per_second_source:'generator',tracks:[{frame_name:'Root',values:[1,2,3]}]}];
  const pose={clips:[{...animation[0],observedClock:{source:'DLL'}}]};
  assert.equal(animationSidecarEmbeddedInPose(animation,pose),true);
  const changed=structuredClone(pose);changed.clips[0].tracks[0].values[2]=4;
  assert.equal(animationSidecarEmbeddedInPose(animation,changed),false);
  assert.equal(animationSidecarEmbeddedInPose(animation,{clips:[]}),false);
  const file='rf/effects/body.animation.json';
  assert.equal(runtimeAssetExclusionReason(file),null);
  assert.ok(runtimeAssetExclusionReason(file,{animationRedundant:true}));
  assert.equal(runtimeAssetExclusionReason('scene/body.animation.json',{animationRedundant:true}),null);
});
test('bounded generator exclusions retain collision poses, selected runtime, GM inspection, audio and maps',()=>{
  for(const file of ['rf/rf_preview.png','rf/outputs.json','rf/native-motion.json.gz'])assert.ok(runtimeAssetExclusionReason(file));
  for(const file of ['rf/effects/attack.pose.json','rf/runtime-pose.json','rf/rf-runtime.glb','rf/pose-tracks.json.gz','audio/a.ogg','scene/map/mesh.glb','rf/fx/spark.png'])
    assert.equal(runtimeAssetExclusionReason(file,{animationRedundant:true,rfManifest:{runtimeGlb:'rf-runtime.glb'},hasRuntimeGlb:true}),null);
});
