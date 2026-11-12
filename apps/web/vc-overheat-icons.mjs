import {FULL_EFFECT_QUALITY} from '../../packages/effect-runtime/presentation-quality.mjs';

// The original _ShowOverheatIcon creates these 3D billboard sequences at the
// sampled head/line position. Their source DDS, sizes and lifetime stay intact.
export const veteranOverheatIconTemplates=Object.freeze(['WeaponTaker_Overheat',
  ...[1,2,3].map(size=>`Overlap_EDT_Emoticon_${size}_OverHeat`)]);
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

export function veteranOverheatIconBirths(event){
  const size=event.size??0;
  if(!point(event.position)||!Number.isInteger(size)||size<0||size>3||size>0&&!point(event.direction))return null;
  const births=[{name:veteranOverheatIconTemplates[0],position:[...event.position]}];
  if(size>0)births.push({name:veteranOverheatIconTemplates[size],
    // X2GURaven.cpp17422 adds the *unmirrored* original line direction here.
    position:event.position.map((n,i)=>n+event.direction[i]*50+(i===1?20:0))});
  return births;
}

/** One finite notice, with at most one overlap notice, per actor. Retrying a
 * network event does not restart it; a later notice replaces both old handles.
 * No actor attachment is kept after birth and no damage/buff state is inferred. */
export function createVeteranOverheatIcons({runtime,onUnsupported=()=>{}}){
  const actors=new Map(),notes=new Set();let births=0;
  const note=(id,detail)=>{if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}};
  const stop=record=>{for(const id of record.handles)runtime.stop(id,true);record.handles.length=0;};
  return {
    event(event,state){
      if(event.type!=='overheatIcon')return false;
      const actor=state.actors.find(a=>a.id===event.actorId);
      if(actor?.professionId?.toUpperCase()!=='VC'||!(actor.hp>0))return false;
      // A restored remote notice may already have consumed part of its source
      // lifetime in transit. Bound its handles without restarting that window.
      if(event.remaining!==undefined&&(!Number.isFinite(event.remaining)||event.remaining<=0))return false;
      let record=actors.get(actor.id);
      if(record&&Number.isFinite(event.eventId)&&event.eventId<=record.eventId)return false;
      const particles=veteranOverheatIconBirths(event);
      if(!particles){note('vc-overheat-icon-anchor','Original head position / line direction or supported icon stage missing');return false;}
      if(!record){record={eventId:-1,handles:[]};actors.set(actor.id,record);}else stop(record);
      if(Number.isFinite(event.eventId))record.eventId=event.eventId;
      record.remaining=event.remaining??Infinity;
      for(const particle of particles){const emitter=runtime.add(particle.name,{effectQuality:FULL_EFFECT_QUALITY,
        position:particle.position,facing:1,billboardType:'BT_ALL'});
        if(emitter){record.handles.push(emitter.id);births++;}}
      return true;
    },
    step(state,dt=0){
      for(const [id,record] of actors){const actor=state.actors.find(a=>a.id===id);
        if(!actor||actor.hp<=0||actor.professionId?.toUpperCase()!=='VC'){stop(record);actors.delete(id);continue;}
        if(Number.isFinite(record.remaining)){
          if(Number.isFinite(dt)&&dt>0)record.remaining-=dt;
          if(record.remaining<=1e-9){stop(record);continue;}
        }
        let kept=0;for(const handle of record.handles)if(runtime.emitters.has(handle))record.handles[kept++]=handle;
        record.handles.length=kept;
      }
    },
    clear(){for(const record of actors.values())stop(record);actors.clear();notes.clear();births=0;},
    proof(){return {actors:actors.size,births,liveHandles:[...actors.values()].reduce((n,r)=>n+r.handles.length,0),
      templates:[...veteranOverheatIconTemplates],reference:'fixed-V5 X2GURaven::_ShowOverheatIcon; target2016 particle declarations',
      targetClientMeasured:false,unsupported:[...notes]};},
  };
}
