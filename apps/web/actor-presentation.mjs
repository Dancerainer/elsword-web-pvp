import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import { cloneWithFreshMaterialUpdates } from './clone-material-updates.mjs';
import {setVector3Exact,setQuaternionExact} from './transform-values.mjs';
import { createPoseLibrary, sampleChannel, sampleChannelToRef, nativeQuaternionNlerpToRef, consumesRootTranslation, sampleTransitionTrack, resolveControllerPose, mapClipTime } from '../../tools/assets/character/sample_pose.mjs';

const sourceLibraries=new WeakMap();
const animationChannels=new WeakMap();

/** Preserved glTF SRT keys, evaluated with the shipped D3DX interpolation.
 * No axis conversion here: converted glTF values already use render axes. */
export function evaluateNativeAnimation(animation,seconds) {
  if(!Number.isFinite(seconds))throw Error('Non-finite native animation time');
  const property=animation.targetProperty;
  if(!['position','scaling','rotationQuaternion'].includes(property))throw Error('Unsupported native animation property: '+property);
  let channel=animationChannels.get(animation);
  if(!channel){
    if(!(animation.framePerSecond>0))throw Error('Invalid native animation frame rate');
    const keys=animation.getKeys();
    channel={times:keys.map(k=>k.frame/animation.framePerSecond),values:keys.map(k=>k.value.asArray())};
    animationChannels.set(animation,channel);
  }
  const value=sampleChannel(channel,seconds,property==='rotationQuaternion');
  return property==='rotationQuaternion'?Quaternion.FromArray(value):Vector3.FromArray(value);
}

/** The combat clock owns every pose. Complete SRT groups sample original keys
 * directly, without creating Babylon animatables or substituting its SLERP. */
export function createActorView(container, scene, id, scale = .01, sourcePose = null) {
  for (const group of container.animationGroups) group.stop();
  // Babylon 9.29 instantiateModelsToScene(cloneMaterials=true) synchronously
  // constructs clones. Scene.addMaterial/addMultiMaterial/addTexture/
  // addMorphTargetManager append them; this path removes no scene resources.
  // Material notifications are deferred, so observe the appended tails rather
  // than notifications or rescanning an ever-growing scene for every FX view.
  const materialStart=scene.materials.length,multiStart=scene.multiMaterials.length;
  const textureStart=scene.textures.length,morphStart=scene.morphTargetManagers.length;
  const clone = cloneWithFreshMaterialUpdates(container, scene,
    () => container.instantiateModelsToScene(name => id + '_' + name, true, { doNotInstantiate: true }));
  // A source resource registered during cloning is still shared. Exclude
  // container identities, including render targets and source morph managers.
  const sourceMaterials=new Set([...container.materials,...container.multiMaterials]);
  const sourceTextures=new Set(container.textures),sourceMorphs=new Set(container.morphTargetManagers);
  const ownedMaterials=[...scene.materials.slice(materialStart),...scene.multiMaterials.slice(multiStart)].filter(item=>!sourceMaterials.has(item));
  const ownedTextures=scene.textures.slice(textureStart).filter(item=>!sourceTextures.has(item));
  const ownedMorphs=scene.morphTargetManagers.slice(morphStart).filter(item=>!sourceMorphs.has(item));
  const root = new TransformNode(id + '-world', scene); root.scaling.setAll(scale);
  for (const node of clone.rootNodes) node.parent = root;
  for (const group of clone.animationGroups) group.stop();
  const prefix = id + '_';
  const clips = new Map(clone.animationGroups.map(group => [group.name.slice(prefix.length), group]));
  const sourceDurations = new Map((sourcePose?.clips || []).map(clip => [clip.name,
    clip.durationSeconds ?? Math.max(...clip.tracks.flatMap(track => ['translation', 'rotation', 'scale'].map(k => track[k].times.at(-1))))]));
  const targets = [...new Set(clone.animationGroups.flatMap(group => group.targetedAnimations.map(a => a.target)))];
  const bindPose = targets.map(target => ({ target,
    position: target.position?.clone(), scaling: target.scaling?.clone(),
    rotationQuaternion: target.rotationQuaternion?.clone(), rotation: target.rotation?.clone(),
  }));
  const bip01 = scene.getTransformNodeByName(prefix + 'Bip01');
  let sourceLibrary=sourcePose&&sourceLibraries.get(sourcePose);
  if(sourcePose&&!sourceLibrary){sourceLibrary=createPoseLibrary(sourcePose);sourceLibraries.set(sourcePose,sourceLibrary);}
  const view = { id, root, bip01, groups: clone.animationGroups, skeletons: clone.skeletons,
    meshes: root.getChildMeshes(), clips, sourceDurations, sourcePlayback: new Map((sourcePose?.clips||[]).map(c=>[c.name,c.nativePlaybackField])),
    frameRates: new Map(), group: null, missing: new Set(), sample: null,
    bindPose, blendPose: bindPose.map(pose => ({target:pose.target,position:pose.position?.clone(),
      scaling:pose.scaling?.clone(),rotationQuaternion:pose.rotationQuaternion?.clone()})), channelBindings:new Map(),nativeBindings:new Map(),sourceLibrary };
  // Identity proof for the optional FX-only material traversal adapter. Actor
  // and costume views do not install it; disposal still owns this same array.
  Object.defineProperty(view,'ownedMaterials',{value:ownedMaterials,enumerable:false});
  view.nodesBySourceName = new Map(root.getDescendants().map(node => [node.name.slice(prefix.length), node]));
  view.resetBindPose = () => {
    for (const pose of bindPose) {
      if (pose.position) pose.target.position.copyFrom(pose.position);
      if (pose.scaling) pose.target.scaling.copyFrom(pose.scaling);
      if (pose.rotationQuaternion) pose.target.rotationQuaternion.copyFrom(pose.rotationQuaternion);
      if (pose.rotation) pose.target.rotation.copyFrom(pose.rotation);
    }
  };
  view.disposed = false;
  view.dispose = () => {
    if (view.disposed) return;
    view.disposed = true;
    view.costume?.dispose(); view.costume = null;
    view.core?.dispose(); view.core = null;
    // Babylon's entries disposer owns nodes, skeletons and animation groups,
    // but omits the cloned materials/textures and our world transform.
    clone.dispose(); root.dispose();
    for (const material of ownedMaterials) material.dispose(false, false);
    for (const texture of ownedTextures) texture.dispose();
    for (const manager of ownedMorphs) manager.dispose();
    for (const map of [clips, sourceDurations, view.sourcePlayback, view.frameRates, view.channelBindings,
      view.nativeBindings, view.nodesBySourceName]) map.clear();
    view.meshes.length = 0; bindPose.length = 0; view.blendPose.length = 0; view.missing.clear();
    view.group = null; view.sample = null; view.bip01 = null; view.sourceLibrary = null; view.transitionQuaternionScratch = null;
    ownedMaterials.length = 0; ownedTextures.length = 0; ownedMorphs.length = 0;
  };
  return view;
}

