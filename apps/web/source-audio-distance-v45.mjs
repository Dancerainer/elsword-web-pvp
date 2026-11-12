import {SOURCE_SOUND_DISTANCE} from '../../packages/combat-core/source-sound-event-v45.mjs';

/** Original static PE/FMOD distance rule. Coordinates are source-world units;
 * browser rendering uses x/y * scale and reverses z. No audio pan inference. */
export function sourceCameraEye(position,scale){
  if(!position||!Number.isFinite(scale)||scale<=0)throw TypeError('Invalid audio camera scale');
  const eye=[position.x/scale,position.y/scale,-position.z/scale];
  if(!eye.every(Number.isFinite))throw TypeError('Invalid audio camera position');
  return eye;
}
export function sourceSoundGain(source,listener,localActorId){
  if(!source)return 1; // Explicit system/UI sounds have no world source.
  if(source.onlyIfLocal&&source.actorId!==localActorId)return 0;
  if(source.native3D!==true)return 1;
  const point=source.sourcePosition,rule=source.soundDistance??SOURCE_SOUND_DISTANCE;
  if(!Array.isArray(point)||point.length!==3||!point.every(Number.isFinite)||
    !Array.isArray(listener)||listener.length!==3||!listener.every(Number.isFinite))return 0;
  if(rule.curve!=='linear'||!Number.isFinite(rule.min)||!Number.isFinite(rule.max)||rule.min<0||rule.max<=rule.min)return 0;
  const distance=Math.hypot(...point.map((value,i)=>value-listener[i]));
  return distance<=rule.min?1:distance>=rule.max?0:(rule.max-distance)/(rule.max-rule.min);
}
