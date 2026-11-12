/** Aggregate each resource once. Do not parse/sort the whole preload history
 * twice a second while fighting, and do not retain PerformanceEntry objects. */
export function createResourceTimingSummary({performance,PerformanceObserver}){
  const totals={requests:0,reused:0,transferredBytes:0,decodedBytes:0,largestTransfers:[]};
  let observer=null,cursor=0;
  function consume(rows){
    for(const row of rows){
      let file;try{file=new URL(row.name).pathname;}catch{continue;}
      if(!file.startsWith('/assets/'))continue;
      totals.requests++;if(row.transferSize===0)totals.reused++;
      totals.transferredBytes+=row.transferSize??0;totals.decodedBytes+=row.decodedBodySize??0;
      if(row.transferSize>0){totals.largestTransfers.push({file,bytes:row.transferSize});totals.largestTransfers.sort((a,b)=>b.bytes-a.bytes);totals.largestTransfers.length=Math.min(3,totals.largestTransfers.length);}
    }
  }
  try{if(PerformanceObserver){observer=new PerformanceObserver(list=>consume(list.getEntries()));observer.observe({type:'resource',buffered:true});}}catch{observer?.disconnect();observer=null;}
  return {snapshot(){
    if(observer)consume(observer.takeRecords());
    else {const entries=performance.getEntriesByType('resource');if(entries.length<cursor)cursor=0;consume(entries.slice(cursor));cursor=entries.length;}
    return {...totals,largestTransfers:totals.largestTransfers.map(row=>({...row}))};
  },dispose(){observer?.disconnect();observer=null;}};
}
