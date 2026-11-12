import {normalizeProfessionId} from '../../packages/professions/catalog.mjs';

/** One page owns one current profession. Server status wins over a late POST;
 * queued/playing/saving pages defer publication until their host is idle.
 * Resources and account preferences are prepared before commit, which is
 * synchronous so a render packet cannot observe two different professions. */
export function createProfessionSwitch({current,canCommit,commit,prepare=null,onError=()=>{},onBusy=()=>{}}){
  let revision=0,pending=null,saving=false,disposed=false,switches=0,preparing=null,prepared=null,prepareRun=null;
  function flush(){
    if(disposed||pending===null||!canCommit())return false;
    const next=pending;
    if(next===current()){pending=null;return false;}
    if(prepare&&prepared!==next){
      if(preparing!==null)return false;
      preparing=next;onBusy(true);
      prepareRun=Promise.resolve().then(()=>prepare(next)).then(()=>{
        prepareRun=null;if(disposed)return;prepared=next;preparing=null;onBusy(saving);flush();
      },error=>{
        prepareRun=null;if(disposed)return;preparing=null;if(pending===next)pending=null;
        onBusy(saving);onError(error);flush();
      });
      return false;
    }
    commit(next);pending=null;switches++;return true;
  }
  return {
    observe(id){if(disposed)return false;revision++;pending=normalizeProfessionId(id);return flush();},
    flush,
    async settled(){while(prepareRun)await prepareRun;},
    async select(id,save){
      id=normalizeProfessionId(id);
      if(disposed||saving||preparing!==null||!canCommit())throw Error('Finish configuring your skills or leave the queue before switching classes');
      saving=true;onBusy(true);const before=revision;
      try{
        const result=await save(id);
        if(disposed)return result;
        if(revision===before)pending=normalizeProfessionId(result?.professionId??id);
        flush();while(prepareRun)await prepareRun;return result;
      }finally{saving=false;if(!disposed){onBusy(preparing!==null);flush();}}
    },
    get busy(){return saving||preparing!==null;},
    proof(){return {current:current(),pending,revision,switches,saving,disposed,preparing};},
    dispose(){disposed=true;pending=null;revision++;},
  };
}
