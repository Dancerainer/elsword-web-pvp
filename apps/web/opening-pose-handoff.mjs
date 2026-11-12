/** Keep the authored opening pose until admission, then blend its final frame
 * into the live controller. An underlying spawn blend must not replay it. */
export function createOpeningPoseHandoff(){
 let last=null,blend=null;
 return {sample({phase,presentation,time,dt=0}){
  if(phase==='intro'&&presentation){
    last={fromName:presentation.animationName,fromTime:Math.min(presentation.duration,time),fromLoop:false,fromSpeed:0,
      durationSeconds:Math.max(.03,Math.min(.45,presentation.duration/10)),fromWeight:1,enabled:true,elapsedSeconds:0,fromPresentation:true};
    blend=null;return {override:true,transition:null};
  }
  if(last){blend={...last};last=null;}
  if(blend){const transition={...blend};blend.elapsedSeconds+=Math.max(0,dt);
    if(blend.elapsedSeconds>=blend.durationSeconds)blend=null;
    return {override:true,transition};}
  return {override:false};
 },clear(){last=null;blend=null;}};
}
