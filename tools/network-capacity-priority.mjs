import os from 'node:os';

/** Only call with this experiment's own PID; never discover or modify peers
 * belonging to another task. A denied priority request remains visible evidence. */
export function setCapacityProcessPriority(policy='normal',pid=process.pid,api=os){
  if(!['normal','above-normal'].includes(policy))throw Error('Unsupported process priority policy');
  const result={pid,policy,requestedPriority:policy==='above-normal'?api.constants.priority.PRIORITY_ABOVE_NORMAL:null};
  try{result.beforePriority=api.getPriority(pid);if(result.requestedPriority!==null)api.setPriority(pid,result.requestedPriority);result.actualPriority=api.getPriority(pid);}
  catch(error){result.error=error.message;try{result.actualPriority=api.getPriority(pid);}catch{result.actualPriority=null;}}
  return result;
}
