/** Actual Web coordinators and codecs; controlled RTC/WS/SSE wire adapters.
 * Server glue is declared: production owner driver + exported delta/pacer /
 * receipt helpers, with a frozen fight lifecycle and no HTTP/session stack. */
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {gunzipSync,createGzip,createGunzip} from 'node:zlib';
import {Writable} from 'node:stream';
import {StringDecoder} from 'node:string_decoder';
import {distribution} from './network-fault-model-v38.mjs';

export function describeMeasurementError(error,depth=0){if(depth>4)return {truncated:true};return {name:error?.name??typeof error,message:String(error?.message??error),
 ...(error?.cause?{cause:describeMeasurementError(error.cause,depth+1)}:{}),
 ...(error?.errors?{errors:Array.from(error.errors).slice(0,8).map(value=>describeMeasurementError(value,depth+1))}:{})};}

// zlib.flush() calls write() with an empty internal marker. Only real SSE
// event batches establish fault-address metadata or reset their local parts.
export function bindSseBatchSource(gzip,{parse,lookup,fallbackDirection,onBatch}){
 const originalWrite=gzip.write.bind(gzip);
 gzip.write=(value,...rest)=>{const events=parse(String(value));if(events.length){
  const metas=events.map(e=>lookup(e.id)).filter(Boolean),last=metas.at(-1);
  onBatch({direction:last?.direction??fallbackDirection,frame:Math.max(0,...metas.map(m=>m.frame)),actions:metas.flatMap(m=>m.actions??[]),epoch:last?.epoch});
 }return originalWrite(value,...rest);};return gzip;
}

