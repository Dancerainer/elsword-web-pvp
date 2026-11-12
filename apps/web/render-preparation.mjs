import {isAddFactoryFollower} from '../../packages/combat-core/add-factory.mjs';
/** Promise-only preparation can keep the browser in its microtask queue for
 * seconds when cached resources finish immediately. Share a bounded queue
 * across professions so heartbeat timers and input run between work batches.
 * Awaited I/O may overlap; only the synchronous start of each job is queued. */
export function createPreparationScheduler({maxBatchSize=16,maxBatchMs=8,now=()=>performance.now()}={}) {
  const queue=[];let pending=false,starts=0,batchStart=0;
  function drain(){
    if(starts===0)batchStart=now();
    while(queue.length){
      if(starts>=maxBatchSize||now()-batchStart>=maxBatchMs){
        setTimeout(()=>{starts=0;batchStart=now();drain();},0);return;
      }
      const {work,resolve,reject}=queue.shift();starts++;
      try{resolve(work());}catch(error){reject(error);}
    }
    pending=false;
  }
  return work=>new Promise((resolve,reject)=>{
    queue.push({work,resolve,reject});
    if(!pending){pending=true;queueMicrotask(drain);}
  });
}
export const scheduleRenderPreparation=createPreparationScheduler();

/** Optional probe telemetry. Observe promises without changing their result,
 * retry policy, concurrency or source burst budget. No timers are installed. */
export function createPreparationDiagnostics(onProgress,{templates=0,now=()=>performance.now()}={}){
  if(typeof onProgress!=='function')return null;
  const started=now(),pending=new Map();let sequence=0,lastEmit=-Infinity;
  const state={phase:'starting',templates,visitedTemplates:0,createdViews:0,requestedJobs:0,completedJobs:0,failedJobs:0};
  function emit(force=false){
    const time=now();if(!force&&time-lastEmit<250)return;lastEmit=time;
    const oldest=pending.values().next().value;
    onProgress({...state,elapsedMs:time-started,pendingJobs:pending.size,
      oldestPending:oldest?{...oldest,ageMs:time-oldest.startedAt}:null,reportedAt:time});
  }
  return {
    phase(phase,template){state.phase=phase;if(template!==undefined)state.template=template;emit(true);},
    template(name){state.template=name;state.visitedTemplates++;state.phase='creating';emit();},
    created(){state.createdViews++;emit();},
    observe(job,label){
      const id=++sequence;state.requestedJobs++;pending.set(id,{label,startedAt:now()});
      job.then(()=>{pending.delete(id);state.completedJobs++;emit();},error=>{
        pending.delete(id);state.failedJobs++;state.error=String(error?.stack??error);emit(true);
      });return job;
    },
    finish(error){state.phase=error?'failed':'complete';if(error)state.error=String(error?.stack??error);emit(true);},
  };
}

/** A rejected shader preparation must be retried; concurrent requests share
 * only the same mesh/variant. The weak keys do not retain disposed meshes. */
export function createRenderPreparationCache() {
  const jobs=new WeakMap();
  return function prepare(mesh,options) {
    let variants=jobs.get(mesh);
    if(!variants){variants=new Map();jobs.set(mesh,variants);}
    const key=options?.useInstances===true?'instances':'mesh';
    if(variants.has(key))return variants.get(key);
    const job=scheduleRenderPreparation(()=>mesh.material.forceCompilationAsync(mesh,options));
    variants.set(key,job);
    job.catch(()=>{if(variants.get(key)===job)variants.delete(key);});
    return job;
  };
}

/** Reuse the lookup itself and iterate source packets directly. Selection and
 * last-wins duplicate IDs match the former filter/map/Map expression. */
export function updateControlledEffectLookup(lookup,effects) {
  lookup.clear();
  for(const effect of effects??[])if(effect.sourcePosedAnchor||effect.sourceArcHandle>0||effect.sourceSkillMeshControl||effect.sourceXCrashMeshClock||effect.sourceSetTargetMesh||effect.sourceAddFury||effect.sourceAddQuicksilverLink||effect.sourceAddVoidCollapse||isAddFactoryFollower(effect)||effect.sourceAddSummonSerial!==undefined||effect.name==='DamageEffect_SA_APT_Magnetron_Dynamo_Start')
    lookup.set(effect.id,effect);
  return lookup;
}
