/** Keep a synchronous frame fault from cancelling Babylon's next RAF.
 * A failed battle stays stopped: silently stepping partially mutated state is
 * unsafe. The host displays the first fault and offers reload/logout.
 */
export function createFrameSupervisor({onFault=()=>{},onPresentationFault=()=>{},clock=()=>performance.now()}={}){
  let fault=null,frames=0,stage='idle';
  const presentationFaults=new Map();
  return Object.freeze({
    // These callers only update presentation. A failed display stage may skip
    // one frame and retry; combat/owner packet faults still stop immediately.
    presentation(name,callback){
      const previousStage=stage;
      stage=name;
      try{return callback();}
      catch(error){
        const count=(presentationFaults.get(name)?.count??0)+1;
        const proof={stage:name,count,frames,atMs:clock(),message:String(error?.message??error).slice(0,1000),stack:String(error?.stack??'').slice(0,4000)};
        presentationFaults.set(name,proof);
        // Bound storage and logs even when a missing effect fails every frame.
        if(count===1||count<=32&&(count&(count-1))===0){
          try{onPresentationFault({...proof},error);}catch{}
        }
      }finally{stage=previousStage;}
    },
    wrap(callback){
      return function(...args){
        if(fault)return;
        frames++;stage='frame';
        try{return callback.call(this,name=>{stage=name;},...args);}
        catch(error){
          fault={stage,frames,atMs:clock(),message:String(error?.message??error).slice(0,1000),stack:String(error?.stack??'').slice(0,4000)};
          try{onFault({...fault},error);}catch(reportError){console.error('Unable to display battle frame fault',reportError);}
        }
      };
    },
    proof:()=>fault?{...fault}:null,
    presentationProof:()=>[...presentationFaults.values()].map(proof=>({...proof})),
  });
}
