import {multiply,resolveControllerPose} from '../../tools/assets/character/sample_pose.mjs';
export {nativeEffectQuaternion} from '../combat-core/archenemy-mesh.mjs';

function originalArcFailedLoopLibrary(template,library){
  const original=template?.name==='Raven_Overtaker_Flying_Impact'&&template.initialAnimation?.name==='Waiting'&&library?.clips.has('Normal');
  // Same native ChangeAnim failure/LOOP-index0 sequence. Harsh Chaser's
  // target declaration requests Normal, but its original X has one named
  // constant clip. The core's serialized controller supplies the phase;
  // this adapter never guesses a tick or substitutes an arbitrary clip.
  const sword=['HarshChaserBlade','SwordFallBlade1','SwordFallBlade2','SwordFallBlade3','SwordFallBlade4'].includes(template?.name)&&
    template.initialAnimation?.name==='Normal'&&library?.clips.has('Elsword_SisKnight_sword');
  const sheath=template?.name==='ElswordSheath02'&&template.initialAnimation?.name==='Normal'&&library?.clips.has('Elsword_SisKnight_sheath');
  const second=template?.name==='SecondBlade'&&template.initialAnimation?.name==='Normal'&&library?.clips.has('Elsword_SisKnight_sword_base');
  const prism=template?.name==='Mesh_Particle_Prism'&&template.initialAnimation?.name==='Loop'&&library?.clips.has('Normal');
  return (original||sword||sheath||second||prism)&&template.initialAnimation.playback==='XAP_LOOP'&&
    library?.clips.size===1&&!library.clips.has(template.initialAnimation.name);
}

// Waiting fails, then Play(LOOP) still executes. The first SkinAnim update
// copies bind frames and selects index0; the following update samples Normal.
// Initial DLL tracks alone do NOT prove a permanently retained bind pose.
export function arcUsesBindPose(template,library,e={}){
  return originalArcFailedLoopLibrary(template,library)&&!e.sourceArcPose?.animationName;
}
export function arcEffectPose(template,library,e){
  // A failed original AniName retains the serialized native controller even
  // when literal mesh movement independently controls its velocity/size.
  if(originalArcFailedLoopLibrary(template,library)){
    if(arcUsesBindPose(template,library,e))return {bind:true};
    return {...resolveControllerPose(e.sourceArcPose,name=>library.clips.get(name)?.durationSeconds,
      name=>library.clips.get(name)?.nativePlaybackField),controllerState:e.sourceArcPose,bind:false};
  }
  if(e?.sourceShadowMesh?.literalMotion){const m=e.sourceShadowMesh,controllerState={animationName:m.animationName,animationTime:m.animationTime,animationLoop:m.animationPlayback==='XAP_LOOP',presentationTransition:null};
    return {...resolveControllerPose(controllerState,name=>library.clips.get(name)?.durationSeconds,name=>library.clips.get(name)?.nativePlaybackField),controllerState,bind:false};}
  if(e?.sourceArcStartMesh&&e.sourceArcPose)return {...resolveControllerPose(e.sourceArcPose,
    name=>library.clips.get(name)?.durationSeconds,name=>library.clips.get(name)?.nativePlaybackField),
    controllerState:e.sourceArcPose,bind:false};
  return null;
}

export function sampleEffectBindPose(library,worldMatrix){
  const matrices=new Map(),visiting=new Set();
  const visit=index=>{const frame=library.frames[index];if(matrices.has(frame.name))return matrices.get(frame.name);
    if(visiting.has(index))throw new Error('Cyclic effect skeleton');visiting.add(index);
    const parent=frame.parent===null?worldMatrix:visit(frame.parent);
    const matrix=parent?multiply(parent,frame.nativeRowMatrix):[...frame.nativeRowMatrix];
    visiting.delete(index);matrices.set(frame.name,matrix);return matrix;};
  for(let i=0;i<library.frames.length;i++)visit(i);return matrices;
}
