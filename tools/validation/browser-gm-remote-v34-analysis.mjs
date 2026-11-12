/** QA-only predicates. A sampled large step is evidence to inspect, not a
 * universal gameplay range cap. Keep legal native skill displacement intact. */
const unsafe=new Set([1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080]);
export const isSafeBrowserPort=port=>Number.isInteger(port)&&port>=1024&&port<=65535&&!unsafe.has(port);
export async function listenOnSafePort(server){
  for(let attempt=0;attempt<20;attempt++){
    await new Promise((resolve,reject)=>{const error=e=>reject(e);server.once('error',error);server.listen(0,'127.0.0.1',()=>{server.off('error',error);resolve();});});
    const port=server.address().port;if(isSafeBrowserPort(port))return port;
    await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
  throw Error('Could not allocate a browser-safe local port');
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const nearest=(rows,at)=>rows.reduce((best,row)=>!best||Math.abs(row.at-at)<Math.abs(best.at-at)?row:best,null);
export function analyzeGmTrace(traces,playerIds){
  const hits=[],windows=[],movements=[];
  for(const [view,trace]of traces.entries()){
    for(const event of trace.events){
      if(event.type==='attackWindow')windows.push({view,phase:event.phase,actorId:event.actorId,state:event.state,animationTime:event.animationTime});
      if(event.type!=='hit'||event.targetId!==playerIds[view])continue;
      const other=nearest(traces[1-view].rows,event.observedAt),actor=(id,rows)=>rows?.find(a=>a.id===id)??null;
      const own=actor(event.targetId,event.actors),remote=actor(event.actorId,event.actors);
      hits.push({...event,view,counterpartSampleGapMs:other?Math.abs(other.at-event.observedAt):null,
        victimOwner:own,attackerSeenByVictim:remote,
        attackerOwner:actor(event.actorId,other?.actors),victimSeenByAttacker:actor(event.targetId,other?.actors),
        counterpartRendered:other?.rendered??null,localActorDistance:own&&remote?distance(own,remote):null});
    }
    let previous=null;
    for(const row of trace.rows){
      if(previous&&row.phase===previous.phase&&row.step>previous.step){
        for(const actor of row.actors.filter(a=>a.id!==playerIds[view])){
          const before=previous.actors.find(a=>a.id===actor.id);if(!before)continue;
          const steps=row.step-previous.step,shown=row.rendered?.find(a=>a.id===actor.id);
          movements.push({view,phase:row.phase,at:row.at,steps,id:actor.id,state:actor.state,previousState:before.state,
            stateSerial:actor.stateSerial,position:[actor.x,actor.y,actor.z],previousPosition:[before.x,before.y,before.z],
            distancePerObservedTick:distance(actor,before)/steps,renderGap:shown?distance(actor,shown):null});
        }
      }
      previous=row;
    }
  }
  const remoteMotion=movements.filter(r=>r.phase==='remote-motion');
  return {committedVictimHits:hits,attackWindows:windows,
    farHits:hits.filter(h=>h.phase==='far-jump-x'),nearGmJumpXHits:hits.filter(h=>h.phase==='near-jump-x'&&h.actorId===playerIds[0]&&h.origin?.state==='RSI_JUMP_COMBO_X'),
    movementSamples:movements.length,remoteMotionSamples:remoteMotion.length,
    maxRemoteMotionDistancePerObservedTick:Math.max(0,...remoteMotion.map(r=>r.distancePerObservedTick)),
    maxRenderGap:Math.max(0,...movements.map(r=>r.renderGap??0)),
    largestMovements:[...movements].sort((a,b)=>b.distancePerObservedTick-a.distancePerObservedTick).slice(0,30),
    skippedSteps:traces.map(t=>t.skippedSteps),overflow:traces.some(t=>t.overflow),
    scope:'RAF read-only snapshots of completed simulation ticks; catch-up gaps and per-hit eventStepLag retained; counterpart browser sampled asynchronously'};
}
