/** Traverse actual named resource references. No guessed skill FX aliases. */
import {awakeningAttachmentsFor} from './awakening-effects.mjs';
import {veteranOverheatIconTemplates} from './vc-overheat-icons.mjs';
import {normalizeEffectQuality,particlePresentationBudget,createEffectPresentationPolicy,FULL_EFFECT_QUALITY,ACTIVE_ARMOR_CAST_EFFECT_SET} from '../../packages/effect-runtime/presentation-quality.mjs';
import {originalMeshPlayCount,terminalTransparentMeshTime} from '../../packages/effect-runtime/mesh-play-count.mjs';
import {resolveEffectTemplateKey} from '../../packages/combat-assets/effect-template-key.mjs';
import {rsCommandEffectRoots} from '../../packages/combat-core/rs-effect-bindings.mjs';
import {elesisEffectRoots} from '../../packages/combat-core/elesis-skills.mjs';
import {isAddProfile,isElswordProfile,isElesisProfile,professionIdForProfile} from '../../packages/professions/identity.mjs';
import {getAddSkillResourceRoots} from '../../packages/combat-core/add-skills.mjs';
import {ADD_MOONLIGHT_EXPLOSION_SETS} from '../../packages/combat-core/add-moonlight-source-v45.mjs';
import {addCompiledPrewarmBursts} from './add-compiled-prewarm-v57.mjs';
import {usesNativeMeshGeometry} from './native-particle-geometry.mjs';
import commandBindings from '../../contracts/command-presentation-bindings-v29.json' with {type:'json'};
const elswordSwordCallbackRoots=Object.freeze([
  'EffectSet_VigorStart','EffectSet_DestructionStart','EffectSet_VigorEnd','EffectSet_DestructionEnd',
  'ELSWORD_ANGRY_WIND','MonsterAngryWind','Counter_Particle01',
]);
function enqueueResources(index,value,queue){
  if(typeof value==='string')queue.push(value);
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){
    // Character/mesh animation names may coincide with a particle registry
    // key. They describe motion, not a request to create that effect.
    if(['ANIM_NAME','ANI_NAME','animation'].includes(key))continue;
    const type=key==='PARTICLE_NAME'?8:key==='MAIN_EFFECT_NAME'?4:['NAME','NAME_HYPER'].includes(key)?value.EFFECT_TYPE:undefined;
    enqueueResources(index,typeof child==='string'&&type>=2&&type<=9?resolveEffectTemplateKey(index.templates,child,type):child,queue);
  }
}
function templateClosure(profile,index,roots){
  const queue=[],seen=new Set(),templates=new Set();enqueueResources(index,roots,queue);
  while(queue.length){const name=queue.pop();if(seen.has(name))continue;seen.add(name);
    const template=index.templates[name];if(template){templates.add(name);enqueueResources(index,template.fields,queue);enqueueResources(index,template.events,queue);enqueueResources(index,template.repeated,queue);}
    enqueueResources(index,profile.effectSets?.[name]?.raw,queue);enqueueResources(index,profile.damageEffects?.[name]?.raw,queue);
  }return templates;
}
/** Only actual SwordMan callback resources get one whole-sequence plane
 * reservation per roster owner. This avoids multiplying every skill pool. */
export function collectSwordCallbackTemplates(profile,index){
  return templateClosure(profile,index,isElswordProfile(profile)?elswordSwordCallbackRoots:[]);
}
export function collectSwordCallbackQuadCopies(profile,index,ownerCount){
  const copies=new Map([...collectSwordCallbackTemplates(profile,index)].map(name=>[name,ownerCount]));
  // One Start set contains two overlapping vitality_wake_01 entries at 0
  // and .05s. Count original set members rather than assuming one sequence
  // per reachable template. Different callback sets have distinct tails.
  for(const root of isElswordProfile(profile)?elswordSwordCallbackRoots:[]){
    const members=new Map();
    for(const [key,entry]of Object.entries(profile.effectSets?.[root]?.raw??{}))if(/^EFFECT\d+$/.test(key)&&entry?.NAME){
      const name=resolveEffectTemplateKey(index.templates,entry.NAME,entry.EFFECT_TYPE);
      members.set(name,(members.get(name)??0)+1);
    }
    for(const [name,count]of members)if(copies.has(name))copies.set(name,Math.max(copies.get(name),ownerCount*count));
  }
  return copies;
}
/** These three short cast sequences need independent whole-sequence slots
 * for actual equipped owners. Elesis' initial buff238 displayer and explicit
 * cast can coexist; reserve both without altering either gameplay producer. */
