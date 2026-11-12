/** Original announcement and sound precede the user-requested result dialog.
 * Audio duration comes from original Ogg pages; muted playback still advances.
 * Draw has an original graphic but no confirmed GameDrawing sound. */
export function createResultPresentation({hud,playSound,durationFor,timers=globalThis}){
  let timer=null,generation=0,current=null;
  function clear(){generation++;if(timer!==null)timers.clearTimeout(timer);timer=null;current=null;}
  return {clear,present(result){
    if(current===result)return false;
    clear();current=result;const token=generation,outcome=hud().announceResult(result);
    const name=outcome==='win'?'Win.ogg':outcome==='loss'?'Lose.ogg':null;
    if(name)playSound(name);
    const seconds=name?durationFor(name):1.5;
    timer=timers.setTimeout(()=>{timer=null;if(token===generation)hud().result(result);},Math.max(0,seconds??1.5)*1000);
    return true;
  }};
}
