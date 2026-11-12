/** Browser packet clock, seconds in performance.now's monotonic time domain.
 * A host scheduling fix, not the unacquired target2016 Main/DI Read loop.
 * The existing .1s/six-step preview cap is retained. A clipped frame drops
 * old wall-clock debt explicitly and reads inputs in the retained .1s window.
 */
export function createInputStepClock({stepSeconds=1/60,maxDeltaSeconds=.1,maxSteps=6}={}){
  if(!Number.isFinite(stepSeconds)||stepSeconds<=0||!Number.isFinite(maxDeltaSeconds)||maxDeltaSeconds<=0||
      !Number.isInteger(maxSteps)||maxSteps<=0||maxDeltaSeconds>stepSeconds*maxSteps)
    throw new RangeError('Finite packet interval and bounded catch-up budget required');
  let previous=null,origin=0,packets=0;
  const finite=time=>{if(!Number.isFinite(time))throw new TypeError('Finite monotonic input time required');return time;};
  function rebase(now){previous=origin=finite(now);packets=0;}
  function advance(now,{paused=false}={}){
    finite(now);
    if(previous===null){rebase(now);return {rawDt:0,dt:0,cutoffs:[],alpha:0,rebased:true,reason:'initial'};}
    if(now<previous)throw new RangeError('Input packet clock must be monotonic');
    const rawDt=now-previous,dt=Math.min(rawDt,maxDeltaSeconds);previous=now;
    if(paused){rebase(now);return {rawDt,dt,cutoffs:[],alpha:0,rebased:true,reason:'suspended'};}
    const clipped=rawDt>maxDeltaSeconds;
    if(clipped){origin=now-maxDeltaSeconds;packets=0;}
    // Integer packet boundaries avoid frame-rate-dependent addition drift.
    // This epsilon compensates only floating division, not input timing: the
    // buffer still uses the exact <= cutoff comparison with no extra window.
    const total=(now-origin)/stepSeconds;
    const complete=Math.floor(total+8*Number.EPSILON*Math.max(1,Math.abs(total)));
    const count=Math.min(maxSteps,Math.max(0,complete-packets));
    const cutoffs=Array.from({length:count},(_,i)=>origin+(packets+i+1)*stepSeconds);
    packets+=count;
    const alpha=Math.max(0,Math.min(1,(now-(origin+packets*stepSeconds))/stepSeconds));
    return {rawDt,dt,cutoffs,alpha,rebased:clipped,reason:clipped?'clipped-frame':null};
  }
  return Object.freeze({rebase,advance});
}
