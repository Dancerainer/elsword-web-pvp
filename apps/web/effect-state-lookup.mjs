/** Presentation dispatch reads one stable membership snapshot per event batch.
 * Values remain the original actor/effect objects; first duplicate IDs retain
 * Array.find semantics. A new batch always rebuilds, even when mutable arrays
 * retain their references and lengths between simulation/owner updates. */
export function createEffectStateLookup(state){
  const lookup={actors:new Map(),effects:new Map()};
  for(const actor of state.actors??[])if(!lookup.actors.has(actor.id))lookup.actors.set(actor.id,actor);
  for(const effect of state.effects??[])if(!lookup.effects.has(effect.id))lookup.effects.set(effect.id,effect);
  return lookup;
}
