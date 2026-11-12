/** Diagnostic summaries for independent real rooms. No game rules or state
 * changes: all memberships and concurrency windows come from observed peers. */
export const MODE_PLAYERS=Object.freeze({'1v1':2,'2v2':4,'3v3':6});
export function parseRoomPlan(value='3v3'){
  const modes=value.split(',');
  if(!modes.length||modes.length>6||modes.some(mode=>!Object.hasOwn(MODE_PLAYERS,mode)))throw Error('Invalid room plan');
  const players=modes.reduce((sum,mode)=>sum+MODE_PLAYERS[mode],0);
  if(players>30)throw Error('Diagnostic room plan exceeds 30 players');
  return {modes,players,peerModes:modes.flatMap(mode=>Array(MODE_PLAYERS[mode]).fill(mode))};
}
export function distribution(values){
  const rows=values.filter(Number.isFinite).sort((a,b)=>a-b),n=rows.length;
  const at=p=>n?rows[Math.min(n-1,Math.ceil(n*p)-1)]:null;
  return {samples:n,mean:n?rows.reduce((a,b)=>a+b,0)/n:null,p50:at(.5),p95:at(.95),p99:at(.99),max:n?rows[n-1]:null};
}
const countModes=modes=>Object.fromEntries(Object.keys(MODE_PLAYERS).map(mode=>[mode,modes.filter(value=>value===mode).length]));
export function summarizeRoomOverlap({plan,peers,receiveRows=[],minimumOverlapSeconds=150}){
  const reasons=[],rooms=new Map(),peerRoom=new Map();
  if(peers.length!==plan.players)reasons.push('peer-count-mismatch');
  for(const peer of peers){
    if(!peer.playerId||peerRoom.has(peer.playerId)){reasons.push('missing-or-duplicate-player-id');continue;}
    if(!peer.matchId||!MODE_PLAYERS[peer.matchMode]){reasons.push('peer-missing-match-identity');continue;}
    const room=rooms.get(peer.matchId)??{matchId:peer.matchId,mode:peer.matchMode,players:[],starts:[],ends:[],declarations:[]};
    rooms.set(peer.matchId,room);peerRoom.set(peer.playerId,peer.matchId);room.players.push(peer.playerId);
    if(room.mode!==peer.matchMode)reasons.push('room-mode-disagreement');
    if(peer.requestedMode!==peer.matchMode)reasons.push('requested-mode-mismatch');
    room.declarations.push([...(peer.matchPlayerIds??[])].sort());
    const generated=peer.generatedReports??[];
    if(!generated.length){reasons.push('peer-without-source-reports');continue;}
    room.starts.push(generated[0].generatedAtWallMs);room.ends.push(generated.at(-1).generatedAtWallMs);
  }
  const expected=countModes(plan.modes),actual=countModes([...rooms.values()].map(room=>room.mode));
  if(JSON.stringify(expected)!==JSON.stringify(actual))reasons.push('observed-room-plan-mismatch');
  const starts=[],ends=[];
  for(const room of rooms.values()){
    room.players.sort();
    if(room.players.length!==MODE_PLAYERS[room.mode])reasons.push('incomplete-room');
    if(room.declarations.some(ids=>JSON.stringify(ids)!==JSON.stringify(room.players)))reasons.push('membership-disagreement');
    if(room.starts.length===room.players.length&&room.ends.length===room.players.length){
      room.startWallMs=Math.max(...room.starts);room.endWallMs=Math.min(...room.ends);
      room.overlapSeconds=Math.max(0,(room.endWallMs-room.startWallMs)/1000);starts.push(room.startWallMs);ends.push(room.endWallMs);
    }
    delete room.starts;delete room.ends;delete room.declarations;
  }
  const complete=starts.length===rooms.size&&peerRoom.size===plan.players&&rooms.size===plan.modes.length;
  const startWallMs=complete?Math.max(...starts):null,endWallMs=complete?Math.min(...ends):null;
  const overlapSeconds=complete?Math.max(0,(endWallMs-startWallMs)/1000):0;
  if(overlapSeconds<minimumOverlapSeconds)reasons.push('concurrent-window-too-short');
  const crossRoomRows=receiveRows.filter(row=>peerRoom.get(row.source)!==peerRoom.get(row.sink)||!peerRoom.has(row.source)||row.source===row.sink);
  if(crossRoomRows.length)reasons.push('unexpected-cross-room-or-self-delivery');
  const overlapping=row=>complete&&row.generatedAtWallMs>=startWallMs&&row.generatedAtWallMs<endWallMs&&row.acceptedAtWallMs>=startWallMs&&row.acceptedAtWallMs<endWallMs;
  const concurrentRows=receiveRows.filter(overlapping);
  for(const room of rooms.values()){
    const rows=concurrentRows.filter(row=>peerRoom.get(row.sink)===room.matchId);
    room.actuallyAppliedEndToEndMs=distribution(rows.filter(row=>row.applied===true).map(row=>row.ms));
    room.acceptedEndToEndMs=distribution(rows.map(row=>row.ms));
    room.rejectedOrSupersededDeliveries=rows.filter(row=>row.applied===false).length;
    room.bins30s=Array.from({length:Math.ceil(overlapSeconds/30)},(_,i)=>{
      const selected=rows.filter(row=>row.acceptedAtWallMs>=startWallMs+i*30000&&row.acceptedAtWallMs<Math.min(endWallMs,startWallMs+(i+1)*30000));
      return {startSeconds:i*30,endSeconds:Math.min(overlapSeconds,(i+1)*30),actuallyAppliedEndToEndMs:distribution(selected.filter(row=>row.applied===true).map(row=>row.ms)),acceptedEndToEndMs:distribution(selected.map(row=>row.ms))};
    });
  }
  return {scope:'intersection of first through last generated report for every player in every observed production match; latency requires generation and application inside this intersection',
    expectedRooms:expected,observedRooms:actual,requiredPlayers:plan.players,minimumOverlapSeconds,startWallMs,endWallMs,overlapSeconds,
    valid:reasons.length===0,reasons:[...new Set(reasons)],crossRoomDeliveries:crossRoomRows.length,
    acceptedEndToEndMs:distribution(concurrentRows.map(row=>row.ms)),actuallyAppliedEndToEndMs:distribution(concurrentRows.filter(row=>row.applied===true).map(row=>row.ms)),
    rejectedOrSupersededDeliveries:concurrentRows.filter(row=>row.applied===false).length,rooms:[...rooms.values()]};
}
export function summarizeSharedWire(bins,startWallMs,endWallMs){
  if(!Number.isFinite(startWallMs)||!Number.isFinite(endWallMs)||endWallMs<=startWallMs)return {seconds:0,downBytesPerSecond:distribution([]),upBytesPerSecond:distribution([]),rows:[]};
  // Only full wall-clock seconds inside actual common concurrency. Empty bins
  // are zero traffic, not missing samples; partial first/last seconds are excluded.
  const start=Math.ceil(startWallMs/1000)*1000,end=Math.floor(endWallMs/1000)*1000,rows=[];
  const selected=new Map();for(const bin of bins){const second=Math.floor(bin.atWallMs/1000)*1000;if(second<start||second>=end)continue;
    const row=selected.get(second)??{atWallMs:second,downBytes:0,upBytes:0};row.downBytes+=bin.down;row.upBytes+=bin.up;selected.set(second,row);}
  for(let second=start;second<end;second+=1000)rows.push(selected.get(second)??{atWallMs:second,downBytes:0,upBytes:0});
  return {scope:'complete one-second bins inside all-player overlap; one shared raw TCP bottleneck, including HTTP/SSE/WS framing and zero-traffic seconds; excluding TCP/IP and retransmission',
    startWallMs:start,endWallMs:end,seconds:rows.length,downBytesPerSecond:distribution(rows.map(row=>row.downBytes)),upBytesPerSecond:distribution(rows.map(row=>row.upBytes)),rows};
}
export function assessMeasurementIntegrity({concurrency,peers,peerExit,drops,sourceUnchanged,measurementUnchanged}){
  const failures=[];
  if(!sourceUnchanged)failures.push('production-source-changed-during-run');
  if(!measurementUnchanged)failures.push('measurement-tools-changed-during-run');
  if(!concurrency.valid)failures.push(...concurrency.reasons);
  if(peerExit.some(row=>row.code!==0))failures.push('peer-process-failed');
  if(peers.some(peer=>peer.error||peer.errors?.length))failures.push('peer-reported-error');
  if(drops.some(row=>row.reason!=='logout'))failures.push('unexpected-server-session-release');
  return {scope:'complete simultaneous run, immutable inputs, clean peer processes and no protocol errors or unexpected releases; latency values must still be assessed separately',
    passed:failures.length===0,failures:[...new Set(failures)]};
}