export async function loadProductionTransport(root){
 const modules={};for(const [key,file]of Object.entries({client:'apps/web/online-client.mjs',binary:'packages/online/network-binary.mjs',
  upload:'packages/online/owner-upload-delta.mjs',relay:'packages/online/owned-relay-delta.mjs',pacer:'apps/server/owned-relay-pacer.mjs',
  controller:'apps/server/owned-relay-controller.mjs',receipts:'packages/online/peer-receipts.mjs',driver:'apps/server/local-owner-driver.mjs',sse:'apps/server/sse-stream.mjs'}))
  modules[key]=await import(pathToFileURL(resolve(root,file)).href);return modules;
}
export async function createProductionPair({version,wire,sims,syncs,ids=['a','b'],peerMode='hybrid',onObserved=()=>{}}){
 const m=version.transport,endpoints={},events=[],errors=[],generated=new Map(),admitted=new Map(),firstSend=new Map(),firstLaneSend=new Map(),serverAdmitted=new Map(),queues=[];
 const match={id:'network-application-v40',mode:'1v1',seed:wire.seed,ownership:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1,
  players:ids.map((id,team)=>({id,team,connected:true}))};
 const connections=new Map(),controlFrames=new Map();let eventSequence=0,closed=false,retiredDeliveryDiscards=0,driver;
 const decoded=data=>{if(typeof data==='string')return JSON.parse(data);let bytes=new Uint8Array(data);
  if(!m.binary.isNetworkBinary(bytes))bytes=new Uint8Array(gunzipSync(bytes));return m.binary.isNetworkBinary(bytes)?m.binary.decodeNetworkBinary(bytes):JSON.parse(new TextDecoder().decode(bytes));};
 function metadata(value,from,lane){
  if(value.type==='fragment')throw Error('measurement-v40-fragment-metadata-unsupported');
  const report=value.report??value.owner??value.ownerUpload?.pose??value.ownerDelta??value.motion??value.status??value.buffStatus;
  const actions=value.report?.actions??value.report?.actionEvent?.actions??value.owner?.actions??value.ownerUpload?.actions??[];
  let frame=report?.frameSeq??value.frameSeq??value.packet?.frameSeq??value.sequence??0;
  if(value.type==='actions')controlFrames.set(`${from}:${value.sequence}`,frame);
  if(value.type==='ack'&&lane==='rtcControl')frame=controlFrames.get(`${ids.find(id=>id!==from)}:${value.sequence}`)??0;
 const kind=value.type??(value.motionOnly?'motion':value.statusOnly?'status':value.ownerUpload?'upload':value.ownerDelta||value.owner?'pose':'capability');
  return {direction:ids.indexOf(from),lane,frame,kind,identity:kind+(value.part===undefined?'':':part'+value.part),
   epoch:report?.epoch??value.epoch,actions:actions.map(a=>a.id),sequence:value.sequence};
 }
 const noteSent=(meta)=>{for(const id of meta.actions??[]){const key=ids[meta.direction]+':'+meta.epoch+':'+id;if(!firstSend.has(key))firstSend.set(key,wire.now);
  const lanes=firstLaneSend.get(key)??{};lanes[meta.lane]??=wire.now;firstLaneSend.set(key,lanes);}};
 function receive(index,type,data){
  const sim=sims[index],sync=syncs[index],id=ids[index],own=sim.actor(id),before=own?JSON.stringify([own.x,own.y,own.z,own.hp,own.mp,own.stateSerial,own.animationTime]):null;
  let result=true;
  if(type==='owner-actions'){
   result=sync.receiveActions(data.playerId,data.actions,data.epoch,data.frameSeq);
   if(result===true)for(const action of data.actions){const key=data.playerId+':'+data.epoch+':'+action.id;
    if(!admitted.has(key))admitted.set(key,{at:wire.now,sourceFrame:action.frameSeq??data.frameSeq,transport:data.transport??'relay'});}
  }else if(type==='peer-owned-state')result=sync.receivePeerResult(sim,data.playerId,data.report,id);
  else if(type==='owner-motion')result=sync.receiveMotion(sim,data.playerId,data.motion,id);
  else if(type==='owner-status')result=sync.receiveStatus(sim,data.playerId,data.status,id);
  else if(type==='owner-protection')result=sync.receiveProtection(sim,data.playerId,data.status,id,data.buffRevision);
  else if(type==='owner-buffs')result=sync.receiveBuffs(sim,data.playerId,data.snapshot,id);
  else if(type==='state')result=sync.reconcile(sim,data,id);
  if(type!=='state'&&before!==null&&before!==JSON.stringify([own.x,own.y,own.z,own.hp,own.mp,own.stateSerial,own.animationTime]))throw Error('production-arrival-mutated-local-owner');
  events.push({at:wire.now,to:id,type,playerId:data?.playerId,frame:data?.report?.frameSeq??data?.motion?.frameSeq??data?.frameSeq,transport:data?.transport,
   accepted:result===true||result?.accepted===true,result:result===undefined?null:result,
   actions:type==='owner-actions'?data.actions.map(a=>a.id):undefined});onObserved(index,type,data,result);return result;
 }
 const downstream=Object.fromEntries(ids.map(id=>[id,{deltas:m.relay.createOwnedRelayDelta(),receipts:new Map(),controllers:new Map(),lives:new Map(),sources:new Map(),skippedPoses:0,skippedActions:0}]));
 function closePair(){if(closed)return;closed=true;const failures=[];const attempt=fn=>{try{fn();}catch(error){failures.push(error);}};
  for(const e of Object.values(endpoints))attempt(()=>e.client?.close());
  for(const row of Object.values(downstream)){attempt(()=>row.pacer?.clearAll());attempt(()=>row.sse?.destroy('measurement-completed'));attempt(()=>row.reader?.destroy());}
  attempt(()=>driver?.stop());if(failures.length)throw new AggregateError(failures,'production-pair-cleanup-failed');
 }
 try{
 for(const to of ids){const row=downstream[to],reader=createGunzip(),utf8=new StringDecoder('utf8');let text='',activeBatch=null,chunkIndex=0,pendingInflates=0,pendingFlushes=0;row.sseDuplicates=0;row.logicalEvents=new Map();
  row.reader=reader;
  const beginNative=(stream,kind)=>{const token=++wire.codecSerial;let finished=false;wire.activeStreams++;if(kind==='inflate')pendingInflates++;else pendingFlushes++;
   wire.codecDebug.set(token,{name:'sse-'+kind,to,at:wire.now});
   const finish=()=>{if(finished)return;finished=true;wire.activeStreams--;if(kind==='inflate')pendingInflates--;else pendingFlushes--;wire.activity++;
    wire.codecDebug.delete(token);stream.off('error',finish);stream.off('close',finish);};stream.once('error',finish);stream.once('close',finish);return finish;};
  const parse=value=>value.split('\n\n').filter(Boolean).map(block=>{const lines=block.split('\n'),id=Number(lines.find(l=>l.startsWith('id: '))?.slice(4)),
   type=lines.find(l=>l.startsWith('event: '))?.slice(7),body=lines.find(l=>l.startsWith('data: '))?.slice(6);return body?{id,type,data:JSON.parse(body)}:null;}).filter(Boolean);
  reader.on('data',chunk=>{text+=utf8.write(chunk);let end;
   while((end=text.indexOf('\n\n'))>=0){const block=text.slice(0,end+2);text=text.slice(end+2);
    for(const event of parse(block)){endpoints[to]?.source?.emit(event.type,event.data,event.id);
     const meta=row.logicalEvents.get(event.id);if(meta&&wire.sample(meta,0,wire.now).duplicate){row.sseDuplicates++;
      wire.schedule(()=>endpoints[to]?.source?.emit(event.type,event.data,event.id),1);}}}});
  reader.on('error',error=>{if(!closed)errors.push({at:wire.now,to,where:'sse-decode',message:error.message});});
  const chunkMetadata=[];
  const response=new Writable({write(chunk,_encoding,callback){
   const meta=chunkMetadata.shift();if(!meta)throw Error('missing-sse-chunk-source-metadata');
   const packet=wire.send(new Uint8Array(chunk),meta,value=>{const finish=beginNative(reader,'inflate');try{reader.write(value,finish);}catch(error){finish();throw error;}});
   wire.scheduleAt(callback,packet.serializedAt);
  }});
  // Bind while pipe enqueues the chunk. _write may run after a later gzip
  // batch has changed activeBatch while the previous chunk serialized.
  const originalResponseWrite=response.write.bind(response);response.write=(chunk,...rest)=>{
   chunkMetadata.push({...activeBatch,lane:'relayDown',connection:`sse:${to}`,reliable:true,suppressDuplicate:true,kind:'gzip-sse',identity:'gzip-sse:chunk'+chunkIndex++});
   return originalResponseWrite(chunk,...rest);
  };response.writeHead=()=>{};response.flushHeaders=()=>{};
  row.reader=reader;row.response=response;
  row.sse=m.sse.createSseStream({headers:{'accept-encoding':'gzip'}},response,{clock:()=>wire.now,createCompressor:options=>{
   const gzip=createGzip(options),originalFlush=gzip.flush.bind(gzip);
   bindSseBatchSource(gzip,{parse,lookup:id=>row.logicalEvents.get(id),fallbackDirection:1-ids.indexOf(to),onBatch:batch=>{activeBatch=batch;chunkIndex=0;}});
   gzip.flush=(kind,callback)=>{const finish=beginNative(gzip,'flush');try{return originalFlush(kind,error=>{finish();callback(error);});}catch(error){finish();throw error;}};return gzip;
  }});
  wire.debugProviders.set('sse:'+to,()=>({pendingInflates,pendingFlushes,responseWritableLength:response.writableLength,responseNeedDrain:response.writableNeedDrain,
   readerWritableLength:reader.writableLength,readerReadableLength:reader.readableLength,readerDestroyed:reader.destroyed,readerErrored:reader.errored?.message,
   errors:errors.filter(e=>e.to===to),packets:wire.packets.filter(p=>p.connection===`sse:${to}`).slice(-8),queuedChunkMetadata:chunkMetadata.length,...row.sse.performance()}));
 }
 const sendEvent=(to,type,data,{replaceable=false,urgent=false}={})=>{
  const row=downstream[to],from=data.playerId??ids.find(id=>id!==to),frame=data.report?.frameSeq??data.status?.frameSeq??data.frameSeq??0,id=++eventSequence;
  row.logicalEvents.set(id,{direction:ids.indexOf(from),lane:'relayDown',frame,kind:type,identity:'sse-event:'+type,actions:data.actions?.map(a=>a.id)??[],epoch:data.epoch});
  return row.sse.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
   {replaceKey:replaceable?`${type}:${data.playerId}`:null,urgent:urgent||type==='input'&&!!data.actions?.length||type==='owner-status'});
 };
 for(const id of ids){const row=downstream[id];row.pacer=m.pacer.createOwnedRelayPacer({clock:()=>wire.now,timers:wire.timers,
  canSend:(value,context)=>context?.lifeChanged||!healthy(row,value.playerId,value.epoch,value.frameSeq),
  send:(value,context)=>sendEvent(id,'owned-state',value,{replaceable:!context?.lifeChanged,urgent:context?.lifeChanged||context?.controllerChanged})});}
 function healthy(row,source,epoch,frame){const receipt=row.receipts.get(source);return !!receipt&&wire.now-receipt.at<750&&receipt.epoch===epoch&&receipt.frameSeq>=frame-18;}
 function serverEmit(type,data){
  if(type==='state')return; // Frozen fight only; lifecycle/reconnect has separate production tests.
  for(const to of ids){if(to===data.playerId)continue;const row=downstream[to];
   if(type==='input'){
    const pruned=m.receipts.pruneAcknowledgedPeerActions(data,row.receipts.get(data.playerId),{now:wire.now});row.skippedActions+=pruned.skipped;
    if(!pruned.value.actions.length)continue;sendEvent(to,type,{...row.deltas.encodeActions(data.playerId,pruned.value),relayToken:'v40-fixed-'+to});
   }else if(type==='owned-state'){
    const report=data.report,source=data.playerId;row.sources.set(source,{epoch:report.epoch,frameSeq:report.frameSeq});
    const split=row.deltas.encodeSplit(source,report,{deltaVersion:3});
    const controllerChanged=m.controller.observeOwnedRelayController(row.controllers,source,m.controller.ownedRelayControllerSignature(report));
    const life=`${report.epoch}:${report.actor.hp<=0}:${!!report.actor.hidden}:${!!report.actor.deathComplete}`,lifeChanged=row.lives.has(source)&&row.lives.get(source)!==life;row.lives.set(source,life);
    if(split.baseline){row.pacer.clear(source,{resetClock:!!split.baseline.actorBaseline||lifeChanged});sendEvent(to,type,{matchId:match.id,relayToken:'v40-fixed-'+to,...split.baseline},{urgent:lifeChanged||controllerChanged});}
    if(!lifeChanged&&healthy(row,source,report.epoch,report.frameSeq)){row.pacer.clear(source,{resetClock:false});row.skippedPoses++;continue;}
    row.pacer.offer(source,{matchId:match.id,relayToken:'v40-fixed-'+to,...split.value},{lifeChanged,controllerChanged},{immediate:lifeChanged||controllerChanged});
   }else sendEvent(to,type,data,{replaceable:type==='owner-status'});
  }
 }
 const serverSim=version.simulation.createSimulation({profile:sims[0].profile,map:sims[0].map,actors:structuredClone(sims[0].state.actors)});
 serverSim.state.actors=structuredClone(sims[0].state.actors);
 const players=ids.map((id,team)=>({id,team,alive:true,connected:true,lockUntil:0,invincibleUntil:0}));
 const serverHits=[];const pvp={start(){},snapshot:()=>({phase:'fight',fightTime:Math.max(0,wire.now/1000),players}),
  advance(){},drainEvents:()=>[],player:id=>players.find(p=>p.id===id),recordHit:hit=>{serverHits.push({...hit,at:wire.now});return true;}};
 driver=m.driver.createLocalOwnerBattleDriver({match,simulation:serverSim,pvp,clock:()=>wire.now,manual:true,emit:serverEmit,finish(){}});
 ids.forEach(id=>driver.ready(id));
 function acceptUpload(from,batch,upload=endpoints[from].upload){
  let candidate=null;
  if(batch.ownerUpload){candidate=upload.decode(batch.ownerUpload);batch={...batch,owner:candidate.report};delete batch.ownerUpload;}
  const result=driver.submitInput(from,batch);
  for(const id of result.consumedActionIds??[]){const key=from+':'+batch.owner?.epoch+':'+id;if(!serverAdmitted.has(key))serverAdmitted.set(key,wire.now);}
  const ownerReceipt=candidate&&result.accepted===true&&result.ignored===undefined&&result.frameSeq===batch.owner.frameSeq?candidate.ownerReceipt:null;
  if(ownerReceipt)candidate.commit();
  const row=downstream[from];row.receipts.clear();
  for(const receipt of m.receipts.normalizePeerReceipts(batch.peerReceipts??[])){
   const source=row.sources.get(receipt.playerId);if(!source||source.epoch!==receipt.epoch||receipt.frameSeq>source.frameSeq+120)continue;
   row.receipts.set(receipt.playerId,{...receipt,at:wire.now});if(healthy(row,receipt.playerId,source.epoch,source.frameSeq))row.pacer.clear(receipt.playerId,{resetClock:false});
  }
  return {accepted:result.accepted!==false,matchId:match.id,sequence:batch.sequence,...result,...(ownerReceipt?{ownerReceipt}:{})};
 }
 for(const [index,id]of ids.entries()){
  const endpoint=endpoints[id]={channels:new Map(),channelGenerations:new Map(),socketGeneration:0,upload:m.upload.createOwnerUploadDelta()};
  class Source{constructor(){endpoint.source=this;this.listeners=new Map();}addEventListener(type,fn){this.listeners.set(type,fn);}close(){}
   emit(type,data,eventId){this.listeners.get(type)?.({data:JSON.stringify(data),...(eventId===undefined?{}:{lastEventId:String(eventId)})});}}
  class Channel{
   constructor(label){this.label=label;this.readyState='open';this.bufferedAmount=0;this.generation=(endpoint.channelGenerations.get(label)??0)+1;endpoint.channelGenerations.set(label,this.generation);}
   send(payload){const value=decoded(payload),lane=this.label==='control'?'rtcControl':value.motionOnly?'rtcMotion':value.statusOnly?'rtcStatus':'rtcPose',
    meta={...metadata(value,id,lane),reliable:this.label==='control',connection:`rtc:${id}:${this.label}:${this.generation}`};noteSent(meta);
    const receiver=endpoints[ids[1-index]]?.channels.get(this.label);
    wire.send(payload,meta,packet=>{if(this.readyState!=='open'||receiver?.readyState!=='open'||endpoints[ids[1-index]]?.channels.get(this.label)!==receiver){retiredDeliveryDiscards++;return;}
     receiver.onmessage?.({data:packet});},this);}
   close(){this.readyState='closed';}
  }
  class Peer{constructor(){endpoint.peer=this;this.connectionState='connected';this.sctp={maxMessageSize:128*1024};this.channels=new Set();}
   createDataChannel(label){const channel=new Channel(label);this.channels.add(channel);endpoint.channels.set(label,channel);return channel;}
   async createOffer(){return {type:'offer',sdp:'controlled-application-wire'};}async setLocalDescription(description){this.localDescription={toJSON:()=>description};}
   close(){this.connectionState='closed';for(const channel of this.channels)channel.close();}}
  endpoint.Channel=Channel;
  class Socket{
   constructor(){this.bufferedAmount=0;this.closed=false;this.generation=++endpoint.socketGeneration;this.upload=m.upload.createOwnerUploadDelta();endpoint.socket=this;wire.schedule(()=>{if(!this.closed)this.onmessage?.({data:JSON.stringify({type:'transport',data:{connected:true,ownerUploadDelta:1,networkBinaryVersion:m.binary.NETWORK_BINARY_VERSION}})});},0);}
   send(payload){const batch=decoded(payload),meta={...metadata(batch,id,'wsUp'),reliable:true,connection:`ws-up:${id}:${this.generation}`};noteSent(meta);
    wire.send(payload,meta,packet=>{if(this.closed||endpoint.socket!==this){retiredDeliveryDiscards++;return;}try{const value=decoded(packet),result=acceptUpload(id,value,this.upload),ack=JSON.stringify({type:'ack',data:result});
     wire.send(ack,{direction:1-index,lane:'wsAck',connection:`ws-down:${id}:${this.generation}`,reliable:true,frame:meta.frame,kind:'ack',identity:'upload-ack'},body=>{if(this.closed||endpoint.socket!==this){retiredDeliveryDiscards++;return;}this.onmessage?.({data:body});});
    }catch(error){errors.push({at:wire.now,from:id,where:'server-upload',message:error.message});}},this);}
   close(){this.closed=true;this.upload=m.upload.createOwnerUploadDelta();}
  }
  endpoint.client=m.client.createOnlineClient({EventSource:Source,RTCPeerConnection:peerMode==='hybrid'?Peer:null,WebSocket:Socket,
   peerMode,timers:wire.timers,clock:()=>wire.now,onEvent:(type,data)=>receive(index,type,data),onError:error=>errors.push({at:wire.now,from:id,where:'client',message:error.message,fatal:!!error.fatal}),
   fetch:async(url,options)=>{
    if(url!=='/api/online/input')return {ok:true,status:200,json:async()=>({accepted:true})};
    const batch=JSON.parse(options.body);return new Promise(resolveResponse=>{
     const meta={...metadata(batch,id,'httpUp'),reliable:true,connection:`http-up:${id}`};noteSent(meta);
     wire.send(options.body,meta,text=>{let result;try{result=acceptUpload(id,JSON.parse(text));}catch(error){errors.push({at:wire.now,from:id,where:'http-server',message:error.message});result={accepted:false};}
      wire.send(JSON.stringify(result),{direction:1-index,lane:'httpAck',connection:`http-down:${id}`,reliable:true,frame:meta.frame,kind:'http-ack',identity:'http-ack'},
       value=>resolveResponse({ok:true,status:200,json:async()=>JSON.parse(value)}));});
    });
   }});
  await endpoint.client.open();await endpoint.client.setMatch(match,id);await wire.settle();
 }
 if(peerMode==='hybrid')for(const label of ['input','control']){
  const right=endpoints[ids[1]],channel=new right.Channel(label);right.channels.set(label,channel);right.peer.channels.add(channel);right.peer.ondatachannel({channel});
 }
 const room={matchId:match.id,snapshot:sims[0].snapshot(),ownership:{mode:'local-owner-v1',continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1,
  actors:Object.fromEntries(sims[0].state.actors.map(actor=>[actor.id,{epoch:1,frameSeq:0}]))},owners:{}};
 for(const endpoint of Object.values(endpoints))endpoint.source.emit('state',room);
 for(const endpoint of Object.values(endpoints))endpoint.channels.get('control')?.onopen?.();
 await wire.advance(0);
 function sample(){queues.push({at:wire.now,clients:ids.map(id=>{const p=endpoints[id].client.performance();return {id,pendingFrames:p.pendingFrames,pendingActions:p.pendingActions,pendingHits:p.pendingHits,
  socketAcknowledgements:p.socketAcknowledgements,ownerFatal:p.ownerFatal,
  peerControls:Object.fromEntries(Object.entries(p.peerControls??{}).map(([other,row])=>[other,{pendingPackets:row.pendingPackets,inflightPackets:row.inflightPackets,pendingUnsentPackets:row.pendingUnsentPackets,
   pendingReceive:row.pendingReceive,pendingPoses:row.pendingPoses,frontierComplete:row.frontierComplete,stagedCanonicalIds:row.stagedCanonicalIds,fallbacks:row.fallbacks,rejected:row.rejected,
   sendSequence:row.sendSequence,receivedSequence:row.receivedSequence}])),
  relay:{pending:p.relay.pending,bufferedBytes:p.relay.bufferedBytes,coalescedSends:p.relay.coalescedSends},directCheckpointsDeferred:p.directCheckpointsDeferred};})});}
 return {match,endpoints,errors,events,generated,admitted,serverHits,
  async send(index,input,report){const id=ids[index];for(const action of report.actions){const key=id+':'+report.epoch+':'+action.id;
   if(!generated.has(key)){const frame=action.frameSeq??report.frameSeq-(action.ageFrames??0);
    generated.set(key,{at:wire.now,firstExportAt:wire.now,sourceGeneratedAt:frame*1000/60,frame});}}
   endpoints[id].client.send(input,report);await wire.settle();sample();},
  async advance(now){await wire.advance(now);sample();},
  report(){const arrivals=events.filter(e=>e.at>=0&&['peer-owned-state','owner-motion'].includes(e.type)),gaps=[],acceptedGaps=[];
   for(const id of ids)for(const type of ['peer-owned-state','owner-motion'])for(const acceptedOnly of [false,true]){
    const rows=arrivals.filter(e=>e.to===id&&e.type===type&&(!acceptedOnly||e.accepted)),target=acceptedOnly?acceptedGaps:gaps;
    for(let i=1;i<rows.length;i++)target.push({to:id,type,ms:rows[i].at-rows[i-1].at,sourceFrameGap:rows[i].frame-rows[i-1].frame});}
   const actions=[...generated].map(([id,row])=>({id,...row,firstSendAt:firstSend.get(id)??null,admittedAt:admitted.get(id)?.at??null,
    firstSendByLane:firstLaneSend.get(id)??{},serverAdmittedAt:serverAdmitted.get(id)??null,
    queueWaitMs:firstSend.has(id)?firstSend.get(id)-row.firstExportAt:null,admissionAgeMs:admitted.has(id)?admitted.get(id).at-row.firstExportAt:null,
    exportDelayMs:row.firstExportAt-row.sourceGeneratedAt,sourceToSendMs:firstSend.has(id)?firstSend.get(id)-row.sourceGeneratedAt:null,
    sourceToAdmissionMs:admitted.has(id)?admitted.get(id).at-row.sourceGeneratedAt:null,
    sourceToServerAdmissionMs:serverAdmitted.has(id)?serverAdmitted.get(id)-row.sourceGeneratedAt:null}));
   return {peerMode,wire:wire.report(),actions,actionQueueWaitMs:distribution(actions.map(r=>r.queueWaitMs).filter(Number.isFinite)),
    actionAdmissionAgeMs:distribution(actions.map(r=>r.admissionAgeMs).filter(Number.isFinite)),
    actionExportDelayMs:distribution(actions.map(r=>r.exportDelayMs).filter(Number.isFinite)),actionSourceToSendMs:distribution(actions.map(r=>r.sourceToSendMs).filter(Number.isFinite)),
    actionSourceToAdmissionMs:distribution(actions.map(r=>r.sourceToAdmissionMs).filter(Number.isFinite)),unadmittedActions:actions.filter(r=>r.admittedAt===null).length,
    actionSourceToSendByLane:Object.fromEntries(['rtcControl','wsUp','httpUp'].map(lane=>[lane,distribution(actions.map(r=>r.firstSendByLane[lane]-r.sourceGeneratedAt).filter(Number.isFinite))])),
    actionSourceToServerAdmissionMs:distribution(actions.map(r=>r.sourceToServerAdmissionMs).filter(Number.isFinite)),
    receiveCallbackGapMs:distribution(gaps.map(row=>row.ms)),receiveCallbackSourceFrameGap:distribution(gaps.map(row=>row.sourceFrameGap).filter(Number.isFinite)),
    acceptedCallbackGapMs:distribution(acceptedGaps.map(row=>row.ms)),acceptedCallbackSourceFrameGap:distribution(acceptedGaps.map(row=>row.sourceFrameGap).filter(Number.isFinite)),
    receiveCallbackGaps:gaps,retiredDeliveryDiscards,errors,clients:ids.map(id=>({id,...endpoints[id].client.performance()})),
    server:{mode:'production-local-owner-driver-with-frozen-fight-glue-and-production-gzip-sse',hits:serverHits,downstream:ids.map(id=>{
     const {sampledAtWallMs,...sse}=downstream[id].sse.performance();return {id,skippedPoses:downstream[id].skippedPoses,skippedActions:downstream[id].skippedActions,
      pacer:downstream[id].pacer.performance(),sse,sseApplicationDuplicateDeliveries:downstream[id].sseDuplicates};})},
    queueMaximums:{pendingFrames:Math.max(0,...queues.flatMap(r=>r.clients.map(p=>p.pendingFrames))),pendingActions:Math.max(0,...queues.flatMap(r=>r.clients.map(p=>p.pendingActions))),
     socketAcknowledgements:Math.max(0,...queues.flatMap(r=>r.clients.map(p=>p.socketAcknowledgements)))},events,queues};},
  close:closePair,
 };
 }catch(error){try{closePair();}catch(cleanup){console.error('constructor-cleanup-failure',JSON.stringify(describeMeasurementError(cleanup)));}throw error;}
}