export function collectActiveArmorCastQuadCopies(profile,index,actors){
  const elesis=isElesisProfile(profile);
  if(!elesis&&!isElswordProfile(profile))return new Map();
  const skills=elesis?[28201,28218]:[21201,21218];
  const owners=actors.filter(actor=>(actor.loadout??[]).some(slot=>skills.includes(Number(slot?.skillId)))).length;
  const copies=new Map();if(!owners)return copies;
  for(const [key,entry]of Object.entries(profile.effectSets?.[ACTIVE_ARMOR_CAST_EFFECT_SET]?.raw??{}))if(/^EFFECT\d+$/.test(key)&&entry?.NAME){
    const name=resolveEffectTemplateKey(index.templates,entry.NAME,entry.EFFECT_TYPE);
    if(index.templates[name])copies.set(name,(copies.get(name)??0)+owners*(elesis?2:1));
  }
  return copies;
}
/** Capacity uses the same command owner policy as actor/effect/hit rendering.
 * Shared templates reserve the largest reachable density, never a reduced
 * skill's capacity for an independently full command or structural cue. */
export function collectCommandTemplateQualities(profile,index,effectQuality){
  const quality=normalizeEffectQuality(isAddProfile(profile)?{...effectQuality,sourceFamily:'add'}:effectQuality);
  const policy=createEffectPresentationPolicy(profile,quality),result=new Map();
  const put=(roots,q)=>{for(const name of templateClosure(profile,index,roots)){
    const old=result.get(name);if(!old||q.particleDivisor<old.particleDivisor)result.set(name,q);
  }};
  for(const setName of policy.comboSets)put([setName],policy.effect({setName,skillId:null}));
  for(const name of policy.comboEffects)put([name],policy.effect({name,skillId:null}));
  for(const setName of policy.fullQualityEffectSets)put([setName],FULL_EFFECT_QUALITY);
  put(['DamageImpact','DamageImpactCore','DamageImpactSlash','DamageImpactRed','DamageImpactRingRed','DamageImpactCoreRed','DamageImpactSlashRed'],
    policy.characterHit({origin:{skillId:null}}));
  put(awakeningAttachmentsFor(profile).map(row=>row.template),FULL_EFFECT_QUALITY);
  if(['RF','VC','BM'].includes(professionIdForProfile(profile)))put(['Raven_attackX3Front_Particle01','Smoke_Raven_ComboX03','Smoke_Raven_ComboX01','Flare_Raven_ComboX02'],policy.commandQuality);
  return result;
}
function collectEffectResources(profile,index,loadout,{includeResourceOnly=true,extraRoots=[]}={}){
  const templates=new Set(),effectSets=new Set(),damageEffects=new Set(),seen=new Set(),queue=[];
  const allSkillStates=new Set(profile.skillCatalog.flatMap(s=>s.states??[]));
  const enqueue=value=>enqueueResources(index,value,queue);
  for(const [name,state] of Object.entries(profile.states))if(!allSkillStates.has(name))enqueue(state.raw);
  enqueue(rsCommandEffectRoots(profile));
  enqueue(elesisEffectRoots(profile,loadout));
  enqueue(profile.targetCommandEffectSets);
  enqueue(commandBindings.professions[professionIdForProfile(profile)??profile.professionId]?.dynamicRoots);
  if(isAddProfile(profile)){
    queue.push('EffectSet_AN_Formation_Start','ADD_STR_ToKang');
  }
  // Registered2016 DE aerialZX / dashXXX .01 native callbacks. Both exact
  // original set names are absent from their raw state DSL producers.
  if(profile.target?.unitClass===126)queue.push('EffectSet_AAT_DashJumpCombo_ZZX','EffectSet_ADE_DashCombo_XXX_Bomb');
  // SwordMan's mode transitions and destruction feedback are callback-born,
  // outside the animation/state DSL. In particular neither End set appears
  // in a buff displayer. Prepare their complete authored tails before play.
  if(isElswordProfile(profile))queue.push(...elswordSwordCallbackRoots);
  for(const slot of loadout??[]){
    const skill=profile.skillCatalog.find(s=>s.skillId===Number(slot?.skillId));
    if(isElswordProfile(profile)&&skill?.executor==='CounterAttack')queue.push('RevengeWait');
    enqueue(profile.skillEffectResourceRoots?.[String(slot?.skillId)]);
    if(skill&&isAddProfile(profile))enqueue(getAddSkillResourceRoots(skill,profile));
    for(const state of skill?.states??[])enqueue(profile.states[state]?.raw);
    if(skill?.executor==='ChargedBolt')queue.push('RAVEN_OVER_TAKER_CHARGED_BOLT','Flare_Raven_Overtaker_Sp1a_ChargedBolt02');
    if(skill?.executor==='WildCharge')queue.push('EffectSet_WILD_CHARGE_MAX');
    // Fixed Raven16380..16414, frozen in rf-xcrash-source-v14.json: the
    // original callback creates one of these names outside the state DSL.
    if(skill?.executor==='XCrash')queue.push('RRF_X_CRASH_NODAMAGE','RRF_X_CRASH_NODAMAGE_HYPER');
    // The common Raven Shadow X callback spawns this set outside the state
    // DSL. Its delayed bullet impact and ground flame must prewarm too.
    if(skill?.executor==='ShadowStep'&&profile.effectSets?.EffectSet_Raven_Shadow_Buster)
      queue.push('EffectSet_Raven_Shadow_Buster');
  }
  // Hit reaction and Nasod core are shared by the current playable fixture.
  for(const name of ['RAVEN_NASOD_BALL','CriticalHit01','DamageImpact','DamageImpactCore','DamageImpactSlash',
    'DamageImpactRed','DamageImpactRingRed','DamageImpactCoreRed','DamageImpactSlashRed',
    'GroundShockWave','AirDownTick','DownSmoke','DropDown'])queue.push(name);
  for(const attachment of awakeningAttachmentsFor(profile))queue.push(attachment.template);
  // _ShowOverheatIcon is a compiled callback, so its four original notice
  // textures are absent from state.raw and must be ready before the first cast.
  if(profile.professionId?.toUpperCase()==='VC')queue.push(...veteranOverheatIconTemplates);
  // Revival and guild displays can overlap for every member of the frozen
  // roster. Reserve their actual source burst before play, as for common hits.
  queue.push(...Object.keys(index.battleLife?.templates??{}),...Object.keys(index.castDisplay?.templates??{}));
  for(const buff of Object.values(profile.buffTemplates??{}))enqueue(buff.raw?.DISPLAYER?.BDT_EFFECT_SET);
  enqueue(extraRoots);
  // Only actual command/equipped-skill roots get repeated-child burst pools.
  // The complete callback union below still prepares every original material,
  // but must not reserve every unequipped skill's maximum repeated burst.
  const burstRoots=new Set(queue);
  // Original compiled callbacks also request sets absent from state DSL.
  // Resource-only inclusion warms assets; it does not enable an unknown trigger.
  if(includeResourceOnly){enqueue(profile.resourceOnlyEffectSets);enqueue(profile.resourceOnlyTemplates);}
  // VC's fixed-source callback literals include direct CreateDamage calls,
  // not only AddEffectSet (e.g. Napalm and Ignition Crow).
  if(includeResourceOnly)enqueue(profile.sourceLiteralResources);
  const roots=new Set(queue);
  while(queue.length){
    const name=queue.pop();if(seen.has(name))continue;seen.add(name);
    const t=index.templates[name];if(t){templates.add(name);enqueue(t.fields);enqueue(t.events);enqueue(t.repeated);}
    const effectSet=profile.effectSets?.[name]?.raw;
    if(effectSet)effectSets.add(name);
    const damage=profile.damageEffects?.[name]?.raw;if(damage)damageEffects.add(name);
    enqueue(effectSet);enqueue(damage);
  }
  return {templates,effectSets,damageEffects,roots,burstRoots};
}
export function collectEffectTemplates(profile,index,loadout){return collectEffectResources(profile,index,loadout).templates;}

