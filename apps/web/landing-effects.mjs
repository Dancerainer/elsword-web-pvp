// Fixed-V5 GUUser::DamageAirDownLandingStart/FrameMove; target resources are
// separately frozen in rf-landing-fx-index-v1.json. No combat RNG is consumed.
export const airDownLandingState='RSI_DAMAGE_AIR_DOWN_LANDING';
export const landingTemplates=Object.freeze(['DropDown','GroundShockWave','AirDownTick','DownSmoke']);
const smokeTimes=Object.freeze([.029,.46]);
const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);

/** Original common minor sequences belong to each actor. Retriggering resets
 * TriggerCount, retaining old particles, the NumParticles cap and fractional
 * emission carry (GameUnit.h3448 / ParticleSystem.h1474). The observed state
 * serial makes duplicate/late network snapshots harmless to one-shot birth. */
export function createLandingEffects({runtime,onUnsupported=()=>{}}){
  const actors=new Map(),notes=new Set(),counts=new Map();
  function note(id,detail){if(!notes.has(id)){notes.add(id);onUnsupported({type:'unsupported-visual',id,detail});}}
  function trigger(record,name,position,min,max,count,landPosition=position[1]){
    let e=runtime.emitters.get(record.sequences.get(name));
    if(e)runtime.retrigger(e.id,{position,landPosition,emitRate:{random:[min,max]},triggerCount:count});
    else {e=runtime.add(name,{position,facing:1,landPosition,emitRate:{random:[min,max]},triggerCount:count});
      if(e)record.sequences.set(name,e.id);}
    counts.set(name,(counts.get(name)??0)+1);
  }
  function clearActor(id){const record=actors.get(id);if(record)for(const handle of record.sequences.values())runtime.stop(handle,true);actors.delete(id);}
  return {
    step(state){
      const live=new Set();
      for(const actor of state.actors??[]){
        live.add(actor.id);
        let record=actors.get(actor.id);
        if(!record){record={serial:-1,observed:false,landing:false,smokeMask:0,sequences:new Map()};actors.set(actor.id,record);}
        const serial=actor.stateSerial??actor.animationTransitionSerial??0;
        // A delayed packet cannot resurrect an already observed state epoch.
        if(serial<record.serial)continue;
        if(actor.state!==airDownLandingState){record.serial=serial;record.observed=true;record.landing=false;continue;}
        const fresh=serial>record.serial||!record.landing;
        const time=actor.animationTime??0;
        const land=actor.landPosition;
        if(!finitePoint(land)){note('air-down-land-point','Air-down original landPosition unavailable; no guessed dust plane');continue;}
        if(fresh){
          const staleInitial=!record.observed&&time>0;
          record.serial=serial;record.landing=true;record.smokeMask=0;
          if(staleInitial){for(let i=0;i<smokeTimes.length;i++)if(time>=smokeTimes[i])record.smokeMask|=1<<i;}
          else {
            runtime.add('DropDown',{position:[actor.x,actor.y,actor.z],facing:actor.facing});counts.set('DropDown',(counts.get('DropDown')??0)+1);
            trigger(record,'GroundShockWave',[land[0],land[1]+5,land[2]],5,10,1);
            trigger(record,'AirDownTick',[actor.x,actor.y,actor.z],200,200,10,land[1]);
          }
        }
        record.observed=true;
        for(let i=0;i<smokeTimes.length;i++)if(!(record.smokeMask&(1<<i))&&time>=smokeTimes[i]){
          record.smokeMask|=1<<i;trigger(record,'DownSmoke',[...land],100,100,7);
        }
      }
      for(const id of [...actors.keys()])if(!live.has(id))clearActor(id);
    },
    clear(){for(const id of [...actors.keys()])clearActor(id);notes.clear();counts.clear();},
    proof(){return {actors:actors.size,triggers:Object.fromEntries(counts),
      commonSequences:[...actors].flatMap(([actorId,r])=>[...r.sequences].map(([name,id])=>({actorId,name,id,live:runtime.emitters.has(id)}))),
      timers:[...smokeTimes],reference:'fixed-V5 air-down landing; target2016 minor declarations; measured original DLL DropDown keys',targetClientMeasured:false};},
  };
}
