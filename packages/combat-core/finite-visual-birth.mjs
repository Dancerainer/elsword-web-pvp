// This is a bounded transport classification, not a replacement for native
// particle lifetime. Long-lived/owner-stopped visuals require live identities.
// Cache by the frozen profile: births never traverse the template tree twice.
const cache=new WeakMap(),MAX_BIRTH_SECONDS=30;
const positive=n=>Number.isFinite(n)&&n>0;
function interval(value){
  if(Number.isFinite(value)){const n=Math.fround(value);return Number.isFinite(n)?[n,n]:null;}
  const pair=value?.random;
  if(!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isFinite))return null;
  // Native RandomNumber adds abs(width) to its FIRST bound, even if reversed.
  const [a,b]=pair.map(Math.fround),upper=a+Math.abs(b-a);
  return Number.isFinite(Math.fround(upper))?[a,upper]:null;
}
const children=(template,key)=>template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[]);
function duration(profile,name,traceTail=false,ancestors=new Set()){
  const t=profile.effectTemplates?.[name];
  if(!t||!t.fields||t.unsupported?.length||ancestors.has(name)||ancestors.size>6)return null;
  const stack=new Set(ancestors);stack.add(name);const f=t.fields;let life,emission=0;
  if(t.kind==='particle'){
    const lifetime=interval(f.Lifetime),rate=interval(f.Emitrate),max=interval(f.NumParticles);
    if(!lifetime||!positive(lifetime[0])||!rate||!positive(rate[0])||!max||max[0]<1)return null;
    life=lifetime[1];
    if(!traceTail){
      const time=interval(f.TriggerTime),count=interval(f.TriggerCount);let window=Infinity;
      if(time&&time[0]>=0)window=time[1];
      // Include worst-case capacity stalls. It is an upper bound, not a
      // guessed original duration or a newly authored emission policy.
      if(count&&count[0]>=0)window=Math.min(window,count[1]/rate[0]+Math.ceil(count[1]/Math.floor(max[0]))*life);
      if(!Number.isFinite(window))return null;emission=window;
    }
  }else if(t.kind==='mesh'){
    if(f.LifeType==='LT_TIME'){
      const lifetime=interval(f.LifeTime);if(!lifetime||!positive(lifetime[0]))return null;life=lifetime[1];
    }else if(f.LifeType==='LT_PLAY_COUNT'){
      const animations=t.events?.filter(e=>e.property==='AniName')??[],animation=animations[0];
      if(animations.length!==1||animation.start!==0||animation.fade||f.MeshType!=='X_SKIN_MESH'||
        !['XAP_ONE','XAP_ONE_WAIT','XAP_LOOP'].includes(animation.value?.playback)||
        !Number.isSafeInteger(f.PlayCount)||f.PlayCount<=0||t.animationRequiresUnconfirmedRate||t.missingExplicitTickRate)return null;
      const period=t.animationClips?.find(c=>c.name===animation.value.animation)?.durationSeconds;
      let speed=1;for(const e of t.events.filter(e=>e.property==='AniSpeed')){
        const value=interval(e.value);if(!value||!positive(value[0]))return null;speed=Math.min(speed,value[0]);
      }
      if(!positive(period))return null;life=period*f.PlayCount/speed;
    }else return null;
  }else return null;
  let tail=0;
  for(const key of ['TraceParticleList','FinalParticleList'])for(const child of children(t,key)){
    // Trace children stop emission when their parent dies (SetAutoDie), but
    // keep their already-born particle tails; final children start normally.
    const childLife=duration(profile,child,key==='TraceParticleList',stack);
    if(childLife===null)return null;tail=Math.max(tail,childLife);
  }
  const total=emission+life+tail;return positive(total)&&total<=MAX_BIRTH_SECONDS?total:null;
}
function finiteName(profile,name){
  let names=cache.get(profile);if(!names){names=new Map();cache.set(profile,names);}
  if(!names.has(name))names.set(name,duration(profile,name)!==null);
  return names.get(name);
}
/** VC finite pure-visual births are reconstructed from frozen declarations,
 * never from sender-supplied lifetime/definitions. They remain out of the live
 * combat list. RF/LK keep the separately audited RST_ReadyPM contract. */
export function isFiniteVisualBirth(profile,effect){
  if(!effect?.name||effect.buffTemplateId||effect.sourceArcStartMesh||effect.sourceSetTargetMesh||effect.sourceSkillMeshControl||Object.hasOwn(effect,'sourceVeteranTargetId')||profile.damageEffects?.[effect.name]||
    (effect.name!=='RST_ReadyPM'&&(profile.target?.unitClass!==115||!finiteName(profile,effect.name))))return false;
  // DeleteOverHeatObject plays this direct, one-shot close animation. Its
  // network attachment key is separately validated/rebuilt by the receiver.
  if(profile.target?.unitClass===115&&effect.name==='RVC_OverHeat_Object_End'&&effect.sourceVeteranAttachment==='overheat-arm')return true;
  return Object.entries(profile.effectSets?.[effect.setName]?.raw??{}).some(([key,definition])=>
    /^EFFECT\d+$/.test(key)&&definition.NAME===effect.name&&
    (!effect.definitionMember||effect.definitionMember===key));
}
