// CKTDGManager::BeginRender consumes one request per render. A qualifying
// request clears to its exact color and skips the scene for that one frame.
// This reference explicitly comments out motion-blur accumulation.
export function createHitFramebuffer({focusFor=()=>null,enabled=false}={}){
  let count=0,color=[1,1,1,0],elapsed=0,clears=0;
  return {
    setEnabled(value){enabled=value===true;count=0;},
    event(event){
      if(!enabled||!['hit','observedHit'].includes(event.type)||!event.data)return;
      const focus=focusFor(),direct=event.origin?.kind==null||event.origin.kind==='character';
      if(!focus||(event.targetId!==focus&&!(direct&&event.actorId===focus)))return;
      const data=event.data,n=data.CLEAR_SCREEN??0;if(!Number.isInteger(n)||n<0)return;
      const c=['R','G','B','A'].map(k=>data['CLEAR_SCREEN_COLOR_'+k]??(k==='A'?0:1));
      if(!c.every(Number.isFinite))return;count=n;color=c.map(x=>Math.max(0,Math.min(1,x)));
    },
    beginFrame(dt){elapsed+=Number.isFinite(dt)?Math.max(0,dt):0;
      if(count>0){count--;if(elapsed>.2){elapsed=0;clears++;return [...color];}}return null;
    },
    clear(){count=0;color=[1,1,1,0];clears=0;},
    proof:()=>({enabled,count,color:[...color],clears,motionBlurAccumulation:false}),
  };
}
