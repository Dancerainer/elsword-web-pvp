/** One process-wide download budget. Battle/control writes never wait on it.
 * Rates describe application bytes handed to sockets, not NIC/TCP measurements.
 */
export const DEFAULT_UPDATE_BANDWIDTH = Object.freeze({
  bytesPerSecond: 1_250_000, usableFraction: .9, playerReserveBytesPerSecond: 80_000,
  roomReserveBytesPerSecond: 250_000, tickMs: 20, chunkBytes: 8192,
  // Admit a single update blob up to the 100 MB transfer cap. This bounds
  // aggregate queued memory only; it never increases the socket write budget.
  maximumTransfers: 32, maximumBufferedBytes: 128 * 1024 * 1024,
});

/** Coordinator output transports only; room children send private IPC. */
export function hasBattleOutputPressure(streams=[],socketRelays=[]) {
  const pending=row=>row.queueAgeMs>30||row.queuedBytes>0||row.queuedEvents>0;
  for(const stream of streams)if(stream.transport==='sse'){
    const row=stream.performance();
    // SSE performance() exposes ended/ending, including diagnostics whose
    // compression callback was retired. Only a live output can block updates.
    if(!row.ended&&(pending(row)||row.compressionInFlight))return true;
  }
  for(const relay of socketRelays){
    const row=relay.channel.performance();
    // WebSocket performance().closed includes its closing state; combat output
    // has already been discarded there and must not create sticky pressure.
    if(!row.closed&&pending(row))return true;
  }
  return false;
}

