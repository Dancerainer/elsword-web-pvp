/** 2016 declaration interpreter. Defaults/emission order: reference-V5
 * KTDGParticleSystem.h CParticle::Init and .cpp:2735,3000,3194,5039,5246.
 * Presentation has its own seeded RNG; it never changes combat randomness.
 * Target RNG and native frame scheduling have not been measured. */
import {normalizeEffectQuality,particlePresentationBudget} from './presentation-quality.mjs';
import {isParticleControlEvent,createParticleControlEvents,advanceParticleEventClock,runParticleControlEvents} from './particle-control-events.mjs';
import {originalMeshPlayCount,terminalTransparentMeshTime} from './mesh-play-count.mjs';
export function seededRandom(seed=2016){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296;};}
export function resolveValue(value,rng){
  if(Array.isArray(value))return value.map(v=>resolveValue(v,rng));
  if(value&&typeof value==='object'&&Array.isArray(value.random)){
    // ProcessNumber stores float bounds before RandomNumber compares them.
    // Distinct JS decimals can become the same native float and consume no rand.
    const [min,max]=value.random.map(v=>Math.fround(resolveValue(v,rng)));
    if(!Number.isFinite(min)||!Number.isFinite(max))throw Error('Invalid effect random interval');
    // MinMax.cpp RandomNumber(float,float): equal bounds return before rand;
    // reversed bounds add fabs(width) to the FIRST bound, without sorting.
    if(min===max)return min;
    if(rng.nativeRandom)return rng.nativeRandom.randomFloat(min,max,Math.floor(rng()*32768));
    return Math.fround(Math.fround(min)+Math.fround(Math.fround(Math.abs(Math.fround(max)-Math.fround(min)))*Math.fround(rng())));
  }
  return value;
}
// CParticle::Init, KTDGParticleSystem.h:238..245,255: native UV/DirSpeed
// initial values. These only initialize the sampled channels, not GPU bindings.
const defaults={Color:[1,1,1,1],Size:[1,1,1],Rotate:[0,0,0],Velocity:[0,0,0],Scale:1,Stretch:1,DirSpeed:0,AniSpeed:1,Tex0UV:[0,0],Tex1UV:[0,0],Tex2UV:[0,0]};
const properties=new Map([...Object.keys(defaults),'Texture','Texture1','Texture2','AniName','SlashTrace','SlashTraceTip','Crash','ResetCrash','EventTimer'].map(name=>[name.toUpperCase(),name]));
const canonicalProperty=property=>properties.get(property.toUpperCase())??property;
const numericShape=(a,b)=>Array.isArray(b)?Array.isArray(a)&&a.length===b.length&&b.every((v,i)=>numericShape(a[i],v)):typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b);
const unsupportedTiming={
  // Crash ignores IsFade(), periodically resamples at NowResetCrash>=ResetCrash
  // and is cleared by render; it cannot be represented by a stateless lerp.
  // Original bodies: KTDGParticleSystem.cpp:2546..2576; render:4743..4744.
  Crash:'Original periodic Crash random sampling and render-time reset are not executed',
  ResetCrash:'Original ResetCrash timer updates are not executed',
  EventTimer:'Original particle event-clock reset is not executed',
};
const lerp=(a,b,t)=>Array.isArray(b)?b.map((v,i)=>lerp(a[i],v,t)):typeof b==='number'?a+(b-a)*t:b;
export function compileEvents(template,rng=()=>.5){
  const channels=new Map();
  channels.unsupported=[];
  for(const [nativeEventId,declaration] of template.events.entries()){
    const event={...declaration,property:canonicalProperty(declaration.property)};
    if(unsupportedTiming[event.property]){
      channels.unsupported.push({event:declaration,detail:unsupportedTiming[event.property]});continue;
    }
    const compiled={...event,value:resolveValue(event.value,rng)};
    // OpenTexture assigns the declaration-list index, not a filename hash.
    // Keep it on the compiled event so repeated names retain distinct groups.
    if(event.property==='Texture')compiled.nativeTextureId=nativeEventId;
    if(event.fade&&event.end>event.start&&!numericShape(defaults[event.property],compiled.value)){
      channels.unsupported.push({event:declaration,detail:'Fade has no confirmed numeric initial value or compatible vector shape'});continue;
    }
    if(!channels.has(event.property))channels.set(event.property,[]);
    channels.get(event.property).push(compiled);
    // CParticleEvent_Scale (.cpp:1909) modifies Size at that event. A later
    // absolute Size/fade must not retain a permanent global scale multiplier.
    if(event.property==='Scale'){
      if(!channels.has('Size'))channels.set('Size',[]);
      channels.get('Size').push({...compiled,scaleOperation:true});
    }
  }
  for(const channel of channels.values())channel.sort((a,b)=>a.start-b.start);
  // Frozen per-particle values; this plan never resamples a random declaration.
  // Flat numeric vectors use a reusable destination instead of allocating a
  // new vector for every intermediate fade at every simulation packet.
  channels.samplingPlan=[...channels].map(([property,events])=>({property,events,initial:defaults[property],
    initialRequired:events[0].scaleOperation||events[0].fade&&events[0].end>events[0].start,
    scalar:typeof defaults[property]==='number'&&events.every(event=>typeof event.value==='number'&&Number.isFinite(event.value)),
    vector:Array.isArray(defaults[property])&&events.every(event=>event.scaleOperation?
      typeof event.value==='number'&&Number.isFinite(event.value):
      Array.isArray(event.value)&&event.value.length===defaults[property].length&&event.value.every(Number.isFinite))}));
  return channels;
}
export function sampleProperty(channels,property,age){
  return sampleCanonicalProperty(channels,canonicalProperty(property),age);
}
function sampleCanonicalProperty(channels,property,age){
  let value=defaults[property]??null;
  for(const event of channels.get(property)??[]){
    if(age<event.start)break;
    const target=event.scaleOperation?value.map(n=>Math.fround(Math.fround(n)*Math.fround(event.value))):event.value;
    if(event.fade&&event.end>event.start){
      // An unsupported/malformed vector never acquires invented zero values.
      if(!numericShape(value,target))continue;
      value=lerp(value,target,Math.max(0,Math.min(1,(age-event.start)/(event.end-event.start))));
    }
    else value=target;
  }
  return value;
}
export function sampleEvents(channels,age){
  // Undeclared channels retain the original constructor values. Visiting only
  // authored channels avoids rebuilding a Set and temporary [name,value]
  // arrays for every spark, while preserving key order and sampled values.
  const values={...defaults};
  for(const property of channels.keys())values[property]=sampleProperty(channels,property,age);
  return values;
}
/** Same stateless authored-channel evaluation as sampleEvents, with particle-
 * owned vectors. No result aliases a declaration, another particle or defaults.
 * Non-numeric/unknown channels retain the bounded legacy evaluator. */
