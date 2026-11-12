/** Target DamageSound.lua lookup, consumed at an accepted V5 DamageReact.
 * Source/no-sound guards are independent of HP damage and of critical audio.
 * This pure audio adapter neither consumes combat RNG nor changes hit data. */
import contract from '../../contracts/rf-hit-audio-source-v17.json' with {type:'json'};
const {damageSoundTables,hitTypes,hittedTypes,reactTypes}=contract.bindings;
export function resolveHitSound(data,{hittedType,atStateHittedType=hittedTypes.HTD_NO_SOUND,muted=false}={}){
  if(muted)return null;
  const reaction=data?.REACT_TYPE??reactTypes.RT_NO_DAMAGE;
  if(reaction===reactTypes.RT_NO_DAMAGE||reaction===reactTypes.RT_SENSOR)return null;
  const hit=data.HIT_TYPE??hitTypes.HT_DEFAULT;
  const victim=atStateHittedType!==hittedTypes.HTD_NO_SOUND?atStateHittedType:hittedType;
  if(!Number.isInteger(hit)||!Number.isInteger(victim)||hit===hitTypes.HT_NO_SOUND||victim===hittedTypes.HTD_NO_SOUND)return null;
  const table=damageSoundTables[hit];
  return table?.[victim]||table?.[hittedTypes.HTD_DEFAULT]||damageSoundTables[hitTypes.HT_DEFAULT]?.[hittedTypes.HTD_DEFAULT]||null;
}

/** DamageEffect::OnFrameMove_SoundData: global endpoint is strict, skin
 * EventTimer is strict at the previous endpoint; each record is removed once.
 * The audited RF records all have RATE=100. Other rates remain unsupported,
 * instead of changing combat RNG merely to create a presentation sound. */
export function damageEffectSoundEntries(raw,processed=[],{afterGlobal,beforeAnimation,afterAnimation}={}){
  const done=new Set(processed);
  return Object.entries(raw??{}).filter(([key,entry])=>{
    if(!/^SOUND\d+$/.test(key)||done.has(key)||!entry||typeof entry!=='object')return false;
    const time=entry.EVENT_TIME??0,global=entry.USE_GLOBAL_TIME===true||entry.USE_GLOBAL_TIME===1;
    if(!Number.isFinite(time)||time<0||typeof entry.FILE_NAME!=='string'||!entry.FILE_NAME)return false;
    const t=Math.fround(time);
    return global?afterGlobal>t:beforeAnimation<t&&afterAnimation>=t;
  }).sort(([a],[b])=>Number(a.slice(5))-Number(b.slice(5))).map(([key,entry])=>({key,name:entry.FILE_NAME,rate:entry.RATE??100,
    clock:entry.USE_GLOBAL_TIME===true||entry.USE_GLOBAL_TIME===1?'mesh-global':'mesh-animation',time:entry.EVENT_TIME??0}));
}
