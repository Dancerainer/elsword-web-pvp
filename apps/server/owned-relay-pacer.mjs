// Only independently decodable owned-state v2 clock packets belong here.
// Birth templates and reliable battle events must use the immediate path.
export function createOwnedRelayPacer({intervalMs=50,maxSources=5,clock=Date.now,
  timers={setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout},send,canSend=()=>true}={}) {
  if(!Number.isFinite(intervalMs)||intervalMs<=0||!Number.isSafeInteger(maxSources)||maxSources<1
    ||typeof clock!=='function'||typeof send!=='function'||typeof canSend!=='function'
    ||typeof timers?.setTimeout!=='function'||typeof timers?.clearTimeout!=='function')throw Error('invalid-owned-relay-pacer');
  const rows=new Map(),stats={offered:0,sent:0,replaced:0,cancelled:0,staleDropped:0,sourceLimitDropped:0,maxPending:0};
  const cancelTimer=row=>{if(row.timer!==null){timers.clearTimeout(row.timer);row.timer=null;}};
  const deliver=(row,packet)=>{
    if(!canSend(packet.value,packet.context)){stats.staleDropped++;return false;}
    if(send(packet.value,packet.context)===false){stats.staleDropped++;return false;}
    row.lastSentAt=clock();stats.sent++;return true;
  };
  const schedule=(source,row,deadline)=>{
    const timer=timers.setTimeout(()=>{
      if(rows.get(source)!==row||row.timer!==timer)return;
      row.timer=null;
      if(clock()<deadline){schedule(source,row,deadline);return;}
      const packet=row.pending;row.pending=null;
      if(packet)deliver(row,packet);
    },Math.max(0,deadline-clock()));
    row.timer=timer;timer?.unref?.();
  };
  return {
    offer(source,value,context,{immediate=false}={}) {
      stats.offered++;
      let row=rows.get(source);
      if(!row){
        if(rows.size>=maxSources){stats.sourceLimitDropped++;return false;}
        row={lastSentAt:null,pending:null,timer:null};rows.set(source,row);
      }
      const packet={value,context};
      if(immediate||row.lastSentAt===null||clock()>=row.lastSentAt+intervalMs){
        cancelTimer(row);if(row.pending){row.pending=null;stats.replaced++;}
        return deliver(row,packet);
      }
      if(row.pending)stats.replaced++;
      row.pending=packet;
      if(row.timer===null)schedule(source,row,row.lastSentAt+intervalMs);
      stats.maxPending=Math.max(stats.maxPending,[...rows.values()].filter(item=>item.pending).length);
      return true;
    },
    clear(source,{resetClock=true}={}) {
      const row=rows.get(source);if(!row)return;
      cancelTimer(row);if(row.pending){row.pending=null;stats.cancelled++;}
      if(resetClock)rows.delete(source);
    },
    clearAll() {for(const source of rows.keys())this.clear(source);},
    performance() {return {...stats,intervalMs,sources:rows.size,pending:[...rows.values()].filter(row=>row.pending).length};},
  };
}
