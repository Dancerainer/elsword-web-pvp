/** Original RF pose/helper adapter, independent from Babylon and render rate.
 * Source geometry is preserved; interpolation is checked against the shipped
 * D3DX DLL. Text X bounding spheres and effect attachment need client traces.
 */
import { createPoseLibrary, createPoseSampleBuffer, samplePoseToRef, sampleLocalTransform, resolveControllerPose, mapClipTime, consumesRootTranslation, compose, transform } from '../../tools/assets/character/sample_pose.mjs';
import {arcEffectPose,sampleEffectBindPose,nativeEffectQuaternion} from './effect-transform.mjs';
import {xCrashMeshTransform} from '../combat-core/xcrash-mesh-transform.mjs';
import {actorWorldQuaternion,authoredLineBasis} from './line-basis.mjs';
import {literalMeshSize} from './literal-mesh-size.mjs';
import {maximumStrikePreparedPoint} from './maximum-strike-display-v45.mjs';

const identityScale=[1,1,1];
// Column-matrix equivalent of the original SizeMatrix * bone-combine row
// matrix. Keep translation and bone shear, scaling only the local axes.
const multiplyTargetMeshScale=(matrix,scale)=>matrix.map((value,index)=>index<12?value*scale[Math.floor(index/4)]:value);
function facingQuaternion(facing){return facing<0?[0,1,0,0]:[0,0,0,1];}
function animationTime(library, actor){
  const c=library.clips.get(actor.animationName);
  if(!c)return null;
  const duration=c.durationSeconds;
  return mapClipTime(actor.animationTime,duration,actor.animationLoop,c.nativePlaybackField??null);
}
function staticClip(clip){
  return clip && [...clip.tracks.values()].every(t=>['translation','scale','rotation'].every(k=>{
    const channel=t[k];if(!channel?.values?.length)return false;
    return channel.stride===undefined?channel.values.every(v=>v.every((n,i)=>n===channel.values[0][i]))
      :channel.values.every((n,i)=>n===channel.values[i%channel.stride]);
  }));
}
function toSpheres(helpers, predicate){
  return helpers.filter(predicate).flatMap(h=>{
    const radius=h.nativeStoredBoundingRadius ?? h.geometryBoundingSphereCandidate?.radius;
    if(!(radius>0))return [];
    // V5 KTDXCollision.h GetPointStart ignores the calculated mesh center;
    // GetScaleRadius uses the decomposed X scale, not the maximum axis.
    const multiplier=Math.hypot(...h.matrix.slice(0,3));
    const center=transform(h.matrix,[0,0,0]);
    return [{kind:'sphere',center,radius:radius*multiplier,source:{helper:h.name,
      radiusEvidence:h.nativeStoredBoundingRadius!=null?'original KSM stored radius':'source-vertex candidate; native bounding-sphere routine unverified'}}];
  });
}
function attackShapes(library,matrices,predicate=()=>true){
  const selected=library.helpers.filter(predicate).map(h=>({...h,matrix:matrices.get(h.name)})).filter(h=>h.matrix);
  const shapes=toSpheres(selected,h=>/^ATTACK_SPHERE\d*_/i.test(h.name)||/^ATTACK_SPHERE\d*$/i.test(h.name));
  for(const h of selected){
    const match=/^ATTACK_LINE_START(\d+)(?:_.+)?$/i.exec(h.name);if(!match)continue;
    const start=h.matrix,end=matrices.get('ATTACK_LINE_END'+match[1]),radius=h.nativeStoredBoundingRadius??h.geometryBoundingSphereCandidate?.radius;
    if(!end||!(radius>0))continue;
    shapes.push({kind:'line',start:transform(start,[0,0,0]),end:transform(end,[0,0,0]),radius:radius*Math.hypot(...start.slice(0,3)),
      source:{helper:h.name,radiusEvidence:h.nativeStoredBoundingRadius!=null?'original KSM stored radius':'source-vertex sphere candidate; native .X construction unverified'}});
  }
  return shapes;
}
/** Shared browser/headless effect-helper index; presentation paths never change
 * collision data only in one host. Missing source values remain null. */
