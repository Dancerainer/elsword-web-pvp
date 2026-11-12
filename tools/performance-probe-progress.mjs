/** Browser probe only: expose preparation work before a timed/rendered case.
 * This never imposes a readiness timeout or skips a production preparation. */
export function performanceProbeCase(query,cases){
  if(!query.has('case'))return null;
  const value=query.get('case');
  if(!/^(0|[1-9]\d*)$/.test(value)||Number(value)>=cases.length)throw Error('case must be a zero-based scenario index');
  return Number(value);
}
export function createPerformanceProbeProgress({status,output,button,select,errors,readProgress=()=>({}),
  now=()=>performance.now(),interval=setInterval,cancelInterval=clearInterval}){
  let timer=null,started=0,label='',last=null;
  const stop=()=>{if(timer!==null){cancelInterval(timer);timer=null;}};
  function refresh(){
    const elapsedMs=now()-started,progress=readProgress();
    last={phase:'preparing',scenario:label,elapsedMs,progress,errors:[...errors]};
    const active=Object.entries(progress).filter(([,p])=>!['complete','failed'].includes(p.phase));
    const detail=active.map(([id,p])=>`${id} ${p.phase} · ${p.template??''} · Created: ${p.createdViews} · Pending: ${p.pendingJobs}`).join(' / ');
    status.textContent=`Preparing · ${label} · ${(elapsedMs/1000).toFixed(1)} s${detail?' · '+detail:''}`;
    output.textContent=JSON.stringify(last);output.dataset.preparation=JSON.stringify(last);
  }
  function failed(error,phase='failed'){
    stop();button.disabled=false;select.disabled=false;
    const message=String(error?.stack??error);if(errors.at(-1)!==message)errors.push(message);
    last={...last,phase,scenario:label,elapsedMs:now()-started,progress:readProgress(),errors:[...errors]};
    status.textContent=`Failed · ${label} · ${phase}`;output.textContent=JSON.stringify(last);
    output.dataset.preparation=JSON.stringify(last);
  }
  return {
    async prepare(name,work){
      stop();label=name;started=now();button.disabled=true;select.disabled=true;
      delete output.dataset.report;refresh();timer=interval(refresh,1000);
      try{await work();stop();last={phase:'ready',scenario:label,elapsedMs:now()-started,progress:readProgress()};
        output.dataset.preparation=JSON.stringify(last);output.textContent='';status.textContent='Running · '+label;return true;
      }catch(error){failed(error,'preparation');return false;}
    },
    failed,
    snapshot(){return last;},
  };
}
