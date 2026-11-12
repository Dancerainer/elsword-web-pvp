/** Private IPC entry. No listener, credentials, account store or disk writes. */
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {createBattleDriverFactory} from './battle-driver.mjs';
import {consumeLocalOwnerWorkerInput} from '../../packages/online/service.mjs';
import {updateRoomRelayBinding} from './room-worker-relays.mjs';
import {compactOwnedSocketRoom} from './owned-socket-room.mjs';
import {ownedRelayControllerSignature} from './owned-relay-controller.mjs';

let driver=null,match=null,starting=false,stopping=false,failing=false,metricsTimer=null,outstanding=0,outstandingBytes=0;
let acceptedInputs=0;const peers=new Map(),recentActions=new Map();
const histogram=monitorEventLoopDelay({resolution:20});histogram.enable();
let lastCpu=process.cpuUsage(),lastTime=performance.now(),lastElu=performance.eventLoopUtilization();
function stop(){if(stopping)return;stopping=true;clearInterval(metricsTimer);histogram.disable();driver?.stop?.();if(process.connected)process.disconnect();}
function fatal(reason,detail={}){
  if(stopping||failing)return;failing=true;
  // One small terminal message bypasses an already full output queue, rather
  // than losing the reason when the IPC safety bound retires the room.
  if(process.connected)try{process.send({kind:'fatal',error:reason,detail},()=>stop());}catch{stop();}
  const timer=setTimeout(stop,10);timer.unref?.();
}
function output(message){
  if(stopping||failing||!process.connected)return;
  // Bound IPC as well as TCP: an unhealthy coordinator cannot accumulate an
  // unbounded second copy of reliable events in a room process.
  const bytes=Buffer.byteLength(JSON.stringify(message));
  if(outstanding>=256||outstandingBytes+bytes>16*1024*1024){fatal('room-worker-output-overflow',{pendingOutputMessages:outstanding,pendingOutputBytes:outstandingBytes});return;}
  outstanding++;outstandingBytes+=bytes;
  process.send(message,error=>{outstanding--;outstandingBytes-=bytes;if(error)fatal('room-worker-output-send-failed');});
}
function bind(playerId,binding){
  if(!match.players.some(player=>player.id===playerId))return;
  updateRoomRelayBinding(peers,playerId,binding);
}
function emit(type,data){
  if(type==='input'&&data.actions?.length){
    const prior=recentActions.get(data.playerId);
    // Source frames can barely advance while a browser stalls across respawn.
    // Never relabel an old life merely because its frame is still recent.
    const previous=prior?.epoch===data.epoch?prior.actions:[];
    recentActions.set(data.playerId,{epoch:data.epoch,frameSeq:data.frameSeq,receivedAt:performance.now(),
      actions:[...previous,...data.actions].slice(-16)});
    const prepared={};
    for(const [id,peer]of peers)if(id!==data.playerId){
      const value=peer.deltaVersion===3?{...peer.deltas.encodeActions(data.playerId,data,{cacheKey:data}),relayToken:peer.token}:data;
      prepared[id]={generation:peer.generation,token:peer.token,json:JSON.stringify(value)};
    }
    output({kind:'event',type,data:{...data,__roomPackets:prepared}});return;
  }
  if(type==='owned-state'){
    const report=data.report,prepared={},controllerSignature=ownedRelayControllerSignature(report);
    for(const [id,peer]of peers){
      if(id===data.playerId)continue;
      const life=`${report.epoch}:${report.actor.hp<=0}:${!!report.actor.hidden}:${!!report.actor.deathComplete}`;
      const lifeChanged=peer.lives.has(data.playerId)&&peer.lives.get(data.playerId)!==life;peer.lives.set(data.playerId,life);
      if(peer.splitDeltas){
        const split=peer.deltas.encodeSplit(data.playerId,report,{cacheKey:data,deltaVersion:peer.deltaVersion});
        prepared[id]={generation:peer.generation,token:peer.token,split:true,lifeChanged,controllerSignature,
          actorBaseline:!!split.baseline?.actorBaseline,
          baselineJson:split.baseline?JSON.stringify({matchId:match.id,relayToken:peer.token,...split.baseline}):null,
          json:JSON.stringify({matchId:match.id,relayToken:peer.token,...split.value})};
      }else{
        const delta=peer.deltas.encode(data.playerId,report);
        prepared[id]={generation:peer.generation,token:peer.token,split:false,critical:delta.critical,
          json:JSON.stringify({matchId:match.id,relayToken:peer.token,...delta.value})};
      }
    }
    // The coordinator needs source/life clocks for authenticated RTC receipts;
    // it never needs to receive, clone or re-encode the full owner tree.
    output({kind:'event',type,data:{matchId:data.matchId,playerId:data.playerId,
      report:{epoch:report.epoch,frameSeq:report.frameSeq,actor:{hp:report.actor.hp,hidden:report.actor.hidden,deathComplete:report.actor.deathComplete}},
      __roomPackets:prepared}});return;
  }
  if(type==='state'){
    for(const [id,row]of recentActions)if(data.ownership.actors[id]?.epoch!==row.epoch)recentActions.delete(id);
    const prepared={};
    for(const [id,peer]of peers){
      let lifeChanged=false;
      for(const actor of data.snapshot.actors){const life=`${!!actor.pvpDead}:${!!actor.pvpDisconnected}`;
        if(peer.roomLives.has(actor.id)&&peer.roomLives.get(actor.id)!==life)lifeChanged=true;peer.roomLives.set(actor.id,life);}
      const compact=compactOwnedSocketRoom(data,peer.epochs);
      prepared[id]={generation:peer.generation,token:peer.token,critical:compact.critical||lifeChanged,json:JSON.stringify(compact.data)};
    }
    const seed={...data,recentActions:Object.fromEntries([...recentActions].filter(([id,row])=>
      performance.now()-row.receivedAt<=1000&&data.ownership.actors[id]?.epoch===row.epoch).map(([id,row])=>
      [id,{epoch:row.epoch,frameSeq:data.ownership.actors[id].frameSeq,actions:row.actions}]))};
    output({kind:'event',type,data:{...data,__roomPackets:prepared},seed});return;
  }
  output({kind:'event',type,data});
}
function metrics(){
  const stamp=performance.now(),cpu=process.cpuUsage(),elu=performance.eventLoopUtilization(),memory=process.memoryUsage();
  const delta=performance.eventLoopUtilization(elu,lastElu),snapshot=driver?.snapshot?.();
  output({kind:'metrics',value:{sampledAtWallMs:Date.now(),cpuPercent:100*((cpu.user-lastCpu.user)+(cpu.system-lastCpu.system))/1000/(stamp-lastTime),
    rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,eventLoopUtilization:delta.utilization,
    eventLoopDelayP95Ms:histogram.percentile(95)/1e6,acceptedInputs,ownerReports:snapshot?.stats?.ownerReports??0,
    pendingOutputMessages:outstanding,pendingOutputBytes:outstandingBytes}});
  lastTime=stamp;lastCpu=cpu;lastElu=elu;histogram.reset();
}
process.on('disconnect',stop);
process.on('message',async message=>{
  if(stopping||failing||!message||typeof message!=='object')return;
  if(message.kind==='stop'){stop();return;}
  if(message.kind==='initialize'){
    if(starting)return;starting=true;match=message.match;
    try{
      for(const row of message.bindings??[])bind(row.playerId,row);
      const factory=await createBattleDriverFactory({root:message.root,assetRoot:message.assetRoot});
      if(!factory)throw Error('room-worker-assets-unavailable');
      driver=await factory({match,emit,finish:result=>output({kind:'finish',result})});
      output({kind:'ready',snapshot:driver.snapshot()});
      metricsTimer=setInterval(metrics,1000);metricsTimer.unref?.();
    }catch(error){fatal('room-worker-initialize-failed',{errorName:error.name??'Error',errorMessage:String(error.message??'').slice(0,512)});}
    return;
  }
  if(message.kind==='bind'){if(match)bind(message.playerId,message.binding);return;}
  if(message.kind!=='request'||!driver)return;
  try{
    let value;
    if(message.method==='submitInput'){
      const [id,body]=message.args;
      if(body?.matchId!==match.id||!match.players.some(player=>player.id===id))throw Error('player-not-in-match');
      value=consumeLocalOwnerWorkerInput(driver,id,body);acceptedInputs++;
    }else if(['ready','disconnect','reconnect'].includes(message.method))value=driver[message.method](...message.args);
    else throw Error('invalid-room-worker-method');
    output({kind:'reply',id:message.id,value});
  }catch(error){output({kind:'reply',id:message.id,error:error.code??error.message,status:error.status??400});}
});
