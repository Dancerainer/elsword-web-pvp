/** Presentation metadata only; no audio device, camera or gameplay RNG. */
import source from '../../contracts/source-distance-native-v45.json' with {type:'json'};
export const SOURCE_SOUND_DISTANCE=Object.freeze({min:source.sound.ordinarySound.defaultMinDistance,
 max:source.sound.ordinarySound.defaultMaxDistance,curve:'linear',listener:'camera-eye',units:'source-world'});
export function sourceSoundPositionMetadata(position,onlyIfLocal=false){
 const sourcePosition=Array.isArray(position)?position.slice():[];
 if(sourcePosition.length!==3||!sourcePosition.every(Number.isFinite))throw TypeError('Invalid original sound source position');
 return {onlyIfLocal,native3D:!onlyIfLocal,sourcePosition,
  ...(!onlyIfLocal?{soundDistance:{...SOURCE_SOUND_DISTANCE}}:{}),
  soundSourceEvidence:'contracts/source-distance-native-v45.json; original static PE/FMOD, not client audio measured'};
}
export function sourceSoundEventMetadata(actor,onlyIfLocal=false){
 return {...sourceSoundPositionMetadata([actor.x,actor.y,actor.z],onlyIfLocal),soundPositionSource:'unit'};
}
/** SOUND (not SOUND_PLAY) calls the live main mesh's GetPos in the frozen
 * X2DamageEffect consumer. Missing mesh transforms must not become owner XYZ.
 * The exact original2016 SOUND consumer remains a source-audit limitation. */
export function sourceEffectSoundEventMetadata(effect){
 const position=(effect.currentAnchor??effect.birthAnchor)?.position;
 const evidence='contracts/source-sound-routes-native-v45.json; frozen-V5 X2DamageEffect.cpp:2578 mesh GetPos; original2016 SOUND consumer not closed';
 if(Array.isArray(position)&&position.length===3&&position.every(Number.isFinite))
  return {...sourceSoundPositionMetadata(position),soundPositionSource:'effect-main-mesh',soundPositionEvidence:evidence};
 return {onlyIfLocal:false,native3D:true,sourcePosition:null,soundDistance:{...SOURCE_SOUND_DISTANCE},
  soundPositionSource:'effect-main-mesh',soundPositionEvidence:evidence,
  soundSpatialUnsupported:'Original effect main-mesh position unavailable'};
}