export function createEventSample(channels){
  const values={};for(const [property,value] of Object.entries(defaults))values[property]=Array.isArray(value)?[...value]:value;
  return sampleEventsToRef(channels,0,values);
}
export function sampleEventsToRef(channels,age,values){
  for(const plan of channels.samplingPlan){const {property,events}=plan;
    if(plan.scalar){
      let value=plan.initial;
      for(const event of events){if(age<event.start)break;
        if(event.fade&&event.end>event.start){if(!Number.isFinite(value))continue;
          value=value+(event.value-value)*Math.max(0,Math.min(1,(age-event.start)/(event.end-event.start)));
        }else value=event.value;
      }
      values[property]=value;continue;
    }
    if(!plan.vector){values[property]=sampleCanonicalProperty(channels,property,age);continue;}
    const current=values[property],initial=plan.initial;
    // An active first absolute event overwrites every component before any
    // fade/Scale can read it. Retain the reset for pre-start/default samples.
    if(plan.initialRequired||age<events[0].start)for(let i=0;i<initial.length;i++)current[i]=initial[i];
    for(const event of events){if(age<event.start)break;
      const ratio=event.fade&&event.end>event.start?Math.max(0,Math.min(1,(age-event.start)/(event.end-event.start))):null;
      for(let i=0;i<current.length;i++){
        const target=event.scaleOperation?Math.fround(Math.fround(current[i])*Math.fround(event.value)):event.value[i];
        current[i]=ratio===null?target:current[i]+(target-current[i])*ratio;
      }
    }
  }
  return values;
}
const children=(template,key)=>template.repeated?.[key]??(template.fields[key]?[template.fields[key]]:[]);
// D3DXMatrixRotationYawPitchRoll + D3DXVec3Transform, native left-handed units.
// Roll, pitch, then yaw; KTDGParticleSystem.h:352..390 and .cpp:5135..5155.
export function rotateNative(vector,degrees){
  const [x,y,z]=degrees.map(n=>n*Math.PI/180),[a,b,c]=vector;
  const rx=a*Math.cos(z)-b*Math.sin(z),ry=a*Math.sin(z)+b*Math.cos(z);
  const py=ry*Math.cos(x)-c*Math.sin(x),pz=ry*Math.sin(x)+c*Math.cos(x);
  return [rx*Math.cos(y)+pz*Math.sin(y),py,-rx*Math.sin(y)+pz*Math.cos(y)];
}
function rotationBasis(degrees,target={}){const x=degrees[0]*Math.PI/180,y=degrees[1]*Math.PI/180,z=degrees[2]*Math.PI/180;
  target.cx=Math.cos(x);target.sx=Math.sin(x);target.cy=Math.cos(y);target.sy=Math.sin(y);target.cz=Math.cos(z);target.sz=Math.sin(z);return target;}
