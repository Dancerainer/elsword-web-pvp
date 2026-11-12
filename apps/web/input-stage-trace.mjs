/** Same-process timing of sampled device edges, fixed-step completion and
 * render submission. These observations do not prove input permission, a hit,
 * network one-way delay or physical input-to-photon latency. */
export function createInputStageTrace({capacity=128}={}){
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>1024)throw new RangeError('Invalid input trace capacity');
  const rows=[];let next=0,generation=0;
  const distribution=values=>{
    const ordered=values.filter(Number.isFinite).sort((a,b)=>a-b),at=q=>ordered.length?ordered[Math.floor((ordered.length-1)*q)]:null;
    return {count:ordered.length,p50Ms:at(.5),p95Ms:at(.95),maxMs:ordered.at(-1)??null};
  };
  return {
    record({input,sampledAt,completedAt,before,after,step,reportFrame=null}){
      if(!before||!after||!Number.isFinite(sampledAt)||!Number.isFinite(completedAt)||completedAt<sampledAt)return [];
      const accepted=[],lastDown=new Map();
      for(const edge of input.edges??[])if(edge.down&&!edge.manual)lastDown.set(edge.key,edge);
      for(const edge of input.edges??[]){
        if(edge.manual||!Number.isFinite(edge.time)||edge.time*1000>sampledAt)continue;
        const pressed=edge.down&&input.pressed.includes(edge.key)&&lastDown.get(edge.key)===edge;
        if(pressed)accepted.push(completedAt-edge.time*1000);
        rows.push({id:++next,generation,key:edge.key,down:edge.down,inputAt:edge.time*1000,sampledAt,completedAt,
          pressed,actorId:after.id,step,reportFrame,
          beforeState:before.state,beforeSerial:before.stateSerial,state:after.state,stateSerial:after.stateSerial,
          renderSubmittedAt:null,renderStatus:'pending'});
        if(rows.length>capacity)rows.shift();
      }
      return accepted;
    },
    presented(actor,at){
      if(!actor||!Number.isFinite(at))return;
      for(const row of rows)if(row.renderStatus==='pending'&&row.actorId===actor.id&&at>=row.completedAt){
        if(actor.stateSerial===row.stateSerial){row.renderSubmittedAt=at;row.renderStatus='submitted';}
        else if(actor.stateSerial>row.stateSerial)row.renderStatus='superseded-before-render';
      }
    },
    reset(){for(const row of rows)if(row.renderStatus==='pending')row.renderStatus='context-reset';generation++;},
    snapshot(){
      const presses=rows.filter(row=>row.pressed),submitted=presses.filter(row=>row.renderStatus==='submitted');
      return {scope:'Local sampled press to step and same-controller render submission; not action permission, network or photon latency',capacity,generation,
        inputToSample:distribution(presses.map(row=>row.sampledAt-row.inputAt)),
        sampleToStepComplete:distribution(presses.map(row=>row.completedAt-row.sampledAt)),
        stepCompleteToRenderSubmit:distribution(submitted.map(row=>row.renderSubmittedAt-row.completedAt)),
        inputToStepComplete:distribution(presses.map(row=>row.completedAt-row.inputAt)),
        supersededBeforeRender:presses.filter(row=>row.renderStatus==='superseded-before-render').length,
        rows:rows.map(row=>({...row}))};
    },
  };
}
