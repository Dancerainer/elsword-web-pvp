/** Target2016 User 31f57c30/31f57de0 -> 31f902d0.
 * Queue records and scalar caches are separate. Native source UID64 is mapped
 * to the Web actor ID; source+5fde has no established Web equivalent, so death
 * does not fabricate that deletion predicate. */
const f=Math.fround,channels=['hit','world'];
const key=channel=>channel==='hit'?'hitStop':'worldStop';
export function requestActorStop(actor,channel,duration,sourceId=null){
  if(!channels.includes(channel)||!Number.isFinite(duration)||Math.abs(duration)>3600||
    sourceId!==null&&(typeof sourceId!=='string'||!sourceId||sourceId.length>128))throw new TypeError('invalid-source-stop-request');
  const queues=actor.sourceStopQueues??={hit:[],world:[]};
  queues[channel].push({remaining:f(duration),sourceId});
}
export function resetActorStopCache(actor){actor.hitStop=0;actor.worldStop=0;}
/** Web authority projection replaces one received channel. It is distinct
 * from the original cache-only reset: old local requests cannot resurrect a
 * countdown which the current remote owner has explicitly replaced. */
export function replaceActorStopProjection(actor,field,remaining){
  if(!['hitStop','worldStop'].includes(field)||!Number.isFinite(remaining)||remaining<0||remaining>3600)throw new TypeError('invalid-stop-projection');
  if(actor.sourceStopQueues){actor.sourceStopQueues[field==='hitStop'?'hit':'world']=[];
    if(!actor.sourceStopQueues.hit.length&&!actor.sourceStopQueues.world.length)delete actor.sourceStopQueues;}
  actor[field]=remaining;
}
/** The ordinary User outer loop deducts the entire delta before the gate.
 * An exhausted last record remains and masks any earlier positive record.
 * A resumed update receives the whole delta, never a residual fraction. */
export function advanceActorStops(actor,delta,{sourceRetired=()=>false}={}){
  if(!Number.isFinite(delta)||delta<0)throw new TypeError('invalid-source-stop-delta');
  const queues=actor.sourceStopQueues;
  for(const channel of channels){
    const field=key(channel),rows=queues?.[channel];
    if(rows?.length){
      if(rows.length>1000)rows.splice(0,rows.length-500);
      for(let i=0;i<rows.length;){
        const row=rows[i];row.remaining=Math.max(0,f(row.remaining-f(delta)));
        if(row.sourceId!==null&&sourceRetired(row.sourceId)){rows.splice(i,1);continue;}
        i++;
      }
      actor[field]=rows.length?rows.at(-1).remaining:0;
    }else actor[field]=Math.max(0,f((actor[field]??0)-f(delta)));
  }
  return actor.hitStop>0||actor.worldStop>0?0:delta;
}
export function validateSourceStopQueues(value){
  if(value===undefined)return true;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2)return false;
  return channels.every(channel=>Array.isArray(value[channel])&&value[channel].length<=1100&&value[channel].every(row=>
    row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===2&&Number.isFinite(row.remaining)&&Math.abs(row.remaining)<=3600&&
    (row.sourceId===null||typeof row.sourceId==='string'&&row.sourceId.length>0&&row.sourceId.length<=128)));
}
