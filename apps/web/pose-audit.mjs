import { createPoseLibrary, samplePose, compose, consumesRootTranslation, mapClipTime, resolveControllerPose } from '../../tools/assets/character/sample_pose.mjs';
import {actorWorldQuaternion} from '../../packages/combat-assets/line-basis.mjs';

/** Independent decoded native tracks versus the pose AFTER Babylon renders.
 * This checks conversion/playback, not the unmeasured original-client rules. */
export function createPoseAudit(document,{map,useDisplayedRoot=false}={}) {
  const library = createPoseLibrary(document);
  const durations = new Map([...library.clips].map(([name,clip])=>[name,clip.durationSeconds]));
  return (view, actor, scale = .01) => {
    const selected = view.sample;
    if (!selected) return { supported: false, reason: 'no-sampled-clip' };
    const name = actor.animationName ?? selected.name, time = actor.animationTime ?? selected.sourceTime;
    const duration = durations.get(name), loop = actor.animationLoop ?? selected.loop;
    if (duration === undefined) return { supported: false, reason: 'missing-source-clip', clip: name };
    const seconds = mapClipTime(time,duration,loop,library.clips.get(name).nativePlaybackField??null);
    const pose=resolveControllerPose({animationName:name,animationTime:time,animationLoop:loop,
      presentationTransition:actor.presentationTransition??selected.originalTransition},n=>durations.get(n),n=>library.clips.get(n)?.nativePlaybackField);
    // Core views have a separate helper scale and three-axis steering root.
    // Audit their independent source tracks under that same displayed root;
    // the ordinary actor placement oracle is unchanged. This does not verify
    // the original client's dynamic root/steering policy.
    let worldMatrix;
    if(useDisplayedRoot){
      if(!(scale>0&&Number.isFinite(scale)))throw Error('Positive pose audit unit scale required');
      worldMatrix=Array.from(view.root.computeWorldMatrix(true).asArray(),(value,index)=>{
        const row=index%4,column=Math.floor(index/4);
        return value*(row===2?-1:1)*(column===2?-1:1)/(row<3?scale:1);
      });
    }else worldMatrix=compose([actor.x,actor.y,actor.z],[1,1,1],actorWorldQuaternion(actor,map));
    const native = samplePose(library, pose.clipName, pose.timeSeconds, {
      transition:pose.transition,
      rootTranslationOverride: consumesRootTranslation(actor) ? [0, null, 0] : null,
      worldMatrix,
    });
    const nodes = new Map(view.root.getDescendants().map(n => [n.name.slice(view.id.length + 1), n]));
    let maximumErrorNative = 0, worstNode = null, comparedNodes = 0;
    const missing = [];
    for (const [name, matrix] of native) {
      const node = nodes.get(name);
      if (!node) { missing.push(name); continue; }
      const actual = node.getWorldMatrix().asArray();
      for (let index = 0; index < 16; index++) {
        const row = index % 4, column = Math.floor(index / 4);
        const expected = matrix[index] * (row === 2 ? -1 : 1) * (column === 2 ? -1 : 1) * (row < 3 ? scale : 1);
        const difference = Math.abs(actual[index] - expected) / (row < 3 ? scale : 1);
        if (!Number.isFinite(difference)) throw Error('Non-finite rendered pose: ' + name);
        if (difference > maximumErrorNative) { maximumErrorNative = difference; worstNode = name; }
      }
      comparedNodes++;
    }
    return { supported: missing.length === 0 && selected.name === name, clip: name, seconds,
      sampledClip: selected.name, clockDifferenceSeconds: Math.abs(seconds - selected.seconds),
      comparedNodes, maximumErrorNative, worstNode, missing,
      worldTransform:useDisplayedRoot?'displayed-root':'authored-actor',
      referenceFrame:useDisplayedRoot?'source-local-tracks-under-displayed-root':'authored-actor-world',
      transition: selected.transition ?? null,
      purpose:useDisplayedRoot
        ?'Original local SRT tracks under the current displayed root; native core root position, scale and steering policy are not verified by this comparison.'
        :'source-key conversion/display with original-DLL interpolation probes; full native-client behavior unmeasured' };
  };
}
