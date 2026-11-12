/** Local diagnostic transparent TCP bottleneck. Keeps HTTP chunk/gzip/WS
 * bytes unchanged. Global shared egress and per-player caps include all
 * connections; upstream reads pause at bounded application queues. Kernel TCP
 * buffers remain real and are part of this experiment, unlike a trace FIFO. */
import net from 'node:net';
import {performance} from 'node:perf_hooks';
export async function createCapacityTcpProxy({upstreamPort,players,egressBytesPerSecond=625000,oneWayMs=80,slowPlayer=-1,
 slowBytesPerSecond=32768,pausePlayer=-1,pauseAtWallMs=Infinity,pauseDurationMs=0,queueHighWater=32768}={}){
 const flows=new Map(),closedFlows=[],servers=[],events=[],bins=new Map();let closed=false,nextId=0,lastDownId=0;
 const bucket=rate=>({rate,tokens:Number.isFinite(rate)?rate*.01:Infinity,at:performance.now()});
 const shared=bucket(egressBytesPerSecond),individual=Array.from({length:players},(_,i)=>bucket(i===slowPlayer?slowBytesPerSecond:Infinity));
 const debit=(b,bytes)=>{if(Number.isFinite(b.rate))b.tokens-=bytes;};
 function refresh(b,now){if(Number.isFinite(b.rate)){b.tokens=Math.min(b.rate*.02,b.tokens+(now-b.at)*b.rate/1000);b.at=now;}}
 function record(flow,bytes){const key=Math.floor(Date.now()/100),row=bins.get(key)??{atWallMs:key*100,down:0,up:0,players:{}};
  row[flow.direction==='down'?'down':'up']+=bytes;row.players[flow.player]??={down:0,up:0};row.players[flow.player][flow.direction==='down'?'down':'up']+=bytes;bins.set(key,row);}
 const flowRecord=({id,player,direction,bytes,maxQueueBytes,closed})=>({id,player,direction,bytes,maxQueueBytes,closed});
 function archive(flow){if(flow.closed)return;flow.closed=true;flow.queue.length=0;flow.queuedBytes=0;flows.delete(flow.id);closedFlows.push(flowRecord(flow));}
 function attach(source,destination,player,direction){const flow={id:++nextId,player,direction,source,destination,queue:[],queuedBytes:0,sourceEnded:false,sourceClosed:false,closed:false,bytes:0,maxQueueBytes:0};flows.set(flow.id,flow);
  source.on('data',data=>{if(flow.closed)return;flow.queue.push({data,offset:0,readyAt:performance.now()+oneWayMs});flow.queuedBytes+=data.length;
   flow.maxQueueBytes=Math.max(flow.maxQueueBytes,flow.queuedBytes);if(flow.queuedBytes>=queueHighWater)source.pause();});
  source.on('end',()=>{flow.sourceEnded=true;});destination.on('drain',()=>{});
  source.on('error',()=>{});destination.on('error',()=>{});
  source.on('close',hadError=>{flow.sourceClosed=true;if(flow.closed)return;
   // A normal FIN may close the upstream duplex while its delayed downstream
   // tail is still queued. Keep that tail until sent; an abort cannot preserve it.
   if(flow.sourceEnded&&!hadError){if(!flow.queue.length&&!destination.destroyed)destination.end();return;}
   archive(flow);if(!destination.destroyed)destination.destroy();
  });
  destination.on('close',()=>archive(flow));
  return flow;
 }
 function sendPiece(flow,now){if(flow.closed||flow.destination.destroyed||flow.destination.writableNeedDrain||!flow.queue.length)return 0;
  if(flow.direction==='down'&&flow.player===pausePlayer&&Date.now()>=pauseAtWallMs&&Date.now()<pauseAtWallMs+pauseDurationMs)return 0;
  const row=flow.queue[0];if(row.readyAt>now)return 0;
  const available=flow.direction==='down'?Math.floor(Math.min(shared.tokens,individual[flow.player].tokens)):Infinity;
  const bytes=Math.min(1500,row.data.length-row.offset,available);if(bytes<1)return 0;
  if(flow.direction==='down'){debit(shared,bytes);debit(individual[flow.player],bytes);}
  flow.destination.write(row.data.subarray(row.offset,row.offset+bytes));row.offset+=bytes;flow.queuedBytes-=bytes;flow.bytes+=bytes;record(flow,bytes);
  if(row.offset===row.data.length)flow.queue.shift();return bytes;
 }
 const timer=setInterval(()=>{if(closed)return;const now=performance.now();refresh(shared,now);for(const b of individual)refresh(b,now);
  const live=[...flows.values()],down=live.filter(flow=>flow.direction==='down');
  // A cursor over historical closed HTTP connections gives the first live SSE
  // connection most low-rate refill ticks. Rotate after actual bytes sent, and
  // give each live downstream only one piece per round instead of a whole burst.
  let start=down.findIndex(flow=>flow.id>lastDownId);if(start<0)start=0;
  for(let n=0;n<down.length*16;n++){if(shared.tokens<1)break;const flow=down[(start+n)%down.length];if(sendPiece(flow,now))lastDownId=flow.id;}
  for(const flow of live){if(flow.direction==='up')for(let pieces=0;pieces<16;pieces++)if(!sendPiece(flow,now))break;
   if(flow.queuedBytes<queueHighWater/2&&!flow.sourceEnded&&!flow.sourceClosed)flow.source.resume();if(flow.sourceEnded&&!flow.queue.length&&!flow.destination.destroyed)flow.destination.end();
  }
 },2);
 for(let player=0;player<players;player++){const server=net.createServer({allowHalfOpen:true},client=>{const upstream=net.connect({host:'127.0.0.1',port:upstreamPort,allowHalfOpen:true});
   client.setNoDelay(true);upstream.setNoDelay(true);events.push({type:'connection',player,atWallMs:Date.now()});
   attach(upstream,client,player,'down');attach(client,upstream,player,'up');client.once('close',()=>events.push({type:'close',player,atWallMs:Date.now()}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);}
 return {ports:servers.map(server=>server.address().port),
  setPause({player,atWallMs,durationMs}){pausePlayer=player;pauseAtWallMs=atWallMs;pauseDurationMs=durationMs;events.push({type:'pause-scheduled',player,atWallMs,durationMs});},
  snapshot(){return {method:{egressBytesPerSecond:Number.isFinite(egressBytesPerSecond)?egressBytesPerSecond:null,oneWayMs,slowPlayer,slowBytesPerSecond,queueHighWater,
    fairScheduling:'v2 live-flow round-robin after actual bytes sent, one 1500-byte piece per round; closed sockets removed; 20ms token cap; true socket backpressure; includes raw HTTP and WS framing, excludes TCP/IP headers and retransmissions'},
    bins:[...bins.values()],events,activeFlows:flows.size,closedFlowRecords:closedFlows.length,flows:[...closedFlows,...[...flows.values()].map(flowRecord)].sort((a,b)=>a.id-b.id)};},
  async close(){closed=true;clearInterval(timer);for(const flow of flows.values()){flow.source.destroy();flow.destination.destroy();}await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));},
 };
}