// Native ProcessNumber stores float endpoints. RandomNumber adds fabs(width)
// to the first endpoint even for reversed ranges (MinMax.cpp); never sort them.
export function effectNumberUpperBound(value){
  if(typeof value==='number'){const number=Math.fround(value);return Number.isFinite(number)?number:null;}
  if(!value||!Array.isArray(value.random)||value.random.length!==2)return null;
  const [a,b]=value.random.map(effectNumberUpperBound);
  if(a===null||b===null)return null;
  const result=Math.fround(a+Math.abs(Math.fround(b-a)));return Number.isFinite(result)?result:null;
}

/** Conservative source emitter multiplicity during one reachable burst.
 * Sum declared descendants instead of assuming every reachable template has
 * one emitter. HIT sequences are created for each accepted target contact;
 * RE_ATTACK=0 permits one per target, and RE_ATTACK=1 is bounded by the main
 * mesh lifetime and the fixed host packet/HIT_GAP. DAMAGE_TIME is a hit count.
 * The sum deliberately does not assume that delayed children cannot overlap.
 */
function collectBurstMultiplicities(profile,index,roots,{burstRoots,burstGroups,unconfirmedRoots,damageLifetimeCaps,effectSetLifetimeCaps,tickSeconds,targetCount,qualityFor,quadTemplates=new Set(),onUnsupported}){
  const result=new Map(),unbounded=new Set();
  const unknown=new Set();
  const note=(name,detail)=>{const key=name+':'+detail;if(!unknown.has(key)){unknown.add(key);onUnsupported({name,detail});}};
  const merge=(into,from,multiple=1)=>{for(const [name,count]of from)into.set(name,(into.get(name)??0)+count*multiple);};
  const children=(template,key)=>template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[]);
  const meshDescendants=(name,seen=new Set())=>{
    const names=new Set();if(seen.has(name))return names;seen.add(name);
    const template=index.templates[name];if(!template)return names;
    if(usesNativeMeshGeometry(template)||quadTemplates.has(name))names.add(name);
    for(const key of ['TraceParticleList','FinalParticleList'])for(const child of children(template,key))
      for(const descendant of meshDescendants(child,seen))names.add(descendant);
    return names;
  };
  const omitChildren=(name,detail)=>{for(const descendant of meshDescendants(name)){
    unbounded.add(descendant);note(descendant,detail);
  }};
  const lifetime=template=>{
    const fields=template?.fields;if(!fields)return null;
    if(fields.LifeType==='LT_TIME'){
      const seconds=effectNumberUpperBound(fields.LifeTime);
      return seconds!==null&&seconds>0?seconds:null;
    }
    if(fields.LifeType==='LT_PLAY_COUNT'){
      // A slow or unresolved AniSpeed cannot borrow the unscaled clip duration
      // as a seconds bound. Unknown playback stays explicitly unsupported.
      if(fields.MeshType!=='X_SKIN_MESH')return null;
      const animation=template.events?.find(event=>event.property==='AniName'&&event.start===0)?.value;
      const name=animation?.animation,count=originalMeshPlayCount(template);
      const duration=template.animationClips?.find(clip=>clip.name===name)?.durationSeconds;
      if(!(Number.isFinite(duration)&&duration>0)||template.events?.some(event=>event.property==='AniSpeed'&&!(typeof event.value==='number'&&event.value>=1)))return null;
      if(count===0){const visualEnd=terminalTransparentMeshTime(template,{opaqueTarget:true});return visualEnd===null?null:visualEnd+2*tickSeconds;}
      if(count===1)return duration+2*tickSeconds;
      // ONE/WAIT retain their end flag; a count3 mesh needs three subsequent
      // global packets, not three animation periods. This is a pool bound.
      if(Number.isSafeInteger(count)&&count>1&&['XAP_ONE','XAP_ONE_WAIT'].includes(animation.playback))return duration+(count+1)*tickSeconds;
      return null;
    }
    return null;
  };
  const particleBirths=(template,{emissionSeconds,triggerCount,triggerTime}={})=>{
    if(template.kind==='mesh')return 1;
    const f=template.fields,cap=effectNumberUpperBound(f.NumParticles),rate=effectNumberUpperBound(f.Emitrate),life=effectNumberUpperBound(f.Lifetime);
    const limit=effectNumberUpperBound(triggerCount??f.TriggerCount??-1),duration=effectNumberUpperBound(triggerTime??f.TriggerTime??-1);
    if([cap,rate,life,limit,duration].some(value=>value===null)||cap<0||rate<0||life<0||limit<-1||duration<-1)return null;
    if(cap===0||rate===0||life===0)return 0;
    const budget=particlePresentationBudget(template,Math.floor(cap),limit,qualityFor(template.name));
    const seconds=Math.min(emissionSeconds??Infinity,duration>=0?duration:Infinity);
    // A live cap bounds concurrency, not cumulative births. Sum all births
    // during a confirmed finite source window, including fractional carry.
    const timeBound=Number.isFinite(seconds)?Math.ceil(rate/budget.divisor*tickSeconds*Math.ceil(seconds/tickSeconds))+1:Infinity;
    const bound=Math.min(budget.limit>=0?Math.floor(budget.limit):Infinity,timeBound);
    return Number.isSafeInteger(bound)?bound:null;
  };
  const damageLifetime=(name,damage)=>{
    const declared=lifetime(index.templates[resolveEffectTemplateKey(index.templates,damage.MAIN_EFFECT_NAME,4)]),cap=damageLifetimeCaps.get(name);
    return cap==null?declared:declared==null?cap:Math.min(declared,cap);
  };
  const acceptedHits=(name,damage)=>{
    const data=damage.DAMAGE_DATA??{};
    if(data.NO_DAMAGE===1||data.NO_DAMAGE===true)return 0;
    if(data.RE_ATTACK==null||data.RE_ATTACK===0||data.RE_ATTACK===false)return targetCount;
    if(data.RE_ATTACK!==1&&data.RE_ATTACK!==true)return null;
    const seconds=damageLifetime(name,damage),gap=effectNumberUpperBound(data.HIT_GAP??0);
    if(seconds===null||seconds<0||gap===null||gap<0)return null;
    // One initial contact plus every declared gap; a packet can deliver at
    // most one contact for this source/target. Keep a boundary packet as well.
    return (Math.ceil(seconds/Math.max(tickSeconds,gap))+1)*targetCount;
  };
  // An AutoDie Trace emitter stops when its owning particle dies. Its already
  // emitted tail survives for the authored child lifetime. Bound simultaneous
  // old tails, not every particle born over a long-lived skill's whole life.
  const traceTail=(name,path=new Set())=>{
    if(path.has(name))return null;
    const t=index.templates[name];if(!t)return null;
    const own=t.kind==='particle'?effectNumberUpperBound(t.fields.Lifetime):lifetime(t);
    if(own===null||own<0)return null;
    const next=new Set(path);next.add(name);let tail=0;
    for(const key of ['TraceParticleList','FinalParticleList'])for(const child of children(t,key)){
      const childTail=traceTail(child,next);if(childTail===null)return null;
      let finalWindow=0;
      if(key==='FinalParticleList'){
        const c=index.templates[child];
        if(c?.kind==='particle'){
          const time=effectNumberUpperBound(c.fields.TriggerTime??-1),count=effectNumberUpperBound(c.fields.TriggerCount??-1),rate=effectNumberUpperBound(c.fields.Emitrate);
          if(time!==null&&time>=0)finalWindow=time;
          else if(count!==null&&count>=0&&rate>0)finalWindow=count/rate+tickSeconds;
          else return null;
        }
      }
      tail=Math.max(tail,childTail+finalWindow);
    }
    return own+tail;
  };
  const concurrentTraceParents=(template,child,cumulative)=>{
    // A finite child tail alone cannot certify an indefinitely emitting
    // parent. Detached Final sequences have their own clocks and Wild
    // Charge can retain its emitter for an unconfirmed hold duration.
    if(cumulative===null)return null;
    if(template.kind!=='particle')return cumulative;
    const cap=effectNumberUpperBound(template.fields.NumParticles),rate=effectNumberUpperBound(template.fields.Emitrate),tail=traceTail(child);
    if(cap===null||rate===null||tail===null||cap<0||rate<0)return cumulative;
    const budget=particlePresentationBudget(template,Math.floor(cap),effectNumberUpperBound(template.fields.TriggerCount??-1),qualityFor(template.name));
    const count=budget.max+Math.ceil(rate/budget.divisor*tickSeconds*Math.ceil(tail/tickSeconds))+1;
    return Math.min(cumulative,count);
  };
  const creationCount=(entry,seconds)=>{
    // DamageEffect.cpp:2043..2060,2290..2309,7110..7114: source count cap,
    // strict loop-end time and the still-live parent bound repeated children.
    const count=effectNumberUpperBound(entry.LOOP_END_COUNT??1);
    if(count===null||!Number.isSafeInteger(count)||count<0)return null;
    // Native checks the count only after a successful first creation, so a
    // declared zero still needs the conservative one-child pool.
    if(count<=1)return 1;
    const at=effectNumberUpperBound(entry.EVENT_TIME??-1),gap=effectNumberUpperBound(entry.LOOP_INTERVAL??0);
    const end=effectNumberUpperBound(entry.LOOP_END_TIME??99999);
    if(at===null||gap===null||end===null||at<0||gap<0)return null;
    const until=Math.min(end,seconds??Infinity);
    if(until<=at)return 0;
    return gap===0?count:Math.min(count,Math.ceil((until-at)/gap));
  };
  const walk=(name,path=new Set(),options={})=>{
    const counts=new Map();if(path.has(name)){
      note(name,'Recursive source effect burst has no confirmed finite multiplicity; recursive pool budget omitted');
      omitChildren(name,'Recursive original Trace/Final chain has no confirmed finite pool upper bound; omitted');
      return counts;
    }
    const next=new Set(path);next.add(name);
    const template=index.templates[name];if(usesNativeMeshGeometry(template)||quadTemplates.has(name))counts.set(name,1);
    if(template){
      const descendantNames=['TraceParticleList','FinalParticleList'].flatMap(key=>children(template,key));
      if(descendantNames.some(child=>meshDescendants(child).size)){
        const births=particleBirths(template,options);
        for(const key of ['TraceParticleList','FinalParticleList'])for(const child of children(template,key)){
          const simultaneous=key==='TraceParticleList'?concurrentTraceParents(template,child,births):births;
          if(simultaneous===null){omitChildren(child,'Unconfirmed finite original parent-particle birth count/window for '+name+'; Trace/Final mesh pool upper bound omitted');continue;}
          if(simultaneous<=0)continue;
          // Native AutoDie ends Trace emission when this parent particle dies;
          // its already-born child tails remain, so conservatively sum them.
          // Final children are detached: they use their own count/time fields.
          const seconds=template.kind==='particle'?effectNumberUpperBound(template.fields.Lifetime):lifetime(template);
          const childOptions=key==='TraceParticleList'&&seconds!==null&&seconds>=0?{emissionSeconds:seconds+2*tickSeconds}:{};
          merge(counts,walk(child,next,childOptions),simultaneous);
        }
      }
    }
    const set=profile.effectSets?.[name]?.raw;
    if(set)for(const [key,entry]of Object.entries(set))if(/^EFFECT\d+$/.test(key)&&entry?.NAME){
      const cap=effectSetLifetimeCaps.get(name);
      // Only a confirmed owner stop bounds an otherwise indefinite set.
      // This window is not inherited by detached Final children above.
      const memberOptions=cap==null?options:{...options,emissionSeconds:Math.min(options.emissionSeconds??Infinity,cap+2*tickSeconds)};
      merge(counts,walk(resolveEffectTemplateKey(index.templates,entry.NAME,entry.EFFECT_TYPE),next,memberOptions));
    }
    const damage=profile.damageEffects?.[name]?.raw;if(!damage)return counts;
    const mainKey=resolveEffectTemplateKey(index.templates,damage.MAIN_EFFECT_NAME,4);
    if(mainKey)merge(counts,walk(mainKey,next,options));
    const mainSeconds=damageLifetime(name,damage);
    for(const [key,entry]of Object.entries(damage)){
      if(/^(?:PASSIVE|START|TIME)_PARTICLE\d+$/.test(key)&&entry?.PARTICLE_NAME)merge(counts,walk(entry.PARTICLE_NAME,next,{
        emissionSeconds:mainSeconds!==null&&mainSeconds>=0?mainSeconds+2*tickSeconds:undefined,
        triggerCount:entry.TRIGGER_COUNT,triggerTime:entry.TRIGGER_TIME}));
      if(/^HIT_PARTICLE\d+$/.test(key)&&entry?.PARTICLE_NAME){
        const hits=acceptedHits(name,damage);
        if(hits!==null)merge(counts,walk(entry.PARTICLE_NAME,next),hits);
        else if(usesNativeMeshGeometry(index.templates[entry.PARTICLE_NAME])||quadTemplates.has(entry.PARTICLE_NAME)){
          if(quadTemplates.has(entry.PARTICLE_NAME))unbounded.add(entry.PARTICLE_NAME);
          note(entry.PARTICLE_NAME,'Unconfirmed accepted-hit burst lifetime/gap/re-attack for '+name+'; parallel HIT pool budget omitted');
        }
      }
      if(/^(?:CREATE|DIE)_DAMAGE_EFFECT\d+$/.test(key)&&entry?.DAMAGE_EFFECT_NAME){
        const count=options.childLoops&&key.startsWith('CREATE_')?creationCount(entry,mainSeconds):1;
        if(count===null)note(entry.DAMAGE_EFFECT_NAME,'Unconfirmed finite CREATE_DAMAGE loop count/window for '+name+'; repeated-child pool omitted');
        else if(count>0)merge(counts,walk(entry.DAMAGE_EFFECT_NAME,next,options),count);
      }
    }
    return counts;
  };
  for(const root of roots)for(const [name,count]of walk(root,new Set(),{childLoops:burstRoots.has(root)}))result.set(name,Math.max(result.get(name)??0,count));
  for(const group of burstGroups){
    const counts=new Map();
    for(const [name,multiple,options]of group)for(const [template,count]of walk(name,new Set(),{childLoops:true})){
      const copies=Math.min(multiple,options?.templateInstanceCaps?.get(template)??multiple);
      counts.set(template,(counts.get(template)??0)+count*copies);
    }
    for(const [name,count]of counts)result.set(name,Math.max(result.get(name)??0,count));
  }
  for(const root of unconfirmedRoots)for(const name of walk(root,new Set(),{childLoops:true}).keys()){
    unbounded.add(name);note(name,'Unconfirmed finite compiled producer duration/count for '+root+'; whole-burst pool upper bound omitted');
  }
  return {multiplicity:result,unbounded};
}