export function mergeEffectIndexes(original,index){
  const result={...original,templates:{...original.templates}};
  for(const [name,t] of Object.entries(index.templates))if(t.kind==='mesh'&&t.poseData){
    const initial=Object.fromEntries(t.events.filter(e=>e.start===0&&!e.fade).map(e=>[e.property,e.value]));
    result.templates[name]={...t,initialSize:initial.Size??null,initialVelocity:initial.Velocity??null,
      sizeEvidence:initial.Size?'original explicit Size event at time zero':'reference-V5 constructor default; target2016 unmeasured',
      initialAnimation:initial.AniName?{name:initial.AniName.animation,playback:initial.AniName.playback}:null,missingExplicitTickRate:t.animationMissingTickRate};
  }
  return result;
}
export function createNativeSamplers({characterPose,effectIndex,effectPoses,profile,map,onUnsupported=()=>{}}){
  const character=createPoseLibrary(characterPose), effects=new Map();
  // The collision path needs matrices and stored radii, never transformed mesh
  // vertices/AABBs. Sampling those for every candidate was needless hot-path work.
  const actorCache=new Map(),effectPoseCache=new WeakMap(),nasodPoseCache=new WeakMap(),emptyMatrices=new Map();
  const actorSampling={evaluations:0,reused:0,buffers:0};
  const effectSampling={evaluations:0,reused:0};
  const sameTransition=(prior,transition)=>prior.oldClip===transition?.clipName&&prior.oldTime===transition?.timeSeconds&&prior.oldWeight===transition?.weight;
  function saveTransition(prior,transition){prior.oldClip=transition?.clipName;prior.oldTime=transition?.timeSeconds;prior.oldWeight=transition?.weight;}
  function sameMatrix(saved,current){for(let i=0;i<16;i++)if(saved[i]!==current[i])return false;return true;}
  function effectMatrices(effect,library,clip,bind,time,matrix,transition){
    // FireDummy has seventeen original bone attachment requests per packet.
    // They share one SkinAnim output; sampling the full hierarchy seventeen
    // times creates needless matrices and interpolation arrays. Include every
    // world/clock/transition input, so movement or reconciliation invalidates
    // the cached pose even when the effect object itself remains the same.
    let prior=effectPoseCache.get(effect);
    if(prior?.library===library&&prior.clip===clip?.name&&prior.bind===bind&&prior.time===time&&
      sameTransition(prior,transition)&&sameMatrix(prior.world,matrix)){effectSampling.reused++;return prior.matrices;}
    if(prior?.library!==library){prior={library,world:Array(16).fill(0),buffer:null};effectPoseCache.set(effect,prior);}
    // The Map is private to this sampler. Public anchor/matrix consumers copy
    // their results, so the next clock can safely reuse this effect's storage.
    if(!bind)prior.buffer??=createPoseSampleBuffer(library);
    prior.matrices=bind?sampleEffectBindPose(library,matrix):samplePoseToRef(library,clip.name,time,prior.buffer,{worldMatrix:matrix,transition});
    prior.clip=clip?.name;prior.bind=bind;prior.time=time;saveTransition(prior,transition);
    for(let i=0;i<16;i++)prior.world[i]=matrix[i];
    effectSampling.evaluations++;return prior.matrices;
  }
  const notes=new Set();
  function note(id,detail){if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-asset-adapter',id,detail});}}
  for(const [file,data] of Object.entries(effectPoses)){
    if(data.unsupportedTracks?.length){note('effect-pose:'+file,'Unsupported original pose tracks retained: '+JSON.stringify(data.unsupportedTracks));continue;}
    effects.set(file,createPoseLibrary(data));
  }
  function options(a,quaternion){return {rootTranslationOverride:consumesRootTranslation(a)?[0,null,0]:null,
    worldMatrix:compose([a.x,a.y,a.z],identityScale,quaternion)};}
  function controllerPose(a){return resolveControllerPose(a,name=>character.clips.get(name)?.durationSeconds,name=>character.clips.get(name)?.nativePlaybackField);}
  function motionOffsetSampler(a){
    const t=animationTime(character,a);if(t===null){note('motion:'+a.animationName,'Missing original root-motion pose');return null;}
    const pose=controllerPose(a);
    // Retained controller output has already passed SkinAnim's XZ clear.
    if(pose.retained&&consumesRootTranslation(a))return {x:0,z:0};
    const local=sampleLocalTransform(character,pose.clipName,pose.timeSeconds,'Bip01',{transition:pose.transition});
    return {x:local.translation[0],z:local.translation[2]};
  }
  function actorMatrices(a){
    const t=animationTime(character,a);
    if(t===null){note('pose:'+a.animationName,'Missing original helper pose for '+a.animationName);return emptyMatrices;}
    const pose=controllerPose(a),blend=pose.transition,quaternion=actorWorldQuaternion(a,map);
    const rootClear=consumesRootTranslation(a);let prior=actorCache.get(a.id);
    if(prior&&prior.clip===pose.clipName&&prior.time===pose.timeSeconds&&prior.x===a.x&&prior.y===a.y&&prior.z===a.z&&prior.facing===a.facing&&
      prior.q0===quaternion[0]&&prior.q1===quaternion[1]&&prior.q2===quaternion[2]&&prior.q3===quaternion[3]&&prior.rootClear===rootClear&&sameTransition(prior,blend)){
      actorSampling.reused++;return prior.buffer.matrices;
    }
    if(!prior){prior={buffer:createPoseSampleBuffer(character)};actorCache.set(a.id,prior);actorSampling.buffers++;}
    const matrices=samplePoseToRef(character,pose.clipName,pose.timeSeconds,prior.buffer,{...options(a,quaternion),transition:blend});
    prior.clip=pose.clipName;prior.time=pose.timeSeconds;prior.x=a.x;prior.y=a.y;prior.z=a.z;prior.facing=a.facing;
    prior.q0=quaternion[0];prior.q1=quaternion[1];prior.q2=quaternion[2];prior.q3=quaternion[3];prior.rootClear=rootClear;saveTransition(prior,blend);
    actorSampling.evaluations++;return matrices;
  }
  function helpers(library,matrices,predicate){
    return library.helpers.filter(predicate).map(h=>({...h,matrix:matrices.get(h.name)})).filter(h=>h.matrix);
  }
  function collisionSampler(a,{raw}={}){
    // GUUser Init/Reset disables these three helpers before any state starts
    // (fixed source lines 1565-1567, 2122-2124). They are auxiliary boxes,
    // not additional hits from feet/the small hand in every sword attack.
    const disabled=new Set(['rfoot','lfoot','lhand2']);
    for(const name of Object.values(raw?.ENABLE_ATTACK_BOX??{}))disabled.delete(String(name).toLowerCase());
    for(const name of Object.values(raw?.DISABLE_ATTACK_BOX??{}))disabled.add(String(name).toLowerCase());
    return attackShapes(character,actorMatrices(a),h=>!disabled.has(h.name.replace(/^ATTACK_(?:SPHERE\d+|LINE_START\d+)_/i,'').toLowerCase()));
  }
  function defenderSampler(a){return toSpheres(helpers(character,actorMatrices(a),h=>/^COLLISION_SPHERE\d+_/i.test(h.name)),()=>true);}
  function actorRotationSampler(a){return [0,map===undefined?a.facing<0?180:0:
    authoredLineBasis(a,typeof map==='function'?map():map).yRotationDegrees,0];}
  function actorAttachmentBone(d,a){
    // EffectSet.cpp 2827/2874: BONE_NAME wins over WEAPON_BONE_NAME.
    // The converted major weapon is mounted under its original hand matrix,
    // including its original TRACE frames. Other weapon/model slots have no
    // corresponding source hierarchy in this pose and cannot use that sword.
    const weapon=!d.BONE_NAME&&d.WEAPON_BONE_NAME;
    if(weapon&&((d.WEAPON_BONE_WEAPON_INDEX??0)!==0||(d.WEAPON_BONE_MODEL_INDEX??0)!==0)){
      note('weapon-bone-slot:'+d.WEAPON_BONE_WEAPON_INDEX+':'+d.WEAPON_BONE_MODEL_INDEX,'Original requested weapon/model slot is not present in the mounted character pose');return null;
    }
    const name=d.BONE_NAME==='_HEAD_BONE'?'Bip01_Head':d.BONE_NAME||weapon;
    if(!name)return null;
    const bone=actorMatrices(a).get(name);
    if(!bone)note((weapon?'weapon-bone:':'bone:')+(d.BONE_NAME||weapon),'Original effect attachment bone is absent: '+name);
    return bone??null;
  }
  function actorAttachmentMatrix(d,a){
    if(d.TRACE_MATRIX!==1)return null;
    // GetCombineMatrix3188..3219 applies the weapon matrix independently of
    // the actor-bone target-mesh condition.
    if(d.BONE_NAME&&d.TRACE_USER_TARGET_FORCE!==1&&d.BONE_TRACE_TARGET_MESH)return null;
    return actorAttachmentBone(d,a);
  }
  function effectAnchorSampler(effect,a){
    if(effect.sourceElesisBloodCutter!==undefined)return effect.sourcePosedAnchor??effect.currentAnchor??effect.birthAnchor;
    if(Object.hasOwn(effect,'sourceBoneTargetMeshId'))return effect.currentAnchor??effect.birthAnchor??null;
    // EffectSet target-mesh links are resolved by the core using exact instance
    // IDs. A dead target freezes the saved anchor; it never becomes the owner.
    if(Object.hasOwn(effect,'sourceTargetMeshId')||Object.hasOwn(effect,'sourceVeteranTargetId'))return effect.currentAnchor??effect.birthAnchor;
    // EffectSet::GetEffectPosition returns its explicit world position before
    // considering bone/TRACE fields (fixed V5 X2EffectSet.cpp:2790). This is
    // used by VC Deadly Raid and the common Raven parry effect.
    if(effect.birthAnchor?.customPosition)return effect.birthAnchor;
    const d=effect.definition??{}, t=animationTime(character,a);
    let position=[a.x,a.y,a.z],matrix=null;
    if(d.BONE_NAME||d.WEAPON_BONE_NAME){
      if(t===null)return null;
      // _HEAD_BONE is an EffectSet consumer token, not a skeleton node.
      // RF User binds Bip01_Head (X2GUUser.cpp:4584); GetHeadBonePos at
      // 13145 adds an unscaled world Y=70 after GetFramePos. Keep this
      // reference-V5 consumer separate from the target's declared offsets.
      let head=d.BONE_NAME==='_HEAD_BONE',bone=actorAttachmentBone(d,a);
      // CommonFrameMove_EffectSet calls PlayEffectSet(owner,NULL) (GUUser
      //37787). With Always.h MODIFY_GET_BONE_POS, EffectSet2843 falls back
      // to GetHeadBonePos only for a missing owner frame. Preserve the raw
      // force/name fields: these carriers must not bind to a summoned dummy.
      const ownerMissingFrame=(profile.target?.unitClass===125&&/^EffectSet_HA_SCA_FATE_SMASHER_Attack[1-4]$/.test(effect.setName??'')&&/^Dummy0[1-3]$/.test(d.BONE_NAME??'')&&d.TRACE_USER_TARGET_FORCE===1)||
        (profile.target?.unitClass===125&&/^EffectSet_C_SDK_Combo_SDK_ZZZXX?$/.test(effect.setName??'')&&d.BONE_NAME==='Dummy03'&&d.TRACE_USER_TARGET_FORCE===1)||
        (profile.target?.unitClass===121&&effect.setName==='EffectSet_SA_SBH_ANCIENT_FIRE'&&d.BONE_NAME==='Bop01');
      if(!bone&&ownerMissingFrame){bone=actorMatrices(a).get('Bip01_Head');head=true;}
      if(!bone)return null;
      position=transform(bone,[0,0,0]);
      const combined=actorAttachmentMatrix(d,a);if(combined)matrix=[...combined];
      // SwordMan PhantomSword_FrameMove explicitly left-multiplies this
      // temporary sheath's bone matrix by D3DXMatrixScaling(1.3f). The long
      // lived ThirdBlade/center follow the unscaled delayed hand matrix.
      if(matrix&&profile.target?.unitClass===112&&d.NAME==='ElswordPhantomSwordSheath01')
        matrix=matrix.map((value,index)=>index<12?Math.fround(Math.fround(value)*Math.fround(1.3)):value);
      if(head)position[1]+=70;
    }
    // EffectSet GetEffectRotation3013–3065 adds declared Euler rotation
    // to the unit rotation. Ordinary TRACE updates position, not rotation.
    const applyUnit=d.APPLY_UNIT_ROTATION!==0&&d.APPLY_UNIT_ROTATION!==false;
    const mirror=!applyUnit&&(d.APPLY_UNIT_ROTATION_MIRROR===1||d.APPLY_UNIT_ROTATION_MIRROR===true);
    const rotation=[d.ROTATE_X??0,(d.ROTATE_Y??0)+(applyUnit||mirror?a.facing<0?180:0:0),d.ROTATE_Z??0];
    if(mirror&&a.facing<0)rotation[0]*=-1;
    return {rotation,position:[position[0]+a.facing*(d.POSITION_OFFSET_X??0),position[1]+(d.POSITION_OFFSET_Y??0),position[2]+(d.POSITION_OFFSET_Z??0)],
      facing:a.facing,...(matrix?{matrix}:{}),evidence:'original pose + declared offsets; reference-V5 X2EffectSet.cpp GetEffectPosition/SetEffectSetOffset'+
        (d.BONE_NAME==='_HEAD_BONE'?'; X2GUUser GetHeadBonePos Bip01_Head + world Y70':'')+
        ((profile.target?.unitClass===125&&(/^EffectSet_HA_SCA_FATE_SMASHER_Attack[1-4]$/.test(effect.setName??'')||/^EffectSet_C_SDK_Combo_SDK_ZZZXX?$/.test(effect.setName??'')&&d.BONE_NAME==='Dummy03'&&d.TRACE_USER_TARGET_FORCE===1)||profile.target?.unitClass===121&&effect.setName==='EffectSet_SA_SBH_ANCIENT_FIRE'&&d.BONE_NAME==='Bop01')?'; fixedV5 owner missing-frame head fallback, raw bone name retained':'')+'; target runtime pending'};
  }
  function effectSampler(e,a){
    const template=effectIndex.templates[e.damage?.MAIN_EFFECT_NAME??(e.definition?.USE_SUB_ATTACK_LIST_SET===1?e.name:null)];
    if(!template?.poseData){note('effect:'+e.damage?.MAIN_EFFECT_NAME,'Original effect helper asset not converted');return [];}
    const library=effects.get(template.poseData),arc=arcEffectPose(template,library,e),bind=arc?.bind;
    const clip=library?.clips.get(arc?.clipName??template.initialAnimation?.name);
    if(!clip&&!bind){note('effect-clip:'+e.name,'Original effect animation unavailable');return [];}
    if(!bind&&template.missingExplicitTickRate && !staticClip(clip)){note('effect-tick:'+e.name,'Nonconstant animation lacks a confirmed native tick rate');return [];}
    if(!template.initialSize)note('effect-default-size:'+e.name,'Uses reference-V5 KTDGXMeshPlayer.cpp:1308 constructor Size [1,1,1]; raw Size absent, target2016 unmeasured');
    // V5 X2EffectSet.cpp 1287/1330: damage effects TRACE and TRACE_MORE both update position.
    const follows=e.definition.TRACE_MORE===1 || e.definition.TRACE===1 || e.definition.TRACE_MATRIX===1;
    let anchor=e.sourcePosedAnchor??(follows?effectAnchorSampler(e,a):(e.currentAnchor??e.birthAnchor));
    if(!anchor){note('effect-anchor:'+e.name,'Effect birth anchor not supplied by the core');return [];}
    const position=[...anchor.position];
    if(!follows && !e.currentAnchor && template.initialVelocity){for(let i=0;i<3;i++)position[i]+=template.initialVelocity[i]*e.elapsed*(i===1?1:anchor.facing);}
    // V5 CXMeshInstance constructor initializes velocity to zero. An absent source
    // field stays null in the index; this runtime default is tagged reference-V5.
    else if(!follows && !e.currentAnchor && !template.initialVelocity)note('effect-default-velocity:'+e.name,'Undeclared template velocity uses reference-V5 constructor zero; not a target literal');
    const meshTransform=xCrashMeshTransform(template,e,anchor,{literal:profile.target?.unitType===8});
    const scale=meshTransform?.scale??literalMeshSize(template,e.meshLifetimeElapsed??e.elapsed).map((n,i)=>n*(e.definition[['SCALE_X','SCALE_Y','SCALE_Z'][i]]??1));
    const rotation=meshTransform?.rotation??e.sourcePosedAnchor?.rotation??e.currentAnchor?.rotation??e.birthAnchor?.rotation??anchor.rotation;
    // EffectSet1437/3188 applies the complete GetCombineMatrix bone matrix.
    // Armageddon explicitly TRACE_USER_TARGET_FORCEs Dummy1_Rhand, so its
    // original sword helpers rotate with the sword rather than the actor yaw.
    const traceMatrix=!e.birthAnchor?.customPosition?actorAttachmentMatrix(e.definition,a):null;
    const targetMatrix=e.definition.TRACE_MATRIX===1&&Object.hasOwn(e,'sourceBoneTargetMeshId')?anchor.matrix:null;
    const matrix=(targetMatrix?multiplyTargetMeshScale(targetMatrix,scale):null)??(e.sourcePhantomSword?anchor.matrix:null)??traceMatrix??compose(position,scale,rotation?nativeEffectQuaternion(rotation):facingQuaternion(anchor.facing));
    const time=arc?.timeSeconds??(bind||template.missingExplicitTickRate?0:mapClipTime(e.animationTime,clip.durationSeconds,
      template.initialAnimation.playback==='XAP_LOOP',clip.nativePlaybackField));
    const matrices=effectMatrices(e,library,clip,bind,time,matrix,arc?.transition);
    return attackShapes(library,matrices).map(shape=>({...shape,
      source:{...shape.source,sizeEvidence:template.sizeEvidence??(template.initialSize?'original explicit Size event at time zero':'reference-V5 constructor default; target2016 unmeasured')}}));
  }
  function effectBoneMatrices(e,a,{bindPose=false}={}){
    const template=effectIndex.templates[e.damage?.MAIN_EFFECT_NAME??e.mainEffectName??e.name],library=effects.get(template?.poseData),arc=arcEffectPose(template,library,e);
    const bind=bindPose||arc?.bind,clip=library?.clips.get(arc?.clipName??template?.initialAnimation?.name);
    if(!clip&&!bind)return null;
    if(!bind&&template.missingExplicitTickRate&&!staticClip(clip))return null;
    const follows=e.definition?.TRACE_MORE===1||e.definition?.TRACE===1||e.definition?.TRACE_MATRIX===1;
    const anchor=e.sourcePosedAnchor??(follows?effectAnchorSampler(e,a):(e.currentAnchor??e.birthAnchor));
    if(!anchor)return null;
    const meshTransform=bindPose?null:xCrashMeshTransform(template,e,anchor,{literal:profile.target?.unitType===8});
    const scale=meshTransform?.scale??literalMeshSize(template,e.meshLifetimeElapsed??e.elapsed).map((n,i)=>n*(e.definition?.[['SCALE_X','SCALE_Y','SCALE_Z'][i]]??1));
    const time=arc?.timeSeconds??(bind||template.missingExplicitTickRate?0:mapClipTime(e.animationTime??e.elapsed??0,clip.durationSeconds,
      template.initialAnimation.playback==='XAP_LOOP',clip.nativePlaybackField));
    const rotation=meshTransform?.rotation??e.sourcePosedAnchor?.rotation??e.currentAnchor?.rotation??e.birthAnchor?.rotation??anchor.rotation;
    const traceMatrix=!e.birthAnchor?.customPosition?actorAttachmentMatrix(e.definition??{},a):null;
    const targetMatrix=e.definition?.TRACE_MATRIX===1&&Object.hasOwn(e,'sourceBoneTargetMeshId')?anchor.matrix:null;
    const matrix=(targetMatrix?multiplyTargetMeshScale(targetMatrix,scale):null)??(e.sourcePhantomSword?anchor.matrix:null)??traceMatrix??compose(anchor.position,scale,rotation?nativeEffectQuaternion(rotation):facingQuaternion(anchor.facing));
    return effectMatrices(e,library,clip,bind,time,matrix,arc?.transition);
  }
  function effectBoneSampler(e,a,boneName,{nativeMissingFramePosition=false,bindPose=false}={}){
    const poses=effectBoneMatrices(e,a,{bindPose});if(!poses)return null;
    // KTDGXSkinAnim::GetFramePos returns the original zero vector when an
    // otherwise valid mesh/clip does not contain this requested frame.
    const bone=poses.get(boneName),position=bone?transform(bone,[0,0,0]):null;
    return correctedMaximumStrikePoint(e,a,boneName,position)??position??(nativeMissingFramePosition?[0,0,0]:null);
  }
  function correctedMaximumStrikePoint(e,a,boneName,position){
    if(boneName!=='Dummy02'||!e.sourceAddMaximumStrike)return null;
    const center=actorMatrices(a).get('Bip01'),anchor=e.currentAnchor??e.birthAnchor;
    if(!center||!anchor)return null;
    const template=effectIndex.templates[e.mainEffectName??e.damage?.MAIN_EFFECT_NAME],local=xCrashMeshTransform(template,e,anchor,{literal:true})?.localRotation;
    return maximumStrikePreparedPoint(e,position,anchor.position,transform(center,[0,0,0]),local,actorRotationSampler(a)[1]);
  }
  function effectBoneMatrixSampler(e,a,boneName,options={}){
    // EffectSet::GetCombineMatrix3188 returns the exact target mesh frame,
    // including its scale/shear. A missing frame returns NULL, never an actor
    // frame or a reconstructed Euler matrix.
    const bone=effectBoneMatrices(e,a,options)?.get(boneName);if(!bone)return null;
    const copy=[...bone],point=correctedMaximumStrikePoint(e,a,boneName,transform(bone,[0,0,0]));
    if(point)for(let i=0;i<3;i++)copy[12+i]=point[i];return copy;
  }
  function nasodAttackSampler(core){
    const template=effectIndex.templates.Raven_NasodBall,library=effects.get(template?.poseData);
    const clip=library?.clips.get(core.animationName);
    if(!clip){note('nasod-attack-pose','Original Nasod AttackN pose is unavailable; no target-center collision substitute');return [];}
    const scale=core.helper?.scale??1;
    const world=compose([core.x,core.y,core.z],[scale,scale,scale],nativeEffectQuaternion(core.rotation??[0,0,0]));
    const time=mapClipTime(core.animationTime,clip.durationSeconds,false,clip.nativePlaybackField);
    let buffer=nasodPoseCache.get(core);if(buffer?.library!==library){buffer=createPoseSampleBuffer(library);nasodPoseCache.set(core,buffer);}
    const matrices=samplePoseToRef(library,clip.name,time,buffer,{worldMatrix:world});
    return attackShapes(library,matrices).map(shape=>({...shape,source:{...shape.source,
      evidence:'target2016 core AttackN helper + pinned-V5 request scale/rotation; target-client-unmeasured'}}));
  }
  return {collisionSampler,defenderSampler,effectAnchorSampler,effectSampler,effectBoneSampler,effectBoneMatrixSampler,actorRotationSampler,motionOffsetSampler,nasodAttackSampler,effectSamplingStats:()=>({...effectSampling}),actorSamplingStats:()=>({...actorSampling})};
}
