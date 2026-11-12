/** Bounded fixed-V5 mesh/lock-on consumers; target combat remains unmeasured. */
import {rotateNative} from '../effect-runtime/index.mjs';
const f=Math.fround, DEG=Math.PI/180;
export const ARC_START_MESH_NAMES=Object.freeze(Array.from({length:4},(_,i)=>`Raven_Overtaker_Sp2a_FlyingImpact_Start_0${i+1}`));

/** Raven13159..13190 creates Start at GetPos(), without a hand attachment.
 * The original keys move the bones; its instance anchor stays at creation. */
export function initializeArcStartMesh(effect,template){
  if(!ARC_START_MESH_NAMES.includes(template?.name)||template.initialAnimation?.name!=='Normal'||
    template.initialAnimation.playback!=='XAP_ONE'||template.fields?.LifeType!=='LT_PLAY_COUNT'||
    template.fields.PlayCount!==1||template.initialAniSpeed!==1.4||
    !template.animationClips?.find(c=>c.name==='Normal')?.durationSeconds)
    throw new TypeError('Confirmed original Archenemy Start template required');
  effect.sourceArcStartMesh=true;effect.sourceSkillMeshControl=true;
  effect.mainEffectName=template.name;effect.templateFields={...template.fields};
  effect.initialAnimationName='Normal';effect.initialAnimationPlayback='XAP_ONE';
  effect.initialSize=[...template.initialSize];effect.lifeTimeSeconds=null;
  effect.currentAnchor={...effect.birthAnchor,position:[...effect.birthAnchor.position],rotation:[...effect.birthAnchor.rotation]};
  effect.sourceArcStartController={elapsed:0,time:0,period:f(template.animationClips.find(c=>c.name==='Normal').durationSeconds),
    // ChangeAnim defaults to transition=true; initial transition=.1,
    // KeyTrackSpeed(0->1). Mesh AniSpeed scales AdvanceTime, not track speed.
    rampDuration:f(.1),speed:f(template.initialAniSpeed)};
  effect.sourceArcGlobalTime=0;effect.sourceArcMeshAnimationTime=0;effect.sourceArcSlashTrace=false;
  advanceArcStartMesh(effect,f(.0001),template); // MeshPlayer CreateInstance:369; constructor RunEvent:1522.
}

export function advanceArcStartMesh(effect,dt,template){
  if(effect.sourceArcStartEndPending){effect.dead=true;effect.endReason='original-mesh-play-end';return;}
  const c=effect.sourceArcStartController,before=effect.sourceArcMeshAnimationTime??0,now=f(Math.min(c.time,c.period));
  effect.sourceArcMeshAnimationTime=now;
  // PlayProcess:2106 copies LAST SkinAnim time; RunEvent:2470..2508 uses
  // that packet before SkinAnim advances at1951. Anim .05 is not Global .05.
  for(const event of template.events)if(event.property==='SlashTrace'&&event.clock==='animation'&&
    before<f(event.start)&&now>=f(event.start))effect.sourceArcSlashTrace=!!event.value;
  effect.sourceArcGlobalTimeBefore=effect.sourceArcGlobalTime;
  effect.sourceArcGlobalTime=f(effect.sourceArcGlobalTime+f(dt));
  const integral=t=>t<c.rampDuration?t*t/(2*c.rampDuration):t-c.rampDuration/2;
  const previous=c.elapsed;c.elapsed+=f(f(dt)*c.speed);
  c.time+=integral(c.elapsed)-integral(previous);
  effect.animationTime=f(Math.min(c.time,c.period));
  effect.sourceArcPose={animationName:'Normal',animationTime:c.time,animationLoop:false,presentationTransition:null};
  effect.sourceArcStartEndPending=effect.animationTime>f(c.period-Math.max(f(c.period/10),f(.03)));
}