function compiledBurstGroups(profile,loadout){
  const selected=new Set((loadout??[]).map(slot=>Number(slot?.skillId)));
  const profession=professionIdForProfile(profile)??profile.professionId?.toUpperCase();
  if(profession==='DE'&&selected.has(29022)){
    // Fixed Add callback creates six prepared projectiles at once. Resource
    // reachability alone sees the name once and used to leave seventy model
    // copies to be constructed synchronously during the first combat burst.
    return [[['DamageEffect_ATT_Maximum_Strike_Bullet_Projectile',6]]];
  }
  if(profession==='LP'&&selected.has(29205)){
    // ProcessMagnetronDamageEffect owns three original 120-degree orbits.
    return [[['DamageEffect_SA_APT_Magnetron_Dynamo_Start',3]]];
  }
  if(profession==='CA'&&selected.has(28213))return [[
    // The authored cast and its initial DUMMY share one original attack-box
    // template while the persistent buff set starts on its own custom clock.
    ['DamageEffect_SI_A_SDK_INJECTION_STIGMA_DUMMY',1],
    ['DamageEffect_SI_A_SDK_INJECTION_STIGMA',1],
    ['EffectSet_SI_A_SDK_INJECTION_STIGMA_BUFF',1],
  ]];
  if(profession!=='VC')return [];
  if(!profile.skillCatalog.some(skill=>selected.has(Number(skill.skillId))&&skill.executor==='GigaProminence'))return [];
  // Fixed Raven.cpp28,19227..19306: eight loops, two source sets per loop.
  // 19314..19467: both finish branches create two stone and two flame damage
  // instances; only overheat adds one smoke. Normal/overheat are alternatives.
  return [false,true].map(heat=>[
    ['EffectSet_Raven_Giga_Prominence_Flame',16],
    ['RAVEN_GIGA_PROMINENCE_FINISH_STONE',2],
    ['RAVEN_GIGA_PROMINENCE_FINISH'+(heat?'_OVERHEAT':''),2],
    ...(heat?[['RAVEN_GIGA_PROMINENCE_FINISH_SMOKE',1]]:[]),
  ]);
}

