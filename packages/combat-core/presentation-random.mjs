/** Web presentation-only stream. The target2016 seed/table initialization and
 * thread call order remain unmeasured; these are explicit host isolation rules,
 * not a substitute for the captured 32000-entry native sampler. */
export function presentationRandom(state,actorId){
  if(typeof actorId!=='string'||!actorId)throw new TypeError('Presentation random requires an actor identity');
  const random=state.presentationRandom??={version:1,seed:state.seed>>>0||1,actors:{}};
  if(random.version!==1)throw new TypeError('Unsupported presentation random state');
  // Prefix all roster IDs, including prototype-like strings. Snapshot/restore
  // needs only ordinary JSON and cannot accidentally access object prototypes.
  const key='actor:'+actorId;
  let x=random.actors[key];
  if(x===undefined){
    x=(random.seed^0x9e3779b9)>>>0;
    for(let i=0;i<actorId.length;i++)x=Math.imul(x^actorId.charCodeAt(i),16777619)>>>0;
    if(x===0)x=1;
  }
  x^=x<<13;x^=x>>>17;x^=x<<5;
  random.actors[key]=x>>>0;
  return (x>>>0)/4294967296;
}
