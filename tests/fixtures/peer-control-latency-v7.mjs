/** Deterministic transport queue, no browser/NAT/original-client claim. */
export function runPeerControlLatency(createPeerControl,{rttMs=300,sourceHz=20,durationMs=4000}={}){
  let now=0,ordinal=0;const pending=[],actions=[],poses=[],faults=[],created=new Map();
  const oneWay=rttMs/2,start=2*rttMs+100,period=1000/sourceHz;
  const enqueue=(kind,value)=>{pending.push({kind,value,due:now+oneWay,ordinal:ordinal++});return true;};
  const a=createPeerControl({matchId:'latency-v7',clock:()=>now,reliableTransport:true,
    send:text=>enqueue('b-control',text),onFault:reason=>faults.push({now,pair:'a',reason})});
  const b=createPeerControl({matchId:'latency-v7',clock:()=>now,reliableTransport:true,
    send:text=>enqueue('a-control',text),onFault:reason=>faults.push({now,pair:'b',reason}),
    apply:report=>{for(const action of report.actions)actions.push({id:action.id,ageMs:now-created.get(action.id)});return true;},
    onPose:pose=>poses.push({id:pose.id,ageMs:now-pose.created})});
  let source=0;const end=start+durationMs+2*rttMs+300;
  for(now=0;now<=end;now++){
    while(now>=start+source*period&&source*period<durationMs){
      const id=++source,frameSeq=id*3;created.set(id,now);
      a.stage({protocol:'local-owner-v1',epoch:1,frameSeq,actor:{state:'attack'},effects:[],hits:[],
        actions:[{id,frameSeq,actor:{fired:['STOP_OTHER_UNIT1']},effects:[]}]});
      enqueue('pose',{id,created:now,epoch:1,barrier:a.watermark(1)});
    }
    for(;;){
      pending.sort((x,y)=>x.due-y.due||x.ordinal-y.ordinal);if(pending[0]?.due>now||!pending.length)break;
      const event=pending.shift();
      if(event.kind==='b-control')b.receiveText(event.value);
      else if(event.kind==='a-control')a.receiveText(event.value);
      else if(!b.fence(event.value,event.value.epoch,event.value.barrier))poses.push({id:event.value.id,ageMs:now-event.value.created});
    }
    a.pump();b.pump();
  }
  const stats=rows=>{const ages=rows.map(row=>row.ageMs).sort((x,y)=>x-y);
    const sourceGaps=rows.slice(1).map((row,index)=>created.get(row.id)-created.get(rows[index].id)).sort((x,y)=>x-y);
    return {count:rows.length,p50Ms:ages[Math.floor((ages.length-1)*.5)]??null,p95Ms:ages[Math.floor((ages.length-1)*.95)]??null,maxMs:ages.at(-1)??null,
      p95SourceGapMs:sourceGaps[Math.floor((sourceGaps.length-1)*.95)]??null,maxSourceGapMs:sourceGaps.at(-1)??null};};
  return {rttMs,sourceHz,durationMs,sourceActions:source,actions:stats(actions),poses:stats(poses),faults,
    actionIds:actions.map(row=>row.id),sender:a.performance(),receiver:b.performance()};
}
