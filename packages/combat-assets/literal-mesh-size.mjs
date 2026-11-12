import {compileEvents,sampleProperty} from '../effect-runtime/index.mjs';
const cache=new WeakMap();
/** Original literal Size channel, shared with the presentation event sampler.
 * Used by posed collision geometry as the invisible mesh expands. Random Size
 * needs the saved native event/RNG identity and is deliberately not inferred. */
export function literalMeshSize(template,elapsed){
  if(!template)return [1,1,1];
  let channels=cache.get(template);
  if(channels===undefined){
    const events=(template.events??[]).filter(e=>e.property==='Size');
    if(!events.length)channels=null;
    else if(events.every(e=>Array.isArray(e.value)&&e.value.length===3&&e.value.every(Number.isFinite)))
      channels=compileEvents({events,fields:{},repeated:{}});
    else channels=false;
    cache.set(template,channels);
  }
  return channels?sampleProperty(channels,'Size',Math.max(0,elapsed??0)):(template.initialSize??[1,1,1]);
}
