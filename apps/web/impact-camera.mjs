// GUUser focus-unit consumers and KTDGCamera::UpdateCameraShake, fixed V5.
// Tracking owns the base camera. Only the source oscillation's frame increment
// is added after tracking, without a guessed decay or random displacement.
export function createImpactCamera({focusFor=()=>null}={}){
  const make=()=>({gap:0,time:0,timer:0,interval:0,positive:false});let vertical=make(),horizontal=make(),accepted=0;
  const apply=(data)=>{
    const type=data.CAMERA_SHAKE_TYPE??3,gap=data.CAMERA_CRASH_GAP??0,time=data.CAMERA_CRASH_TIME??0;
    if(![3,4,7,8].includes(type)||![gap,time].every(Number.isFinite))return;
    const row=type<=4?vertical:horizontal;row.gap=Math.fround(gap);row.time=Math.fround(time);
    if(type===3||type===7){row.timer=Math.fround(.05);row.interval=Math.fround(.05);}accepted++;
  };
  return {
    event(event){
      if(!['hit','observedHit'].includes(event.type)||!event.data)return;
      const focus=focusFor();if(!focus)return;
      const direct=event.origin?.kind==null||event.origin.kind==='character';
      if(event.targetId===focus||direct&&event.actorId===focus)apply(event.data);
    },
    advance(dt,{right=[1,0,0]}={}){
      const offset=[0,0,0];if(!(dt>0)||!Number.isFinite(dt))return offset;
      for(const [row,axis]of [[vertical,'up'],[horizontal,'right']]){
        if(row.time>0){row.time=Math.fround(row.time-Math.fround(dt));row.timer=Math.fround(row.timer-Math.fround(dt));if(row.timer<=0){row.timer=row.interval;
          const sign=row.positive?1:-1;row.positive=!row.positive;
          if(axis==='up')offset[1]+=sign*row.gap;else for(let i=0;i<3;i++)offset[i]+=-sign*right[i]*row.gap;
        }}else{row.time=0;row.timer=0;}
      }return offset;
    },
    clear(){vertical=make();horizontal=make();accepted=0;},
    proof:()=>({accepted,vertical:{...vertical},horizontal:{...horizontal},source:'fixed-V5 focus/oscillation; target2016 fields'}),
  };
}
