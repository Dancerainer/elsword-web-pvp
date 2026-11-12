/** Per-appearance handles, using the existing original-declaration executor.
 * Never consume combat RNG; replacing a costume releases all old sequences. */
export function createCostumeParticles({runtime,sample=()=>[]}){
  const live=new Map();
  return {
    step(state){
      const keep=new Set();
      for(const actor of state.actors??[]){
        for(const binding of sample(actor)??[]){
          keep.add(binding);let handle=live.get(binding);
          if(!handle||!runtime.emitters.has(handle.id)){
            handle=runtime.add(binding.template,{actorId:actor.id,position:binding.position(),facing:1,
              follow:true,anchor:()=>binding.position()});
            if(handle)live.set(binding,handle);
          }
          if(handle)handle.options.hidden=actor.hp<=0||actor.hidden===true||actor.invisible===true;
        }
      }
      for(const [binding,handle] of live)if(!keep.has(binding)){runtime.stop(handle.id,true);live.delete(binding);}
    },
    clear(){for(const handle of live.values())runtime.stop(handle.id,true);live.clear();},
    proof(){return {sequences:live.size};}
  };
}