export function originalArcFailedLoop(template){
  return (template?.name==='Mesh_Particle_Prism'&&template.initialAnimation?.name==='Loop'&&
    template.initialAnimation.playback==='XAP_LOOP'&&template.animationClips?.length===1&&template.animationClips[0].name==='Normal')||
    (template?.name==='Raven_Overtaker_Flying_Impact'&&template.initialAnimation?.name==='Waiting'&&
    template.initialAnimation.playback==='XAP_LOOP'&&template.animationClips?.length===1&&
    template.animationClips[0].name==='Normal')||(['HarshChaserBlade','SwordFallBlade1','SwordFallBlade2','SwordFallBlade3','SwordFallBlade4'].includes(template?.name)&&template.initialAnimation?.name==='Normal'&&
    template.initialAnimation.playback==='XAP_LOOP'&&template.animationClips?.length===1&&template.animationClips[0].name==='Elsword_SisKnight_sword')||
    (template?.name==='ElswordSheath02'&&template.initialAnimation?.name==='Normal'&&template.initialAnimation.playback==='XAP_LOOP'&&
      template.animationClips?.length===1&&template.animationClips[0].name==='Elsword_SisKnight_sheath')||
    (template?.name==='SecondBlade'&&template.initialAnimation?.name==='Normal'&&template.initialAnimation.playback==='XAP_LOOP'&&
      template.animationClips?.length===1&&template.animationClips[0].name==='Elsword_SisKnight_sword_base');
}

export function advanceArcController(effect,dt,template){
  if(!originalArcFailedLoop(template))return;
  const c=effect.sourceArcController??={animationName:null,time:effect.animationTime??0,maxTime:0,
    transitionTime:f(.1),ramp:null,transition:null};
  const integral=(t,D)=>t<D?t*t/(2*D):t-D/2;
  if(c.ramp){const {elapsed,duration}=c.ramp;c.ramp.elapsed+=dt;
    c.time+=integral(c.ramp.elapsed,duration)-integral(elapsed,duration);
  }else c.time+=dt;
  if(c.transition)c.transition.elapsedSeconds+=dt;
  // SkinAnim.h UpdateAnimationFrameStructure writes the pose BEFORE the LOOP
  // switch. ChangeAnim(index0) changes tracks, not these already copied frames.
  effect.sourceArcPose={animationName:c.animationName,animationTime:c.time,animationLoop:true,
    presentationTransition:c.transition?{...c.transition}:null};
  // The fixed reference has ADAPTIVE_FRAME_MOVE: logical time is float/clamped.
  const logicalTime=f(Math.max(0,Math.min(c.time,c.maxTime)));
  if(logicalTime>f(c.maxTime-c.transitionTime)){
    const previousName=c.animationName,previousTime=c.time,previousDuration=c.transitionTime;
    const previousSpeed=c.ramp?Math.min(1,c.ramp.elapsed/c.ramp.duration):1;
    const previousWeight=c.ramp?Math.min(1,c.ramp.elapsed/c.ramp.duration):1;
    c.animationName=template.animationClips[0].name;
    c.maxTime=f(template.animationClips[0].durationSeconds);c.time=0;
    c.ramp={elapsed:0,duration:previousDuration};
    c.transition=previousName?{enabled:true,fromName:previousName,fromTime:previousTime,fromSpeed:previousSpeed,
      fromWeight:previousWeight,fromLoop:true,durationSeconds:previousDuration,elapsedSeconds:0}:null;
    c.transitionTime=Math.max(f(c.maxTime/10),f(.03));
    effect.sourceArcLoopSelections=(effect.sourceArcLoopSelections??0)+1;
  }
  effect.animationTime=f(c.time);
}

export function advanceArcGlobalEvents(effect,dt,template){
  if(effect.sourceArcGlobalTime===undefined)
    for(const event of template?.events??[])if(event.property==='SlashTrace'&&event.start===0)effect.sourceArcSlashTrace=event.value===true;
  const before=effect.sourceArcGlobalTime??0,after=f(before+f(dt));
  effect.sourceArcGlobalTimeBefore=before;effect.sourceArcGlobalTime=after;
  for(const event of template?.events??[])if(event.property==='SlashTrace'){
    const start=f(event.start);
    if(before<start&&after>=start||start===0&&after===0)effect.sourceArcSlashTrace=event.value===true;
  }
}

