/** Counter-addressed application-arrival model; not a TCP/SCTP stack model. */
export const stepMs=1000/60;
export const scenarios=[
  {id:'lossless',base:20,jitter:0,loss:0,rto:120},
  {id:'jitter-loss-2pct',base:35,jitter:25,loss:.02,rto:120},
  {id:'severe-jitter-loss-10pct',base:75,jitter:100,loss:.10,rto:180},
  {id:'asymmetric-burst-v37',base:55,jitter:75,loss:.08,rto:180,burst:{minimum:300,maximum:650,cycle:2000},reverse:{base:20,jitter:15,loss:.01}},
  {id:'extreme-jitter-loss-20pct',base:150,jitter:300,loss:.20,rto:250},
  {id:'asymmetric-burst-1000ms',base:150,jitter:250,loss:.15,rto:250,burst:{minimum:500,maximum:1000,cycle:2500},reverse:{base:50,jitter:40,loss:.10}},
];
export function draw(seed,direction,lane,frame,attempt,field){
  let value=(seed^Math.imul(direction+1,0x9e3779b9)^Math.imul(lane+1,0x85ebca6b)^Math.imul(frame+1,0xc2b2ae35)^Math.imul(attempt+1,0x27d4eb2d)^Math.imul(field+1,0x165667b1))>>>0;
  value=Math.imul(value^(value>>>16),0x7feb352d);value=Math.imul(value^(value>>>15),0x846ca68b);
  return ((value^(value>>>16))>>>0)/4294967296;
}
function attempt(scenario,seed,direction,lane,frame,index,sentAt){
  const {base,jitter,loss}=direction===1&&scenario.reverse?scenario.reverse:scenario;
  const delayMs=Math.max(5,base+(draw(seed,direction,lane,frame,index,1)*2-1)*jitter);
  let burst=false;
  if(scenario.burst&&direction===0){const {minimum,maximum,cycle}=scenario.burst,number=Math.floor(sentAt/cycle),start=450+draw(seed,0,7,number,0,0)*250,
    duration=minimum+draw(seed,0,7,number,0,1)*(maximum-minimum),within=sentAt-number*cycle;burst=within>=start&&within<start+duration;}
  return {sentAt,delayMs,lost:burst||draw(seed,direction,lane,frame,index,0)<loss,burst};
}
export function makeNetworkTrace(scenario,seed,count=900){
  const directions=[0,1].map(direction=>Array.from({length:count+1},(_unused,frame)=>{
    const initial=frame*stepMs,pose=attempt(scenario,seed,direction,1,frame,0,initial),motion=attempt(scenario,seed,direction,2,frame,0,initial),reliable=[];
    let sentAt=initial;
    for(let index=0;index<20;index++){const row=attempt(scenario,seed,direction,0,frame,index,sentAt);reliable.push(row);if(!row.lost)break;sentAt+=Math.min(720,scenario.rto*2**index);}
    if(reliable.at(-1).lost)throw Error('seeded-retransmission-horizon-exhausted');return {frame,pose,motion,reliable};
  }));
  return {schemaVersion:1,scenario:scenario.id,seed,stepMs,directions};
}
export function percentile(values,percent){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*percent)-1)];}
export function distribution(values){return {count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:values.length?Math.max(...values):null};}