export function createUpdateBandwidth({getPressure=()=>({}), clock=()=>performance.now(),
  timers={setInterval,clearInterval}, ...options}={}) {
  const config={...DEFAULT_UPDATE_BANDWIDTH,...options};
  for(const name of ['bytesPerSecond','playerReserveBytesPerSecond','roomReserveBytesPerSecond','tickMs','chunkBytes','maximumTransfers','maximumBufferedBytes'])
    if(!Number.isSafeInteger(config[name])||config[name]<=0)throw Error('invalid-update-bandwidth-config');
  if(!(config.usableFraction>0&&config.usableFraction<=.95)||typeof getPressure!=='function'||typeof clock!=='function'
    ||typeof timers.setInterval!=='function'||typeof timers.clearInterval!=='function')throw Error('invalid-update-bandwidth-config');
  const sockets=new Map(),transfers=[],samples=[];
  let lastAt=clock(),pendingClosedBytes=0,downloadDelta=0,tokens=0,cursor=0,bufferedBytes=0,reservedTransfers=0,closed=false;
  const metrics={downloadBytes:0,priorityBytes:0,completed:0,cancelled:0,rejected:0,pausedTicks:0,maximumBufferedBytes:0};
  let state={budgetBytesPerSecond:config.bytesPerSecond*config.usableFraction,priorityBytesPerSecond:0,reservedBytesPerSecond:0,playingRooms:0,playingPlayers:0,paused:false};
  const socketDelta=()=>{
    let bytes=pendingClosedBytes;pendingClosedBytes=0;
    for(const [socket,previous]of sockets){const current=socket.bytesWritten;bytes+=Math.max(0,current-previous);sockets.set(socket,current);}
    return bytes;
  };
  function finish(row,cancelled=false){
    if(row.finished)return;row.finished=true;row.release();
    row.response.off('drain',row.drain);row.response.off('close',row.abort);row.response.off('error',row.abort);
    const index=transfers.indexOf(row);if(index>=0){transfers.splice(index,1);if(index<cursor)cursor--;}
    if(cancelled)metrics.cancelled++;else metrics.completed++;
    row.resolve(!cancelled);
  }
  function tick(){
    if(closed)return;
    const at=clock(),elapsed=Math.max(0,at-lastAt),delta=Math.max(0,socketDelta()-downloadDelta);
    downloadDelta=0;lastAt=at;metrics.priorityBytes+=delta;
    samples.push({at,elapsed,bytes:delta});while(samples.length&&at-samples[0].at>1000)samples.shift();
    const rate=windowMs=>{
      const rows=samples.filter(row=>at-row.at<windowMs),duration=rows.reduce((sum,row)=>sum+row.elapsed,0);
      return duration?rows.reduce((sum,row)=>sum+row.bytes,0)*1000/Math.max(windowMs,duration):0;
    };
    const pressure=getPressure(),playingRooms=Math.max(0,pressure.playingRooms??0),playingPlayers=Math.max(0,pressure.playingPlayers??0);
    // A fresh battle/fallback burst must reduce this pump's download budget,
    // before enough samples fill the longer rolling estimates. Reuse tickMs
    // as the minimum interval so zero/early callbacks cannot amplify noise.
    const intervalPriorityRate=delta*1000/Math.max(elapsed,config.tickMs);
    const priorityRate=Math.max(intervalPriorityRate,rate(250),rate(1000)),reserved=Math.max(playingRooms*config.roomReserveBytesPerSecond,playingPlayers*config.playerReserveBytesPerSecond);
    const usable=config.bytesPerSecond*config.usableFraction;
    const paused=Boolean(pressure.blocked)||priorityRate>=usable*.95||reserved>=usable;
    const controlMargin=Math.min(32_768,usable*.03);
    const budget=paused?0:Math.max(0,usable-Math.max(reserved,priorityRate*1.2+(priorityRate?controlMargin:0)));
    state={budgetBytesPerSecond:budget,priorityBytesPerSecond:priorityRate,reservedBytesPerSecond:reserved,playingRooms,playingPlayers,paused:budget===0};
    // A short bounded credit prevents idle time from accumulating a large burst.
    // Recompute before every pump: a newly started battle discards old credit.
    tokens=Math.min(tokens+budget*Math.min(elapsed,config.tickMs*2)/1000,budget*config.tickMs*2/1000);
    if(!budget){tokens=0;if(transfers.length)metrics.pausedTicks++;return;}
    let misses=0;
    while(transfers.length&&tokens>=1&&misses<transfers.length){
      cursor%=transfers.length;const row=transfers[cursor];cursor=(cursor+1)%transfers.length;
      if(row.response.destroyed){finish(row,true);continue;}
      if(row.blocked||row.response.writableNeedDrain){misses++;continue;}
      const bytes=Math.min(config.chunkBytes,Math.floor(tokens),row.bytes.length-row.offset);
      if(!bytes)break;
      row.blocked=!row.response.write(row.bytes.subarray(row.offset,row.offset+bytes));
      row.offset+=bytes;tokens-=bytes;downloadDelta+=bytes;metrics.downloadBytes+=bytes;misses=0;
      if(row.offset===row.bytes.length){row.response.end();finish(row);}
    }
  }
  const timer=timers.setInterval(tick,config.tickMs);timer.unref?.();
  return {
    attachSocket(socket){
      if(closed||sockets.has(socket))return;sockets.set(socket,socket.bytesWritten);
      socket.once('close',()=>{const previous=sockets.get(socket);if(previous!==undefined)pendingClosedBytes+=Math.max(0,socket.bytesWritten-previous);sockets.delete(socket);});
    },
    reserve(bytes){
      if(closed||!Number.isSafeInteger(bytes)||bytes<0||reservedTransfers>=config.maximumTransfers||bufferedBytes+bytes>config.maximumBufferedBytes){metrics.rejected++;return null;}
      reservedTransfers++;bufferedBytes+=bytes;metrics.maximumBufferedBytes=Math.max(metrics.maximumBufferedBytes,bufferedBytes);
      let released=false;
      return ()=>{if(released)return;released=true;reservedTransfers--;bufferedBytes-=bytes;};
    },
    send(response,bytes,release){
      if(typeof release!=='function')throw Error('update-transfer-reservation-required');
      if(closed||response.destroyed){release();return Promise.resolve(false);}
      return new Promise(resolve=>{
        const row={response,bytes,release,resolve,offset:0,blocked:false,finished:false};
        row.drain=()=>{row.blocked=false;};row.abort=()=>finish(row,true);
        response.on('drain',row.drain);response.once('close',row.abort);response.once('error',row.abort);transfers.push(row);
        if(bytes.length===0){response.end();finish(row);}
      });
    },
    performance:()=>({...metrics,...state,activeTransfers:transfers.length,reservedTransfers,bufferedBytes,config:{...config}}),
    close(){if(closed)return;closed=true;timers.clearInterval(timer);for(const row of [...transfers]){row.response.destroy();finish(row,true);}sockets.clear();},
  };
}
