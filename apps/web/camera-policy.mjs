/** Fixed V5 source candidate, never a measured 2016 camera.
 * X2GameOption.cpp 1815–1856; X2Camera.cpp 391–548;
 * KTDGCamera.cpp 183–220/268–294. See contracts/rf-camera-trails-source.json.
 * All positions/distances are native units; convert once at the renderer boundary.
 */
export const FARTHEST_REFERENCE_CAMERA = Object.freeze({
  zoomLevel: -1, distance: 1500, height: 200, lookOffsetY: 100,
  trackingSeconds: .3, targetTrackingSeconds: 0, landCompensation: 400,
  evidence: 'reference-V5 manual farthest setting; target 1x UI label and runtime pending',
});
const vec = (v, name) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(name+' must be a finite vec3');
  return [...v];
};
function finite(n, name) { if (!Number.isFinite(n)) throw new TypeError(name+' must be finite'); return n; }

export function referenceManualCameraDistance({zoomLevel=-1, modifyFrustum=true, worldBase=0, worldSteps=[0,0,0], expandedRange=true}={}) {
  if (!Number.isInteger(zoomLevel)) throw new TypeError('zoomLevel must be an integer');
  const manual = modifyFrustum ? (zoomLevel===-1?1500:zoomLevel===1?600:zoomLevel===2&&expandedRange?200:1100)
    : (zoomLevel===-1?1500:zoomLevel===1?900:zoomLevel===-2?1800:1200);
  // The legacy branch returns directly and has no world correction.
  if (!modifyFrustum) return manual;
  vec(worldSteps,'worldSteps'); finite(worldBase,'worldBase');
  return worldBase + manual + worldSteps[Math.max(-1,Math.min(1,zoomLevel))+1];
}

/** The target Scene SetProjection(15,500000,4,...) supplies the divisor,
 * not a 4-radian FOV. KTDGManager.cpp 1038–1056 uses client width/height. */
export function nativeProjection({near=15,far=500000,fovDivisor=4,width=1024,height=768}={}) {
  if (!(near>0 && far>near && fovDivisor>0)) throw new RangeError('Invalid projection declaration');
  finite(width,'width');finite(height,'height');
  return {near,far,verticalFovRadians:Math.PI/fovDivisor,aspect:(width>0?width:1024)/(height>0?height:768)};
}

/** yRotationDegrees and dirVector are native unit values, including facing.
 * Flat-lane callers may explicitly supply 0(right)/180(left), [1,0,0].
 * The caller can supply an authored line-relative eye adjustment. */
export function normalTrackingPoints({position,facing=1,yRotationDegrees,dirVector=[1,0,0],land=0}, policy={}) {
  const p=vec(position,'position'),dir=vec(dirVector,'dirVector');
  finite(yRotationDegrees,'yRotationDegrees');finite(land,'land');
  // Fixed reference Always.h does not define PVP_ZOOM_CAMERA_1. Its smaller
  // height clamp applies to dungeon/battlefield; PvP retains 400. The alternate
  // macro branch is explicit instead of being silently assigned to target2016.
  const c={...FARTHEST_REFERENCE_CAMERA,angleDegrees:0,eyeDistance:0,lookDistance:0,pvpHeightCompensation:false,...policy};
  for(const name of ['distance','height','lookOffsetY','angleDegrees','eyeDistance','lookDistance']) finite(c[name],name);
  let compensation=c.landCompensation;
  if(c.pvpHeightCompensation){
    if(c.distance<=800)compensation=100;
    else if(c.distance<=900)compensation=200;
    else if(c.distance<=1200)compensation=300;
  }
  const right=facing>0,sign=right?1:-1;
  const radians=(yRotationDegrees+(right?c.angleDegrees:180-c.angleDegrees))*Math.PI/180;
  const eye=[p[0]-Math.sin(radians)*c.distance,p[1]+c.height,p[2]-Math.cos(radians)*c.distance];
  const target=[p[0],p[1]+c.lookOffsetY,p[2]];
  for(let i=0;i<3;i++){eye[i]+=dir[i]*c.eyeDistance*sign;target[i]+=dir[i]*c.lookDistance*sign;}
  if(c.lineRelativeEye){
    const relative=vec(c.lineRelativeEye,'lineRelativeEye'),depth=[-dir[2],0,dir[0]];
    if(dir[1]){const n=Math.hypot(...depth);if(n)for(let i=0;i<3;i++)depth[i]/=n;}
    for(let i=0;i<3;i++)eye[i]+=dir[i]*relative[0]+depth[i]*relative[2];
    eye[1]+=relative[1];
  }
  eye[1]=Math.max(eye[1],land+compensation);target[1]=Math.max(target[1],land+compensation);
  return {eye,target};
}

export function createCameraTrackingState({eye,target}) {
  return {eye:vec(eye,'eye'),target:vec(target,'target'),eyeVelocity:[0,0,0],targetVelocity:[0,0,0],remaining:0,targetRemaining:0};
}
export function setCameraTracking(state,{eye,target},{seconds=.3,targetSeconds=0}={}) {
  finite(seconds,'seconds');finite(targetSeconds,'targetSeconds');
  const e=vec(eye,'eye'),t=vec(target,'target');
  return {...state,eye:[...state.eye],target:[...state.target],
    eyeVelocity:e.map((v,i)=>seconds>0?(v-state.eye[i])/seconds:v),
    targetVelocity:t.map((v,i)=>seconds>0?(v-state.target[i])/seconds:v),
    remaining:seconds,targetRemaining:targetSeconds};
}
export function advanceCameraTracking(state,dt) {
  if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('dt must be nonnegative');
  const s={...state,eye:[...state.eye],target:[...state.target],eyeVelocity:[...state.eyeVelocity],targetVelocity:[...state.targetVelocity]};
  // Native UpdateCamera does not clamp the step to remaining time. A single
  // .4s frame can overshoot a .3s track; do not disguise this as min(1,dt/.3).
  if(s.remaining!==0){
    for(let i=0;i<3;i++)s.eye[i]+=s.eyeVelocity[i]*dt;
    if(s.targetRemaining===0)for(let i=0;i<3;i++)s.target[i]+=s.targetVelocity[i]*dt;
    s.remaining=Math.max(0,s.remaining-dt);
  }
  if(s.targetRemaining!==0){
    for(let i=0;i<3;i++)s.target[i]+=s.targetVelocity[i]*dt;
    s.targetRemaining=Math.max(0,s.targetRemaining-dt);
  }
  return s;
}
