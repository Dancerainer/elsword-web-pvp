// Fixed V5 KTDGParticleSystem.cpp:2546-2607,5403-5495 and .h:204-205,
// 261-262,314-320. These fields have mutable clocks and cannot be a fade lerp.
const f32=Math.fround;
const names=new Set(['CRASH','RESETCRASH','EVENTTIMER']);
export const isParticleControlEvent=event=>names.has(event.property.toUpperCase());
const active=(event,oldTime,newTime)=>event.fade?newTime>=event.start&&oldTime<event.end:
  oldTime<event.start&&newTime>=event.start||event.start===0&&oldTime===0;

export function createParticleControlEvents(template){
  const events=template.events.filter(isParticleControlEvent).map(e=>({...e,property:e.property.toUpperCase(),start:f32(e.start),end:f32(e.end)}));
  if(!events.length)return null;
  return {events,time:0,oldTime:0,resetCrash:f32(.01),nowResetCrash:0,crash:[0,0,0]};
}

export function advanceParticleEventClock(control,dt){
  control.oldTime=control.time;control.time=f32(control.time+f32(dt));
  control.nowResetCrash=f32(control.nowResetCrash+f32(dt));
  // The supported target reset declarations follow the other events. The
  // native velocity accumulator integrates only up to the timer event edge.
  const reset=control.events.find(e=>e.property==='EVENTTIMER'&&active(e,control.oldTime,control.time));
  return reset?Math.min(control.time,reset.start):control.time;
}

export function runParticleControlEvents(control,resolve){
  for(const event of control.events){
    if(!active(event,control.oldTime,control.time))continue;
    if(event.property==='RESETCRASH')control.resetCrash=f32(resolve(event.value));
    else if(event.property==='EVENTTIMER')control.time=f32(resolve(event.value));
    else {
      if(control.nowResetCrash<control.resetCrash)continue;
      control.nowResetCrash=0;
      control.crash=event.start>control.time||event.end<control.time?[0,0,0]:resolve(event.value).map(f32);
    }
  }
}

/** Native render adds the offset once then clears it, independently of age,
 * the actor attachment, particle velocity and collision helpers. */
export function consumeParticleCrash(control){
  if(!control)return null;const crash=control.crash;control.crash=[0,0,0];return crash;
}