function clipTiming(view, name, time, loop, holdFinalFrame=false) {
  const group = view.clips.get(name);
  if(!group)return null;
  view.frameRates??=new Map();
  let fps=view.frameRates.get(name);
  if(fps==null){fps=group.targetedAnimations[0]?.animation.framePerSecond;
    if (!(fps > 0) || group.targetedAnimations.some(a => a.animation.framePerSecond !== fps))throw Error('Unsupported animation frame rate: ' + name);
    view.frameRates.set(name,fps);}
  const duration = view.sourceDurations?.get(name) ?? (group.to - group.from) / fps;
  if (!Number.isFinite(duration) || duration < 0) throw Error('Invalid source clip duration: ' + name);
  const seconds = mapClipTime(time,duration,loop,holdFinalFrame?1:view.sourcePlayback?.get(name)??null);
  return {group,frame:group.from+seconds*fps,seconds,duration};
}

// ChangeAnim keys old track speed/weight linearly to zero over D. The integral
// of old speed is v*(e-e²/(2D)); this source clock is frozen by the core, not RAF.
export function transitionSample(view, transition) {
  const track=sampleTransitionTrack(transition,name=>clipTiming(view,name,0,false)?.duration,name=>view.sourcePlayback?.get(name));
  if(!track)return null;
  const old=clipTiming(view,track.clipName,track.timeSeconds,false);
  return {...transition,oldSeconds:old.seconds,oldFrame:old.frame,weight:track.weight,
    oldWeight:track.oldWeight,newWeight:track.newWeight,zeroTotalWeight:track.zeroTotalWeight};
}

