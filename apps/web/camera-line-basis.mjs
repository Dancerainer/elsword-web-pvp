import {normalTrackingPoints} from './camera-policy.mjs';
import {authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';
export {authoredLineBasis} from '../../packages/combat-assets/line-basis.mjs';

/** Supply native points to the unchanged camera WASM tracking bridge.
 * Authored yaw/direction from the shared fixed V5 line consumer; not a
 * measured target2016 camera. Authored line slots can supply the original
 * relative or absolute camera request while general dynamic camera stays off.
 * The caller passes the same displayed actor used to draw the character.
 * World-unit to renderer scale/handedness conversion stays at the caller.
 */
export function normalTrackingActorPoints(actor,map,land,policy,scripted){
  const basis=authoredLineBasis(actor,map);
  const lineCamera=scripted?advanceLineCamera(actor,map,scripted.dt,scripted.previous):null;
  const points=lineCamera?.absolute?absoluteLinePoints(actor,lineCamera.absolute,land):
    normalTrackingPoints({position:[actor.x,actor.y,actor.z],facing:actor.facing,
      yRotationDegrees:basis.yRotationDegrees,dirVector:basis.dirVector,land},
      lineCamera?{...policy,lineRelativeEye:lineCamera.relative}:policy);
  return lineCamera?{...points,lineCamera}:points;
}
function absoluteLinePoints(actor,fields,land){
  const eye=[...fields.EYE_POS],focus=fields.FOCUS_UNIT;
  const target=focus===false||focus===0?[...fields.LOOKAT_POS]:[actor.x,actor.y,actor.z];
  target[1]+=300;
  eye[1]=Math.max(eye[1],land+200);target[1]=Math.max(target[1],land+200);
  return {eye,target};
}

/** GUUser::CommonCamera + LineScriptedCameraData::OnFrameMove. Each native
 * component approaches its authored value by speed * seconds. The camera
 * index belongs to the remembered line, including the step before a pad.
 */
export function advanceLineCamera(actor,map,dt,previous){
  if(!(Number.isFinite(dt)&&dt>=0))throw new RangeError('camera dt must be nonnegative');
  const line=map.lines.find(l=>l.lineId===(actor.lastTouchLineId??actor.lineId));
  const slot=map.cameraSlots?.find(s=>s.index===line?.nativeFields?.CAMERA_INDEX);
  const fields=slot?.nativeFields;
  const names=['RELATIVE_EYE_POS_X','RELATIVE_EYE_POS_Y','RELATIVE_EYE_POS_Z'];
  const relativeMode=names.every(name=>Number.isFinite(fields?.[name]));
  const final=relativeMode?names.map(name=>fields[name]):[0,0,0];
  const speed=relativeMode?(fields.CAMERA_REPOSITION_SPEED??100):(previous?.speed??100);
  const step=speed*dt,current=previous?.relative??[0,0,0];
  const relative=current.map((value,i)=>value+Math.sign(final[i]-value)*Math.min(Math.abs(final[i]-value),step));
  const absolute=fields&&!relativeMode&&Array.isArray(fields.EYE_POS)&&Array.isArray(fields.LOOKAT_POS)?fields:null;
  return {relative,final,speed,index:slot?.index??null,absolute};
}
