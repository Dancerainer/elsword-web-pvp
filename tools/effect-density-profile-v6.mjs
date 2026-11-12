/** Summary functions for measured samples. Phase CPU fields are disjoint;
 * renderer subphase counters are diagnostic subsets and must not be added. */
export const cpuPhases=Object.freeze(['coreMs','eventMs','updateMs','renderMs','sceneMs']);
export const summaryFields=Object.freeze([...cpuPhases,'effectCpuMs','totalCpuMs','fxUpdateMs','fxRenderMs','fxQuadMergeMs','sampleAnimationMs','particlesInNativeDrawOrderMs','setNativeSequenceRenderOrderMs','nativeQuadTextureDrawGroupsMs','evaluateActiveMs','renderSortedMs','createActorViewMs']);
export const peakFields=Object.freeze(['fxParticles','fxEmitters','fxQuadInstances','liveQuadBatches','quadDrawSlots','liveMeshViews','totalDraws','quadDraws','meshDraws','allBatchCpuBufferBytes','allGpuBufferBytes']);
export function percentile(values,p){
  if(!Number.isFinite(p)||p<0||p>1)throw new RangeError('Percentile must be between zero and one');
  return [...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]??0;
}
export function summarize(rows){return Object.fromEntries(summaryFields.map(field=>{
  const values=rows.map(row=>row[field]??0);
  return [field,{median:percentile(values,.5),p95:percentile(values,.95),max:Math.max(0,...values),sum:values.reduce((a,b)=>a+b,0)}];
}));}
export function metricPeaks(rows){return Object.fromEntries(peakFields.map(field=>{
  const row=rows.reduce((peak,row)=>!peak||(row[field]??0)>(peak[field]??0)?row:peak,null);
  return [field,{value:row?.[field]??0,frame:row?.frame??null}];
}));}
export function compareCombatTraces(reference,candidate){
  const differences=[];
  if(reference.frames.length!==candidate.frames.length)differences.push({field:'frameCount',reference:reference.frames.length,candidate:candidate.frames.length});
  for(let frame=0;frame<Math.min(reference.frames.length,candidate.frames.length);frame++){
    for(const field of ['combatStateHash','combatEventsHash'])if(reference.frames[frame][field]!==candidate.frames[frame][field])
      differences.push({frame,field,reference:reference.frames[frame][field],candidate:candidate.frames[frame][field]});
  }
  return {equal:differences.length===0,comparedFrames:Math.min(reference.frames.length,candidate.frames.length),differences};
}