function nativeBindings(view,name) {
  view.nativeBindings??=new Map();let bindings=view.nativeBindings.get(name);if(bindings)return bindings;
  const clip=view.sourceLibrary?.clips.get(name),prefix=view.id?view.id+'_':'';
  bindings=view.clips.get(name).targetedAnimations.map(({target,animation})=>{
    const property=animation.targetProperty,key={position:'translation',scaling:'scale',rotationQuaternion:'rotation'}[property];
    if(!key)return {target,animation,property,channel:null};
    const source=clip?.tracks.get(target.name.slice(prefix.length))?.[key];
    const channel=source??{times:animation.getKeys().map(k=>k.frame/animation.framePerSecond),values:animation.getKeys().map(k=>k.value.asArray())};
    return {target,animation,property,channel,source:Boolean(source),sampleValue:new Float64Array(property==='rotationQuaternion'?4:3)};
  });view.nativeBindings.set(name,bindings);return bindings;
}
function nativeValue(binding,seconds) {
  const value=sampleChannelToRef(binding.channel,seconds,binding.property==='rotationQuaternion',binding.sampleValue);
  if(binding.source){
    if(binding.property==='position')value[2]*=-1;
    if(binding.property==='rotationQuaternion'){value[0]*=-1;value[1]*=-1;}
  }
  return value;
}
function sampleNativeGroup(view,name,seconds,frame) {
  const bindings=nativeBindings(view,name);
  // Complete SRT groups do not need Babylon runtime animatables. This avoids
  // both its SLERP and allocating/starting hundreds of tracks on each command.
  if(bindings.some(b=>!b.channel))view.clips.get(name).goToFrame(frame);
  for(const b of bindings)if(b.channel){const value=nativeValue(b,seconds);
    if(b.property==='rotationQuaternion')setQuaternionExact(b.target[b.property],value[0],value[1],value[2],value[3]);
    else setVector3Exact(b.target[b.property],value[0],value[1],value[2]);}
}

function applyTransition(view, transition) {
  const old=view.clips.get(transition.fromName);
  // Reset sparse old tracks to the same decoded bind pose as an ordinary clip.
  for(let i=0;i<view.bindPose.length;i++){
    const bind=view.bindPose[i],value=view.blendPose[i];
    for(const property of ['position','scaling','rotationQuaternion'])if(bind[property])value[property].copyFrom(bind[property]);
  }
  let channels=view.channelBindings.get(old);
  if(!channels){const byTarget=new Map(view.blendPose.map(pose=>[pose.target,pose]));
    channels=nativeBindings(view,transition.fromName).map(binding=>{
      const {target,animation}=binding;
      const pose=byTarget.get(target),property=animation.targetProperty;
      if(!pose||!['position','scaling','rotationQuaternion'].includes(property))throw Error('Unsupported transition channel: '+property);
      return {...binding,animation,pose,property};});view.channelBindings.set(old,channels);}
  for(const binding of channels){const value=nativeValue(binding,transition.oldSeconds);
    if(binding.property==='rotationQuaternion')binding.pose[binding.property].set(value[0],value[1],value[2],value[3]);
    else binding.pose[binding.property].set(value[0],value[1],value[2]);}
  const scratch=view.transitionQuaternionScratch??={left:new Float64Array(4),right:new Float64Array(4),result:new Float64Array(4)};
  for(const pose of view.blendPose){
    const target=pose.target;
    if(pose.position)Vector3.LerpToRef(pose.position,target.position,transition.weight,target.position);
    if(pose.scaling)Vector3.LerpToRef(pose.scaling,target.scaling,transition.weight,target.scaling);
    if(pose.rotationQuaternion){
      const a=pose.rotationQuaternion,b=target.rotationQuaternion;
      scratch.left[0]=a.x;scratch.left[1]=a.y;scratch.left[2]=a.z;scratch.left[3]=a.w;
      scratch.right[0]=b.x;scratch.right[1]=b.y;scratch.right[2]=b.z;scratch.right[3]=b.w;
      const value=nativeQuaternionNlerpToRef(scratch.left,scratch.right,transition.weight,scratch.result);
      target.rotationQuaternion.set(value[0],value[1],value[2],value[3]);
    }
  }
}

