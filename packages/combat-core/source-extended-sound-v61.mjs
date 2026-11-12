/** Target-2016 static sound declarations. No clock, RNG, actor mutation or audio
 * device lives here. Native evidence is recorded separately from Web playback.
 * SOUND_PLAY_EX joins ordinary timed sounds; STATE_SOUND_PLAY owns a separate
 * native handle group. Both observed playback paths use bLoop=false.
 */
export const SOURCE_DELETE_CONDITION_SOUND=Object.freeze({
  DCS_NONE:0,DCS_DAMAGE_REACT:1,DCS_STATE_END:2,DCS_DIE:3,
  DCS_CUSTOM_STATE:4,DCS_SKILL_STATE_END:5,
});
const empty=Object.freeze([]),cache=new WeakMap();
const flag=value=>value===1||value===true;
const validName=value=>typeof value==='string'&&value.length>0;
const validTime=value=>Number.isFinite(value)&&value>=0;

function freezeEntry(entry){
  Object.freeze(entry.value);Object.freeze(entry.deleteConditions);
  return Object.freeze(entry);
}

/** Entries use the same animation timer and probability gate as SOUND_PLAYn.
 * The EX field key includes its 1-based source row, making each row an
 * independent fired-field receipt even if two rows name the same sound.
 * A selected SOUND_SET currently excludes this extension path: none of the
 * eight reachable target declarations combine extensions with a bank. The
 * bank replacement/order contract must be closed before generalizing it.
 */
export function getSourceExtendedSoundEntries(raw,soundSet=null){
  if(!raw||typeof raw!=='object'||soundSet)return empty;
  const existing=cache.get(raw);if(existing)return existing;
  const entries=[],extended=raw.SOUND_PLAY_EX;
  // The native parser visits consecutive 1-based EX subtables, stopping on
  // the first absent table/name; it does not flatten arbitrary object keys.
  for(let index=1;extended&&typeof extended==='object';index++){
    const row=extended[index];if(!row||!validName(row[1]))break;
    const time=row[2]??0;if(!validTime(time))continue;
    const conditions=[];
    for(let column=3;Object.hasOwn(row,column);column++){
      if(!Number.isInteger(row[column]))break;
      conditions.push(row[column]);
    }
    entries.push(freezeEntry({field:`SOUND_PLAY_EX:${index}`,kind:'extended',
      name:row[1],time,rate:100,onlyIfLocal:false,loop:false,
      nativeHandleGroup:'condition',deleteConditions:conditions,
      value:{1:time,2:row[1],3:100,4:false}}));
  }
  // Native numbered STATE_SOUND_PLAY tables likewise stop at the first gap.
  for(let index=0;;index++){
    const field=`STATE_SOUND_PLAY${index}`,row=raw[field];if(!row)break;
    if(!validName(row[2])||!validTime(row[1]))continue;
    const rate=row[3]??100;if(!Number.isFinite(rate))continue;
    entries.push(freezeEntry({field,kind:'state',name:row[2],time:row[1],rate,
      onlyIfLocal:flag(row[4]),loop:false,nativeHandleGroup:'state',
      deleteConditions:[],value:{1:row[1],2:row[2],3:rate,4:flag(row[4])}}));
  }
  const result=Object.freeze(entries);cache.set(raw,result);return result;
}

/** Shared by the simulation timer and V0 owned-presentation catch-up. */
export function sourceExtendedSoundEntryForField(raw,soundSet,field){
  return getSourceExtendedSoundEntries(raw,soundSet).find(entry=>entry.field===field)??null;
}

/** This only matches an explicit native enum request. Calling it on state
 * leave, damage, death or a custom flag is the caller's lifecycle contract;
 * the enum itself is not evidence that a callback happens at that point.
 */
export function sourceSoundDeleteConditionMatches(entry,condition){
  return Number.isInteger(condition)&&condition>0&&condition<=5&&
    entry?.nativeHandleGroup==='condition'&&entry.deleteConditions.includes(condition);
}
