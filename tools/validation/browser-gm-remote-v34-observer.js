/* QA only: read the existing workbench once per rendered frame. This cannot
   observe intermediate catch-up ticks; their count and event lag are explicit.
   No simulation, input, network message or animation method is replaced. */
(() => {
  let enabled=false,handle=null,phase='idle',lastStep=null,rows=[],events=[],seen=new Set(),total=0,skippedSteps=0,overflow=false;
  const actorFields=['id','professionId','x','y','z','vx','vy','vz','facing','state','stateSerial','stateTime','animationName','animationTime','grounded','lineId','lastTouchLineId','hp','mp','pvpDead','pvpDisconnected'];
  const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
  function capture(){
    if(!enabled)return;
    const workbench=window.rfWorkbench;
    if(workbench){
      const snapshot=workbench.snapshot(),render=workbench.renderSnapshot?.();
      if(render?.mode==='online'){
        if(lastStep!==null&&snapshot.step>lastStep+1)skippedSteps+=snapshot.step-lastStep-1;
        lastStep=snapshot.step;
        const row={at:Date.now(),pageTime:performance.now(),phase,step:snapshot.step,time:snapshot.time,
          localPlayerId:render.localPlayerId,actors:snapshot.actors.map(a=>pick(a,actorFields)),rendered:render.actors,
          playback:render.playback?.receiver};
        rows.push(row);total++;
        for(const event of workbench.events())if(['hit','attackWindow','stateChanged'].includes(event.type)){
          const identity=[event.type,event.eventId,event.actorId,event.targetId,event.step,event.time,event.state].join('|');
          if(seen.has(identity))continue;seen.add(identity);
          // Ignore lobby/previous-match history observed at the first sample.
          if(Number.isFinite(event.step)&&event.step<snapshot.step-12)continue;
          events.push({...pick(event,['type','eventId','time','step','actorId','targetId','amount','hp','state','animationName','animationTime','reason','origin']),
            observedAt:row.at,phase,observedStep:row.step,eventStepLag:Number.isFinite(event.step)?row.step-event.step:null,
            localPlayerId:row.localPlayerId,actors:row.actors,rendered:row.rendered,playback:row.playback});
        }
        if(total>=18000||seen.size>=50000){overflow=true;enabled=false;return;}
      }
    }
    handle=requestAnimationFrame(capture);
  }
  window.__gmRemoteV34={
    start(){if(enabled)return;enabled=true;handle=requestAnimationFrame(capture);},
    phase(value){phase=String(value);},
    drain(){const result={rows,events,total,skippedSteps,overflow};rows=[];events=[];return result;},
    stop(){enabled=false;if(handle!==null)cancelAnimationFrame(handle);return this.drain();},
  };
})();