export function sampleAnimation(view, name, time, loop = false, transition = null, holdFinalFrame = false) {
  if (!Number.isFinite(time)) throw Error('Non-finite animation time: ' + name);
  const clampPresentation=holdFinalFrame||transition?.fromPresentation===true;
  const playback=n=>clampPresentation?1:view.sourcePlayback?.get(n);
  const logicalTiming=clipTiming(view,name,time,loop,holdFinalFrame);if(!logicalTiming)return false;
  const controllerPose=resolveControllerPose({animationName:name,animationTime:time,animationLoop:loop,presentationTransition:transition},
    n=>clipTiming(view,n,0,false)?.duration,playback);
  const timing=clipTiming(view,controllerPose.clipName,controllerPose.timeSeconds,false,clampPresentation);
  const {group,frame,duration,seconds}=timing;
  if (view.group !== group) {
    view.group?.stop(); view.resetBindPose(); view.group = group;
    if(nativeBindings(view,controllerPose.clipName).some(b=>!b.channel)){group.start(false,1);group.pause();}
  }
  // Preserve the exact source period. Float32 glTF key times can otherwise wrap
  // a looping clip just before the simulation's original KAC period ends.
  const blend=controllerPose.transition?{fromName:controllerPose.transition.clipName,
    oldSeconds:controllerPose.transition.timeSeconds,weight:controllerPose.transition.weight,
    oldWeight:controllerPose.transition.oldWeight,newWeight:controllerPose.transition.newWeight}:null;
  // Resample the new pose before each blend, even when hitstop freezes its frame:
  // interpolating an already mixed node repeatedly would drift toward the old pose.
  const resample=blend||view.sample?.transition||view.sample?.poseClipName!==controllerPose.clipName||view.sample.frame!==frame;
  if(resample)sampleNativeGroup(view,controllerPose.clipName,seconds,frame);
  if(blend)applyTransition(view,blend);
  // Shipped D3DX controller normalizes the final output even when GetSRT
  // returns an exact raw nonunit key. Do this after the old/new raw blend.
  if(resample||blend)for(const pose of view.bindPose??nativeBindings(view,controllerPose.clipName))pose.target.rotationQuaternion?.normalize();
  // placeActor clears consumed root X/Z in-place. Keep the sampled source root
  // so repeated frozen seeks/raw inspection cannot accidentally reuse that zero.
  const rootTranslation=resample?view.bip01?.position.asArray():view.sample?.rootTranslation;
  view.sample = { name, sourceTime:time,seconds:logicalTiming.seconds,frame,duration:logicalTiming.duration,loop,paused:!group.isPlaying,
    transition:blend,rootTranslation,poseClipName:controllerPose.clipName,poseSeconds:seconds,retainedPose:controllerPose.retained,originalTransition:transition };
  return true;
}

/** DrawCount repeats one native mesh player's sampled pose. Effect copies use
 * the same original model and clock; interpolate once, then copy the complete
 * sampled SRT to their independent nodes. No transform/clock storage is shared.
 * Ordinary actors and differently authored models are never accepted here. */
export function copySampledAnimation(source,target){
  if(!source.sourceLibrary||source.sourceLibrary!==target.sourceLibrary||source.bindPose.length!==target.bindPose.length)return false;
  const groupName=source.sample?.poseClipName;
  if(groupName&&nativeBindings(source,groupName).some(binding=>!binding.channel))return false;
  for(let i=0;i<source.bindPose.length;i++){
    const from=source.bindPose[i].target,to=target.bindPose[i].target;
    for(const property of ['position','scaling','rotationQuaternion','rotation'])if(from[property]&&to[property]){
      const value=from[property];
      if(property==='rotationQuaternion')setQuaternionExact(to[property],value.x,value.y,value.z,value.w);
      else setVector3Exact(to[property],value.x,value.y,value.z);
    }
  }
  const group=groupName?target.clips.get(groupName):null;
  if(target.group!==group){target.group?.stop();target.group=group;}
  target.sample=source.sample?{...source.sample,rootTranslation:source.sample.rootTranslation?[...source.sample.rootTranslation]:source.sample.rootTranslation}:null;
  return true;
}

export function placeActor(view, actor, scale = .01, rendererYaw = actor.facing > 0 ? 0 : Math.PI) {
  setVector3Exact(view.root.position,actor.x * scale, actor.y * scale, -actor.z * scale);
  if(!Object.is(view.root.rotation.y,rendererYaw))view.root.rotation.y=rendererYaw;
  // SkinAnim always extracts/clears move-bone X/Z. APPLY_ANIM_MOVE only gates
  // addition of that offset to User position; it does not disable extraction.
  if(view.bip01){
    const consumed=consumesRootTranslation(actor),raw=view.sample?.rootTranslation;
    if(consumed){view.bip01.position.x=0;view.bip01.position.z=0;}
    else if(raw){view.bip01.position.x=raw[0];view.bip01.position.z=raw[2];}
  }
}

/** Source-named points from the sampled display pose. Refresh the hierarchy so
 * trails can read this frame after placeActor and before scene.render(). */
export function getActorNativePoints(view, names, scale=.01) {
  if(!(scale>0)||!Number.isFinite(scale))throw Error('Invalid native render scale');
  const points=new Map();
  for(const name of names){
    const node=view.nodesBySourceName?.get(name);if(!node)continue;
    const matrix=node.computeWorldMatrix(true).asArray();
    points.set(name,[matrix[12]/scale,matrix[13]/scale,-matrix[14]/scale]);
  }
  return points;
}
