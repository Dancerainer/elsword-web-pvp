/** Authenticated room coordinator and optional direct player-state channels. */
import {OWNERSHIP_PROTOCOL,validateOwnedState,validateCombatPlayback,clearAbsentOwnedLifecycleFields} from '../../packages/online/owned-state.mjs';
import {createOnlineSocket,compressOnlineText,compressOnlineBytes,packOnlineBinary,decodeOnlineGzip,encodeOnlineEnvelope} from './online-socket.mjs';
import {encodeNetworkBinary,decodeNetworkBinary,isNetworkBinary,networkJsonByteLength,NETWORK_BINARY_VERSION,NETWORK_BINARY_COMPRESSION_THRESHOLD} from '../../packages/online/network-binary.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {ONLINE_POLL_MAXIMUM_BATCH_EVENTS} from '../../packages/online/poll-contract.mjs';
import {createPeerControl} from './online-peer-control.mjs';
import {createOwnerPoseDelta,OWNER_POSE_DELTA_VERSION,OWNER_POSE_MASK_VERSION} from '../../packages/online/owner-pose-delta.mjs';
import {createOwnerUploadDelta} from '../../packages/online/owner-upload-delta.mjs';
import {buildOwnerUploadPrefix,MAXIMUM_OWNER_UPLOAD_BYTES} from '../../packages/online/owner-upload-prefix.mjs';
import {encodeOwnedStatus,validateOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createOwnerBuffSender,createOwnerBuffReceiver,decodeOwnerBuffProtection,OWNER_BUFF_SYNC_VERSION} from '../../packages/online/owner-buff-sync.mjs';
import {encodeOwnedMotion,validateOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {RTC_SIGNAL_VERSION,readRtcSignalIdentity,compareRtcSignalIdentity,rtcSdpUfrag,rtcCandidateUfrag} from '../../packages/online/rtc-signal.mjs';
import {createBinaryCompressionCache} from '../../packages/online/binary-compression-cache.mjs';
// Shared by client replacements in one page. A reload gets a new authenticated
// coordinator sourceEpoch; this local number is never treated as a page epoch.
let nextSignalGeneration=0;
export function createOnlineClient({fetch:request=(...args)=>globalThis.fetch(...args),EventSource:Source=globalThis.EventSource,
  RTCPeerConnection:Peer=globalThis.RTCPeerConnection,onEvent=()=>{},onError=()=>{},iceServers=[],eventTransport='sse',
  WebSocket:Socket=typeof window==='undefined'?null:globalThis.WebSocket,socketOptions={},rtcOptions={},
  timers=globalThis,pageInitToken=null,peerMode='hybrid',maximumOwnerCredits=8,clock=()=>globalThis.performance?.now?.()??Date.now()}={}){
  if(!['sse','poll'].includes(eventTransport))throw new TypeError('Unsupported online event transport');
  if(!['hybrid','relay'].includes(peerMode))throw new TypeError('Unsupported peer mode');
  if(!Number.isSafeInteger(maximumOwnerCredits)||maximumOwnerCredits<1||maximumOwnerCredits>8)throw new TypeError('Invalid owner upload credit');
  if(pageInitToken!==null&&(typeof pageInitToken!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(pageInitToken)))throw new TypeError('Invalid online page identity');
  let stream=null,match=null,sequence=0,frameSequence=0,timer=null,upload=null,stopped=false;
  let matchGeneration=0,streamGeneration=0,matchBinding=null;
  let matchPhase=null,matchStateSequence=-1;
  const phaseOrder={created:0,intro:1,fight:2,slow:3,result:4};
  const combatOpen=()=>!!match&&!['settling','finished','aborted'].includes(match.status)&&(matchPhase===null||matchPhase==='fight'||matchPhase==='slow');
  let lastServerEventId=-1;
  let relay=null;const relayDeltas=createOwnedRelayDelta(),acknowledgements=new Map(),socketAckTimes=[],sourceClocks=new Map(),roomActors=new Map();let newestInput=null,roomActorsMatch=null,relayToken=null;
  let latestOwner=null,ownerFrameBase=0;const ownerHits=new Map(),ownerActions=new Map(),ownerActionSizes=new Map();
  const encoder=new TextEncoder(),maximumPendingActions=128,maximumPendingActionBytes=2*1024*1024;
  let pendingActionBytes=0,ownerFatal=null;
  let lastOwnerUploadAt=-Infinity,lastOwnerCheckpointKey=null;let directCheckpointsDeferred=0;
  const peerCodec='rtc-owner-gzip-v1',peerMaximumBytes=128*1024,peerReceiptAgeMs=350;
  const controlHighWater=128*1024,controlLowWater=64*1024;
  // Web scheduling budgets: a small canonical action can use its bounded raw
  // encoding when native compression stalls. Large snapshots keep compression.
  const criticalRawMaximum=8192,criticalCompressionBudgetMs=16,criticalRawBurstBytes=32768,criticalRawBytesPerSecond=16384;
  const networkBinaryEnabled=rtcOptions.networkBinary!==false;
  const peerBinaryCompress=rtcOptions.compressBytes??compressOnlineBytes;
  const decodedPose=Symbol('validated-pose-delta-candidate');
  const statusMetrics={sent:0,received:0,rejected:0};
  const buffSender=createOwnerBuffSender();let buffMarker=null;
  const buffMetrics={snapshotsSent:0,snapshotsReceived:0,compactSent:0,compactReceived:0,repairs:0,requestsSent:0,requestsCoalesced:0,staleCompacts:0,rejected:0};
  const motionMetrics={sent:0,received:0,rejected:0};
  const uploadDeltas=createOwnerUploadDelta();
  const peerGzipEnabled=rtcOptions.enabled!==false&&(typeof rtcOptions.compress==='function'||typeof globalThis.CompressionStream==='function')
    &&(typeof rtcOptions.decode==='function'||typeof globalThis.DecompressionStream==='function');
  const peerCompress=rtcOptions.compress??compressOnlineText,peerDecode=rtcOptions.decode??(data=>decodeOnlineGzip(data,{maximumWireBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes}));
  const peerControlDecode=rtcOptions.decode?async data=>({value:await peerDecode(data)}):data=>decodeOnlineGzip(data,{maximumWireBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes,returnMetadata:true});
  const controlCompressionCache=new Map();let controlCompressionBytes=0;
  const controlCompressionMetrics={compressions:0,shared:0};
  const binaryControlCompression=createBinaryCompressionCache({compress:bytes=>packOnlineBinary(bytes,{compress:peerBinaryCompress})});
  let directPacking=null,directPending=null;
  const directMetrics={compressions:0,compressionFailures:0,coalescedSamples:0,lastCompressionMs:0,maximumCompressionMs:0,
    motionEncodings:0,sharedMotionEncodings:0,ownerPreparations:0,sharedOwnerPreparations:0,statusEncodings:0,sharedStatusEncodings:0};
  // Same-source, same-life arrival comparisons need no synchronized clocks.
  // Retain numeric timestamps only, bounded independently of live effect size.
  const pathArrivals=new Map(),maximumPathFrames=128,maximumPathPairs=8;
  function validatedDelivery(result,playerId,report){
    if(result&&typeof result==='object')return result.validated===true&&result.playerId===playerId
      &&result.epoch===report.epoch&&result.frameSeq===report.frameSeq;
    // Existing callbacks expose only application success. A false result
    // remains a rejection; only the explicit validated result admits duplicates.
    return result!==false;
  }
  function observePath(playerId,report,path){
    if(!match||disconnectedPlayers.has(playerId)||!match.players.some(player=>player.id===playerId))return;
    let row=pathArrivals.get(playerId);
    if(row&&report.epoch<row.epoch)return;
    if(!row||row.epoch!==report.epoch){row={epoch:report.epoch,frames:new Map(),pairs:[],relayPreferred:false,
      rtcArrivals:0,relayArrivals:0,lastRtcFrame:null,lastRelayFrame:null};pathArrivals.set(playerId,row);}
    for(const [frame,sample]of row.frames)if(clock()-sample.at>2000)row.frames.delete(frame);
    let sample=row.frames.get(report.frameSeq);
    if(!sample){sample={at:clock()};row.frames.set(report.frameSeq,sample);}
    if(sample[path]!==undefined)return;
    sample[path]=clock();row[path==='rtc'?'rtcArrivals':'relayArrivals']++;
    row[path==='rtc'?'lastRtcFrame':'lastRelayFrame']=report.frameSeq;
    if(sample.rtc!==undefined&&sample.relay!==undefined){
      row.pairs.push({frameSeq:report.frameSeq,rtcAfterRelayMs:sample.rtc-sample.relay});
      if(row.pairs.length>maximumPathPairs)row.pairs.shift();
      if(row.pairs.length>=3){const sorted=row.pairs.map(value=>value.rtcAfterRelayMs).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
        // ACK delivery even when it loses the race. Only suppress the faster
        // fallback after the recent matched samples favor the direct path.
        if(median>12)row.relayPreferred=true;else if(median<6)row.relayPreferred=false;}
    }
    while(row.frames.size>maximumPathFrames)row.frames.delete(row.frames.keys().next().value);
  }
  function pathDiagnostics(id){
    const row=pathArrivals.get(id);if(!row)return {pairedSamples:0,relayPreferred:false,relativeArrivalMedianMs:null,retainedFrames:0};
    const sorted=row.pairs.map(sample=>sample.rtcAfterRelayMs).sort((a,b)=>a-b);
    return {epoch:row.epoch,pairedSamples:row.pairs.length,retainedFrames:row.frames.size,rtcArrivals:row.rtcArrivals,
      relayArrivals:row.relayArrivals,lastRtcFrame:row.lastRtcFrame,lastRelayFrame:row.lastRelayFrame,
      relativeArrivalMedianMs:sorted.length?sorted[Math.floor(sorted.length/2)]:null,relayPreferred:row.relayPreferred,
      comparisonScope:'same-source-frame validated application delivery; positive means RTC later than relay, not one-way network latency'};
  }
  const uploadTimes=[];let sentPosts=0,sentBytes=0,failedPosts=0,lastPostBytes=0,httpRetryAt=0;
  function validPlaybackActions(actions){
    if(actions===undefined)return true;if(!Array.isArray(actions))return false;
    return actions.every(action=>{
      if(match?.combatPlaybackVersion!==1)return action?.playback===undefined;
      if(!action||Object.hasOwn(action,'targetViews'))return false;
      try{return validateCombatPlayback(action.playback).version===1;}catch{return false;}
    });
  }
  function normalizeMatch(value,localPlayerId){
    const sameRoom=match?.id===value.id&&match.localPlayerId===localPlayerId;
    const field=(key,normalize)=>normalize(Object.hasOwn(value,key)?value[key]:sameRoom?match[key]:0);
    const normalized={...value,continuousAuraVersion:field('continuousAuraVersion',n=>[1,2].includes(n)?n:0),
      ownerStatusVersion:field('ownerStatusVersion',n=>n===1?1:0),combatPlaybackVersion:field('combatPlaybackVersion',n=>n===1?1:0)};
    // Room capabilities are a lifetime binding. Older loading metadata may
    // omit them; an explicit incompatible value cannot change live semantics.
    if(sameRoom&&(normalized.combatPlaybackVersion!==match.combatPlaybackVersion||match.combatPlaybackVersion===1&&
      ['continuousAuraVersion','ownerStatusVersion'].some(key=>normalized[key]!==match[key])))
      throw Error('room-network-capability-changed');
    if(normalized.combatPlaybackVersion===1&&(normalized.ownerStatusVersion!==1||normalized.continuousAuraVersion!==2))
      throw Error('invalid-room-combat-playback-capability');
    return normalized;
  }
  const recordUpload=duration=>{uploadTimes.push(Math.max(0,duration));if(uploadTimes.length>128)uploadTimes.shift();};
  function clearOwnerActions(){ownerActions.clear();ownerActionSizes.clear();pendingActionBytes=0;ownerFatal=null;}
  function removeOwnerAction(id){if(!ownerActions.delete(id))return false;pendingActionBytes-=ownerActionSizes.get(id)??0;ownerActionSizes.delete(id);return true;}
  function failOwner(reason){if(!ownerFatal){ownerFatal=reason;onError(Object.assign(Error(reason),{fatal:true}));}}
  function acceptOwnerActions(actions,frameSeq){
    if(!validPlaybackActions(actions)){failOwner('owner-action-playback-mode-mismatch');return false;}
    const additions=[];let bytes=0;
    for(const action of actions??[]){if(ownerActions.has(action.id)||additions.some(row=>row.action.id===action.id))continue;
      const {ageFrames=0,...sample}=action,value={...structuredClone(sample),frameSeq:Math.max(0,frameSeq-ageFrames)};
      if(match?.ownerStatusVersion!==1&&value.actor){delete value.actor.forceInvincible;delete value.actor.sourceStatusClock;}
      else if(value.actor?.sourceStatusClock)value.actor.sourceStatusClock.frameSeq+=ownerFrameBase;
      const size=encoder.encode(JSON.stringify(value)).length;additions.push({action:value,size});bytes+=size;
    }
    if(ownerActions.size+additions.length>maximumPendingActions||pendingActionBytes+bytes>maximumPendingActionBytes){failOwner('owner-action-history-overflow');return false;}
    for(const row of additions){ownerActions.set(row.action.id,row.action);ownerActionSizes.set(row.action.id,row.size);pendingActionBytes+=row.size;}return true;
  }
  function acknowledgeOwner(report,value){
    if(!report||latestOwner?.epoch!==report.epoch)return;
    const consumedHits=value.consumedHitIds===undefined?new Set(value.ignored?[]:report.hits.map(hit=>hit.id)):
      new Set(Array.isArray(value.consumedHitIds)?value.consumedHitIds.filter(id=>Number.isSafeInteger(id)&&id>=0):[]);
    for(const hit of report.hits)if(consumedHits.has(hit.id))ownerHits.delete(hit.id);
    // New coordinators explicitly acknowledge canonical IDs. The accepted
    // owner frame can advance without consuming old-life / locked actions.
    const consumed=value.consumedActionIds===undefined?new Set(value.ignored?[]:report.actions.map(action=>action.id)):
      new Set(Array.isArray(value.consumedActionIds)?value.consumedActionIds.filter(id=>Number.isSafeInteger(id)&&id>=0):[]);
    let removed=false;for(const action of report.actions)if(consumed.has(action.id))removed=removeOwnerAction(action.id)||removed;
    // A control-only prefix withheld pose even when it carried the final
    // action. Its receipt must trigger the complete latest pose while idle.
    if(removed&&(ownerActions.size||report.actionFrontierComplete===false)&&newestInput){pending.length=0;pending.push(newestInput);}
  }
  function ownerWire({actions=true,hits=true}={}){
    if(!latestOwner)return null;
    try{return buildOwnerUploadPrefix(latestOwner,{actions:actions?[...ownerActions.values()]:[],hits:hits?[...ownerHits.values()]:[]});}
    catch(error){failOwner(error.message);return null;}
  }
  function compressControl(text,bytes){
    const saved=controlCompressionCache.get(text);if(saved){controlCompressionMetrics.shared++;return saved.promise;}
    while(controlCompressionCache.size>=64||controlCompressionBytes+bytes>2*1024*1024){
      const [key,row]=controlCompressionCache.entries().next().value;controlCompressionCache.delete(key);controlCompressionBytes-=row.bytes;
    }
    const row={bytes,promise:null,settled:false};controlCompressionMetrics.compressions++;
    row.promise=Promise.resolve().then(()=>peerCompress(text)).then(value=>{row.settled=true;return value;}).catch(error=>{
      if(controlCompressionCache.get(text)===row){controlCompressionCache.delete(text);controlCompressionBytes-=bytes;}throw error;
    });controlCompressionCache.set(text,row);controlCompressionBytes+=bytes;return row.promise;
  }
  function checkpointKey(report){
    const a=report.actor;
    return JSON.stringify([report.epoch,a.hp,a.state,a.stateSerial,a.facing,a.grounded,a.lineId,a.animationName,a.animationTransitionSerial,
      a.invincible,a.superArmor,a.superArmorNotRed,a.skillSuperArmorNotRed,a.fired,a.pvpDead,
      (a.buffs??[]).map(b=>[b.id,b.name,b.level,b.stacks,b.sourceId]),
      report.effects.map(e=>[e.id,e.name,e.setName,e.active,e.dead,e.combatRetired])]);
  }
  function healthyDirectUpload(report){
    const live=match.players.filter(player=>player.id!==match.localPlayerId&&!disconnectedPlayers.has(player.id)&&player.connected!==false);
    if(peers.size!==live.length||!peers.size)return false;
    return [...peers.values()].every(peer=>{
      const c=peer.control.performance();
      return activePeer(peer)&&rtcAvailable(peer)&&peer.channel?.readyState==='open'&&peer.controlChannel?.readyState==='open'
        &&c.negotiated&&!c.failed&&!c.degraded&&c.poseAckAgeMs!==null&&c.poseAckAgeMs<250
        &&report.frameSeq-c.acknowledgedPoseFrame<=18&&!pathArrivals.get(peer.id)?.relayPreferred;
    });
  }
  const pending=[],peers=new Map(),remote=new Map(),peerRetries=new Map(),peerRetryFailures=new Map(),peerActionLedgers=new Map(),disconnectedPlayers=new Set(),disconnectedEpochs=new Map();
  const signalFrontiers=new Map(),signalCandidates=new Map(),legacySignalPeers=new Set();
  const signalMetrics={stale:0,rejected:0,duplicates:0,legacyFallbacks:0,candidatesQueued:0,candidatesApplied:0};
  const eventTypes=['status','match-preparing','match-preparation-ended','match','state','input','owned-state','owner-status','signal','disconnect','reconnect-ended','result','server-error','resource-delivery','session-replaced'];
  const context=()=>match?{generation:matchGeneration,id:match.id,localPlayerId:match.localPlayerId}:null;
  const current=ctx=>!stopped&&ctx&&ctx.generation===matchGeneration&&ctx.id===match?.id;
  const activePeer=peer=>current(peer.context)&&peers.get(peer.id)===peer;
  // A data channel can remain "open" briefly after ICE/DTLS becomes unusable.
  // New/connecting transports may still negotiate; known broken paths cannot
  // advertise delivery or keep queueing gameplay into their old SCTP buffer.
  const rtcAvailable=peer=>!['disconnected','failed','closed'].includes(peer.connection.connectionState);
  function bindingKey(value,localPlayerId){
    // Progress, connection notices and receipt counters may change within the
    // frozen room. Every other roster field remains part of its binding.
    const mutable=new Set(['loadingProgress','connected','lastSequence','lastFrameSeq','lastReservedSequence']);
    const players=value.players.map(player=>Object.fromEntries(Object.entries(player).filter(([key])=>!mutable.has(key))))
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    return JSON.stringify({id:value.id,seed:value.seed,versions:value.versions,sceneId:value.sceneId,mode:value.mode,
      ownership:value.ownership,continuousAuraVersion:value.continuousAuraVersion??0,ownerStatusVersion:value.ownerStatusVersion??0,
      combatPlaybackVersion:value.combatPlaybackVersion??0,localPlayerId,players},(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
        ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  }
  function peerLedger(id,epoch){
    let row=peerActionLedgers.get(id);
    if(!row||row.epoch!==epoch){row={epoch,actions:new Map(),sizes:new Map(),acknowledged:new Set(),bytes:0,disabled:false};peerActionLedgers.set(id,row);peerRetries.delete(id);peerRetryFailures.delete(id);}
    return row;
  }
  function retainPeerActions(id,epoch,actions){
    const row=peerLedger(id,epoch);if(row.disabled)return;
    const additions=actions.filter(action=>!row.actions.has(action.id)&&!row.acknowledged.has(action.id));
    const bytes=additions.reduce((sum,action)=>sum+(ownerActionSizes.get(action.id)??encoder.encode(JSON.stringify(action)).length),0);
    if(row.actions.size+additions.length>maximumPendingActions||row.bytes+bytes>maximumPendingActionBytes){
      row.disabled=true;row.reason='peer-action-history-overflow';const peer=peers.get(id);peer?.control.closed();if(peer)peer.receipt=null;return;
    }
    for(const action of additions){const size=ownerActionSizes.get(action.id)??encoder.encode(JSON.stringify(action)).length;
      row.actions.set(action.id,action);row.sizes.set(action.id,size);row.bytes+=size;}
  }
  function acknowledgePeerActions(id,{epoch,actionIds}){
    const row=peerActionLedgers.get(id);if(!row||row.epoch!==epoch)return;
    for(const actionId of actionIds){row.acknowledged.add(actionId);
      if(row.actions.delete(actionId)){row.bytes-=row.sizes.get(actionId)??0;row.sizes.delete(actionId);}}
    while(row.acknowledged.size>256)row.acknowledged.delete(row.acknowledged.values().next().value);
  }
  function stagePeerActions(peer){
    if(!latestOwner||!activePeer(peer))return;
    const ledger=peerLedger(peer.id,latestOwner.epoch);if(ledger.disabled)return;
    if(peer.controlStagedEpoch!==latestOwner.epoch){peer.controlStagedEpoch=latestOwner.epoch;peer.controlStagedIds.clear();}
    const actions=[...ledger.actions.values()].filter(action=>!peer.controlStagedIds.has(action.id)).sort((a,b)=>a.id-b.id);
    peer.controlFrontierComplete=false;
    if(peer.control.stage({...latestOwner,effects:[],hits:[],actions:[]})!==true)return;
    // A reconstructed control stream first stages every unacknowledged event
    // retained for this particular recipient, even after the server ACKed it.
    for(let start=0;start<actions.length;){
      const report={...latestOwner,effects:[],hits:[],actions:actions.slice(start,start+16)};
      while(encoder.encode(JSON.stringify(report)).length>MAXIMUM_OWNER_UPLOAD_BYTES&&report.actions.length>1)report.actions.pop();
      if(encoder.encode(JSON.stringify(report)).length>MAXIMUM_OWNER_UPLOAD_BYTES){ledger.disabled=true;ledger.reason='peer-action-message-too-large';peer.control.closed();peer.receipt=null;return;}
      if(peer.control.stage(report)!==true)return;
      for(const action of report.actions)peer.controlStagedIds.add(action.id);
      while(peer.controlStagedIds.size>256)peer.controlStagedIds.delete(peer.controlStagedIds.values().next().value);
      start+=report.actions.length;
    }
    peer.controlFrontierComplete=true;
  }
  const report=(ctx,error)=>{if(current(ctx))onError(error);};
  async function api(url,method='GET',body,{signal,keepalive=false,headers={},bodyText}={}){
    const response=await request(url,{method,cache:'no-store',...(signal?{signal}:{}),...(keepalive?{keepalive:true}:{}),
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(pageInitToken?{'X-RF-Page-Init':pageInitToken}:{}),...headers},...(body?{body:bodyText??JSON.stringify(body)}:{})});
    let value;try{value=await response.json();}catch(error){error.status=response.status;throw error;}
    if(!response.ok){const error=Error(value?.error??'HTTP '+response.status);error.status=response.status;error.code=value?.error;throw error;}return value;
  }
  function closePeers(){
    timers.clearTimeout(directPacking?.deadline);directPacking=null;directPending=null;
    controlCompressionCache.clear();controlCompressionBytes=0;
    binaryControlCompression.clear();
    for(const p of peers.values())retirePeer(p);
    peers.clear();remote.clear();peerRetries.clear();peerRetryFailures.clear();
  }
  function retirePeer(p){
      if(peers.get(p.id)===p)peers.delete(p.id);
      p.connection.onicecandidate=null;p.connection.ondatachannel=null;
      if(p.channel){p.channel.onmessage=null;p.channel.onopen=null;p.channel.onclose=null;}
      if(p.controlChannel){p.controlChannel.onmessage=null;p.controlChannel.onopen=null;p.controlChannel.onclose=null;p.controlChannel.onbufferedamountlow=null;}
      timers.clearTimeout(p.statsJob?.deadline);
      timers.clearTimeout(p.decodeJob?.deadline);p.decodeJob=null;p.decodePending=null;p.receipt=null;
      retireControlAdapter(p);
      p.connection.close();
  }
  function retireControlAdapter(peer){
    peer.controlWake=null;peer.controlSendBlocked=false;
    const encode=peer.controlEncodeJob?.compression?peer.controlEncodeJob:peer.controlNativePending,saved=encode?.text&&controlCompressionCache.get(encode.text);
    binaryControlCompression.discardPending(encode?.compression);
    // A retired unresolved native job cannot be a useful cache for a rebuilt
    // stream. Other peers already awaiting it retain their own promise.
    if(saved&&!saved.settled&&saved.promise===encode.compression){
      controlCompressionCache.delete(encode.text);controlCompressionBytes-=saved.bytes;
    }
    for(const field of ['controlEncodeJob','controlDecodeJob']){
      const job=peer[field];if(job){job.expired=true;timers.clearTimeout(job.deadline);timers.clearTimeout(job.budgetDeadline);peer[field]=null;}
    }
    peer.controlNativePending=null;
    peer.controlOutbound.length=0;peer.controlInbound.length=0;
  }
  const currentControlJob=(peer,job,field)=>activePeer(peer)&&peer.control===job.control
    &&peer[field]===job&&!job.expired&&!peer.control.performance().failed;
  function disconnectPlayer(id,epoch=roomActors.get(id)?.epoch){
    if(!match?.players.some(player=>player.id===id))return false;
    const currentEpoch=roomActors.get(id)?.epoch;
    if(Number.isSafeInteger(epoch)&&Number.isSafeInteger(currentEpoch)&&epoch<currentEpoch)return false;
    disconnectedPlayers.add(id);
    const retired=Number.isSafeInteger(epoch)&&epoch>=0?epoch:-1;
    disconnectedEpochs.set(id,Math.max(disconnectedEpochs.get(id)??-1,retired));
    const peer=peers.get(id);if(peer){peer.control.closed();retirePeer(peer);}
    remote.delete(id);sourceClocks.delete(id);pathArrivals.delete(id);peerRetries.delete(id);peerRetryFailures.delete(id);peerActionLedgers.delete(id);directPending?.delete(id);
    if(directPending&&!directPending.size)directPending=null;
    return true;
  }
  function invalidateMatch({preserveBuffSource=false,preserveSignalFrontiers=false}={}){
    matchGeneration++;upload?.controller.abort();upload=null;
    uploadDeltas.reset();
    if(!preserveBuffSource){buffSender.clear();buffMarker=null;}
    relay?.clearPending();acknowledgements.clear();sourceClocks.clear();pathArrivals.clear();newestInput=null;
    socketAckTimes.length=0;
    lastOwnerUploadAt=-Infinity;lastOwnerCheckpointKey=null;directCheckpointsDeferred=0;
    match=null;matchBinding=null;matchPhase=null;matchStateSequence=-1;pending.length=0;latestOwner=null;ownerHits.clear();clearOwnerActions();peerActionLedgers.clear();closePeers();disconnectedPlayers.clear();disconnectedEpochs.clear();
    signalCandidates.clear();if(!preserveSignalFrontiers){signalFrontiers.clear();legacySignalPeers.clear();}
    uploadTimes.length=0;sentPosts=0;sentBytes=0;failedPosts=0;lastPostBytes=0;httpRetryAt=0;
  }
  async function signal(peer,type,payload){
    if(!activePeer(peer)||!peer.offerId)return null;
    const ctx=peer.context;
    try{
      const value=await api('/api/online/signal','POST',{matchId:ctx.id,to:peer.id,type,payload,
        signalVersion:RTC_SIGNAL_VERSION,generation:peer.signalGeneration,offerId:peer.offerId},
        {headers:pageInitToken?{'X-RF-Page-Init':pageInitToken}:{}});
      return activePeer(peer)?value:null;
    }catch(error){if(activePeer(peer))throw error;return null;}
  }
  function attachChannel(peer,channel){
    if(!activePeer(peer)){channel.close?.();return;}
    if(channel.label==='control'){attachControlChannel(peer,channel);return;}
    peer.channel=channel;channel.binaryType='arraybuffer';
    peer.poseSender.reset();peer.poseReceiver.reset();peer.poseDeltaSupported=false;peer.gzip=false;peer.codecAdvertised=false;
    channel.onclose=()=>{if(peer.channel===channel){peer.receipt=null;peer.gzip=false;}};
    const accept=data=>{
      if(!activePeer(peer)||peer.channel!==channel)return;
      try{
        if(data.matchId!==peer.context.id||!Number.isSafeInteger(data.sequence)||data.sequence<0)return;
        if([1,2].includes(data.motionVersion)){peer.motionSupported=true;peer.motionSupportedVersion=Math.max(peer.motionSupportedVersion,data.motionMaxVersion===2?2:data.motionVersion);}
        if(data.buffSyncVersion===OWNER_BUFF_SYNC_VERSION&&!peer.buffSyncSupported){
          peer.buffSyncSupported=true;
          if(latestOwner?.actor.sourceStatusClock&&latestOwner.epoch===roomActors.get(peer.context.localPlayerId)?.epoch)
            buffMarker=buffSender.capture(encodeOwnedStatus(latestOwner));
        }
        if(!combatOpen())return;
        if(data.motion){
          const motion=validateOwnedMotion(data.motion);
          if(match?.combatPlaybackVersion!==1||motion.epoch!==roomActors.get(peer.id)?.epoch||motion.frameSeq!==data.sequence){motionMetrics.rejected++;return;}
          if(onEvent('owner-motion',{playerId:peer.id,motion,transport:'rtc-motion'})!==false)motionMetrics.received++;
          if(data.motionOnly===true)return;
        }
        if(data.buffStatus){
          if(!peer.buffSyncSupported||match?.ownerStatusVersion!==1||data.buffStatus.epoch!==roomActors.get(peer.id)?.epoch||data.buffStatus.frameSeq!==data.sequence){buffMetrics.rejected++;return;}
          onEvent('owner-protection',{playerId:peer.id,status:decodeOwnerBuffProtection(data.buffStatus),buffRevision:data.buffStatus.buffRevision,transport:'rtc-protection'});
          const status=peer.buffReceiver.decode(data.buffStatus);
          if(status){buffMetrics.compactReceived++;statusMetrics.received++;onEvent('owner-status',{playerId:peer.id,status,transport:'rtc-buff-delta'});}
          else requestBuffRepair(peer,data.buffStatus);
          if(data.statusOnly===true)return;
        }
        // Protection is independent of the collision-history fence. A fresh
        // armor/end checkpoint cannot wait behind a large reliable effect.
        if(data.status){
          if(match?.ownerStatusVersion!==1){statusMetrics.rejected++;return;}
          const status=validateOwnedStatus(data.status),expectedEpoch=roomActors.get(peer.id)?.epoch;
          if(status.epoch!==expectedEpoch||status.frameSeq!==data.sequence){statusMetrics.rejected++;return;}
          statusMetrics.received++;onEvent('owner-status',{playerId:peer.id,status,transport:'rtc'});
          if(data.statusOnly===true)return;
        }
        if([OWNER_POSE_DELTA_VERSION,OWNER_POSE_MASK_VERSION].includes(data.poseDelta))peer.poseDeltaSupported=data.poseDelta;
        if(data.ownerDelta&&!data[decodedPose]){
          try{const candidate=peer.poseReceiver.decode(data.ownerDelta);data={...data,owner:candidate.report,[decodedPose]:candidate};}
          catch(error){peer.receipt=null;peer.transport.poseDeltaRejected++;if(error?.message==='pose-delta-baseline-required'||error?.message==='invalid-pose-delta-base')peer.transport.poseResyncs++;return;}
        }
        const p=data.packet;
        if(!Array.isArray(p?.held)||p.held.length>16||new Set(p.held).size!==p.held.length||p.held.some(k=>!['LEFT','RIGHT','UP','DOWN','Z','X','AWAKEN','Q','W','E','R','A','S','D','C','SPECIAL'].includes(k)))return;
        if(data.codec===peerCodec&&peerGzipEnabled)peer.gzip=true;
        if(data.sequence>peer.sequence){peer.sequence=data.sequence;const packet={held:[...p.held],frameSeq:data.sequence};
          remote.set(peer.id,packet);onEvent('peer-input',{playerId:peer.id,packet});}
        if(data.owner&&data.owner.frameSeq===data.sequence){
          const report=validateOwnedState(data.owner),expectedEpoch=roomActors.get(peer.id)?.epoch;
          if(expectedEpoch!==undefined&&report.epoch!==expectedEpoch)return;
          if(!validPlaybackActions(report.actions))return;
          if(match?.ownerStatusVersion===1&&report.actor.sourceStatusClock)onEvent('owner-status',{playerId:peer.id,status:encodeOwnedStatus(report),transport:'rtc-pose'});
          if(report.actions?.length&&onEvent('owner-actions',{playerId:peer.id,epoch:report.epoch,frameSeq:report.frameSeq,actions:report.actions})===false)return;
          // Legacy single-channel reports can carry only an oldest canonical
          // prefix. Admit that prefix without advancing its newer source pose.
          if(report.actionFrontierComplete===false){peer.receipt=null;return;}
          if(report.epoch===peer.ownerEpoch&&data.sequence<=(peer.ownerSequence??-1))return;
          if(data.controlSequence!==undefined){
            if(!Number.isSafeInteger(data.controlSequence)||data.controlSequence<0)return;
            if(peer.control.fence(data,report.epoch,data.controlSequence))return;
          }
          peer.ownerSequence=data.sequence;peer.ownerEpoch=report.epoch;const applied=onEvent('peer-owned-state',{playerId:peer.id,report,transport:'rtc'});
          if(!activePeer(peer)||peer.channel!==channel||roomActors.get(peer.id)?.epoch!==expectedEpoch)return;
          const delivered=validatedDelivery(applied,peer.id,report);
          // A receipt means a strictly validated, current-life owner actually
          // arrived. Channel-open / ICE success alone cannot suppress relay.
          if(delivered){data[decodedPose]?.commit();observeSource(peer.id,report.epoch,report.frameSeq);observePath(peer.id,report,'rtc');
            peer.control.acknowledgePose(report.epoch,report.frameSeq);}
          if(expectedEpoch===report.epoch&&delivered&&!peer.control.performance().failed&&!peer.control.performance().degraded){
            // Observe gaps at delivery too: a paused main-thread timer must
            // not hide a long outage when a fresh packet precedes its flush.
            if(!peer.receipt||peer.receipt.epoch!==report.epoch||clock()-peer.receipt.at>peerReceiptAgeMs)peer.recoveryStableAt=null;
            peer.receipt={playerId:peer.id,epoch:report.epoch,frameSeq:report.frameSeq,at:clock()};
          }
        }
      }catch{peer.transport.rejectedMessages++;}
    };
    peer.acceptPose=accept;
    async function decode(){
      if(peer.decodeJob)return;const job={deadline:null,expired:false,receiptAtStart:peer.receipt};peer.decodeJob=job;
      try{while(peer.decodePending&&activePeer(peer)&&peer.channel===channel){
        const row=peer.decodePending;peer.decodePending=null;const began=clock();
        job.receiptAtStart=peer.receipt;
        job.deadline=timers.setTimeout(()=>{if(peer.decodeJob===job){job.expired=true;peer.decodePending=null;
          // An older native decode cannot revoke a newer, independently
          // validated raw delivery that arrived while that job was waiting.
          if(peer.receipt===job.receiptAtStart)peer.receipt=null;peer.transport.decodeFailures++;}},1000);
        const binary=networkBinaryEnabled&&peer.control.performance().receiveNetworkBinaryVersion===NETWORK_BINARY_VERSION;
        const data=row.decoded??await (binary?decodeOnlineGzip(row.data,{maximumWireBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes,allowBinary:true}):peerDecode(row.data));timers.clearTimeout(job.deadline);job.deadline=null;
        if(!activePeer(peer)||peer.channel!==channel||peer.decodeJob!==job||job.expired)return;
        const elapsed=clock()-began;peer.transport.maximumDecodeMs=Math.max(peer.transport.maximumDecodeMs,elapsed);
        if(elapsed>=1000)throw Error('peer-decode-timeout');accept(data);
      }}catch{if(activePeer(peer)){peer.transport.decodeFailures++;if(peer.receipt===job.receiptAtStart)peer.receipt=null;}}
      finally{timers.clearTimeout(job.deadline);if(peer.decodeJob===job){peer.decodeJob=null;if(peer.decodePending)void decode();}}
    }
    channel.onmessage=event=>{
      if(!activePeer(peer)||peer.channel!==channel)return;
      if(!combatOpen()&&typeof event.data!=='string')return;
      if(typeof event.data==='string'&&event.data.length>peerMaximumBytes){peer.transport.rejectedMessages++;return;}
      const bytes=typeof event.data==='string'?new TextEncoder().encode(event.data).byteLength:event.data?.byteLength??event.data?.size??0;
      if(bytes<=0||bytes>peerMaximumBytes){peer.transport.rejectedMessages++;return;}
      peer.transport.receivedMessages++;peer.transport.receivedBytes+=bytes;
      if(typeof event.data==='string'){try{accept(JSON.parse(event.data));}catch{peer.transport.rejectedMessages++;}return;}
      const binary=networkBinaryEnabled&&peer.control.performance().receiveNetworkBinaryVersion===NETWORK_BINARY_VERSION;
      if(!binary&&(!peerGzipEnabled||!peer.codecAdvertised)){peer.transport.rejectedMessages++;return;}
      // Raw records require no asynchronous native decompressor. In
      // particular a large independent full snapshot must not wait for an
      // older gzip job merely because it exceeds the small-motion cutoff.
      // A large delta can depend on that pending full baseline, so preserve
      // its existing ordering and decode it just once.
      let decoded;
      if(binary&&isNetworkBinary(event.data)){
        try{decoded=decodeNetworkBinary(event.data,{maximumBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes});}
        catch{peer.transport.decodeFailures++;return;}
        if(bytes<=8192||decoded.ownerDelta?.full===true||decoded.owner&&!decoded.ownerDelta||!peer.decodeJob){
          if(peer.decodeJob&&bytes>8192)peer.transport.independentRawBypasses++;
          accept(decoded);return;
        }
      }
      // RTC is replaceable and unreliable. Bound decoding to one native job
      // plus the newest waiting pose; reliable actions stay on server input.
      if(peer.decodePending)peer.transport.coalescedReceives++;
      peer.decodePending={data:event.data,bytes,...(decoded?{decoded}:{})};void decode();
    };
  }
  function sendBuffAux(peer,payload){
    if(!combatOpen()||!activePeer(peer)||!rtcAvailable(peer)||!peer.buffSyncSupported||peer.controlChannel?.readyState!=='open'||peer.control.performance().failed||peer.controlChannel.bufferedAmount>32768||peer.controlOutbound.length>=16)return false;
    const snapshot=payload.kind==='snapshot';
    const value={type:'buff-sync',v:OWNER_BUFF_SYNC_VERSION,matchId:peer.context.id,
      ownerId:snapshot?peer.context.localPlayerId:peer.id,requesterId:snapshot?peer.id:peer.context.localPlayerId,...payload};
    const binary=networkBinaryEnabled&&peer.control.performance().networkBinaryVersion===NETWORK_BINARY_VERSION;
    const wire=encodeOnlineEnvelope(value,{binary,maximumBytes:peerMaximumBytes});
    // Oversized repairs still travel through full owner/relay state. Keep the
    // independent protection channel small; no action-sequence fragmentation.
    if(wire.bytes>peerPoseLimit(peer))return false;
    peer.controlOutbound.push({text:wire.text,binary:wire.binary,bytes:wire.bytes,at:clock(),buffEnvelope:value});
    void encodeControls(peer);return true;
  }
  function sendBuffSnapshot(peer){
    const snapshot=buffSender.snapshot();
    if(!snapshot||snapshot.epoch!==roomActors.get(peer.context.localPlayerId)?.epoch)return false;
    if(sendBuffAux(peer,{kind:'snapshot',snapshot})){peer.buffSentEpoch=snapshot.epoch;peer.buffSentRevision=snapshot.revision;peer.buffSentFrame=snapshot.frameSeq;
      peer.buffLastSentAt=clock();buffMetrics.snapshotsSent++;return true;}return false;
  }
  const unsentBuffSnapshot=peer=>buffMarker&&(peer.buffSentEpoch!==buffMarker.epoch||peer.buffSentRevision!==buffMarker.revision||peer.buffSentFrame!==buffMarker.frameSeq);
  function requestBuffRepair(peer,status){
    const saved=peer.buffReceiver.performance();
    // A reordered compact older than the installed mutation is obsolete,
    // rather than a request to retransmit an already superseded Buff list.
    if(saved.epoch===status.epoch&&saved.revision>status.buffRevision){buffMetrics.staleCompacts++;return;}
    const old=peer.buffPendingRequest;
    if(old&&old.epoch===status.epoch&&old.revision>=status.buffRevision){buffMetrics.requestsCoalesced++;return;}
    peer.buffPendingRequest={epoch:status.epoch,revision:status.buffRevision};
    buffMetrics.repairs++;pumpBuffSync(peer);
  }
  function pumpBuffSync(peer){
    if(!combatOpen()||!activePeer(peer)||!peer.buffSyncSupported)return;
    const expectedEpoch=roomActors.get(peer.id)?.epoch;
    if(peer.buffPendingRequest&&peer.buffPendingRequest.epoch!==expectedEpoch)peer.buffPendingRequest=null;
    if(peer.buffPendingAck){
      const ack=peer.buffPendingAck;
      if(ack.epoch!==expectedEpoch)peer.buffPendingAck=null;
      else if(sendBuffAux(peer,{kind:'ack',...ack}))peer.buffPendingAck=null;
    }
    if(peer.buffPendingRequest&&clock()-peer.buffRequestSentAt>=250&&sendBuffAux(peer,{kind:'request',epoch:peer.buffPendingRequest.epoch})){
      peer.buffRequestSentAt=clock();buffMetrics.requestsSent++;
    }
    if(buffMarker&&(!peer.buffAck||peer.buffAck.epoch!==buffMarker.epoch||peer.buffAck.revision!==buffMarker.revision||peer.buffAck.frameSeq!==buffMarker.frameSeq)
      &&(unsentBuffSnapshot(peer)||clock()-peer.buffLastSentAt>=250))sendBuffSnapshot(peer);
  }
  function receiveBuffAux(peer,value){
    if(value?.type!=='buff-sync')return false;
    try{
      if(!combatOpen()||!peer.buffSyncSupported||value.v!==OWNER_BUFF_SYNC_VERSION||value.matchId!==peer.context.id)throw Error('invalid-buff-sync-context');
      const incomingSnapshot=value.kind==='snapshot';
      if(value.ownerId!==(incomingSnapshot?peer.id:peer.context.localPlayerId)||value.requesterId!==(incomingSnapshot?peer.context.localPlayerId:peer.id))throw Error('invalid-buff-sync-identity');
      const keys=Object.keys(value),base=['type','v','matchId','kind','ownerId','requesterId'];
      const expected=value.kind==='snapshot'?[...base,'snapshot']:value.kind==='ack'?[...base,'epoch','revision','frameSeq']:value.kind==='request'?[...base,'epoch']:[];
      if(keys.length!==expected.length||keys.some(key=>!expected.includes(key)))throw Error('invalid-buff-sync-envelope');
      if(value.kind==='snapshot'){
        if(value.snapshot?.epoch!==roomActors.get(peer.id)?.epoch)throw Error('invalid-buff-sync-life');
        if(peer.buffReceiver.install(value.snapshot)){
          buffMetrics.snapshotsReceived++;onEvent('owner-buffs',{playerId:peer.id,snapshot:value.snapshot,transport:'reliable-buff'});
          if(peer.buffPendingRequest?.epoch===value.snapshot.epoch&&peer.buffPendingRequest.revision<=value.snapshot.revision)peer.buffPendingRequest=null;
          peer.buffPendingAck={epoch:value.snapshot.epoch,revision:value.snapshot.revision,frameSeq:value.snapshot.frameSeq};pumpBuffSync(peer);
        }
      }else if(value.kind==='ack'){
        if(!buffMarker||value.epoch!==roomActors.get(peer.context.localPlayerId)?.epoch||value.epoch!==buffMarker.epoch||value.revision!==buffMarker.revision||value.frameSeq!==buffMarker.frameSeq)throw Error('invalid-buff-sync-ack');
        peer.buffAck={epoch:value.epoch,revision:value.revision,frameSeq:value.frameSeq};
      }else if(value.kind==='request'){
        if(value.epoch!==roomActors.get(peer.context.localPlayerId)?.epoch||value.epoch!==latestOwner?.epoch)throw Error('invalid-buff-sync-request');
        peer.buffAck=null;if(unsentBuffSnapshot(peer)||clock()-(peer.buffLastSentAt??-Infinity)>=100)sendBuffSnapshot(peer);
      }
    }catch{buffMetrics.rejected++;}
    return true;
  }
  function attachControlChannel(peer,channel){
    if(!activePeer(peer)||peer.controlChannel&&peer.controlChannel!==channel){channel.close?.();return;}
    peer.controlChannel=channel;channel.binaryType='arraybuffer';
    channel.bufferedAmountLowThreshold=controlLowWater;
    channel.onopen=()=>{if(activePeer(peer)&&peer.controlChannel===channel){peer.control.pump();void encodeControls(peer);}};
    channel.onbufferedamountlow=()=>wakeControlSender(peer,channel);
    channel.onclose=()=>{if(activePeer(peer)&&peer.controlChannel===channel){peer.receipt=null;peer.control.closed();}};
    channel.onmessage=event=>{
      if(!activePeer(peer)||peer.controlChannel!==channel||peer.control.performance().failed)return;
      const bytes=typeof event.data==='string'?new TextEncoder().encode(event.data).length:event.data?.byteLength??0;
      if(bytes<=0||bytes>peerMaximumBytes||peer.controlInbound.length>=64){peer.controlWire.lastAdapterFault=bytes<=0||bytes>peerMaximumBytes?'control-inbound-envelope':'control-inbound-backlog';peer.control.closed();peer.receipt=null;return;}
      peer.controlWire.receivedBytes+=bytes;peer.controlWire.receivedMessages++;
      // Raw action envelopes need no asynchronous codec job. Let the bounded
      // control receiver enforce their sequence/delta dependencies directly;
      // an earlier independent Buff repair must not hold up the next action.
      // Fragments still use the adapter FIFO because their assembly is ordered.
      let raw=null;
      try{
        const binary=peer.control.performance().networkBinaryVersion===NETWORK_BINARY_VERSION;
        const value=typeof event.data==='string'?JSON.parse(event.data):binary&&isNetworkBinary(event.data)
          ?decodeNetworkBinary(event.data,{maximumBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes}):null;
        if(value!==null)raw={value,decodedBytes:typeof event.data==='string'?bytes:networkJsonByteLength(value)};
        const protocol=['hello','hello-ack','ack','pose-ack'].includes(value?.type);
        if(protocol||value?.type==='actions'){
          if(!protocol&&!combatOpen())return;
          // receiveParsed verifies the actual JSON structure budget as well as
          // its byte count. Binary decoding supplies the exact reconstructed
          // JSON size; wire bytes are not an admission-size substitute.
          peer.controlWire.decodedMessages++;
          if(!protocol)peer.controlWire.rawCriticalBypasses++;
          peer.control.receiveParsed(value,{decodedBytes:raw.decodedBytes});return;
        }
      }catch{}
      peer.controlInbound.push({value:event.data,bytes,at:clock(),combatAtArrival:combatOpen(),raw});
      peer.controlWire.maximumInboundPending=Math.max(peer.controlWire.maximumInboundPending,peer.controlInbound.length);void decodeControls(peer);
    };
    peer.control.pump();
  }
  function wakeControlSender(peer,channel){
    if(!activePeer(peer)||peer.controlChannel!==channel||peer.control.performance().failed||peer.controlWake!==null)return;
    // A crossing wakes the queued work once, without background-page timer
    // clamping. Retiring the adapter invalidates this token before it can run.
    // Never poll or recursively retry inside the backpressured encoder.
    const wake={control:peer.control};peer.controlWake=wake;
    queueMicrotask(()=>{
      if(peer.controlWake!==wake)return;
      peer.controlWake=null;
      if(!activePeer(peer)||peer.controlChannel!==channel||peer.control!==wake.control||peer.control.performance().failed||!rtcAvailable(peer))return;
      peer.controlWire.lowWaterWakes++;peer.control.pump();pumpBuffSync(peer);sendCriticalAheadOfBuff(peer);void encodeControls(peer);
    });
  }
  async function decodeControls(peer){
    if(peer.controlDecodeJob||peer.control.performance().failed)return;const job={control:peer.control,expired:false,startedAt:clock(),queuedAt:clock()};peer.controlDecodeJob=job;
    try{while(peer.controlInbound.length&&currentControlJob(peer,job,'controlDecodeJob')){
      const row=peer.controlInbound.shift(),value=row.value;job.startedAt=clock();job.queuedAt=row.at;
      peer.controlWire.maximumDecodeWaitMs=Math.max(peer.controlWire.maximumDecodeWaitMs,job.startedAt-row.at);
      if(row.raw){
        const parsed=row.raw.value,protocol=['hello','hello-ack','ack','pose-ack'].includes(parsed?.type);
        peer.controlWire.decodedMessages++;
        if(!row.combatAtArrival&&!protocol)continue;
        if(!receiveBuffAux(peer,parsed)&&(combatOpen()||protocol))peer.control.receiveParsed(parsed,{decodedBytes:row.raw.decodedBytes});continue;
      }
      if(typeof value==='string'){peer.controlWire.decodedMessages++;const parsed=JSON.parse(value);
        if(!row.combatAtArrival&&!['hello','hello-ack','ack','pose-ack'].includes(parsed?.type))continue;
        if(!receiveBuffAux(peer,parsed)&&(combatOpen()||['hello','hello-ack','ack','pose-ack'].includes(parsed?.type)))peer.control.receiveText(value);continue;}
      const binary=peer.control.performance().networkBinaryVersion===NETWORK_BINARY_VERSION;
      if(!binary&&!peer.control.performance().compressed)throw Error('control-codec-required');
      job.deadline=timers.setTimeout(()=>{if(currentControlJob(peer,job,'controlDecodeJob')){job.expired=true;peer.controlWire.decodeTimeouts++;peer.controlWire.lastAdapterFault='control-decode-timeout';peer.control.closed();peer.receipt=null;}},1000);
      const decoded=await (binary?decodeOnlineGzip(value,{maximumWireBytes:peerMaximumBytes,maximumDecodedBytes:peerMaximumBytes,allowBinary:true,returnMetadata:true}):peerControlDecode(value));timers.clearTimeout(job.deadline);
      if(!currentControlJob(peer,job,'controlDecodeJob'))return;
      if(!row.combatAtArrival&&!['hello','hello-ack','ack','pose-ack'].includes(decoded.value?.type))continue;
      if(receiveBuffAux(peer,decoded.value))continue;
      if(!combatOpen()&&!['hello','hello-ack','ack','pose-ack'].includes(decoded.value?.type))continue;
      const duration=Math.max(0,clock()-job.startedAt);peer.controlWire.lastDecodeMs=duration;
      peer.controlWire.maximumDecodeMs=Math.max(peer.controlWire.maximumDecodeMs,duration);peer.controlWire.decodedMessages++;
      if(Number.isSafeInteger(decoded.decodedBytes))peer.control.receiveParsed(decoded.value,{decodedBytes:decoded.decodedBytes});
      else peer.control.receiveText(JSON.stringify(decoded.value));
    }}catch(error){if(currentControlJob(peer,job,'controlDecodeJob')){peer.controlWire.lastAdapterFault=String(error?.message??'control-decode-failed');peer.control.closed();peer.receipt=null;peer.controlWire.decodeFailures++;}}
    finally{timers.clearTimeout(job.deadline);if(peer.controlDecodeJob===job){peer.controlDecodeJob=null;if(peer.controlInbound.length&&activePeer(peer))void decodeControls(peer);}}
  }
  const currentControlRow=(peer,row)=>row.buffEnvelope?combatOpen()&&row.buffEnvelope.matchId===match?.id
    &&(row.buffEnvelope.snapshot?.epoch??row.buffEnvelope.epoch)===roomActors.get(row.buffEnvelope.ownerId)?.epoch
    :row.epoch===undefined||combatOpen()&&row.epoch===Math.max(latestOwner?.epoch??-1,roomActors.get(peer.context.localPlayerId)?.epoch??-1);
  function criticalRawCredit(peer,bytes,{consume=false}={}){
    const at=clock(),elapsed=Math.max(0,at-peer.criticalRawAt);
    peer.criticalRawCredit=Math.min(criticalRawBurstBytes,peer.criticalRawCredit+elapsed*criticalRawBytesPerSecond/1000);peer.criticalRawAt=at;
    if(bytes>peer.criticalRawCredit)return false;
    if(consume)peer.criticalRawCredit-=bytes;return true;
  }
  function recordControlSend(peer,row,value,bytes){
    peer.controlChannel.send(value);peer.controlWire.sentBytes+=bytes;peer.controlWire.sentMessages++;
    if(row.rawFallback){criticalRawCredit(peer,bytes,{consume:true});peer.controlWire.criticalRawFallbackBytes+=bytes;}
    if(row.binary){peer.controlWire.binaryMessages++;if(isNetworkBinary(value))peer.controlWire.binaryRawMessages++;else peer.controlWire.compressedMessages++;}
    else if(value!==row.text)peer.controlWire.compressedMessages++;
  }
  function sendCriticalAheadOfBuff(peer){
    // Only the independent auxiliary codec can be overtaken. Earlier actions,
    // fragments, a life transition or SCTP backpressure remain strict barriers.
    if(!peer.controlEncodeJob?.row?.buffEnvelope||!activePeer(peer)||!rtcAvailable(peer)
      ||peer.control.performance().failed||peer.controlChannel?.readyState!=='open')return;
    for(;;){
      const at=peer.controlOutbound.findIndex(row=>!row.buffEnvelope);if(at<0)return;
      const row=peer.controlOutbound[at],value=row.binary??row.text,bytes=row.binary?.byteLength??row.bytes;
      if(row.type!=='actions'||bytes>criticalRawMaximum||bytes>peerPoseLimit(peer)||!criticalRawCredit(peer,bytes))return;
      if(!currentControlRow(peer,row)){peer.controlOutbound.splice(at,1);continue;}
      if(peer.controlChannel.bufferedAmount>controlHighWater)return;
      row.rawFallback=true;try{recordControlSend(peer,row,value,bytes);}catch{delete row.rawFallback;return;}
      peer.controlOutbound.splice(at,1);peer.controlWire.criticalBuffBypasses++;
    }
  }
  function beginControlCompression(peer,job,row){
    job.compression=row.binary?binaryControlCompression.encode(row.binary):compressControl(row.text,row.bytes);
    const pending={promise:null,text:row.text,compression:job.compression};peer.controlNativePending=pending;
    // Keep at most one unresolved native encoder per peer even after a raw
    // fallback. Its late result has no send continuation and cannot double-send.
    pending.promise=Promise.resolve(job.compression).then(value=>({value}),error=>({error})).then(result=>{
      if(peer.controlNativePending===pending)peer.controlNativePending=null;
      return result;
    });
    return pending.promise;
  }
  async function encodeControls(peer){
    if(peer.controlEncodeJob||peer.control.performance().failed||!rtcAvailable(peer)||peer.controlChannel?.readyState!=='open')return;
    if(peer.controlChannel.bufferedAmount>controlHighWater){peer.controlSendBlocked=true;return;}
    peer.controlSendBlocked=false;const job={control:peer.control,expired:false,startedAt:clock(),queuedAt:clock()};peer.controlEncodeJob=job;
    try{while(peer.controlOutbound.length&&currentControlJob(peer,job,'controlEncodeJob')&&rtcAvailable(peer)){
      if(peer.controlChannel.bufferedAmount>controlHighWater){peer.controlSendBlocked=true;peer.controlWire.sendBackpressureWaits++;return;}
      // Keep the immutable canonical row at the head, including its completed
      // wire encoding. Backpressure must neither consume it nor recompress it.
      const row=peer.controlOutbound[0];let value=row.encoded??row.binary??row.text,bytes=row.encodedBytes??row.binary?.byteLength??row.bytes;job.row=row;job.startedAt=clock();job.queuedAt=row.at;job.text=row.text;job.compression=null;
      if(!currentControlRow(peer,row)){peer.controlOutbound.shift();continue;}
      peer.controlWire.maximumEncodeWaitMs=Math.max(peer.controlWire.maximumEncodeWaitMs,job.startedAt-row.at);
      if(row.encoded===undefined&&peer.control.performance().compressed&&bytes>=(row.binary?NETWORK_BINARY_COMPRESSION_THRESHOLD+1:512)){
        const boundedAction=row.type==='actions'&&bytes<=criticalRawMaximum&&bytes<=peerPoseLimit(peer)&&criticalRawCredit(peer,bytes);
        let result;
        if(boundedAction&&peer.controlNativePending)result={raw:true};
        else{
          job.deadline=timers.setTimeout(()=>{if(currentControlJob(peer,job,'controlEncodeJob')){job.expired=true;peer.controlWire.encodeTimeouts++;peer.controlWire.lastAdapterFault='control-encode-timeout';peer.control.closed();peer.receipt=null;}},1000);
          // Large records keep their compression policy and existing watchdog;
          // they never spawn a second native encoder beside an unresolved one.
          if(peer.controlNativePending)await peer.controlNativePending.promise;
          if(!currentControlJob(peer,job,'controlEncodeJob'))return;
          const compression=beginControlCompression(peer,job,row);
          result=boundedAction?await Promise.race([compression,new Promise(resolve=>{
            job.budgetDeadline=timers.setTimeout(()=>resolve({raw:true}),criticalCompressionBudgetMs);
          })]):await compression;
          timers.clearTimeout(job.deadline);timers.clearTimeout(job.budgetDeadline);
        }
        if(!currentControlJob(peer,job,'controlEncodeJob'))return;
        const duration=Math.max(0,clock()-job.startedAt);peer.controlWire.lastEncodeMs=duration;
        peer.controlWire.maximumEncodeMs=Math.max(peer.controlWire.maximumEncodeMs,duration);
        if(result.raw){row.rawFallback=true;peer.controlWire.criticalCompressionFallbacks++;}
        else{
          if(result.error)throw result.error;value=result.value;
          if(!(value instanceof Uint8Array)||value.byteLength>peerMaximumBytes)throw Error('control-codec-failed');bytes=value.byteLength;
        }
      }
      row.encoded=value;row.encodedBytes=bytes;
      if(!currentControlJob(peer,job,'controlEncodeJob')||peer.controlChannel?.readyState!=='open')return;
      if(!currentControlRow(peer,row)){peer.controlOutbound.shift();continue;}
      // Keep the canonical row until a live path resumes. It remains under
      // the existing admission deadline; server action retention is separate.
      if(!rtcAvailable(peer))return;
      if(peer.controlChannel.bufferedAmount>controlHighWater){peer.controlSendBlocked=true;peer.controlWire.sendBackpressureWaits++;return;}
      if(bytes>peerPoseLimit(peer))throw Error('control-sctp-message-too-large');
      recordControlSend(peer,row,value,bytes);peer.controlOutbound.shift();
    }}catch(error){if(currentControlJob(peer,job,'controlEncodeJob')){peer.controlWire.lastAdapterFault=String(error?.message??'control-encode-failed');peer.control.closed();peer.receipt=null;peer.controlWire.encodeFailures++;}}
    finally{timers.clearTimeout(job.deadline);timers.clearTimeout(job.budgetDeadline);if(peer.controlEncodeJob===job)peer.controlEncodeJob=null;}
  }
  function peerReceipts(){
    return [...peers.values()].filter(p=>activePeer(p)&&rtcAvailable(p)&&p.channel?.readyState==='open'&&p.receipt&&clock()-p.receipt.at<=peerReceiptAgeMs
      &&!p.control.performance().failed&&!p.control.performance().degraded&&!pathArrivals.get(p.id)?.relayPreferred
      &&roomActors.get(p.id)?.epoch===p.receipt.epoch).map(p=>({playerId:p.id,epoch:p.receipt.epoch,frameSeq:p.receipt.frameSeq,
        ...(p.control.receipt(p.receipt.epoch).length?{controlIds:p.control.receipt(p.receipt.epoch)}:{})}));
  }
  const peerPoseLimit=peer=>Math.min(peerMaximumBytes,peer.connection.sctp?.maxMessageSize>0?peer.connection.sctp.maxMessageSize:64*1024);
  function sendPeer(peer,payload,bytes,{compressed=false,binary=false}={}){
    if(!activePeer(peer)||!rtcAvailable(peer)||peer.channel?.readyState!=='open')return false;
    if(peer.channel.bufferedAmount>=32768){peer.transport.skippedBackpressure++;return false;}
    if(bytes>peerPoseLimit(peer)){peer.transport.skippedOversize++;return false;}
    try{peer.channel.send(payload);peer.transport.sentMessages++;peer.transport.sentBytes+=bytes;
      if(compressed)peer.transport.compressedMessages++;else if(peerGzipEnabled)peer.codecAdvertised=true;
      if(binary){peer.transport.binaryMessages++;if(!compressed)peer.transport.binaryRawMessages++;}
      return true;
    }catch(error){peer.transport.sendFailures++;
      const recoverable=error?.name==='OperationError'||error instanceof TypeError;
      if(!recoverable||peer.channel?.readyState!=='open'){peer.channel=null;peer.receipt=null;}
      if(!recoverable)report(peer.context,error);
    }
    return false;
  }
  async function packDirect(){
    if(directPacking)return;const job={deadline:null,expired:false,startedAt:clock()};directPacking=job;
    try{while(directPending){
      const row=directPending.values().next().value,targets=[];
      for(const [id,pendingRow]of directPending)if(row.binary?pendingRow.binary===row.binary:!pendingRow.binary&&pendingRow.text===row.text){targets.push(id);directPending.delete(id);}
      if(!directPending.size)directPending=null;const began=clock();job.startedAt=began;
      job.deadline=timers.setTimeout(()=>{if(directPacking===job){job.expired=true;directPending=null;directMetrics.compressionFailures++;
        for(const peer of peers.values())peer.gzip=false;}},1000);
      const bytes=await (row.binary?packOnlineBinary(row.binary,{compress:peerBinaryCompress}):peerCompress(row.text));timers.clearTimeout(job.deadline);job.deadline=null;
      if(directPacking!==job||!current(row.context)||job.expired)return;
      const elapsed=clock()-began;directMetrics.lastCompressionMs=elapsed;directMetrics.maximumCompressionMs=Math.max(directMetrics.maximumCompressionMs,elapsed);
      if(elapsed>=1000||!(bytes instanceof Uint8Array)||bytes.byteLength>peerMaximumBytes)throw Error('peer-compression-failed');
      directMetrics.compressions++;
      // Finish a started newest-state packet even if another sample arrived.
      // Starving every completed encode would stall an otherwise good peer.
      for(const id of targets){const peer=peers.get(id);if(peer&&peer.gzip&&peer.codecAdvertised)sendPeer(peer,bytes,bytes.byteLength,{compressed:!row.binary||!isNetworkBinary(bytes),binary:!!row.binary});}
    }}catch{if(directPacking===job){directMetrics.compressionFailures++;for(const peer of peers.values())peer.gzip=false;}}
    finally{timers.clearTimeout(job.deadline);if(directPacking===job){directPacking=null;if(directPending)void packDirect();}}
  }
  async function ensurePeer(id,ctx=context()){
    if(!current(ctx)||!Peer||peerMode==='relay'||legacySignalPeers.has(id)||disconnectedPlayers.has(id)||!match.players.some(player=>player.id===id&&player.connected!==false)||id===ctx.localPlayerId)return null;
    if(peers.has(id))return peers.get(id);
    // getRandomValues is also exposed on the supported plain-HTTP entry;
    // randomUUID itself is restricted to secure contexts in some browsers.
    const offerId=ctx.localPlayerId<id?(globalThis.crypto?.randomUUID?.()
      ??Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('')):null;
    const connection=new Peer({iceServers}),peer={id,context:ctx,connection,channel:null,controlChannel:null,sequence:-1,createdAt:clock(),disconnectedAt:null,recoveryStableAt:null,
      signalGeneration:++nextSignalGeneration,offerId,
      remoteSignal:null,offerJob:null,answerJob:null,cachedAnswer:null,candidateJob:null,
      transport:{sentMessages:0,sentBytes:0,compressedMessages:0,binaryMessages:0,binaryRawMessages:0,capabilityMessages:0,receivedMessages:0,receivedBytes:0,skippedBackpressure:0,skippedOversize:0,sendFailures:0,
        rejectedMessages:0,decodeFailures:0,coalescedReceives:0,maximumDecodeMs:0,poseDeltaRejected:0,poseResyncs:0,independentRawBypasses:0},
      poseSender:createOwnerPoseDelta(),poseReceiver:createOwnerPoseDelta(),poseDeltaSupported:false,
      motionSupported:false,motionSupportedVersion:0,
      buffSyncSupported:false,buffReceiver:createOwnerBuffReceiver(),buffAck:null,buffSentEpoch:null,buffSentRevision:null,buffSentFrame:-1,buffLastSentAt:-Infinity,
      buffPendingRequest:null,buffRequestSentAt:-Infinity,buffPendingAck:null,
      gzip:false,codecAdvertised:false,receipt:null,decodeJob:null,decodePending:null,
      controlOutbound:[],controlInbound:[],controlEncodeJob:null,controlDecodeJob:null,controlNativePending:null,criticalRawCredit:criticalRawBurstBytes,criticalRawAt:clock(),controlWake:null,controlSendBlocked:false,controlFrontierComplete:false,controlStagedEpoch:null,controlStagedIds:new Set(),
      controlWire:{sentBytes:0,receivedBytes:0,sentMessages:0,receivedMessages:0,decodedMessages:0,compressedMessages:0,binaryMessages:0,binaryRawMessages:0,encodeFailures:0,decodeFailures:0,
        encodeTimeouts:0,decodeTimeouts:0,lastEncodeMs:0,maximumEncodeMs:0,lastDecodeMs:0,maximumDecodeMs:0,
        maximumEncodeWaitMs:0,maximumDecodeWaitMs:0,maximumOutboundPending:0,maximumInboundPending:0,sendBackpressureWaits:0,lowWaterWakes:0,rawCriticalBypasses:0,
        criticalBuffBypasses:0,criticalCompressionFallbacks:0,criticalRawFallbackBytes:0,lastFault:null,lastAdapterFault:null},
      route:null,statsJob:null,statsAt:-Infinity,statsUpdatedAt:null,statsStatus:'unavailable'};
    peer.control=createPeerControl({matchId:ctx.id,clock,gzip:peerGzipEnabled,reliableTransport:true,networkBinary:networkBinaryEnabled,
      sendValue:(value,metadata)=>{
        if(!activePeer(peer)||!rtcAvailable(peer)||peer.controlChannel?.readyState!=='open'||peer.controlChannel.bufferedAmount>controlHighWater||peer.controlOutbound.length>=64)return false;
        let binary;
        try{binary=encodeNetworkBinary(value,{maximumBytes:peerMaximumBytes});}
        catch(error){if(error?.message==='network-binary-size')return null;throw error;}
        // Larger records use the existing reliable fragment framing. Each
        // fragment can still be packed without changing canonical action IDs.
        if(binary.byteLength>peerPoseLimit(peer))return null;
        peer.controlOutbound.push({binary,bytes:metadata.decodedBytes,at:clock(),type:metadata.type,epoch:metadata.epoch});
        peer.controlWire.maximumOutboundPending=Math.max(peer.controlWire.maximumOutboundPending,peer.controlOutbound.length);sendCriticalAheadOfBuff(peer);void encodeControls(peer);return true;
      },
      send:(text,metadata)=>{
        if(!activePeer(peer)||!rtcAvailable(peer)||peer.controlChannel?.readyState!=='open'||peer.controlChannel.bufferedAmount>controlHighWater)return false;
        const bytes=encoder.encode(text).length;
        if(bytes<512&&['hello','hello-ack','ack','pose-ack'].includes(metadata?.type)){
          try{peer.controlChannel.send(text);peer.controlWire.sentBytes+=bytes;peer.controlWire.sentMessages++;return true;}catch{return false;}
        }
        if(peer.controlOutbound.length>=64)return false;
        peer.controlOutbound.push({text,bytes,at:clock(),type:metadata?.type,epoch:metadata?.epoch});
        peer.controlWire.maximumOutboundPending=Math.max(peer.controlWire.maximumOutboundPending,peer.controlOutbound.length);sendCriticalAheadOfBuff(peer);void encodeControls(peer);return true;
      },
      onAcknowledged:value=>acknowledgePeerActions(id,value),
      apply:raw=>{
        if(!activePeer(peer)||!combatOpen())return false;
        try{const report=validateOwnedState(raw);
          if(roomActorsMatch!==ctx.id||roomActors.get(id)?.epoch!==report.epoch)return false;
          if(!validPlaybackActions(report.actions))return false;
          if(onEvent('owner-actions',{playerId:id,epoch:report.epoch,frameSeq:report.frameSeq,actions:report.actions,transport:'peer-control'})!==true)return false;
          // The reliable envelope already contains a full, validated owner
          // header. Preserve its pose/vitals when the replaceable datagram
          // was lost; the actions retain their own exact reaction intents.
          if(match?.combatPlaybackVersion===1){
            const accepted=onEvent('peer-owned-state',{playerId:id,report,transport:'peer-control'});
            if(accepted===false||accepted?.validated===false)return false;
          }
          return true;
        }catch{return false;}
      },onPose:data=>{if(activePeer(peer))peer.acceptPose?.(data);},onFault:reason=>{if(activePeer(peer)){peer.receipt=null;peer.controlWire.lastFault=reason;
        if(peer.control.performance().failed)retireControlAdapter(peer);}}});
    peers.set(id,peer);
    if(latestOwner){peerLedger(id,latestOwner.epoch);stagePeerActions(peer);}
    connection.onicecandidate=event=>{
      if(!activePeer(peer)||!event.candidate)return;
      try{signal(peer,'candidate',event.candidate.toJSON()).catch(error=>report(ctx,error));}catch(error){report(ctx,error);}
    };
    connection.ondatachannel=event=>attachChannel(peer,event.channel);
    if(ctx.localPlayerId<id){
      attachChannel(peer,connection.createDataChannel('input',{ordered:false,maxRetransmits:0}));
      const control=connection.createDataChannel('control',{ordered:true});
      // Legacy test adapters and older integrations can expose just one channel.
      // Never replace the pose handler with a control handler on that object.
      if(control!==peer.channel)attachControlChannel(peer,control);
      const offer=await connection.createOffer();if(!activePeer(peer))return null;
      await connection.setLocalDescription(offer);if(!activePeer(peer))return null;
      await signal(peer,'offer',connection.localDescription.toJSON());if(!activePeer(peer))return null;
    }
    return peer;
  }
  async function receiveSignal(data){
    const ctx=context();if(!current(ctx)||data.matchId!==ctx.id||disconnectedPlayers.has(data.from))return;
    if(!match.players.some(player=>player.id===data.from&&player.connected!==false)||data.from===ctx.localPlayerId)return;
    if(!['offer','answer','candidate'].includes(data.type)){signalMetrics.rejected++;return;}
    if(data.signalVersion===undefined){
      // An unversioned answer cannot prove which offer it answers. Keep this
      // pair on the existing coordinator path; never weaken another pair or
      // allow an old legacy event to retire a known modern generation.
      if(signalFrontiers.has(data.from))return;
      if(!legacySignalPeers.has(data.from)){legacySignalPeers.add(data.from);signalMetrics.legacyFallbacks++;}
      const previous=peers.get(data.from);if(previous)retirePeer(previous);return;
    }
    let identity;try{identity=readRtcSignalIdentity(data,{received:true});}catch{signalMetrics.rejected++;return;}
    if(data.type!=='candidate'&&(!data.payload||data.payload.type!==data.type||typeof data.payload.sdp!=='string')){signalMetrics.rejected++;return;}
    const initiator=ctx.localPlayerId<data.from,existing=peers.get(data.from);
    if(data.type==='offer'&&initiator||data.type==='answer'&&!initiator){signalMetrics.rejected++;return;}
    // Only an answer/candidate for this exact locally-created offer may enter
    // its PC. A previous page's random offer ID cannot match after a reload.
    if(initiator&&(!existing||identity.offerId!==existing.offerId)){signalMetrics.stale++;return;}
    const previous=signalFrontiers.get(data.from);
    if(previous){const order=compareRtcSignalIdentity(identity,previous);
      if(order<0){signalMetrics.stale++;return;}
      if(order===0){if(identity.offerId!==previous.offerId){signalMetrics.rejected++;return;}identity=previous;}
    }
    if(identity!==previous){signalFrontiers.set(data.from,identity);signalCandidates.delete(data.from);}
    legacySignalPeers.delete(data.from);
    if(initiator&&existing.remoteSignal&&identity.sourceEpoch>existing.remoteSignal.sourceEpoch
      &&(existing.answerApplied||existing.answerJob)){
      // A reloaded answerer may reply to a retained old offer. Its new page
      // cannot share the former remote DTLS association; start a fresh local
      // offer immediately, including when the old setRemote is still pending.
      retirePeer(existing);await ensurePeer(data.from,ctx);return;
    }
    if(data.type==='candidate'){
      let pending=signalCandidates.get(data.from);
      if(!pending){pending={identity,rows:[],seen:new Set()};signalCandidates.set(data.from,pending);}
      const key=JSON.stringify(data.payload);
      if(pending.seen.has(key)){signalMetrics.duplicates++;return;}
      if(pending.seen.size>=64){signalMetrics.rejected++;return;}
      pending.seen.add(key);pending.rows.push(data.payload);signalMetrics.candidatesQueued++;
      const peer=peers.get(data.from);
      if(peer&&peer.offerId===identity.offerId&&peer.remoteSignal===identity)void drainSignalCandidates(peer,identity);
      return;
    }
    let peer=existing;
    if(data.type==='offer'){
      if(peer?.offerId&&(peer.offerId!==identity.offerId||peer.remoteSignal&&peer.remoteSignal!==identity)){retirePeer(peer);peer=null;}
      peer??=await ensurePeer(data.from,ctx);
      if(!peer||!activePeer(peer)||signalFrontiers.get(data.from)!==identity)return;
      peer.offerId=identity.offerId;peer.remoteSignal=identity;
      if(peer.offerJob||peer.cachedAnswer){
        if(peer.offerSdp!==data.payload.sdp){signalMetrics.rejected++;return;}
        signalMetrics.duplicates++;if(peer.cachedAnswer)await signal(peer,'answer',peer.cachedAnswer);return;
      }
      peer.offerSdp=data.payload.sdp;
      const job={identity};peer.offerJob=job;
      try{
        if(!await runSignalOperation(peer,identity,()=>peer.connection.setRemoteDescription(data.payload)))return;
        await drainSignalCandidates(peer,identity);if(!liveSignal(peer,identity))return;
        const answer=await runSignalOperation(peer,identity,()=>peer.connection.createAnswer());if(!answer)return;
        if(!await runSignalOperation(peer,identity,()=>peer.connection.setLocalDescription(answer.value)))return;
        peer.cachedAnswer=peer.connection.localDescription.toJSON();await signal(peer,'answer',peer.cachedAnswer);
      }finally{if(peer.offerJob===job)peer.offerJob=null;}
    }else{
      if(!peer||!activePeer(peer))return;
      peer.remoteSignal=identity;
      if(peer.answerJob||peer.answerApplied){if(peer.answerSdp!==data.payload.sdp)signalMetrics.rejected++;else signalMetrics.duplicates++;return;}
      peer.answerSdp=data.payload.sdp;
      const job={identity};peer.answerJob=job;
      try{if(!await runSignalOperation(peer,identity,()=>peer.connection.setRemoteDescription(data.payload)))return;
        peer.answerApplied=true;await drainSignalCandidates(peer,identity);
      }finally{if(peer.answerJob===job)peer.answerJob=null;}
    }
  }
  const liveSignal=(peer,identity)=>activePeer(peer)&&peer.remoteSignal===identity
    &&signalFrontiers.get(peer.id)===identity&&peer.offerId===identity.offerId;
  async function runSignalOperation(peer,identity,operation){
    try{const value=await operation();return liveSignal(peer,identity)?{value}:null;}
    catch(error){if(liveSignal(peer,identity))throw error;return null;}
  }
  async function drainSignalCandidates(peer,identity){
    if(peer.candidateJob||!liveSignal(peer,identity)||!peer.connection.remoteDescription)return;
    const job={identity};peer.candidateJob=job;
    try{while(liveSignal(peer,identity)){
      const pending=signalCandidates.get(peer.id);if(pending?.identity!==identity||!pending.rows.length)return;
      const candidate=pending.rows.shift(),expected=rtcSdpUfrag(peer.connection.remoteDescription.sdp),actual=rtcCandidateUfrag(candidate);
      if(expected&&actual&&expected!==actual){signalMetrics.rejected++;continue;}
      try{await peer.connection.addIceCandidate(candidate);if(liveSignal(peer,identity))signalMetrics.candidatesApplied++;}
      catch{if(liveSignal(peer,identity))signalMetrics.rejected++;}
    }}finally{if(peer.candidateJob===job)peer.candidateJob=null;}
  }
  async function flush(){
    for(const peer of [...peers.values()])if(activePeer(peer)){
      peer.control.pump();
      pumpBuffSync(peer);
      if(peer.controlOutbound.length&&rtcAvailable(peer)){sendCriticalAheadOfBuff(peer);void encodeControls(peer);}
      const state=peer.connection.connectionState,age=clock()-peer.createdAt;
      if(state==='disconnected')peer.disconnectedAt??=clock();else peer.disconnectedAt=null;
      const control=peer.control.performance();
      if(peerActionLedgers.get(peer.id)?.disabled){peer.receipt=null;continue;}
      const receipt=peer.receipt,stable=state==='connected'&&peer.channel?.readyState==='open'&&peer.controlChannel?.readyState==='open'
        &&control.negotiated&&!control.failed&&!control.degraded&&peer.controlFrontierComplete&&receipt
        &&receipt.epoch===roomActors.get(peer.id)?.epoch&&clock()-receipt.at<=peerReceiptAgeMs;
      if(stable){
        peer.recoveryStableAt??=clock();
        // Web reconnect policy: ten observed seconds of fresh, validated
        // owners renew consecutive-failure credit, not the restart history.
        if(clock()-peer.recoveryStableAt>=10000)peerRetryFailures.delete(peer.id);
      }else peer.recoveryStableAt=null;
      const failed=state==='failed'||state==='closed'||control.failed
        ||peer.disconnectedAt!==null&&clock()-peer.disconnectedAt>3000
        ||age>10000&&(peer.channel?.readyState!=='open'
          ||peer.controlChannel&&(peer.controlChannel.readyState!=='open'||!control.negotiated));
      if(failed&&age>5000&&peer.context.localPlayerId<peer.id&&(peerRetryFailures.get(peer.id)??0)<4){
        peerRetries.set(peer.id,(peerRetries.get(peer.id)??0)+1);peerRetryFailures.set(peer.id,(peerRetryFailures.get(peer.id)??0)+1);const ctx=peer.context;retirePeer(peer);
        ensurePeer(peer.id,ctx).catch(error=>report(ctx,error));
      }
    }
    const ctx=context();if(!current(ctx)||upload||!pending.length)return;
    const useRelay=relay?.active&&(match.ownership===OWNERSHIP_PROTOCOL||latestOwner!==null);
    if(useRelay){
      const oldest=[...acknowledgements.values()].find(row=>row.sentAt!==undefined);
      if(acknowledgements.size>=64||oldest&&clock()-oldest.sentAt>2000){relay.fail();return;}
      // Credit covers reserved native gzip jobs as well as physically sent
      // reports. A blocked slot needs no encoding; its canonical inbox stays.
      if(acknowledgements.size>=maximumOwnerCredits)return;
    }else if(clock()<httpRetryAt)return;
    const candidate=ownerWire();if(latestOwner&&!candidate)return;
    const key=candidate?checkpointKey(candidate):null;
    if(candidate&&!candidate.hits.length&&!candidate.actions.length&&key===lastOwnerCheckpointKey
      &&healthyDirectUpload(candidate)&&clock()-lastOwnerUploadAt<100){directCheckpointsDeferred++;return;}
    // No await or receipt mutation separates this measured snapshot from its
    // upload. Reuse it only within this flush, never across a later ACK/epoch.
    if(useRelay){
      const frames=[pending.at(-1)],ownerReport=candidate,batch={matchId:ctx.id,sequence:sequence++,frames,...(ownerReport?{owner:ownerReport,peerReceipts:peerReceipts()}:{})};pending.length=0;
      // A partial frontier is not an accepted pose baseline. Keep it outside
      // the delta cache so the same source frame can later carry full effects.
      const compactOwner=!!ownerReport&&ownerReport.actionFrontierComplete!==false&&relay.performance().ownerUploadDelta===true;
      if(compactOwner){
        try{batch.ownerUpload=uploadDeltas.encode(ownerReport,{poseVersion:relay.performance().networkBinaryVersion===NETWORK_BINARY_VERSION?OWNER_POSE_MASK_VERSION:OWNER_POSE_DELTA_VERSION});delete batch.owner;}
        catch(error){pending.push(frames[0]);failOwner(error?.message??'owner-upload-encode-failed');return;}
      }
      const receipt={context:ctx,ownerReport,compactOwner};acknowledgements.set(batch.sequence,receipt);
      const sent=relay.send(batch,{onSent:at=>{receipt.sentAt=at;},onSuperseded:()=>acknowledgements.delete(batch.sequence)});
      if(!sent){acknowledgements.delete(batch.sequence);pending.push(frames[0]);if(compactOwner)relay.fail();}
      else if(ownerReport){lastOwnerUploadAt=clock();lastOwnerCheckpointKey=key;}
      return;
    }
    const owner={context:ctx,controller:new AbortController(),startedAt:clock()};upload=owner;
    const localOwner=match.ownership===OWNERSHIP_PROTOCOL||latestOwner!==null;
    const frames=localOwner?[pending.at(-1)]:pending.splice(0,8);if(localOwner)pending.length=0;
    const ownerReport=candidate;
    if(ownerReport){lastOwnerUploadAt=clock();lastOwnerCheckpointKey=key;}
    const batch={matchId:ctx.id,sequence:sequence++,frames,...(ownerReport?{owner:ownerReport,peerReceipts:peerReceipts()}:{})};
    const bodyText=JSON.stringify(batch);
    lastPostBytes=new TextEncoder().encode(bodyText).length;sentPosts++;sentBytes+=lastPostBytes;
    // A hung POST must not retain a match forever. State is replaceable and
    // hit receipts remain pending until a successful response acknowledges it.
    const deadline=timers.setTimeout(()=>owner.controller.abort(),2000);
    let accepted=false;
    try{const value=await api('/api/online/input','POST',batch,{signal:owner.controller.signal,bodyText});
      if(value.accepted===false)throw Error('owner-input-not-accepted');accepted=true;
      if(current(ctx)&&upload===owner)acknowledgeOwner(ownerReport,value);}
    catch(error){if(upload===owner){
      failedPosts++;httpRetryAt=clock()+50;
      // A failed POST may be the complete pose after the final action prefix
      // was acknowledged. Retry it even with empty event inboxes and no new
      // input; never revive a retired room or a previous owner life.
      if(current(ctx)&&localOwner&&ownerReport&&latestOwner?.epoch===ownerReport.epoch
        &&newestInput&&!pending.length)pending.push(newestInput);
      report(ctx,error);
    }}
    finally{
      timers.clearTimeout(deadline);
      if(upload===owner){recordUpload(clock()-owner.startedAt);upload=null;
        // Reports produced during a completed POST already replace one another.
        // Continue with that newest report immediately, avoiding an additional
        // 0..50ms timer wait while retaining exactly one request in flight.
        // Failed requests retain the timer's retry pacing.
        if(accepted&&localOwner&&current(ctx)&&pending.length)void flush();
      }
    }
  }
  async function lifecycleRequest(url,method,body,prepare){
    const generation=matchGeneration,sourceGeneration=streamGeneration;
    const unchanged=()=>!stopped&&generation===matchGeneration&&sourceGeneration===streamGeneration;
    try{if(prepare)await prepare();if(!unchanged())return null;
      const pageBound=url==='/api/online/ready'||url==='/api/online/loading-progress';
      const value=await api(url,method,body,{headers:pageBound&&pageInitToken?{'X-RF-Page-Init':pageInitToken}:{}});return unchanged()?value:null;
    }catch(error){if(unchanged())throw error;return null;}
  }
  function dispatch(type,data,{filterMatch=false,eventId}={}){
    if(type==='session-replaced'){
      stop();onError(Object.assign(Error('Your account signed in elsewhere. This session has ended.'),{code:'session-replaced',status:401,fatal:true}));return;
    }
    if(Number.isSafeInteger(eventId)){if(eventId<=lastServerEventId)return;lastServerEventId=eventId;}
    if(filterMatch&&['state','input','owned-state','owner-status','disconnect','reconnect-ended','result','server-error'].includes(type)&&data?.matchId&&match&&data.matchId!==match.id)return;
    if(type==='reconnect-ended'){
      if(match&&data?.matchId!==match.id)return;
      invalidateMatch();relayDeltas.clear();roomActors.clear();roomActorsMatch=null;onEvent(type,data);return;
    }
    if(type==='state'&&data?.matchId&&!match)return;
    if(type==='match'&&data?.id===match?.id&&['settling','finished','aborted'].includes(data.status))match={...match,status:data.status};
    if(['input','owned-state','owner-status'].includes(type)&&!combatOpen())return;
    if(type==='state'&&match?.id===data.matchId){
      // A room snapshot is one authoritative lifecycle view. Never let an
      // old-life disconnect in a delayed view retire an already restored
      // participant or roll the local baseline cache back to that old life.
      if(roomActorsMatch===data.matchId&&Object.entries(data.ownership?.actors??{}).some(([id,owner])=>{
        const saved=roomActors.get(id)?.epoch;return Number.isSafeInteger(owner?.epoch)&&Number.isSafeInteger(saved)&&owner.epoch<saved;
      }))return;
      const phase=data.pvp?.phase;
      if(Object.hasOwn(phaseOrder,phase)){
        if(matchPhase!==null&&phaseOrder[phase]<phaseOrder[matchPhase]||Number.isSafeInteger(data.sequence)&&data.sequence<matchStateSequence)return;
        matchPhase=phase;if(Number.isSafeInteger(data.sequence))matchStateSequence=data.sequence;
      }
    }
    if(type==='result'&&match?.id===data.matchId)matchPhase='result';
    if(type==='owner-status'){
      if(match?.ownerStatusVersion!==1||data.playerId===match?.localPlayerId||disconnectedPlayers.has(data.playerId))return;
      const status=validateOwnedStatus(data.status);if(status.epoch!==roomActors.get(data.playerId)?.epoch)return;
      statusMetrics.received++;onEvent(type,{...data,status,transport:'relay'});return;
    }
    if(type==='disconnect'&&!disconnectPlayer(data.playerId??data.id,data.epoch??roomActors.get(data.playerId??data.id)?.epoch))return;
    if(type==='input'&&disconnectedPlayers.has(data.playerId))return;
    if(type==='input'&&data.actionDeltaVersion!==undefined){
      if(data.relayToken!==undefined&&relayToken!==data.relayToken){relayDeltas.clear();relayToken=data.relayToken;}
      data=relayDeltas.decodeActions(data);
    }
    if(type==='input'&&!validPlaybackActions(data.actions))return;
    if(type==='owned-state'){
      if(disconnectedPlayers.has(data.playerId))return;
      if(data.playerId===match?.localPlayerId)return;
      if(data.relayToken!==undefined&&relayToken!==data.relayToken){relayDeltas.clear();relayToken=data.relayToken;}
      const decoded=data.baselineOnly===true||typeof data.full==='boolean'?relayDeltas.decode(data):data.report;
      if(decoded===null)return;
      const report=validateOwnedState(decoded);if(!validPlaybackActions(report.actions))return;observeSource(data.playerId,report.epoch,report.frameSeq);
      // This checkpoint is derived locally from the existing validated relay
      // report. It needs no RTC capability or new server/legacy wire fields.
      if(match?.combatPlaybackVersion===1)onEvent('owner-motion',{playerId:data.playerId,motion:encodeOwnedMotion(report,{includeReaction:true}),transport:'relay-motion'});
      if(match?.ownerStatusVersion===1&&report.actor.sourceStatusClock)onEvent('owner-status',{playerId:data.playerId,status:encodeOwnedStatus(report),transport:'relay-pose'});
      const saved=roomActors.get(data.playerId);if(roomActorsMatch===data.matchId&&saved?.epoch===report.epoch){
        Object.assign(saved.actor,structuredClone(report.actor));clearAbsentOwnedLifecycleFields(saved.actor,report.actor);
      }
      const generation=matchGeneration,delivered=onEvent('peer-owned-state',{playerId:data.playerId,report,transport:'relay'});
      if(generation===matchGeneration&&match?.id===data.matchId&&validatedDelivery(delivered,data.playerId,report))observePath(data.playerId,report,'relay');return;
    }
    const revived=[];
    if(type==='state'){
      for(const player of data.pvp?.players??[])if(player.connected===false)disconnectPlayer(player.id,data.ownership?.actors?.[player.id]?.epoch);
      for(const actor of data.snapshot?.actors??[])if(actor.pvpDisconnected===true)disconnectPlayer(actor.id,data.ownership?.actors?.[actor.id]?.epoch);
      for(const actor of data.snapshot?.actors??[])if(disconnectedPlayers.has(actor.id)){
        const epoch=data.ownership?.actors?.[actor.id]?.epoch;
        if(data.pvp?.players?.find(player=>player.id===actor.id)?.connected===true&&actor.pvpDisconnected!==true
          &&Number.isSafeInteger(epoch)&&epoch>=0&&epoch>(disconnectedEpochs.get(actor.id)??-1)){
          disconnectedPlayers.delete(actor.id);disconnectedEpochs.delete(actor.id);revived.push(actor.id);
          match={...match,players:match.players.map(player=>player.id===actor.id?{...player,connected:true}:player)};
        }
      }
      if(roomActorsMatch!==data.matchId){roomActors.clear();roomActorsMatch=data.matchId;}
      if(data.snapshotDelta===true){
        const actors=data.snapshot.actors.map(actor=>{
          const epoch=data.ownership.actors[actor.id]?.epoch,saved=roomActors.get(actor.id);
          if(Object.hasOwn(actor,'stats')){roomActors.set(actor.id,{epoch,actor:structuredClone(actor)});return actor;}
          if(!saved||saved.epoch!==epoch)throw Error('socket-room-baseline-required');
          Object.assign(saved.actor,structuredClone(actor));return structuredClone(saved.actor);
        });
        data={...data,snapshot:{...data.snapshot,actors}};delete data.snapshotDelta;
      }else for(const actor of data.snapshot?.actors??[])roomActors.set(actor.id,{epoch:data.ownership?.actors?.[actor.id]?.epoch,actor:structuredClone(actor)});
      for(const [id,owner]of Object.entries(data?.ownership?.actors??{}))if(id!==match?.localPlayerId)observeSource(id,owner.epoch,owner.frameSeq);
    }
    if(type==='signal'){const ctx=context();receiveSignal(data).catch(error=>report(ctx,error));}
      else {if(type==='input'&&data.actions?.length)onEvent('owner-actions',data);onEvent(type,data);}
    // Authoritative ownership must reach the application before a rebuilt
    // pair can advertise or admit the restored life. A callback may leave the
    // match; ensurePeer checks that captured binding before doing any work.
    if(revived.length&&match?.id===data.matchId){const ctx=context();for(const id of revived)ensurePeer(id,ctx).catch(error=>report(ctx,error));}
  }
  const activePoll=owner=>!stopped&&stream===owner&&owner.generation===streamGeneration;
  async function releasePoll(connectionId){
    if(!connectionId)return;
    const controller=new AbortController(),deadline=timers.setTimeout(()=>controller.abort(),2000);
    try{await api('/api/online/poll/close','POST',{connectionId},{signal:controller.signal,keepalive:true});}
    catch{}finally{timers.clearTimeout(deadline);}
  }
  function stop(){
    stopped=true;streamGeneration++;globalThis.clearInterval(timer);timer=null;
    const previous=stream;stream=null;invalidateMatch();relay?.close();relay=null;
    if(previous?.kind==='poll'){
      if(previous.operation)timers.clearTimeout(previous.operation.deadline);
      previous.operation?.controller.abort();
      if(previous.wait){timers.clearTimeout(previous.wait.timer);previous.wait.resolve(false);previous.wait=null;}
      previous.resolveStarted(null);void releasePoll(previous.connectionId);
    }else previous?.close();
  }
  function waitPoll(owner,milliseconds){
    if(!activePoll(owner))return Promise.resolve(false);
    return new Promise(resolve=>{
      const wait={resolve,timer:timers.setTimeout(()=>{if(owner.wait===wait)owner.wait=null;resolve(activePoll(owner));},milliseconds)};
      owner.wait=wait;
    });
  }
  async function pollApi(owner,url,method='GET',body){
    const operation={controller:new AbortController()};owner.operation=operation;
    operation.deadline=timers.setTimeout(()=>operation.controller.abort(),method==='GET'?11000:2000);
    try{return await api(url,method,body,{signal:operation.controller.signal,
      ...(method==='POST'&&url==='/api/online/poll/open'?{headers:{'X-RF-Owned-Delta':'3',...(pageInitToken?{'X-RF-Page-Init':pageInitToken}:{})}}:{})});}
    finally{timers.clearTimeout(operation.deadline);if(owner.operation===operation)owner.operation=null;}
  }
  function pollFailure(owner,error){
    if(!activePoll(owner))return;
    if(error.status===401){const replaced=error.code==='session-replaced',expired=Error(replaced?'Your account signed in elsewhere. This session has ended.':'Session expired. Please sign in again.');expired.code=replaced?'session-replaced':'login-required';expired.status=401;error=expired;}
    else if(error.status===409&&error.code==='stream-already-open'){
      const duplicate=Error('A connection is already open. Close duplicate pages and try again.');duplicate.code=error.code;duplicate.status=409;error=duplicate;
    }
    error.fatal=true;owner.rejectStarted(error);stop();onError(error);
  }
  function validatePoll(value,after){
    if(!Array.isArray(value?.events)||value.events.length>ONLINE_POLL_MAXIMUM_BATCH_EVENTS||!Number.isSafeInteger(value.cursor)||value.cursor<after)throw Error('invalid-online-poll-response');
    let previous=-1;
    for(const event of value.events){
      if(!Number.isSafeInteger(event?.id)||event.id<0||event.id<=previous||event.id>value.cursor||!eventTypes.includes(event.type)
        ||!event.data||typeof event.data!=='object'||Array.isArray(event.data))throw Error('invalid-online-poll-response');
      previous=event.id;
    }
    if(value.cursor!==Math.max(after,previous))throw Error('invalid-online-poll-response');
  }
  async function pollLoop(owner){
    let failures=0;
    while(activePoll(owner)){
      try{
        if(!owner.connectionId){
          const opened=await pollApi(owner,'/api/online/poll/open','POST',{});
          const validId=typeof opened?.connectionId==='string'&&opened.connectionId.length>0&&opened.connectionId.length<=256;
          if(!activePoll(owner)){if(validId)await releasePoll(opened.connectionId);return;}
          if(validId)owner.connectionId=opened.connectionId;
          if(!validId||!Number.isSafeInteger(opened.cursor)||opened.cursor<0)throw Error('invalid-online-poll-open');
          owner.cursor=opened.cursor;owner.resolveStarted();
        }
        const after=owner.cursor;
        const value=await pollApi(owner,'/api/online/poll?connectionId='+encodeURIComponent(owner.connectionId)+'&after='+after);
        if(!activePoll(owner))return;
        validatePoll(value,after);
        for(const event of value.events){
          if(!activePoll(owner))return;
          if(event.id<=owner.cursor)continue;
          owner.cursor=event.id;try{dispatch(event.type,event.data,{filterMatch:true});}catch(error){if(activePoll(owner))onError(error);}
        }
        if(!activePoll(owner))return;
        owner.cursor=value.cursor;failures=0;
        if(!value.events.length&&!await waitPoll(owner,25))return;
      }catch(error){
        if(!activePoll(owner))return;
        if(error.status===409&&error.code==='poll-connection-not-active')owner.connectionId=null;
        else if((error.status>=400&&error.status<500&&!(error.status===409&&error.code==='poll-already-pending'))
          ||error.message?.startsWith('invalid-online-poll-')){pollFailure(owner,error);return;}
        onError(Error('connection-retrying'));
        if(!await waitPoll(owner,Math.min(1000,250*2**Math.min(failures++,2))))return;
      }
    }
  }
  function observeSource(id,epoch,frameSeq){
    if(!Number.isSafeInteger(epoch)||!Number.isSafeInteger(frameSeq)||frameSeq<=0)return;
    if((pathArrivals.get(id)?.epoch??epoch)<epoch)pathArrivals.delete(id);
    let row=sourceClocks.get(id);const now=clock(),sourceMs=frameSeq*1000/60,offset=now-sourceMs;
    if(!row||row.epoch!==epoch){row={epoch,frameSeq,at:now,minOffset:offset,samples:1};sourceClocks.set(id,row);return;}
    if(frameSeq<=row.frameSeq)return;
    row.minOffset=Math.min(row.minOffset,offset);row.frameSeq=frameSeq;row.at=now;row.samples++;
  }
  function readPeerRoute(stats){
    const rows=[...stats.values()],transport=rows.find(row=>row.type==='transport'&&row.selectedCandidatePairId);
    // A nominated pair need not be the selected pair. Use the transport's
    // explicit selection, with the older browser `selected` field as fallback.
    const pair=transport?stats.get(transport.selectedCandidatePairId):rows.find(row=>row.type==='candidate-pair'&&row.selected===true);
    if(pair?.type!=='candidate-pair'||pair.state!=='succeeded')return {route:'unknown',roundTripTimeMs:null};
    const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
    const known=value=>['host','srflx','prflx','relay'].includes(value)?value:null;
    const localCandidateType=known(local?.candidateType),remoteCandidateType=known(remote?.candidateType);
    const route=localCandidateType==='relay'||remoteCandidateType==='relay'?'relay':localCandidateType&&remoteCandidateType?'direct':'unknown';
    return {route,localCandidateType,remoteCandidateType,protocol:['udp','tcp'].includes(local?.protocol)?local.protocol:null,
      roundTripTimeMs:Number.isFinite(pair.currentRoundTripTime)&&pair.currentRoundTripTime>=0?pair.currentRoundTripTime*1000:null};
  }
  function samplePeerRoute(peer){
    if(!activePeer(peer)||peer.channel?.readyState!=='open'||typeof peer.connection.getStats!=='function'
      ||peer.statsJob||clock()-peer.statsAt<1000)return;
    const job={deadline:null,expired:false};peer.statsJob=job;peer.statsAt=clock();peer.statsStatus='pending';
    job.deadline=timers.setTimeout(()=>{if(activePeer(peer)&&peer.statsJob===job){job.expired=true;peer.statsStatus='timeout';}},1000);
    // Never await diagnostic collection on the input/render path. A hung
    // native call remains the sole call for this peer until it settles, so a
    // timeout cannot create an unbounded stack of pending getStats requests.
    Promise.resolve().then(()=>activePeer(peer)?peer.connection.getStats():null).then(stats=>{
      if(!activePeer(peer)||peer.statsJob!==job||job.expired)return;
      peer.route=readPeerRoute(stats);peer.statsUpdatedAt=clock();peer.statsStatus='ready';
    }).catch(()=>{if(activePeer(peer)&&peer.statsJob===job&&!job.expired)peer.statsStatus='failed';})
      .finally(()=>{timers.clearTimeout(job.deadline);if(peer.statsJob===job)peer.statsJob=null;});
  }
  function openRelay(){
    if(!Socket||relay||stopped)return;
    relay=createOnlineSocket({WebSocket:Socket,url:'/api/online/socket'+(pageInitToken?'?pageInitToken='+encodeURIComponent(pageInitToken):''),clock,timers,...socketOptions,
      onEvent:(type,data,metadata)=>{try{dispatch(type,data,{filterMatch:true,...metadata});}catch(error){onError(error);}},
      onActive:()=>{uploadDeltas.reset();onEvent('transport',{connected:true,kind:'websocket'});void flush();},
      onInactive:()=>{uploadDeltas.reset();acknowledgements.clear();if(newestInput&&match){pending.length=0;pending.push(newestInput);}onEvent('transport',{connected:true,kind:eventTransport});void flush();},
      onAcknowledgement:data=>{
        if(!data||!Number.isSafeInteger(data.sequence))return;
        const row=acknowledgements.get(data.sequence);if(!row||data.matchId!==row.context.id||!current(row.context))return;
        acknowledgements.delete(data.sequence);
        if(row.sentAt!==undefined){socketAckTimes.push(Math.max(0,clock()-row.sentAt));if(socketAckTimes.length>128)socketAckTimes.shift();}
        if(data.accepted!==true){relay?.fail();return;}
        if(row.compactOwner&&data.ownerReceipt?.epoch===row.ownerReport.epoch&&data.ownerReceipt?.frameSeq===row.ownerReport.frameSeq)uploadDeltas.acknowledge(data.ownerReceipt);
        acknowledgeOwner(row.ownerReport,data);void flush();
      }});relay.open();
  }
  return {
    api,
    notifyOwnerCapacity(playerId){
      if(!combatOpen())return false;let retried=false;
      for(const peer of playerId===undefined?peers.values():[peers.get(playerId)])
        if(peer&&activePeer(peer))retried=peer.control.resumeAdmission()||retried;
      return retried;
    },
    setPageInitToken(token){
      if(typeof token!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(token))throw new TypeError('Invalid online page identity');
      if(stream||relay)throw new Error('Cannot change an active online page identity');
      pageInitToken=token;return token;
    },
    roomCapacity(){return api('/api/online/capacity');},
    setRoomCapacity(maxRoomsByMode){return api('/api/online/capacity','POST',{maxRoomsByMode});},
    async open(){
      if(stream)return stream.started;stopped=false;
      if(eventTransport==='poll'){
        const owner={kind:'poll',generation:++streamGeneration,connectionId:null,cursor:0,operation:null,wait:null};
        owner.started=new Promise((resolve,reject)=>{owner.resolveStarted=resolve;owner.rejectStarted=reject;});stream=owner;
        timer=globalThis.setInterval(flush,50);void pollLoop(owner);const started=await owner.started;if(activePoll(owner))openRelay();return started;
      }
      const generation=++streamGeneration,source=new Source('/api/online/events?ownedDelta=3'+(pageInitToken?'&pageInitToken='+encodeURIComponent(pageInitToken):''));stream=source;
      const active=()=>!stopped&&stream===source&&streamGeneration===generation;
      // WS upgrades require this page's established SSE lease. An independent
      // /status response can arrive before /events and is not a lease receipt.
      source.addEventListener('open',()=>{if(active())openRelay();});
      for(const type of eventTypes)source.addEventListener(type,event=>{
        if(!active())return;
        try{dispatch(type,JSON.parse(event.data),{filterMatch:true,...(event.lastEventId!==undefined?{eventId:Number(event.lastEventId)}:{})});}catch(error){if(active())onError(error);}
      });
      source.onerror=()=>{if(active())onError(Error('connection-retrying'));};
      timer=globalThis.setInterval(flush,50);
      try{const status=await api('/api/online/status');if(active())onEvent('status',status);}
      catch(error){if(active())throw error;}
    },
    async join(mode='2v2'){
      const capabilities=[{mode,continuousAuraVersion:2,ownerStatusVersion:1,combatPlaybackVersion:1},
        {mode,continuousAuraVersion:2,ownerStatusVersion:1},{mode,continuousAuraVersion:1},{mode}];
      for(let index=0;index<capabilities.length;index++)try{return await lifecycleRequest('/api/online/queue','POST',capabilities[index],flush);}
      catch(error){if(index===capabilities.length-1||error.status!==400||error.code!=='invalid-queue-request')throw error;}
    },
    async cancel(){return lifecycleRequest('/api/online/queue','DELETE');},
    async ready(id){if(id!==match?.id||stopped)return null;return lifecycleRequest('/api/online/ready','POST',{matchId:id});},
    async loadingProgress(id,percent){if(id!==match?.id||stopped)return null;return lifecycleRequest('/api/online/loading-progress','POST',{matchId:id,percent});},
    async refreshMatch(value,localPlayerId){
      value=normalizeMatch(value,localPlayerId);
      if(!match||stopped||bindingKey(value,localPlayerId)!==matchBinding)return this.setMatch(value,localPlayerId);
      // Loading/ready broadcasts do not retire a pending offer, upload, ACK
      // ledger or decoded pose. Explicit setMatch still means reconnect.
      const terminal=['settling','finished','aborted'].includes(match.status)?match.status:null;
      match={...value,...(terminal?{status:terminal}:{}),localPlayerId};
      for(const player of value.players)if(player.connected===false)disconnectPlayer(player.id);
      const local=value.players.find(player=>player.id===localPlayerId);
      sequence=Math.max(sequence,(local?.lastSequence??-1)+1);
      frameSequence=Math.max(frameSequence,local?.lastFrameSeq??0);
    },
    async setMatch(value,localPlayerId){
      value=normalizeMatch(value,localPlayerId);
      const binding=bindingKey(value,localPlayerId);
      const previousId=match?.id,previousSequence=sequence,sameOwner=previousId===value.id&&match?.localPlayerId===localPlayerId
        &&match?.ownership===OWNERSHIP_PROTOCOL&&match.combatPlaybackVersion===value.combatPlaybackVersion;
      if(previousId!==value.id){relayDeltas.clear();if(roomActorsMatch!==value.id){roomActors.clear();roomActorsMatch=null;}}
      const savedOwner=sameOwner?latestOwner:null,savedHits=sameOwner?[...ownerHits]:[],savedActions=sameOwner?[...ownerActions]:[],savedBase=ownerFrameBase;
      const savedPhase=sameOwner?matchPhase:null,savedStateSequence=sameOwner?matchStateSequence:-1;
      const savedTerminal=sameOwner&&['settling','finished','aborted'].includes(match.status)?match.status:null;
      const savedDisconnected=previousId===value.id?[...disconnectedPlayers]:[],savedDisconnectedEpochs=previousId===value.id?[...disconnectedEpochs]:[];
      const savedLedgers=sameOwner?[...peerActionLedgers]:[],savedFatal=sameOwner?ownerFatal:null;invalidateMatch({preserveBuffSource:sameOwner,preserveSignalFrontiers:previousId===value.id});
      for(const id of savedDisconnected)disconnectedPlayers.add(id);
      for(const [id,epoch]of savedDisconnectedEpochs)disconnectedEpochs.set(id,epoch);
      latestOwner=savedOwner;for(const [id,hit] of savedHits)ownerHits.set(id,hit);
      for(const [id,action]of savedActions){ownerActions.set(id,action);const bytes=encoder.encode(JSON.stringify(action)).length;ownerActionSizes.set(id,bytes);pendingActionBytes+=bytes;}
      for(const [id,ledger]of savedLedgers)peerActionLedgers.set(id,ledger);ownerFatal=savedFatal;
      const local=value.players.find(p=>p.id===localPlayerId);sequence=sameOwner?Math.max(previousSequence,(local?.lastSequence??-1)+1):(local?.lastSequence??-1)+1;
      const acknowledgedFrame=local?.lastFrameSeq??sequence*8;
      frameSequence=previousId===value.id?Math.max(frameSequence,acknowledgedFrame):acknowledgedFrame;
      ownerFrameBase=sameOwner?savedBase:frameSequence;
      match={...value,...(savedTerminal?{status:savedTerminal}:{}),localPlayerId};matchPhase=savedPhase??(value.status==='starting'?'created':null);matchStateSequence=savedStateSequence;matchBinding=binding;const ctx=context();
      for(const p of match.players)if(p.id!==localPlayerId&&!disconnectedPlayers.has(p.id)&&p.connected!==false)ensurePeer(p.id,ctx).catch(error=>report(ctx,error));
    },
    send(packet,ownerState=null){
      if(stopped||!combatOpen())return;
      const ctx=context();
      if(ownerState&&latestOwner&&latestOwner.epoch!==ownerState.epoch)ownerFrameBase=frameSequence;
      // Owner source clocks count actual60Hz local steps, even if only one
      // sample in three is uploaded. Packet sequence is not a20Hz time unit.
      frameSequence=Math.max(frameSequence+1,ownerState?ownerFrameBase+ownerState.frameSeq:0);
      const clean={held:[...packet.held],pressed:[...packet.pressed],released:[...packet.released],frameSeq:frameSequence};
      newestInput=clean;
      if(ownerState){if(latestOwner&&latestOwner.epoch!==ownerState.epoch){ownerHits.clear();clearOwnerActions();peerActionLedgers.clear();peerRetries.clear();peerRetryFailures.clear();}
        if(ownerFatal||!acceptOwnerActions(ownerState.actions,clean.frameSeq))return clean.frameSeq;
        const actor={...ownerState.actor};if(actor.sourceStatusClock)actor.sourceStatusClock={...actor.sourceStatusClock,frameSeq:actor.sourceStatusClock.frameSeq+ownerFrameBase};
        if(match.ownerStatusVersion!==1){delete actor.sourceStatusClock;delete actor.forceInvincible;}
        latestOwner={...ownerState,actor,frameSeq:clean.frameSeq,hits:[],actions:[]};for(const hit of ownerState.hits)ownerHits.set(hit.id,structuredClone(hit));
        if(ownerHits.size>128){onError(Object.assign(Error('owner-hit-history-overflow'),{fatal:true}));return clean.frameSeq;}}
      if(ownerState&&match.ownerStatusVersion===1&&latestOwner.actor.sourceStatusClock&&[...peers.values()].some(peer=>peer.buffSyncSupported))
        buffMarker=buffSender.capture(encodeOwnedStatus(latestOwner));
      // Relay-only sessions and browsers without RTC have no peer consumer
      // that could acknowledge this separate durable inbox.
      if(ownerState&&Peer&&peerMode==='hybrid'){const actions=[...ownerActions.values()];
        for(const player of match.players)if(player.id!==ctx.localPlayerId&&!disconnectedPlayers.has(player.id)&&player.connected!==false)retainPeerActions(player.id,latestOwner.epoch,actions);
        for(const peer of peers.values())stagePeerActions(peer);}
      const owned=match.ownership===OWNERSHIP_PROTOCOL||latestOwner!==null;
      if(owned){pending.length=0;pending.push(clean);}else if(pending.length<120)pending.push(clean);else{pending.splice(0);pending.push(clean);onError(Error('input-backlog'));}
      // Idle fallback HTTP can send now too. flush keeps one request in
      // flight and applies retry pacing; no extra 0..50 ms interval wait.
      if(owned)void flush();
      // One immutable source sample can feed several recipients. Build the
      // common movement/status wire and bounded owner prefix once per actual
      // capability variant, while retaining each peer's own delta baseline,
      // causal fence, backpressure decision and delivery acknowledgement.
      const payloads=new Map(),motionPayloads=new Map(),statusPayloads=new Map(),ownerReports=new Map();
      for(const p of peers.values())if(activePeer(p)&&rtcAvailable(p)&&p.channel?.readyState==='open'){
        if(p.channel.bufferedAmount>=32768){p.transport.skippedBackpressure++;continue;}
        const control=p.control.performance(),barrier=ownerState?p.control.watermark(latestOwner.epoch):0;
        const binary=networkBinaryEnabled&&control.networkBinaryVersion===NETWORK_BINARY_VERSION;
        const controlBlocked=p.controlChannel&&(!control.negotiated||control.failed||control.degraded||!p.controlFrontierComplete||peerActionLedgers.get(p.id)?.disabled);
        if((match.combatPlaybackVersion===1||match.ownerStatusVersion===1)&&controlBlocked&&(!p.motionSupported||!p.buffSyncSupported)&&clock()-(p.lastSmallCapabilityAt??-Infinity)>=250){
          const text=JSON.stringify({matchId:p.context.id,sequence:clean.frameSeq,packet:clean,motionVersion:1,motionMaxVersion:2,buffSyncVersion:OWNER_BUFF_SYNC_VERSION,
            poseDelta:OWNER_POSE_MASK_VERSION,...(peerGzipEnabled?{codec:peerCodec}:{})});
          if(sendPeer(p,text,encoder.encode(text).length))p.lastSmallCapabilityAt=clock();
        }
        // Tiny current movement bypasses action compression/frontier fences.
        // It has no HP, attack/skill state or full-pose receipt authority.
        if(ownerState&&match.combatPlaybackVersion===1&&p.motionSupported){
          const variant=`${binary}:${p.motionSupportedVersion>=2}`;let wire=motionPayloads.get(variant);
          if(wire)directMetrics.sharedMotionEncodings++;
          else{const value={matchId:p.context.id,sequence:clean.frameSeq,motionVersion:1,motionMaxVersion:2,motionOnly:true,
              motion:encodeOwnedMotion(latestOwner,{held:clean.held,includeReaction:p.motionSupportedVersion>=2})};
            wire=encodeOnlineEnvelope(value,{binary,maximumBytes:peerMaximumBytes});motionPayloads.set(variant,wire);directMetrics.motionEncodings++;}
          if(sendPeer(p,wire.binary??wire.text,wire.bytes,{binary:!!wire.binary}))motionMetrics.sent++;
        }
        pumpBuffSync(p);
        if(ownerState&&match.ownerStatusVersion===1&&latestOwner.actor.sourceStatusClock){
          const marker=latestOwner.actor.sourceStatusClock;
          if(p.lastStatusEpoch!==latestOwner.epoch||p.lastStatusRevision!==marker.revision||clean.frameSeq-(p.lastStatusFrame??-Infinity)>=30){
            // Protection remains small even before a Buff snapshot is ACKed.
            // The receiver applies its protection domain immediately; only
            // Buff materialization waits for the independent reliable repair.
            const compactBuff=p.buffSyncSupported&&buffMarker!==null;
            const variant=`${binary}:${compactBuff}`;let wire=statusPayloads.get(variant);
            if(wire)directMetrics.sharedStatusEncodings++;
            else{const value={matchId:p.context.id,sequence:clean.frameSeq,statusOnly:true,buffSyncVersion:OWNER_BUFF_SYNC_VERSION,motionVersion:1,motionMaxVersion:2,
                ...(compactBuff?{buffStatus:buffSender.compact()}:{status:encodeOwnedStatus(latestOwner)})};
              wire=encodeOnlineEnvelope(value,{binary,maximumBytes:peerMaximumBytes});statusPayloads.set(variant,wire);directMetrics.statusEncodings++;}
            if(wire.bytes<=peerPoseLimit(p)&&sendPeer(p,wire.binary??wire.text,wire.bytes,{binary:!!wire.binary})){p.lastStatusEpoch=latestOwner.epoch;p.lastStatusRevision=marker.revision;p.lastStatusFrame=clean.frameSeq;statusMetrics.sent++;if(compactBuff)buffMetrics.compactSent++;}
          }
        }
        if(controlBlocked)continue;
        const key=control.negotiated&&!control.failed?barrier:'legacy',compact=key!=='legacy'&&p.poseDeltaSupported;
        let wire=compact||binary?null:payloads.get(key);
        if(!wire){let owner=null;
          if(ownerState){const includeActions=key==='legacy';
            if(ownerReports.has(includeActions)){owner=ownerReports.get(includeActions);directMetrics.sharedOwnerPreparations++;}
            else{owner=ownerWire({actions:includeActions,hits:false});ownerReports.set(includeActions,owner);directMetrics.ownerPreparations++;}}
          if(ownerState&&!owner)continue;
          const ownerDelta=owner&&compact?p.poseSender.encode(owner,{acknowledgedEpoch:control.acknowledgedPoseEpoch,acknowledgedFrameSeq:control.acknowledgedPoseFrame,
            version:p.poseDeltaSupported===OWNER_POSE_MASK_VERSION?OWNER_POSE_MASK_VERSION:OWNER_POSE_DELTA_VERSION}):null;
          const value={matchId:p.context.id,sequence:clean.frameSeq,packet:clean,poseDelta:OWNER_POSE_MASK_VERSION,buffSyncVersion:OWNER_BUFF_SYNC_VERSION,motionVersion:1,motionMaxVersion:2,
            ...(peerGzipEnabled?{codec:peerCodec}:{}),...(ownerDelta?{ownerDelta}:owner?{owner}:{}),...(key!=='legacy'?{controlSequence:barrier}:{})};
          wire=encodeOnlineEnvelope(value,{binary,maximumBytes:peerMaximumBytes});if(!compact&&!binary)payloads.set(key,wire);}
        // An initial full owner can exceed SCTP's single-message limit before
        // either end has advertised gzip. Bootstrap only that cold large case
        // with an ordinary input/capability packet, never a pose receipt.
        if(peerGzipEnabled&&!p.codecAdvertised&&wire.bytes>peerPoseLimit(p)){
          const text=JSON.stringify({matchId:p.context.id,sequence:clean.frameSeq,packet:clean,
            poseDelta:OWNER_POSE_MASK_VERSION,codec:peerCodec,buffSyncVersion:OWNER_BUFF_SYNC_VERSION,motionVersion:1,motionMaxVersion:2});
          if(sendPeer(p,text,encoder.encode(text).length)){p.transport.capabilityMessages++;if(!p.gzip)continue;}
        }
        // Advertise support inside an ordinary legacy JSON packet. Both ends
        // must have sent / seen that capability before compressed traffic.
        if(p.gzip&&p.codecAdvertised&&!directPacking?.expired&&wire.bytes<=peerMaximumBytes){
          if(wire.binary&&wire.bytes<=NETWORK_BINARY_COMPRESSION_THRESHOLD)sendPeer(p,wire.binary,wire.bytes,{binary:true});
          else{if(directPending?.has(p.id))directMetrics.coalescedSamples++;
            directPending??=new Map();directPending.set(p.id,{context:ctx,text:wire.text,binary:wire.binary});}
        }else sendPeer(p,wire.binary??wire.text,wire.bytes,{binary:!!wire.binary});
      }
      if(directPending)void packDirect();
      return clean.frameSeq;
    },
    remoteInput(id){return remote.get(id)??{held:[],pressed:[],released:[]};},
    clearMatch(){invalidateMatch();relayDeltas.clear();roomActors.clear();roomActorsMatch=null;},
    connectivity(){const suppressed=new Set(peerReceipts().map(receipt=>receipt.playerId));return [...peers.values()].map(p=>{
      samplePeerRoute(p);const dataChannelOpen=p.channel?.readyState==='open',statsAgeMs=p.statsUpdatedAt===null?null:Math.max(0,clock()-p.statsUpdatedAt);
      const details=dataChannelOpen&&statsAgeMs!==null&&statsAgeMs<=5000?p.route:{route:'unknown',roundTripTimeMs:null};
      const control=p.control.performance(),legacy=p.controlChannel===null,controlChannelOpen=p.controlChannel?.readyState==='open';
      const controlUsable=legacy||controlChannelOpen&&control.negotiated&&!control.failed&&!control.degraded&&p.controlFrontierComplete;
      const dataUsable=dataChannelOpen&&controlUsable,directRoute=dataChannelOpen&&details.route==='direct';
      const unavailableReason=!dataChannelOpen?'pose-channel-closed':legacy?null:!controlChannelOpen?'control-channel-closed':
        control.failed?'control-failed':control.degraded?'control-degraded':!control.negotiated?'control-not-negotiated':!p.controlFrontierComplete?'control-frontier-incomplete':null;
      return {id:p.id,state:p.connection.connectionState,dataChannelOpen,controlChannelOpen,...details,directRoute,direct:directRoute&&dataUsable,
        dataUsable,controlUsable,deliveryMode:legacy?'legacy-pose':'reliable-control-and-pose',unavailableReason,
        relaySuppressionEligible:suppressed.has(p.id),pathArrival:pathDiagnostics(p.id),
        statsStatus:p.statsStatus,statsAgeMs};
    });},
    performance(){
      const receipts=peerReceipts(),suppressed=new Set(receipts.map(receipt=>receipt.playerId));
      const sorted=[...uploadTimes].sort((a,b)=>a-b),at=p=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]:null;
      const socketSorted=[...socketAckTimes].sort((a,b)=>a-b),socketAt=p=>socketSorted.length?socketSorted[Math.min(socketSorted.length-1,Math.ceil(socketSorted.length*p)-1)]:null;
      return {sentPosts,sentBytes,failedPosts,lastPostBytes,postP50Ms:at(.5),postP95Ms:at(.95),samples:uploadTimes.length,
        ownerStatus:{version:match?.ownerStatusVersion??0,...statusMetrics},
        ownerBuffSync:{version:OWNER_BUFF_SYNC_VERSION,...buffMetrics},
        peerBuffs:Object.fromEntries([...peers].map(([id,p])=>[id,{version:p.buffSyncSupported?OWNER_BUFF_SYNC_VERSION:0,
          received:p.buffReceiver.performance(),pendingRequest:p.buffPendingRequest?{...p.buffPendingRequest}:null,
          pendingAck:p.buffPendingAck?{...p.buffPendingAck}:null,acknowledged:p.buffAck?{...p.buffAck}:null}])),
        ownerMotion:{version:1,...motionMetrics},
        combatPlayback:{version:match?.combatPlaybackVersion??0},
        ownerUpload:uploadDeltas.performance(),
        relay:relay?.performance()??null,socketAcknowledgements:acknowledgements.size,socketAckP50Ms:socketAt(.5),socketAckP95Ms:socketAt(.95),
        peerCompression:{...directMetrics,pending:!!directPending,active:!!directPacking,
          compressionAgeMs:directPacking?Math.max(0,clock()-directPacking.startedAt):0},
        controlCompression:{...controlCompressionMetrics,cachedTexts:controlCompressionCache.size,cachedTextBytes:controlCompressionBytes,
          binary:binaryControlCompression.performance()},
        peerActionLedgers:Object.fromEntries([...peerActionLedgers].map(([id,row])=>[id,{epoch:row.epoch,pending:row.actions.size,bytes:row.bytes,disabled:row.disabled,reason:row.reason??null}])),
        signaling:{version:RTC_SIGNAL_VERSION,...signalMetrics,legacyRelayPeers:[...legacySignalPeers],pendingCandidates:[...signalCandidates.values()].reduce((sum,row)=>sum+row.rows.length,0)},
        peerMode,maximumOwnerCredits,disconnectedPlayers:[...disconnectedPlayers],directCheckpointsDeferred,peerRestarts:Object.fromEntries(peerRetries),peerRetryFailures:Object.fromEntries(peerRetryFailures),peerReceipts:receipts,peerControls:Object.fromEntries([...peers].map(([id,p])=>[id,{...p.control.performance(),frontierComplete:p.controlFrontierComplete,stagedCanonicalIds:p.controlStagedIds.size,wire:{...p.controlWire,
          outboundPending:Math.max(0,p.controlOutbound.length-(p.controlEncodeJob?1:0)),outboundRetained:p.controlOutbound.length,inboundPending:p.controlInbound.length,
          sendBlocked:p.controlSendBlocked,bufferedBytes:p.controlChannel?.bufferedAmount??0,
          nativeCompressionPending:!!p.controlNativePending,criticalRawMaximum,criticalCompressionBudgetMs,criticalRawBurstBytes,criticalRawBytesPerSecond,
          encodeAgeMs:p.controlEncodeJob?Math.max(0,clock()-p.controlEncodeJob.startedAt):0,
          decodeAgeMs:p.controlDecodeJob?Math.max(0,clock()-p.controlDecodeJob.startedAt):0,
          oldestOutboundAgeMs:Math.max(0,...[p.controlEncodeJob?.queuedAt,p.controlOutbound[0]?.at].filter(Number.isFinite).map(at=>clock()-at)),
          oldestInboundAgeMs:Math.max(0,...[p.controlDecodeJob?.queuedAt,p.controlInbound[0]?.at].filter(Number.isFinite).map(at=>clock()-at)),
          durationScope:'adapter-codec-wait-excludes-FIFO-and-consumer; bounded-action fallback may leave one nativeCompressionPending job'}}])),
        peerTransports:Object.fromEntries([...peers].map(([id,p])=>[id,{...p.transport,bufferedBytes:p.channel?.bufferedAmount??0,
          codec:p.gzip&&p.codecAdvertised?peerCodec:'json',receiptAgeMs:p.receipt?Math.max(0,clock()-p.receipt.at):null,
          poseDeltaSupported:p.poseDeltaSupported,poseSend:p.poseSender.performance(),poseReceive:p.poseReceiver.performance(),
          pathArrival:pathDiagnostics(id),relaySuppressionEligible:suppressed.has(id)}])),
        remoteSources:Object.fromEntries([...sourceClocks].map(([id,row])=>[id,{epoch:row.epoch,frameSeq:row.frameSeq,samples:row.samples,
          arrivalGapMs:Math.max(0,clock()-row.at),relativeSourceAgeMs:Math.max(0,clock()-row.frameSeq*1000/60-row.minOffset)}])),
        sourceAgeScope:'relative to the lowest observed per-life arrival offset; includes source stalls and network queueing, not absolute one-way delay',
        uploadAgeMs:upload?Math.max(0,clock()-upload.startedAt):0,pendingFrames:pending.length,pendingActions:ownerActions.size,
        pendingActionBytes,ownerFatal,pendingHits:ownerHits.size};
    },
    close:stop,
  };
}
