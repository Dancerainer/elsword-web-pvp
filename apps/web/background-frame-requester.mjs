/** Desktop policy, not target2016 timing: Chromium may suppress native RAF in a
 * minimized WebContentsView despite backgroundThrottling:false/visible state.
 * Keep the same engine callback on a60Hz timer only while unfocused/hidden.
 * Foreground retains native RAF. Rearm the pending callback on focus changes,
 * so a RAF already stranded by minimize cannot block the switch itself. */
export function createBackgroundFrameRequester({window=globalThis.window,document=globalThis.document,now=()=>performance.now(),framesPerSecond=60}={}){
 if(!Number.isFinite(framesPerSecond)||framesPerSecond<=0)throw new RangeError('Finite background frame rate required');
 const pending=new Map();let serial=0,disposed=false,background=Boolean(document.hidden||!document.hasFocus()),rafFrames=0,timerFrames=0,switches=0;
 const cancel=row=>row.kind==='timer'?window.clearTimeout(row.nativeId):window.cancelAnimationFrame(row.nativeId);
 function deliver(row,timestamp,token){if(disposed||pending.get(row.id)!==row||row.token!==token)return;pending.delete(row.id);if(row.kind==='timer')timerFrames++;else rafFrames++;row.callback(timestamp);}
 function schedule(row){const token=Symbol();row.token=token;row.kind=background?'timer':'raf';row.nativeId=background?window.setTimeout(()=>deliver(row,now(),token),1000/framesPerSecond):window.requestAnimationFrame(time=>deliver(row,time,token));}
 function changed(){
  if(disposed)return;const next=Boolean(document.hidden||!document.hasFocus());if(next===background)return;background=next;switches++;
  for(const row of pending.values()){cancel(row);schedule(row);}
 }
 window.addEventListener('blur',changed);window.addEventListener('focus',changed);document.addEventListener('visibilitychange',changed);
 return {
  requestAnimationFrame(callback){if(disposed)throw Error('Frame requester disposed');const row={id:++serial,callback};pending.set(row.id,row);schedule(row);return row.id;},
  cancelAnimationFrame(id){const row=pending.get(id);if(row){pending.delete(id);cancel(row);}},
  proof(){return {background,rafFrames,timerFrames,switches,pending:pending.size,backgroundFramesPerSecond:framesPerSecond};},
  dispose(){if(disposed)return;disposed=true;for(const row of pending.values())cancel(row);pending.clear();
   window.removeEventListener('blur',changed);window.removeEventListener('focus',changed);document.removeEventListener('visibilitychange',changed);},
 };
}
