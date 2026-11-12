import {isElswordProfession} from '../../packages/professions/identity.mjs';

export const DESTRUCTION_RAGE_PARTICLES=Object.freeze(['MonsterAngryWind','Counter_Particle01']);
const validSerial=value=>Number.isSafeInteger(value)&&value>=0;
const point=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);

/** One original finite burst per Rage state entry. A local attacker can enter
 * Rage on a temporary remote-victim clone, so the event's post-entry serial
 * owns the identity; reading the observed actor's pre-entry serial is unsafe.
 * Event IDs alone also differ between repeated speculative contacts.
 * No cooldown or shortened particle lifetime is imposed by presentation. */
export function createDestructionRageEffects({runtime,qualityFor=()=>undefined,maxIdentitiesPerActor=32}){
  if(!Number.isInteger(maxIdentitiesPerActor)||maxIdentitiesPerActor<1)throw Error('Positive Rage identity bound required');
  const actors=new Map(),handles=new Map();let lastTime=null,bursts=0,duplicates=0;
  function clock(state){
    const time=state?.time;if(!Number.isFinite(time))return;
    if(lastTime!==null&&time<lastTime-1e-8)actors.clear();
    lastTime=time;
  }
  function identity(event,actor){
    const boundary=[actor.professionId??'LK',event.ownerEpoch??event.networkEpoch??actor.networkFrameEpoch??actor.networkEpoch??null,
      actor.pvpLifeEpoch??actor.lifeEpoch??null];
    if(validSerial(event.ownerStateSerial))return JSON.stringify([...boundary,'entry',event.ownerStateSerial]);
    // Old payloads cannot identify repeated speculative entries. Suppress only
    // exact replay of their available event identity, never a nearby new event.
    if(validSerial(event.eventId))return JSON.stringify([...boundary,'event',event.eventId,event.time??null]);
    if(Number.isFinite(event.time))return JSON.stringify([...boundary,'time',event.time]);
    return null;
  }
  return {
    event(event,state){
      if(event.type!=='destructionRageStarted')return false;
      clock(state);const actor=state.actors?.find(a=>a.id===event.actorId);
      if(!actor||!isElswordProfession(actor.professionId??'LK')||!point(event.position))return false;
      const key=identity(event,actor);let record=actors.get(actor.id);
      if(!record||record.actor!==actor){record={actor,seen:new Set()};actors.set(actor.id,record);}
      if(key!==null&&record.seen.has(key)){duplicates++;return true;}
      if(key!==null){record.seen.add(key);if(record.seen.size>maxIdentitiesPerActor)record.seen.delete(record.seen.values().next().value);}
      let born=false;
      for(const name of event.particles??[]){
        const emitter=runtime.add(name,{effectQuality:qualityFor(actor),position:event.position,
          landPosition:actor.landPosition?.[1],facing:1});
        if(emitter){handles.set(emitter.id,actor.id);born=true;}
      }
      if(born)bursts++;return true;
    },
    step(state){
      clock(state);const ids=new Set((state.actors??[]).map(actor=>actor.id));
      for(const id of actors.keys())if(!ids.has(id))actors.delete(id);
      for(const id of handles.keys())if(!runtime.emitters.has(id))handles.delete(id);
    },
    clear(){for(const id of handles.keys())runtime.stop(id,true);handles.clear();actors.clear();lastTime=null;bursts=0;duplicates=0;},
    proof(){return {bursts,duplicates,actors:actors.size,rememberedIdentities:[...actors.values()].reduce((sum,row)=>sum+row.seen.size,0),
      maxIdentitiesPerActor,liveHandles:[...handles.keys()].filter(id=>runtime.emitters.has(id)).length,
      templates:[...DESTRUCTION_RAGE_PARTICLES],identity:'post-entry-owner-state-serial; exact-event-fallback',sourceLifetimeUnchanged:true};},
  };
}
