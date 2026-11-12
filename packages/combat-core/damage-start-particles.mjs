/** Target START_PARTICLE entries, dispatched once by the damage effect's
 * first live frame. Fixed reference: DamageEffect2423–2432,4793–4814.
 * Particle birth/emission/texture execution remains in the visual runtime. */
export function damageStartParticleEntries(raw){
  if(!raw || typeof raw!=='object')return [];
  return Object.entries(raw).filter(([key])=>/^START_PARTICLE\d+$/.test(key))
    .sort(([a],[b])=>Number(a.slice(14))-Number(b.slice(14)))
    .map(([key,entry])=>({key,entry:structuredClone(entry)}));
}

/** Source time-particle records retain separate global / mesh clocks.
 * First activation is one-shot; their particle sequence can TRACE afterwards. */
export function damageTimedParticleEntries(raw,processed=[],{beforeGlobal,afterGlobal,beforeAnimation,afterAnimation}={}){
  const done=new Set(processed);
  return Object.entries(raw??{}).filter(([key,entry])=>{
    if(!/^TIME_PARTICLE\d+$/.test(key)||done.has(key)||!Number.isFinite(entry.EVENT_TIME)||entry.EVENT_TIME<0)return false;
    const before=entry.USE_GLOBAL_TIME===1?beforeGlobal:beforeAnimation;
    const after=entry.USE_GLOBAL_TIME===1?afterGlobal:afterAnimation;
    const time=Math.fround(entry.EVENT_TIME);
    // Native global EventTimer is strict at the new endpoint; skin EventTimer
    // is strict at the previous endpoint (Mesh2677 / SkinAnim1350).
    return entry.USE_GLOBAL_TIME===1?before<=time&&after>time:before<time&&after>=time;
  }).sort(([a],[b])=>Number(a.slice(13))-Number(b.slice(13)))
    .map(([key,entry])=>({key,entry:structuredClone(entry)}));
}