function compiledDamageLifetimeCaps(profile){
  const caps=new Map();
  if(profile.target?.unitClass===125){
    // Original Injection Stigma callback owns this hidden999-second helper
    // only while BT433 exists. Native BF470 NORMAL_TIME is11 at every level;
    // budget its actual timed ownership, not999 seconds of periodic hits.
    const times=Object.values(profile.buffFactors?.[470]?.raw?.FINALIZER?.BFT_TIME?.NORMAL_TIME??{});
    if(times.length&&times.every(t=>typeof t==='number'&&Number.isFinite(t)&&t>0))
      caps.set('DamageEffect_SI_A_SDK_INJECTION_STIGMA_Buff',Math.max(...times));
  }
  return caps;
}

function compiledEffectSetLifetimeCaps(profile){
  const caps=new Map();
  if(profile.target?.unitClass===126){
    // markAddStigma/tickAddStigma remove this exact set when the source
    // SA_EFFECTIVE_TIME expires (or earlier on paid return/death). Keep the
    // native declaration separate from this existing Web-owned stop rule.
    const skill=profile.skillCatalog.find(row=>row.skillId===29025),seconds=skill?.raw?.SA_EFFECTIVE_TIME?.[skill.maxLevel];
    if(typeof seconds==='number'&&Number.isFinite(seconds)&&seconds>0)
      caps.set('EffectSetI_SA_ADE_REVERSE_STIGMA_Debuff',seconds);
  }
  return caps;
}

