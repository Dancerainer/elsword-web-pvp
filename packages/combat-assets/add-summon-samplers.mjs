/** Original NPC 1604 pose adapter. All positions are native world units. */
import {createPoseLibrary,createPoseSampleBuffer,samplePoseToRef,mapClipTime,compose,transform} from '../../tools/assets/character/sample_pose.mjs';
import {nativeEffectQuaternion} from './effect-transform.mjs';

export function addSummonAnimation(manifest,npc,state=npc?.state){
  const binding=manifest?.stateBindings?.[state];
  if(npc?.kind!=='apocalypse'||!binding)return null;
  return {name:binding.animationName,time:npc.animationTime,loop:binding.rawPlayType===0,duration:binding.durationSeconds};
}
export function addSummonWorldQuaternion(npc){return nativeEffectQuaternion([0,npc.yaw,npc.aimZ]);}

export function createAddSummonSamplers({manifest,pose,onUnsupported=()=>{}}){
  if(manifest?.npcId!==1604||manifest.id!=='apocalypse'||!(manifest.unitScale>0)||manifest.unitScale!==manifest.rawSystem?.UNIT_SCALE)
    throw new TypeError('Original Apocalypse manifest and UNIT_SCALE required');
  const library=createPoseLibrary(pose),cache=new WeakMap(),notes=new Set();
  if(!library.framesByName.has('COLLISION_SPHERE1')||library.framesByName.has('Bip01'))throw new TypeError('Independent Apocalypse hierarchy required');
  for(const binding of Object.values(manifest.stateBindings)){
    if(library.clips.get(binding.animationName)?.durationSeconds!==binding.durationSeconds)throw new TypeError('NPC state/clip duration mismatch');
  }
  function note(id,detail){if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-summon-pose',id,detail});}}
  function matrices(npc){
    const binding=npc?.kind==='apocalypse'?manifest.stateBindings[npc.state]:null,clip=library.clips.get(binding?.animationName);
    if(!clip){note('animation:'+npc?.state,'Original NPC animation absent');return null;}
    if(!Array.isArray(npc.position)||npc.position.length!==3||!npc.position.every(Number.isFinite)||
      !Number.isFinite(npc.animationTime)||!Number.isFinite(npc.yaw)||!Number.isFinite(npc.aimZ)||npc.facing!==1&&npc.facing!==-1)throw new TypeError('Invalid NPC pose state');
    const time=mapClipTime(npc.animationTime,binding.durationSeconds,binding.rawPlayType===0,clip.nativePlaybackField);
    let old=cache.get(npc);
    if(old?.name===clip.name&&old.time===time&&old.x===npc.position[0]&&old.y===npc.position[1]&&old.z===npc.position[2]&&
      old.yaw===npc.yaw&&old.aimZ===npc.aimZ&&old.facing===npc.facing)return old.buffer.matrices;
    if(!old){old={buffer:createPoseSampleBuffer(library)};cache.set(npc,old);}
    const scale=manifest.unitScale,worldMatrix=compose(npc.position,[scale,scale,scale],addSummonWorldQuaternion(npc));
    const result=samplePoseToRef(library,clip.name,time,old.buffer,{worldMatrix});
    old.name=clip.name;old.time=time;old.x=npc.position[0];old.y=npc.position[1];old.z=npc.position[2];
    old.yaw=npc.yaw;old.aimZ=npc.aimZ;old.facing=npc.facing;return result;
  }
  function summonPoseSampler(npc,definition={}){
    const sampled=matrices(npc);if(!sampled)return null;
    if(definition.WEAPON_BONE_NAME&&!definition.BONE_NAME){note('weapon:'+definition.WEAPON_BONE_NAME,'NPC has no character weapon slot');return null;}
    const name=definition.BONE_NAME,bone=name?sampled.get(name):null;
    if(name&&!bone){note('bone:'+name,'Requested original NPC bone is absent');return null;}
    const position=bone?transform(bone,[0,0,0]):[...npc.position];
    // Shared EffectSet offset convention is world Y/Z and facing-scaled X;
    // UNIT_SCALE affects the original hierarchy, never these declared offsets.
    position[0]+=npc.facing*(definition.POSITION_OFFSET_X??0);
    position[1]+=definition.POSITION_OFFSET_Y??0;position[2]+=definition.POSITION_OFFSET_Z??0;
    const apply=definition.APPLY_UNIT_ROTATION!==0&&definition.APPLY_UNIT_ROTATION!==false;
    const mirror=!apply&&(definition.APPLY_UNIT_ROTATION_MIRROR===1||definition.APPLY_UNIT_ROTATION_MIRROR===true);
    const rotation=[(definition.ROTATE_X??0)*(mirror&&npc.facing<0?-1:1),
      (definition.ROTATE_Y??0)+(apply?npc.yaw:mirror&&npc.facing<0?180:0),(definition.ROTATE_Z??0)+(apply?npc.aimZ:0)];
    const matrix=bone&&definition.TRACE_MATRIX===1&&(!definition.BONE_TRACE_TARGET_MESH||definition.TRACE_USER_TARGET_FORCE===1)?[...bone]:null;
    return {position,facing:npc.facing,rotation,...(matrix?{matrix}:{}),
      evidence:'original NPC 1604 pose and UNIT_SCALE; shared qualified EffectSet offset/rotation adapter; target client unmeasured'};
  }
  function summonAnimationDuration(npc,state=npc?.state){return addSummonAnimation(manifest,npc,state)?.duration??null;}
  function summonDefenderSampler(npc){
    const sampled=matrices(npc);if(!sampled)return [];
    return library.helpers.filter(h=>/^COLLISION_SPHERE\d+$/.test(h.name)).flatMap(h=>{
      const matrix=sampled.get(h.name),radius=h.nativeStoredBoundingRadius??h.geometryBoundingSphereCandidate?.radius;
      if(!matrix||!(radius>0)){note('collision:'+h.name,'Original NPC collision radius unavailable');return [];}
      return [{kind:'sphere',center:transform(matrix,[0,0,0]),radius:radius*Math.hypot(...matrix.slice(0,3)),
        source:{helper:h.name,npcId:1604,unitScale:manifest.unitScale,
          radiusEvidence:h.nativeStoredBoundingRadius!=null?'original stored radius':'source-vertex candidate; native X bounding-sphere routine unverified'}}];
    });
  }
  return {summonPoseSampler,summonAnimationDuration,summonDefenderSampler};
}
