import {ONLINE_MODES} from './modes.mjs';

export const MAX_ROOMS_PER_MODE=20;
export const DEFAULT_ROOM_CAPACITY=Object.freeze({maxRoomsByMode:Object.freeze({'1v1':3,'2v2':3,'3v3':2})});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(value));

/** Administrative admission settings, independent from combat rules. */
export function normalizeRoomCapacity(value){
  if(!plain(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'maxRoomsByMode')
    ||!plain(value.maxRoomsByMode)||Object.keys(value.maxRoomsByMode).length!==ONLINE_MODES.length
    ||ONLINE_MODES.some(mode=>!Object.hasOwn(value.maxRoomsByMode,mode)
      ||!Number.isSafeInteger(value.maxRoomsByMode[mode])||value.maxRoomsByMode[mode]<0||value.maxRoomsByMode[mode]>MAX_ROOMS_PER_MODE))
    throw new TypeError('invalid-room-capacity');
  return {maxRoomsByMode:Object.fromEntries(ONLINE_MODES.map(mode=>[mode,value.maxRoomsByMode[mode]]))};
}