export function arcLineBasis(actor,lines){
  const line=lines.find(l=>l.lineId===(actor.lineId??actor.lastTouchLineId));
  if(!line)throw new TypeError('Archenemy requires the saved original line basis');
  const delta=line.end.map((n,i)=>n-line.start[i]),length=Math.hypot(...delta);
  if(!length||!Math.hypot(delta[0],delta[2]))throw new TypeError('Archenemy vertical/zero line basis unsupported');
  const direction=delta.map(n=>n/length),yaw=Math.atan2(-direction[2],direction[0])/DEG;
  // User.cpp:20719..20730 sets the line pitch/yaw and adds180 for left;
  // GetDirVector remains the line vector, independent of the facing flag.
  const zDirection=[-direction[2],0,direction[0]],zLength=Math.hypot(...zDirection);
  return {direction,rotation:[0,yaw+(actor.facing<0?180:0),0],
    zDirection:direction[1]!==0?zDirection.map(n=>n/zLength):zDirection};
}

export function nativeEffectQuaternion([pitch,yaw,roll]){
  const [x,y,z]=[pitch,yaw,roll].map(n=>n*DEG/2),sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);
  return [cy*sx*cz+sy*cx*sz,sy*cx*cz-cy*sx*sz,cy*cx*sz-sy*sx*cz,cy*cx*cz+sy*sx*sz];
}

export function nearestLockOnPoint(shapes,ownerPosition,fallback){
  let point=null,best=Infinity;
  for(const shape of shapes??[]){const p=shape.start??shape.center;if(!p)continue;
    const distance=Math.hypot(...p.map((n,i)=>n-ownerPosition[i]));
    // DamageEffect.cpp:2892..2908 uses <=: the last tied point wins.
    if(distance<=best){best=distance;point=p;}}
  return [...(point??fallback)];
}

export function advanceArcMesh(effect,dt,template){
  const previous=effect.currentAnchor??effect.birthAnchor;if(!previous)return;
  const position=[...previous.position];effect.meshLifetimeElapsed??=0;
  // Data1534 -> Game3166: global mesh is advanced before unit callbacks,
  // then the damage effect performs VectorLockOn for the NEXT mesh packet.
  if(effect.meshLifetimeElapsed>=f(effect.lifeTimeSeconds)){effect.dead=true;effect.endReason='template-life-time';return;}
  effect.meshLifetimeElapsed=f(effect.meshLifetimeElapsed+f(dt));
  advanceArcGlobalEvents(effect,dt,template);
  if(originalArcFailedLoop(template))advanceArcController(effect,dt,template);
  else effect.animationTime=f(effect.animationTime+f(dt));
  let rotation=[...(previous.rotation??[0,0,0])];
  if(effect.initialDirSpeed){
    const direction=effect.sourceArcUseManualDir?effect.sourceArcManualDirDegree.map(n=>f(n*f(DEG))):rotateNative([1,0,0],rotation);
    for(let i=0;i<3;i++)position[i]=f(position[i]+f(f(direction[i]*f(effect.initialDirSpeed))*f(dt)));
    const length=Math.hypot(...direction),horizontal=Math.hypot(direction[0],direction[2]);
    if(effect.sourceArcUseManualDir&&length>0&&horizontal>0)
      rotation=[0,Math.atan2(-direction[2],direction[0])/DEG,Math.asin(Math.max(-1,Math.min(1,direction[1]/length)))/DEG];
  }else{
    // MeshPlayer1571 backs up the CURRENT position, after the previous unit
    // follow callback. Zero native velocity adds no movement in this template.
    const delta=position.map((n,i)=>n-previous.position[i]),length=Math.hypot(...delta);
    effect.sourceArcManualDirDegree=delta.map(n=>length?f(n/length/DEG):0);
  }
  effect.sourceArcPreviousMeshPosition=[...position];
  effect.currentAnchor={...previous,position,rotation};[effect.x,effect.y,effect.z]=position;
}
