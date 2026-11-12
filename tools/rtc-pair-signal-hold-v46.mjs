/** Diagnostic-only HTTP signaling hold. It never substitutes a response or PC. */
export function validatePairSignalHoldMs(value) {
  if(!Number.isSafeInteger(value)||(value!==0&&(value<500||value>1000)))throw Error('invalid-pair-signal-hold-ms');
  return value;
}

export function createPairSignalHold({playerId,durationMs=0,clock=Date.now,schedule=setTimeout,cancel=clearTimeout}={}) {
  validatePairSignalHoldMs(durationMs);
  const signalTypes=new Set(['offer','answer','candidate']),queue=[],requests=[];
  let peerId=null,armedAtWallMs=null,closedAtWallMs=null,releaseAtWallMs=null,timer=null,draining=false,closed=false;
  const isPair=(from,to)=>from==='rtc-v6-0'&&to==='rtc-v6-1'||from==='rtc-v6-1'&&to==='rtc-v6-0';
  async function perform(row,send) {
    row.fetchStartedAtWallMs=clock();
    try {
      const response=await send();
      row.completedAtWallMs=clock();row.status=Number.isInteger(response?.status)?response.status:null;row.outcome='fulfilled';
      return response;
    } catch(error) {row.completedAtWallMs=clock();row.outcome='rejected';throw error;}
  }
  function pump() {
    if(closed||draining||!queue.length)return;
    if(clock()<releaseAtWallMs) {
      if(timer===null)timer=schedule(()=>{timer=null;pump();},Math.max(1,releaseAtWallMs-clock()));
      return;
    }
    draining=true;
    void (async()=>{
      // FIFO includes each genuine response: no later held signal overtakes an
      // earlier HTTP request. Only this pair's temporary diagnostic queue waits.
      while(queue.length&&!closed) {
        const {row,send,resolve,reject}=queue.shift();row.releasedAtWallMs=clock();
        try {resolve(await perform(row,send));}catch(error){reject(error);}
      }
      draining=false;
    })();
  }
  return {
    arm(to,atWallMs) {
      if(durationMs===0)return;
      if(closed||peerId!==null||!isPair(playerId,to)||!Number.isSafeInteger(atWallMs))throw Error('invalid-pair-signal-hold-arm');
      peerId=to;armedAtWallMs=clock();closedAtWallMs=atWallMs;releaseAtWallMs=atWallMs+durationMs;
    },
    send(to,type,send) {
      if(peerId===null||to!==peerId||!signalTypes.has(type))return send();
      if(closed)return Promise.reject(Error('diagnostic-signal-hold-closed'));
      const row={sequence:requests.length,from:playerId,to,type,interceptedAtWallMs:clock(),queuedAtWallMs:null,
        releasedAtWallMs:null,fetchStartedAtWallMs:null,completedAtWallMs:null,status:null,outcome:'pending'};
      requests.push(row);
      if(clock()<releaseAtWallMs||draining||queue.length) {
        row.queuedAtWallMs=clock();
        const result=new Promise((resolve,reject)=>queue.push({row,send,resolve,reject}));pump();return result;
      }
      return perform(row,send);
    },
    snapshot({histories=true}={}) {
      return {durationMs,playerId,peerId,armedAtWallMs,closedAtWallMs,releaseAtWallMs,
        queuedRequests:requests.filter(row=>row.queuedAtWallMs!==null).length,
        pendingRequests:requests.filter(row=>row.outcome==='pending').length,
        completedRequests:requests.filter(row=>row.outcome==='fulfilled').length,
        failedRequests:requests.filter(row=>row.outcome==='rejected').length,
        holding:peerId!==null&&!closed&&clock()<releaseAtWallMs,draining,queueLength:queue.length,
        ...(histories?{requests:requests.map(row=>({...row}))}:{requestHistoryCount:requests.length})};
    },
    close() {
      closed=true;if(timer!==null){cancel(timer);timer=null;}
      for(const {row,reject}of queue.splice(0)) {row.completedAtWallMs=clock();row.outcome='rejected';reject(Error('diagnostic-signal-hold-closed'));}
    },
  };
}