function rotateWithBasisToRef(vector,basis,target){const [a,b,c]=vector,{cx,sx,cy,sy,cz,sz}=basis;
  const rx=a*cz-b*sz,ry=a*sz+b*cz,py=ry*cx-c*sx,pz=ry*sx+c*cx;
  target[0]=rx*cy+pz*sy;target[1]=py;target[2]=-rx*sy+pz*cy;return target;
}
export function createEffectRuntime({index,seed=2016,nativeRandom,effectQuality,opaqueTarget=false,uvConsumer=()=>false,onUnsupported=()=>{},onBirth=()=>{},onDeath=()=>{}}){
  const quality=normalizeEffectQuality(effectQuality);
  let rng=seededRandom(seed),serial=0;
  rng.nativeRandom=nativeRandom;
  const emitters=new Map(),particles=new Map(),notes=new Set();
  function note(id,detail){if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}}
  const f32=Math.fround,velocitySpecs=new WeakMap(),displaySpecs=new WeakMap(),gravitySpecs=new WeakMap(),packetEmitters=[],displayChannels=new WeakMap();
  const zeroGravity=[0,0,0];
  // Fixed declarations have the same immutable channel/event sampling plan
  // for every particle. Only the sampled destination belongs to a particle.
  // Keep random declarations on the original per-birth resolution path so
  // native random consumption and each particle's frozen values stay exact.
  const randomValue=value=>Array.isArray(value)?value.some(randomValue):
    !!(value&&typeof value==='object'&&Array.isArray(value.random));
  function channelsFor(display){
    const cached=displayChannels.get(display);
    if(cached)return cached;
    if(cached===null)return compileEvents(display,rng);
    if(display.events.some(event=>randomValue(event.value))){
      displayChannels.set(display,null);return compileEvents(display,rng);
    }
    const channels=compileEvents(display,rng);displayChannels.set(display,channels);return channels;
  }
  function gravityFor(template){let spec=gravitySpecs.get(template);if(!spec){const declaration=template.fields.Gravity??zeroGravity;
      spec={declaration,constant:Array.isArray(declaration)&&declaration.length===3&&declaration.every(Number.isFinite)};gravitySpecs.set(template,spec);}
    return spec.constant?spec.declaration:resolveValue(spec.declaration,rng);
  }
  function velocityEvents(template){
    let events=velocitySpecs.get(template);if(events)return events;
    events=template.events.filter(event=>canonicalProperty(event.property)==='Velocity').map(event=>({...event,start:f32(event.start),end:f32(event.end)}));
    if(events.some(event=>!Number.isFinite(event.start)||!Number.isFinite(event.end)||event.end<event.start))
      note(template.name+':velocity-time','Original Velocity event time is not supported');
    velocitySpecs.set(template,events);return events;
  }
  // Fixed V5 KTDX.h:330,375 enables both SIMULATION and VELOCITY_ACCUM_BUG_FIX.
  // This mirrors .h:558..562 and .cpp:1988..2056,5486..5488 literally, including
  // the two consecutive velocity additions in the native fade body.
  function updateVelocityAccum(p,time){
    if(p.velocityEventTime<time){const delta=f32(time-p.velocityEventTime);
      for(let i=0;i<3;i++)p.velocityAccum[i]=f32(p.velocityAccum[i]+f32(p.velocity[i]*delta));}
    p.velocityEventTime=time;
  }
  function velocityValue(p,event){
    const value=resolveValue(event.value,rng);
    if(!Array.isArray(value)||value.length!==3||!value.every(n=>typeof n==='number'&&Number.isFinite(f32(n)))){
      note(p.name+':velocity-event','Original Velocity requires a finite three-float vector; unsupported event omitted');return null;}
    return value.map(f32);
  }
  function runVelocityEvent(p,event,oldTime,newTime){
    if(!Number.isFinite(event.start)||!Number.isFinite(event.end)||event.end<event.start){
      note(p.name+':velocity-time','Original Velocity event time is not supported');return;}
    if(!event.fade){const value=velocityValue(p,event);if(!value)return;
      updateVelocityAccum(p,event.start);p.velocity=value;return;}
    if(oldTime<=event.start){const value=velocityValue(p,event);if(!value)return;
      updateVelocityAccum(p,event.start);p.velocityFinal=value;}
    const old2=Math.max(p.velocityEventTime,event.start),new2=Math.min(newTime,event.end);
    if(old2<new2){const ratio=Math.max(0,Math.min(1,f32(f32(new2-old2)/f32(event.end-old2))));
      for(let i=0;i<3;i++){p.velocityRemain[i]=f32(p.velocityFinal[i]-p.velocity[i]);p.velocity[i]=f32(p.velocity[i]+f32(p.velocityRemain[i]*f32(ratio*.5)));}
      updateVelocityAccum(p,new2);
      for(let i=0;i<3;i++)p.velocity[i]=f32(p.velocity[i]+f32(p.velocityRemain[i]*ratio));
    }
    if(event.end<=newTime)for(let i=0;i<3;i++)p.velocity[i]=p.velocityFinal[i];
  }
  function runVelocityEvents(p,oldTime,newTime){
    for(const event of p.velocityEvents){
      const active=event.fade?newTime>=event.start&&oldTime<event.end:
        oldTime<event.start&&newTime>=event.start||event.start===0&&oldTime===0;
      if(active)runVelocityEvent(p,event,oldTime,newTime);
    }
    updateVelocityAccum(p,newTime);
  }
  function add(name,options={}){
    const template=index.templates[name];
    if(!template){note(name,'Original template not present in bounded effect index');return null;}
    if(template.unsupported.length){note(name+':dsl',JSON.stringify(template.unsupported));return null;}
    if(template.kind==='mesh'&&template.fields.LifeType==='LT_PLAY_COUNT'){
      const animation=template.events.find(e=>e.property==='AniName'&&e.start===0)?.value;
      const clip=template.animationClips?.find(c=>c.name===animation?.animation),count=originalMeshPlayCount(template);
      if(template.fields.MeshType!=='X_SKIN_MESH'||!clip?.durationSeconds||!Number.isSafeInteger(count)||count<0||!['XAP_LOOP','XAP_ONE','XAP_ONE_WAIT'].includes(animation.playback)){
        note(name+':lifetime','Play-count requires a confirmed skin period, source playback mode and nonnegative literal count (constructor default zero)');return null;
      }
    }
    if(options.depth>6){note(name+':cycle','Recursive effect chain exceeds supported depth');return null;}
    const fields=template.fields,id=++serial;
    const initialRotation=value=>(value??options.rotate??[0,0,0]).map((n,i)=>n+(i===1&&options.facing<0?180:0));
    const emitter={id,name,template,options,axis:initialRotation(options.axisRotate),addRotate:initialRotation(options.addRotate),age:0,count:0,excess:0,done:false,particles:new Set(),position:[...(options.position??[0,0,0])],oldPosition:[...(options.position??[0,0,0])],gap:[0,0,0],
      max:Math.floor(resolveValue(fields.NumParticles??0,rng)),limit:options.triggerCount??resolveValue(fields.TriggerCount??-1,rng),
      duration:options.triggerTime??resolveValue(fields.TriggerTime??-1,rng)};
    emitter.sourceMax=emitter.max;emitter.sourceLimit=emitter.limit;emitter.firstSourceCarry=0;
    emitter.quality=options.effectQuality===undefined?quality:normalizeEffectQuality(options.effectQuality);
    emitter.firstSourcePacket=false;
    Object.assign(emitter,particlePresentationBudget(template,emitter.sourceMax,emitter.sourceLimit,emitter.quality));
    emitters.set(id,emitter);
    if(template.kind==='mesh'){
      const lifetime=resolveValue(fields.LifeTime??0,rng);
      birth(emitter,lifetime>0?lifetime:Infinity);emitter.done=true;
    }
    return emitter;
  }
  function birth(emitter,lifetime){
    const {template,options}=emitter,fields=template.fields;
    const radius=resolveValue(fields.Emitradius??[0,0,0],rng),id=++serial;
    const axis=[...emitter.axis],offset=rotateNative(radius,axis);
    // Particle Velocity events are executed at their native activation time,
    // rather than sampling a future endpoint before the current movement.
    const particle=template.kind==='particle';let display=displaySpecs.get(template);
    if(!display){display=particle?{...template,events:template.events.filter(event=>canonicalProperty(event.property)!=='Velocity'&&!isParticleControlEvent(event))}:template;displaySpecs.set(template,display);}
    const p={id,emitterId:emitter.id,name:emitter.name,template,options,axis,visualRotation:[...emitter.addRotate],axisBasis:rotationBasis(axis),move:[0,0,0],age:0,lifetime,nativeLifetime:f32(lifetime),channels:channelsFor(display),position:emitter.position.map((n,i)=>n+offset[i]),previousPosition:[0,0,0],velocity:[0,0,0],children:[],facing:options.facing??1};
    for(const unsupported of p.channels.unsupported)note(p.name+':event:'+canonicalProperty(unsupported.event.property),unsupported.detail);
    for(const uv of ['Tex0UV','Tex1UV','Tex2UV'])if(p.channels.has(uv)&&!uvConsumer(template,uv))note(p.name+':uv-render:'+uv,'Original UV offsets are sampled; texture-coordinate rendering is not implemented');
    if(template.kind==='mesh'&&fields.LifeType==='LT_PLAY_COUNT'){
      const name=sampleEvents(p.channels,0).AniName?.animation;
      p.meshPeriod=template.animationClips.find(c=>c.name===name).durationSeconds;
      p.meshAnimationTime=0;p.meshEndPending=false;p.meshPlayCount=0;p.meshMaxPlayCount=originalMeshPlayCount(template);
      p.meshLoop=sampleEvents(p.channels,0).AniName?.playback==='XAP_LOOP';
      p.meshStopped=false;p.presentationRetireAfter=terminalTransparentMeshTime(template,{opaqueTarget});
    }
    p.particleControl=particle?createParticleControlEvents(template):null;
    if(p.particleControl)runParticleControlEvents(p.particleControl,value=>resolveValue(value,rng));
    p.values=createEventSample(p.channels);p.previousVelocity=[...p.values.Velocity];p.velocity=[...p.values.Velocity];
    if(particle){p.velocityEvents=velocityEvents(template);p.velocityFinal=[0,0,0];p.velocityRemain=[0,0,0];p.velocityAccum=[0,0,0];p.velocityEventTime=0;
      // CreateNewParticle .cpp:5191..5200 invokes every time-zero event, even
      // fades, with elapsed=0. SetVelocity(false) leaves the first packet empty.
      for(const event of p.velocityEvents)if(event.start===0)runVelocityEvent(p,event,0,0);
      p.values.Velocity=[...p.velocity];}
    if(!(lifetime>0))return;
    emitter.count++;emitter.particles.add(id);particles.set(id,p);onBirth(p);
    for(const name of children(template,'TraceParticleList')){
      // Fixed V5 .cpp:5246 calls CreateSequence(NULL, child, position, -1...)
      // with no parent axis, overrides, attachment or clock. Only the ordinary
      // parent-position link survives (.h:431..465); each child uses its own
      // constructor/template. ScaleByUnit's conditional native copy is a
      // separate, unmodelled quantity, not the EffectSet options.scale.
      const child=add(name,{effectQuality:emitter.quality,traceMore:false,parentParticleId:id,position:p.position,depth:(options.depth??0)+1});if(child)p.children.push(child.id);
    }
    return p;
  }
  // CKTDGPicChar::DrawText calls CreateNewParticle directly, independent of
  // Emitrate (the original UI sequences use zero). This emits one immediate
  // particle and retains the normal declaration/lifetime/event interpreter.
  function emitParticle(name,options={}){
    const template=index.templates[name];
    if(!template||template.kind!=='particle')return null;
    const emitter=add(name,options);if(!emitter)return null;
    const p=birth(emitter,resolveValue(template.fields.Lifetime??0,rng));
    emitter.done=true;return p??null;
  }
  function retireParticle(p,final=false){
    // CParticle::ClearTraceSeqList calls SetAutoDie, not DestroyInstanceHandle
    // (KTDGParticleSystem.h:471..486,1247..1251). Detach before deleting the
    // parent so the next frame cannot force-delete an existing child tail.
    for(const id of p.children){const child=emitters.get(id);if(child){child.options.parentParticleId=null;stop(id);}}
    if(final)for(const name of children(p.template,'FinalParticleList')){
      // Like Trace children, native .cpp:3069 passes NULL as the owner and
      // literal default overrides. An expired parent's axis, EffectSet scale,
      // trigger count or attachment must not leak into the independent tail.
      add(name,{effectQuality:emitters.get(p.emitterId)?.quality??quality,traceMore:false,parentParticleId:null,position:p.position,depth:(p.options.depth??0)+1});
    }
    onDeath(p);particles.delete(p.id);emitters.get(p.emitterId)?.particles.delete(p.id);
  }
  function stop(id,immediate=false){
    const e=emitters.get(id);if(!e)return;e.done=true;
    if(immediate){for(const pId of [...e.particles]){const p=particles.get(pId);if(p)retireParticle(p);}emitters.delete(id);}
  }
  // CX2GameUnit::PlaySequenceByTriggerCount updates a retained per-unit
  // sequence: SetPosition/SetLandPosition/SetEmitRate/SetTriggerCount. It does
  // not destroy old particles or reset the sequence clock/emission carry.
  function retrigger(id,{position,landPosition,emitRate,triggerCount,effectQuality}={}){
    const e=emitters.get(id);if(!e)return null;
    if(position){e.position=[...position];e.options.position=[...position];}
    if(landPosition!=null)e.options.landPosition=landPosition;
    if(emitRate!=null)e.options.emitRate=emitRate;
    if(triggerCount!=null)e.sourceLimit=triggerCount;
    if(effectQuality!==undefined)e.quality=normalizeEffectQuality(effectQuality);
    e.firstSourcePacket=false;
    Object.assign(e,particlePresentationBudget(e.template,e.sourceMax,e.sourceLimit,e.quality));
    e.count=0;e.firstSourceCarry=0;e.done=false;return e;
  }
  function step(dt,state){
    // Snapshot sequence membership once, retaining native next-packet child
    // processing without allocating another array for every packet.
    packetEmitters.length=0;for(const emitter of emitters.values())packetEmitters.push(emitter);
    for(const e of packetEmitters){
      if(e.options.cancel?.(state)){stop(e.id,true);continue;}
      // SetParticleData updates the sequence axes before its particle phase.
      // New particles copy both; existing Trace particles update movement axes
      // only AFTER their current movement (.cpp3091/5189/5242). Their visual
      // AddRotate remains the value copied at birth, including DirSpeed.
      const orientation=e.options.rotationSource?.(state);
      if(orientation)for(let i=0;i<3;i++){e.axis[i]=orientation.axis[i];e.addRotate[i]=orientation.addRotate[i];}
      const parent=e.options.parentParticleId?particles.get(e.options.parentParticleId):null;
      if(e.options.parentParticleId&&!parent){stop(e.id,true);continue;}
      const anchor=(parent?.tracePosition??parent?.position)??e.options.anchor?.(state);
      for(let i=0;i<3;i++){e.oldPosition[i]=e.position[i];if(anchor)e.position[i]=anchor[i];e.gap[i]=e.position[i]-e.oldPosition[i];}
      if(e.duration>=0&&e.age>=e.duration||e.limit>=0&&e.count>=e.limit)e.done=true;
      e.age+=dt;
      const gap=e.gap;
      for(const id of e.particles){
        const p=particles.get(id);if(!p)continue;
        // EffectSet SetPosition(...,true,true) moves even a particle that will
        // expire during this packet. FinalParticleList must use its new position.
        const traceMore=e.template.kind==='particle'&&e.options.traceMore===true;
        if(traceMore)for(let i=0;i<3;i++)p.position[i]+=gap[i];
        // Mesh PlayProcess reads the previous SkinAnim end pulse before the
        // wrapper advances SkinAnim; do not substitute period*PlayCount time.
        if(p.meshEndPending){
          p.meshPlayCount++;
          if(p.meshPlayCount===p.meshMaxPlayCount){retireParticle(p,true);continue;}
          if(p.meshLoop)p.meshEndPending=false;
        }
        for(let i=0;i<3;i++)p.previousPosition[i]=p.position[i];
        const control=e.options.sourceControl?.(state);
        if(e.options.sourceControl){
          if(!control){retireParticle(p);continue;}
          // The combat core executes the bounded original mesh consumer.
          // Its transform and clock own this mesh; presentation samples only.
          p.position=[...control.position];p.velocity=[...control.velocity];
          p.age=control.nowLifeTime;p.meshAnimationTime=control.animationTime;
          sampleEventsToRef(p.channels,p.age,p.values);
          if(control.localRotation!==undefined){
            // Scoped GM66XX original random Rotate endpoints are resolved
            // once by combat/owner state. Keep the ordinary presentation RNG
            // draws above, but never use a second random mesh orientation.
            if(e.name!=='Mesh_SGM_Dash_XX_Spawnpoint'||e.template.kind!=='mesh'||
              !Array.isArray(control.localRotation)||control.localRotation.length!==3||!control.localRotation.every(Number.isFinite))
              throw new TypeError('Invalid shared GM source mesh rotation');
            for(let i=0;i<3;i++)p.values.Rotate[i]=control.localRotation[i];
          }
          continue;
        }
        const meshTime=e.template.kind==='mesh'&&e.template.fields.LifeType==='LT_TIME';
        // Mesh PlayProcess tests OLD NowLifeTime, then adds elapsed (.cpp:2130).
        // CParticle instead adds elapsed before lifetime testing (.h:314,337).
        if(meshTime&&p.age>=p.nativeLifetime){retireParticle(p,true);continue;}
        const oldAge=p.age;p.age=e.template.kind==='particle'||meshTime?f32(p.age+f32(dt)):p.age+dt;
        if(!meshTime&&p.age>=p.nativeLifetime){retireParticle(p,true);continue;}
        if(e.template.kind==='particle'){
          const control=p.particleControl,velocityEnd=control?advanceParticleEventClock(control,dt):p.age;
          const oldEventTime=control?.oldTime??oldAge,eventTime=control?.time??p.age;
          // CParticle::OnFrameMove consumes the PREVIOUS prepared packet, then
          // sequence Gravity and RunEvent prepare the next (.h:349..371;
          // .cpp:3099..3103,3147). Native frame batching is not target-verified.
          const move=rotateWithBasisToRef(p.velocityAccum,p.axisBasis,p.move);p.velocityAccum.fill(0);p.velocityEventTime=oldEventTime;
          for(let i=0;i<3;i++)p.position[i]+=move[i];
          const speed=p.values.DirSpeed;if(speed){const direction=rotateNative([speed*dt,0,0],p.values.Rotate.map((n,i)=>n+p.visualRotation[i]));for(let i=0;i<3;i++)p.position[i]+=direction[i];}
          // CParticle sets its Trace child sequence position before the outer
          // sequence adds template Trace; TRACE_MORE displacement already happened.
          p.tracePosition??=[0,0,0];for(let i=0;i<3;i++)p.tracePosition[i]=p.position[i];
          if(!traceMore&&(e.template.fields.Trace===true||e.options.trace===true))for(let i=0;i<3;i++)p.position[i]+=gap[i];
          if((e.template.fields.Trace===true||e.options.trace===true)&&
              (p.axis[0]!==e.axis[0]||p.axis[1]!==e.axis[1]||p.axis[2]!==e.axis[2])){
            for(let i=0;i<3;i++)p.axis[i]=e.axis[i];rotationBasis(p.axis,p.axisBasis);
          }
          const gravity=gravityFor(e.template),elapsed=f32(dt),halfTimeSquared=f32(f32(.5*elapsed)*elapsed);
          for(let i=0;i<3;i++){p.velocity[i]=f32(p.velocity[i]+f32(f32(gravity[i])*elapsed));p.velocityAccum[i]=f32(p.velocityAccum[i]+f32(halfTimeSquared*f32(gravity[i])));}
          runVelocityEvents(p,oldEventTime,velocityEnd);
          sampleEventsToRef(p.channels,eventTime,p.values);for(let i=0;i<3;i++)p.values.Velocity[i]=p.velocity[i];
          if(control){runParticleControlEvents(control,value=>resolveValue(value,rng));p.velocityEventTime=control.time;}
          if(e.template.fields.UseLand===true){const land=e.options.landPosition;
            if(Number.isFinite(land)){
              // Fixed V5 .cpp:3150..3175, selected velocity-accum macro branch.
              // The caller supplies the original effect's actual land plane.
              if(p.position[1]<land){p.position[1]=land;if(p.velocity[1]<0){
                if(p.velocity[1]>=-50){p.velocity[1]=0;p.velocityAccum[1]=0;}
                else{p.velocity[1]=f32(p.velocity[1]*-.5);p.velocityAccum[1]=f32(p.velocity[1]*elapsed);}
              }}
            }else note(e.name+':land','Original land plane was not supplied; clamp remains unsupported');
          }
          continue;
        }
        sampleEventsToRef(p.channels,p.age,p.values);
        if(p.presentationRetireAfter!=null&&p.age>=p.presentationRetireAfter){retireParticle(p);continue;}
        if(p.meshPeriod&&!p.meshStopped){p.meshAnimationTime+=dt*(p.values.AniSpeed??1);
          p.meshEndPending=p.meshAnimationTime>p.meshPeriod-Math.max(p.meshPeriod/10,.03);
          // XSkinAnim::OnFrameMove LOOP emits one end pulse and ChangeAnim
          // resets controller time to zero. MeshPlayer consumes that pulse on
          // the next packet; it does not estimate lifespan as period*count.
          if(p.meshEndPending){
            if(p.meshLoop&&p.meshMaxPlayCount!==1)p.meshAnimationTime=0;
            // XAP_ONE/WAIT keeps m_bAnimEnd true after XAS_STOP/WAIT. Thus a
            // count>1 ends on later packets, not after replaying the clip.
            else if(!p.meshLoop)p.meshStopped=true;
          }
        }
        const gravity=gravityFor(e.template),next=p.values.Velocity;
        for(let i=0;i<3;i++)p.velocity[i]+=next[i]-p.previousVelocity[i];
        const move=rotateNative(p.velocity.map(n=>n*dt),p.axis);
        for(let i=0;i<3;i++){
          p.position[i]+=move[i];
          // TRACE_MORE SetPosition moves every existing particle and resets the
          // old position, so a template with Trace=true receives the gap once.
          // EffectSet.cpp:1416; ParticleSystem.cpp:5344..5369,3091..3096.
          if(e.options.traceMore===true||e.template.fields.Trace===true||e.options.trace===true||e.template.kind==='mesh'&&e.options.follow)p.position[i]+=gap[i];
          p.velocity[i]+=gravity[i]*dt;
        }
        for(let i=0;i<3;i++)p.previousVelocity[i]=next[i];
        const speed=p.values.DirSpeed;if(speed){const direction=rotateNative([speed*dt,0,0],p.values.Rotate.map((n,i)=>n+p.visualRotation[i]));for(let i=0;i<3;i++)p.position[i]+=direction[i];}
        if(e.template.fields.UseLand===true){note(e.name+':land','Particle land-plane clamp/collision requires target validation');}
      }
      if(!e.done){const sourceRate=resolveValue(e.options.emitRate??e.template.fields.Emitrate??0,rng)*dt,rate=sourceRate/e.divisor;let count=Math.trunc(rate);e.excess+=rate-count;if(e.excess>1){const extra=Math.trunc(e.excess);count+=extra;e.excess-=extra;}
        // Named short fire/impact cues must not wait for the reduced cadence's
        // first packet after their source owner has already hit or ended.
        // This changes display sampling only: old particles, native lifetime,
        // trigger window and subsequent reduced cadence remain independent.
        if(e.firstSourcePacket&&e.count===0){e.firstSourceCarry+=sourceRate;if(e.firstSourceCarry>=1)count=Math.max(count,1);}
        for(let i=0;i<count&&e.particles.size<e.max&&(e.limit<0||e.count<e.limit);i++)birth(e,resolveValue(e.template.fields.Lifetime??0,rng));}
      if(e.done&&e.particles.size===0&&e.options.triggerWait!==true)emitters.delete(e.id);
    }
  }
  return {add,emitParticle,retrigger,step,stop,particles,emitters,quality,clear(){for(const id of [...emitters.keys()])stop(id,true);packetEmitters.length=0;serial=0;rng=seededRandom(seed);rng.nativeRandom=nativeRandom;},get count(){return particles.size;},notes};
}
