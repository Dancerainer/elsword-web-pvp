/** Bounded exclusions for generator outputs in the current RF runtime.
 * This is independent of particle density. Original artifacts stay intact;
 * preparation may omit a path only after the required proof is supplied. */
const standaloneAnimation=/^rf\/(?:effects|fx\/meshes|archenemy-fx-v17\/meshes|landing-fx\/meshes)\/[^/]+\.animation\.json$/;
const metadataOnly=Object.freeze({
  'rf/rf_preview.png':'Generator preview; no runtime image consumer',
  'rf/outputs.json':'Generator output inventory; no runtime fetch consumer',
  'rf/native-motion.json.gz':'Generator native motion dump; runtime uses runtime-pose.json and GM inspector uses pose-tracks.json.gz',
});
export function animationSidecarEmbeddedInPose(animation,pose){
  if(!Array.isArray(animation)||!Array.isArray(pose?.clips)||animation.length!==pose.clips.length)return false;
  const fields=clip=>({name:clip.name,ticks_per_second:clip.ticks_per_second,tracks:clip.tracks});
  // Pose documents have additional authored/native clock metadata. Compare
  // every clip and its complete tracks; names alone are not enough evidence.
  return animation.every((clip,index)=>JSON.stringify(fields(clip))===JSON.stringify(fields(pose.clips[index])));
}
export function runtimeAssetExclusionReason(relative,{rfManifest,hasRuntimeGlb=false,animationRedundant=false}={}){
  if(relative==='rf/rf.glb'){
    return typeof rfManifest?.runtimeGlb==='string'&&rfManifest.runtimeGlb.length>0&&rfManifest.runtimeGlb!=='rf.glb'&&hasRuntimeGlb
      ?'Legacy character GLB is shadowed by the existing manifest.runtimeGlb selected by game.mjs':null;
  }
  if(Object.hasOwn(metadataOnly,relative))return metadataOnly[relative];
  if(standaloneAnimation.test(relative)&&animationRedundant)return 'Standalone animation sidecar is fully embedded in the retained companion pose JSON; runtime only loads poseData';
  return null;
}
export function isStandaloneAnimationAsset(relative){return standaloneAnimation.test(relative);}
