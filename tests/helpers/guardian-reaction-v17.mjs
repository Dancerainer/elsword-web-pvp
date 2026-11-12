import {make} from './rf-passive-fixture-v12.mjs';

export const guardianSnapshot=b=>({state:b.state,stateSerial:b.stateSerial,animationName:b.animationName,
  animationTime:b.animationTime,animationPlaybackSpeed:b.animationPlaybackSpeed,
  animationSpeedRamp:b.animationSpeedRamp?structuredClone(b.animationSpeedRamp):null,
  blendEnabled:b.presentationTransition?.enabled===true,worldStop:b.worldStop,hitStop:b.hitStop,
  position:[b.x,b.y,b.z],velocity:[b.vx,b.vy],grounded:b.grounded,knockdown:structuredClone(b.knockdown)});

export async function makeGuardian({facing=-1,fromFront=true,awakened=false,speed=1.3}={}){
  const positions=facing<0?[[2022.98,2840,0],[1858.11,2840,0]]:[[1858.11,2840,0],[2022.98,2840,0]];
  const s=await make({skillId:24006,passives:[],positions});
  const a=s.actor('rf'),b=s.actor('target');a.facing=facing;b.facing=fromFront?-facing:facing;
  a.stats.animationSpeedMultiplier=speed;b.stats.animationSpeedMultiplier=speed;
  if(awakened){a.awakening.remaining=20;a.awakening.full=false;}
  s.drainEvents();return s;
}

/** Observation hook only: actual A-slot input, source WASM, Garpai collision,
 * source character/effect helpers, ordinary applyHit. No hit injection/teleport.
 */
export async function observeGuardian(options={}){
  const s=await makeGuardian(options),b=s.actor('target'),hits=[],samples=[],transitions=[];
  const apply=s.applyHit.bind(s);
  s.applyHit=(a,target,data,origin)=>{
    if(origin.skillId!==24006)return apply(a,target,data,origin);
    const before=guardianSnapshot(target),result=apply(a,target,data,origin);
    if(result?.accepted)hits.push({step:s.state.step,time:s.state.time,effectId:origin.id,
      damage:structuredClone(data),before,after:guardianSnapshot(target)});
    return result;
  };
  for(let frame=1;frame<=280;frame++){
    s.step(1/60,frame===1?{rf:{pressed:['A'],held:['A']}}:{},{snapshot:false});
    const events=s.drainEvents();
    for(const event of events)if(event.type==='stateChanged'&&event.actorId==='target')
      transitions.push({step:frame,time:event.time,state:event.state,reason:event.reason});
    if(events.some(e=>e.type==='hit')||frame%5===0)samples.push({step:frame,time:s.state.time,...guardianSnapshot(b)});
  }
  return {evidence:'current-host-simulation; actual A input; no target-client trajectory',options,
    ruleVersions:s.versions,sourceState:s.profile.skillCatalog.find(v=>v.skillId===24006).states,
    hits,samples,transitions,unsupported:s.state.unsupported};
}