/** One reachable EffectSet burst, not an unbounded actor/recast guarantee.
 * CParticleEventSequence caps live particles, applies TriggerCount, ages old
 * particles before emitting, and carries <~1 fractional birth between frames
 * (ParticleSystem.cpp:3000..3023,3065,3194..3235). Round a lifetime window up to
 * whole web simulation packets, and retain one carry particle as a bound.
 * Unknown numeric declarations stay reported rather than becoming a guess.
 */
export function collectEffectMeshBudget(profile,index,loadout,{tickSeconds=1/60,effectQuality,targetCount=1,moonlightReactions=false}={}){
  if(!(Number.isFinite(tickSeconds)&&tickSeconds>0))throw new TypeError('Positive fixed effect tick required');
  if(!Number.isInteger(targetCount)||targetCount<1)throw new TypeError('Positive opposing-target count required');
  const quality=normalizeEffectQuality(isAddProfile(profile)?{...effectQuality,sourceFamily:'add'}:effectQuality);
  const commandQualities=collectCommandTemplateQualities(profile,index,quality),qualityFor=name=>commandQualities.get(name)??quality;
  const extraRoots=moonlightReactions?ADD_MOONLIGHT_EXPLOSION_SETS:[];
  const {templates,roots,burstRoots}=collectEffectResources(profile,index,loadout,{extraRoots}),demands=new Map(),quadCopies=new Map(),unsupported=[];
  const active=[8,9].includes(profile.target?.unitType)?collectEffectResources(profile,index,loadout,{includeResourceOnly:false,extraRoots}):null;
  const compiledAdd=addCompiledPrewarmBursts(profile,index,loadout,{tickSeconds,targetCount,upperBound:effectNumberUpperBound});
  // Only these source-bounded compiled Add producers opt into whole-sequence
  // quad reservations. Keep the established mesh traversal elsewhere. Plane
  // copies count emitters, not their particles; DrawCount is applied by the
  // renderer per texture. Unknown compiled roots retain one-emitter bounds.
  const addQuadRoots=[...compiledAdd.groups.flatMap(group=>group.map(([name])=>name)),...compiledAdd.unconfirmedRoots];
  const quadTemplates=new Set([...templateClosure(profile,index,addQuadRoots)].filter(name=>{
    const t=index.templates[name];return t.fields.particleType==='PT_3D_PLANE'||t.kind==='particle'&&!t.fields.particleType;
  }));
  const {multiplicity,unbounded}=collectBurstMultiplicities(profile,index,active?.roots??roots,{burstRoots:active?.burstRoots??burstRoots,burstGroups:[...compiledBurstGroups(profile,loadout),...compiledAdd.groups],unconfirmedRoots:compiledAdd.unconfirmedRoots,damageLifetimeCaps:compiledDamageLifetimeCaps(profile),effectSetLifetimeCaps:compiledEffectSetLifetimeCaps(profile),tickSeconds,targetCount,
    qualityFor,quadTemplates,onUnsupported:row=>unsupported.push(row)});
  for(const name of templates){
    const t=index.templates[name];
    if(quadTemplates.has(name)){
      const copies=unbounded.has(name)?1:multiplicity.get(name)??1;
      if(Number.isSafeInteger(copies)&&copies>=0)quadCopies.set(name,copies);
      else {quadCopies.set(name,1);unsupported.push({name,detail:'Unconfirmed finite compiled Add quad-emitter count; single-emitter lower bound retained'});}
    }
    if(!usesNativeMeshGeometry(t))continue;
    const f=t.fields,drawUpper=effectNumberUpperBound(f.DrawCount??1);
    const unknown=detail=>unsupported.push({name,detail});
    if(drawUpper===null||drawUpper<0){unknown('Unconfirmed original DrawCount; mesh pool budget omitted');continue;}
    const draws=Math.floor(drawUpper);if(draws===0)continue;
    if(active&&!active.templates.has(name)){
      // Keep every unequipped source mesh, animation and draw pass compiled.
      // Its concurrent burst belongs to a later equipped roster, not startup.
      demands.set(name,{views:draws,peakParticles:1,drawCount:draws,effectSetInstances:1,burstUpperBound:false,budgetScope:'resource-materials-only'});
      continue;
    }
    let peak=1;
    if(t.kind==='particle'){
      const cap=effectNumberUpperBound(f.NumParticles),rate=effectNumberUpperBound(f.Emitrate),life=effectNumberUpperBound(f.Lifetime);
      const trigger=effectNumberUpperBound(f.TriggerCount??-1);
      if([cap,rate,life,trigger].some(value=>value===null)||cap<0||rate<0||life<0||trigger<-1){
        unknown('Unconfirmed original particle cap/rate/lifetime/count; mesh pool budget omitted');continue;
      }
      const budget=particlePresentationBudget(t,Math.floor(cap),trigger,qualityFor(name));
      const packets=Math.ceil(life/tickSeconds),birthBound=rate===0||life===0?0:Math.ceil(rate/budget.divisor*tickSeconds*packets)+1;
      peak=Math.min(budget.max,birthBound,budget.limit<0?Infinity:Math.floor(budget.limit));
    }
    // A missing burst upper bound must not erase the previously supported
    // finite one-emitter pool. Keep that lower-bound preparation, and expose
    // its limitation rather than labelling it a complete source burst budget.
    const incomplete=unbounded.has(name),instances=incomplete?1:multiplicity.get(name)??1,views=peak*draws*instances;
    if(!Number.isSafeInteger(views)){unknown('Original mesh pool budget exceeds a finite integer; omitted');continue;}
    demands.set(name,{views,peakParticles:peak,drawCount:draws,effectSetInstances:instances,
      ...(incomplete?{burstUpperBound:false,budgetScope:'single-emitter-lower-bound'}:{})});
  }
  return {templates,demands,quadCopies,unsupported,scope:'one-effectset-burst',tickSeconds,targetCount};
}

/** The frozen profile/index resource closure depends on skill IDs, not traits.
 * Keep only the latest plan so editing many combinations cannot grow a cache. */
export function createEffectPrewarmPlanner(profile,index,{effectQuality}={}) {
  let previousKey,previousBudget;
  return (slots,{targetCount=1,moonlightReactions=false}={})=>{
    const key=JSON.stringify([(slots??[]).map(slot=>Number(slot?.skillId)),targetCount,moonlightReactions]);
    if(key===previousKey)return previousBudget;
    const budget=collectEffectMeshBudget(profile,index,slots,{effectQuality,targetCount,moonlightReactions});
    previousKey=key;previousBudget=budget;return budget;
  };
}
