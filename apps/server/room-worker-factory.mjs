/** One room per OS process. Only the coordinator owns accounts and queues. */
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OWNERSHIP_PROTOCOL} from '../../packages/online/owned-state.mjs';

const ENTRY = fileURLToPath(new URL('./room-worker-entry.mjs', import.meta.url));
export async function createRoomWorkerFactory({root,assetRoot,metadataFactory,workerEntry=ENTRY,
  requestTimeoutMs=5000,startTimeoutMs=90000,maxPendingInputs=64,maxPendingPerPlayer=16,maxPendingBytes=4*1024*1024,
  onFailure=diagnostic=>console.error(JSON.stringify({event:'room-worker-failure',...diagnostic}))}={}) {
  if(typeof metadataFactory!=='function')throw Error('room-worker-metadata-required');
  if(typeof onFailure!=='function')throw Error('invalid-room-worker-diagnostics');
  for(const value of [requestTimeoutMs,startTimeoutMs,maxPendingInputs,maxPendingPerPlayer,maxPendingBytes])
    if(!Number.isSafeInteger(value)||value<=0)throw Error('invalid-room-worker-limits');
  const workers=new Set(),recentFailures=[];
  const factory=async({match,emit,finish})=>{
    const child=fork(workerEntry,[],{cwd:root,serialization:'advanced',stdio:['ignore','ignore','pipe','ipc'],
      // Do not inherit test runners, coverage hooks or a debugger's listen port.
      execArgv:[],env:{...process.env,RF_ROOM_WORKER_CHILD:'1'}});
    const requests=new Map(),playerPending=new Map();let serial=0,stopped=false,initialized=false,pendingBytes=0,pendingInputs=0,maxObservedInputs=0,maxObservedBytes=0;
    let latestSnapshot=null,lastMetrics={pid:child.pid,matchPlayerCount:match.players.length},startupResolve,startupReject,failure=null,stderrBytes=0,stderrTail=Buffer.alloc(0);
    child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;stderrTail=Buffer.concat([stderrTail,chunk]).subarray(-8192);if(failure){failure.stderrBytes=stderrBytes;failure.stderrTail=stderrTail.toString('utf8');}});
    const startup=new Promise((resolve,reject)=>{startupResolve=resolve;startupReject=reject;});
    const row={diagnostics:()=>({...lastMetrics,pendingInputs,pendingBytes,maxPendingInputs:maxObservedInputs,maxPendingBytes:maxObservedBytes,
      pendingRequests:requests.size,connected:child.connected}),close:()=>fail(Error('room-worker-factory-closed'))};workers.add(row);
    const fail=(error,detail={})=>{
      if(stopped)return;stopped=true;clearTimeout(startupTimer);workers.delete(row);
      if(error.message!=='room-worker-factory-closed'){
        failure={atWallMs:Date.now(),pid:child.pid,cause:error.message,matchPlayerCount:match.players.length,
          pendingInputs,pendingBytes,pendingRequests:requests.size,...detail,exitCode:child.exitCode,signal:child.signalCode,
          stderrBytes,stderrTail:stderrTail.toString('utf8'),lastMetrics:structuredClone(lastMetrics)};
        recentFailures.push(failure);if(recentFailures.length>16)recentFailures.shift();
        // Journal output is a bounded summary with no room/player identity or
        // arbitrary child text. The private diagnostic retains the stderr tail.
        const {stderrTail:privateTail,lastMetrics:metrics,workerErrorMessage:privateMessage,...summary}=failure;
        try{onFailure(summary);}catch{}
      }
      for(const request of requests.values()){clearTimeout(request.timer);request.reject(error);}requests.clear();
      pendingBytes=0;pendingInputs=0;playerPending.clear();
      startupReject(error);if(initialized)emit('room-failed',{matchId:match.id,error:'room-worker-unavailable',cause:error.message});
      if(child.connected)child.disconnect();child.kill();
    };
    const startupTimer=setTimeout(()=>fail(Error('room-worker-start-timeout')),startTimeoutMs);startupTimer.unref?.();
    const send=message=>{
      if(stopped||!child.connected)throw Error('room-worker-unavailable');
      child.send(message,error=>{if(error)fail(Error('room-worker-send-failed'));});
    };
    function rpc(method,args=[],{input=false,bytes=0,playerId=null}={}){
      if(stopped)return Promise.reject(Error('room-worker-unavailable'));
      if(input&&(pendingInputs>=maxPendingInputs||(playerPending.get(playerId)??0)>=maxPendingPerPlayer||pendingBytes+bytes>maxPendingBytes))
        return Promise.reject(Error('room-worker-input-busy'));
      const id=++serial;
      if(input){pendingInputs++;pendingBytes+=bytes;maxObservedInputs=Math.max(maxObservedInputs,pendingInputs);maxObservedBytes=Math.max(maxObservedBytes,pendingBytes);
        playerPending.set(playerId,(playerPending.get(playerId)??0)+1);}
      return new Promise((resolve,reject)=>{
        const release=()=>{if(input){pendingInputs--;pendingBytes-=bytes;const count=(playerPending.get(playerId)??1)-1;if(count)playerPending.set(playerId,count);else playerPending.delete(playerId);}};
        const submittedAt=Date.now();
        const timer=setTimeout(()=>fail(Error('room-worker-request-timeout'),{requestMethod:method,requestAgeMs:Date.now()-submittedAt}),requestTimeoutMs);timer.unref?.();
        requests.set(id,{timer,resolve:value=>{release();resolve(value);},reject:error=>{release();reject(error);}});
        try{send({kind:'request',id,method,args});}catch(error){clearTimeout(timer);requests.delete(id);release();reject(error);}
      });
    }
    child.on('error',error=>fail(Error('room-worker-process-error'),{processErrorCode:typeof error.code==='string'?error.code:null}));
    child.on('disconnect',()=>fail(Error('room-worker-disconnected')));
    child.on('exit',(code,signal)=>{if(failure){failure.exitCode=code;failure.signal=signal;}fail(Error('room-worker-exited'));});
    child.on('message',message=>{
      if(stopped||!message||typeof message!=='object')return;
      if(message.kind==='ready'){
        clearTimeout(startupTimer);latestSnapshot=message.snapshot;initialized=true;startupResolve();return;
      }
      if(message.kind==='fatal'){
        const reason=typeof message.error==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(message.error)?message.error:'room-worker-failed';
        const detail={};for(const key of ['pendingOutputMessages','pendingOutputBytes'])if(Number.isSafeInteger(message.detail?.[key])&&message.detail[key]>=0)detail[key]=message.detail[key];
        if(typeof message.detail?.errorName==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(message.detail.errorName))detail.workerErrorName=message.detail.errorName;
        if(typeof message.detail?.errorMessage==='string')detail.workerErrorMessage=message.detail.errorMessage.slice(0,512);
        fail(Error(reason),detail);return;
      }
      if(message.kind==='reply'){
        const request=requests.get(message.id);if(!request)return;requests.delete(message.id);clearTimeout(request.timer);
        if(message.error){const error=Error(message.error);error.code=message.error;error.status=message.status??400;request.reject(error);}
        else request.resolve(message.value);return;
      }
      if(message.kind==='metrics'){lastMetrics={...message.value,pid:child.pid,matchPlayerCount:match.players.length};return;}
      if(message.kind==='event'){
        if(message.type==='state')latestSnapshot=message.seed??message.data;
        emit(message.type,message.data);return;
      }
      if(message.kind==='finish')Promise.resolve(finish(message.result)).catch(()=>{});
    });
    send({kind:'initialize',root,assetRoot,match,bindings:factory.relayBindings?.(match)??[]});
    await startup;
    const driver={ownership:OWNERSHIP_PROTOCOL,inputValidation:'room-worker-v1',cachedSnapshot:true,
      // Transports already enforce 128 KiB decoded input. Reserve that upper
      // bound without serializing the complete tree again on the coordinator.
      submitInput(id,batch){return rpc('submitInput',[id,batch],{input:true,playerId:id,bytes:128*1024});},
      ready(id){return rpc('ready',[id]);},
      disconnect(id,options){if(!stopped)rpc('disconnect',[id,options]).catch(()=>{});},
      reconnect(id){return stopped?Promise.resolve({resumed:false}):rpc('reconnect',[id]);},
      bindRelay(id,binding){if(!stopped)send({kind:'bind',playerId:id,binding});},
      snapshot(){return latestSnapshot?structuredClone(latestSnapshot):null;},
      diagnostics:row.diagnostics,
      stop(){if(stopped)return;stopped=true;clearTimeout(startupTimer);workers.delete(row);
        for(const request of requests.values()){clearTimeout(request.timer);request.reject(Error('room-worker-stopped'));}requests.clear();
        try{if(child.connected)child.send({kind:'stop'});}catch{}
        const timer=setTimeout(()=>child.kill(),1000);timer.unref?.();child.once('exit',()=>clearTimeout(timer));},
    };
    return driver;
  };
  for(const key of ['ownership','versions','professions','assetDiagnostics','maps','mapVersions','mapLoadTimeoutSeconds'])factory[key]=metadataFactory[key];
  // Only our production entry consumes each owner request synchronously in
  // IPC arrival order. Alternate entries/factories retain serial WS dispatch.
  factory.orderedInputDispatch=workerEntry===ENTRY?'synchronous-owner-ipc-v1':null;
  factory.workerDiagnostics=()=>({mode:'child-process',active:workers.size,workers:[...workers].map(row=>row.diagnostics()),recentFailures:structuredClone(recentFailures)});
  factory.close=()=>{for(const row of [...workers])row.close();};
  return factory;
}
