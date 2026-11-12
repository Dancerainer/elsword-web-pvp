/** Requested spectator handoff: interpolate eye and target in wall-clock
 * time after the outgoing model disappears. This is a web display policy. */
export const CAMERA_HANDOFF_SECONDS=.45;
export function createCameraHandoff({duration=CAMERA_HANDOFF_SECONDS}={}){
  let id=null,last=null,from=null,elapsed=0;
  const copy=value=>Object.fromEntries(['eye','target','up'].map(key=>[key,[...value[key]]]));
  return {
    apply(value,nextId,dt,{transition=true}={}){
      if(id!==nextId){from=transition&&last?copy(last):null;elapsed=0;id=nextId;}
      if(!transition)from=null;
      let shown=copy(value);
      if(from){elapsed=Math.min(duration,elapsed+Math.max(0,dt));const t=duration>0?elapsed/duration:1,k=t*t*(3-2*t);
        for(const key of ['eye','target','up'])shown[key]=value[key].map((n,i)=>from[key][i]+(n-from[key][i])*k);
        const length=Math.hypot(...shown.up);if(length)shown.up=shown.up.map(n=>n/length);
        if(t===1)from=null;
      }
      last=shown;return shown;
    },
    reset(){id=null;last=null;from=null;elapsed=0;},
    proof(){return {targetId:id,transitioning:!!from,elapsed,duration};},
  };
}
