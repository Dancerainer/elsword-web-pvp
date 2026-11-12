/** Per-pair reliable action stream. Pose watermarks refer to this stream, not
 * source frames. Admission and server receipts share canonical action IDs.
 * Bounded queues fail back to the coordinator rather than discarding events
 * and claiming that they were delivered. No render/input path awaits I/O. */
import {MAX_OWNER_BYTES} from '../../packages/online/owned-state.mjs';
import {PEER_CONTROL_DELTA_VERSION,createPeerControlDelta,canEncodePeerControlDelta} from '../../packages/online/peer-control-delta.mjs';
import {networkJsonByteLength,NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';
export const PEER_CONTROL_VERSION=1;
const maximumBytes=128*1024,fragmentBytes=12000,maximumPackets=32,nativeCredits=8;
const encoder=new TextEncoder(),integer=value=>Number.isSafeInteger(value)&&value>=0;
// Parsed entry is only for a bounded JSON decoder with its actual byte count.
// This additional structure budget prevents a fabricated object/count pair,
// cycles or unsupported values from bypassing the text entry's size boundary.
function boundedJson(value){
  let bytes=0;const seen=new Set(),pending=[{value,depth:0}];
  const stringBytes=text=>{
    let size=2;
    for(let i=0;i<text.length;i++){
      const n=text.charCodeAt(i);
      if(n===34||n===92)size+=2;
      else if(n<32)size+=[8,9,10,12,13].includes(n)?2:6;
      else if(n<128)size++;
      else if(n<2048)size+=2;
      else if(n>=0xd800&&n<=0xdbff&&i+1<text.length&&text.charCodeAt(i+1)>=0xdc00&&text.charCodeAt(i+1)<=0xdfff){size+=4;i++;}
      else size+=n>=0xd800&&n<=0xdfff?6:3;
      if(size>maximumBytes)return size;
    }
    return size;
  };
  while(pending.length){
    const {value:entry,depth}=pending.pop();if(depth>64)return false;
    if(entry===null)bytes+=4;
    else if(typeof entry==='string')bytes+=stringBytes(entry);
    else if(typeof entry==='boolean')bytes+=entry?4:5;
    else if(typeof entry==='number'){if(!Number.isFinite(entry))return false;bytes+=String(entry).length;}
    else if(typeof entry==='object'){
      if(seen.has(entry))return false;seen.add(entry);
      const array=Array.isArray(entry);
      if(!array&&Object.getPrototypeOf(entry)!==Object.prototype&&Object.getPrototypeOf(entry)!==null)return false;
      const keys=Object.keys(entry);if(keys.length>maximumBytes||array&&keys.length!==entry.length)return false;
      bytes+=2+Math.max(0,keys.length-1);
      for(const key of keys){if(!array)bytes+=stringBytes(key)+1;pending.push({value:entry[key],depth:depth+1});}
    }else return false;
    if(bytes>maximumBytes||pending.length>maximumBytes)return false;
  }
  return true;
}
export function createPeerControl({matchId,clock=()=>performance.now(),send=()=>false,
  apply=()=>false,onPose=()=>{},onFault=()=>{},onAcknowledged=()=>{},gzip=false,reliableTransport=false,controlDelta=true,networkBinary=false,sendValue=null}={}){
  let negotiated=false,failed=false,degraded=false,sendingEpoch=null,next=0,receivedEpoch=null,received=0;
  let compressed=false,deltaNegotiated=null,binaryNegotiated=null,receiveBinaryNegotiated=false,admissionBlocked=false;
  const binaryEnabled=networkBinary===true&&reliableTransport===true&&typeof sendValue==='function';
  const deltaEnabled=controlDelta!==false&&reliableTransport===true;
  const sendDelta=createPeerControlDelta(),receiveDelta=createPeerControlDelta();
  let assembly=null,pendingAck=false,degradedBarrier=null,lastHello=-Infinity,lastAck=-Infinity,lastPoseAck=-Infinity,poseFrame=-1,stagedFrame=-1;
  const outgoing=new Map(),incoming=new Map(),known=new Set(),admitted=new Set(),heldPoses=new Map();
  const metrics={sentPackets:0,receivedPackets:0,acknowledgedPackets:0,admittedActions:0,
    fencedPoses:0,releasedPoses:0,fallbacks:0,failures:0,rejected:0,receivedBytes:0,sentBytes:0,mergedActionBatches:0,poseRecoveries:0,
    deltaEncodings:0,deltaReceivedPackets:0,admissionWakes:0};
  const occupiesCredit=row=>row.sent!==-Infinity||(row.progress?.nextPart??0)>0;
  function wire(value,progress=null){
    if(value.type==='actions'&&progress&&deltaNegotiated===true&&!progress.prepared){
      if(progress.deltaWire||canEncodePeerControlDelta(value.report)){
        const report=sendDelta.encode(value.report,{previous:progress.deltaWire});
        progress.deltaWire=report;progress.value={...value,report};delete progress.text;metrics.deltaEncodings++;
      }
      progress.prepared=true;
    }
    const envelope=progress?.value??value;
    if(binaryNegotiated===true&&value.type==='actions'&&!(progress?.nextPart>0)){
      const bytes=networkJsonByteLength(envelope);
      if(bytes>maximumBytes){if(progress?.deltaWire)fault('control-codec-oversize');return false;}
      // null requests legacy fragmentation (SCTP message limit); false is
      // backpressure and must not send the same event through another path.
      const sent=sendValue(envelope,{type:value.type,sequence:value.sequence,epoch:value.report?.epoch,decodedBytes:bytes});
      if(sent!==null){if(sent)metrics.sentBytes+=bytes;return sent;}
    }
    const text=progress?.text??JSON.stringify(envelope),bytes=encoder.encode(text).byteLength;
    if(progress)progress.text=text;
    if(bytes>maximumBytes){if(progress?.deltaWire)fault('control-codec-oversize');return false;}
    if(text.length<=fragmentBytes){if(!send(text,{type:value.type,sequence:value.sequence,epoch:value.report?.epoch??value.epoch}))return false;metrics.sentBytes+=bytes;return true;}
    const parts=Math.ceil(text.length/fragmentBytes);
    for(let part=progress?.nextPart??0;part<parts;part++){
      const payload=JSON.stringify({v:PEER_CONTROL_VERSION,matchId,type:'fragment',epoch:value.report.epoch,
        sequence:value.sequence,part,parts,text:text.slice(part*fragmentBytes,(part+1)*fragmentBytes)});
      if(!send(payload,{type:'fragment',sequence:value.sequence,epoch:value.report.epoch,part,parts}))return false;
      metrics.sentBytes+=encoder.encode(payload).byteLength;if(progress)progress.nextPart=part+1;
    }
    return true;
  }
  function fault(reason){
    if(failed)return;failed=true;negotiated=false;admissionBlocked=false;outgoing.clear();incoming.clear();assembly=null;pendingAck=false;degradedBarrier=null;
    sendDelta.clear();receiveDelta.clear();deltaNegotiated=null;binaryNegotiated=null;
    metrics.failures++;heldPoses.clear();onFault(reason);
  }
  function hello(){
    if(failed||negotiated||clock()-lastHello<500)return;
    // A closed/pressured adapter has not sent anything. In particular, an
    // early pump before onopen must not consume the first live retry interval.
    if(wire({v:PEER_CONTROL_VERSION,matchId,type:'hello',gzip,...(deltaEnabled?{controlDelta:PEER_CONTROL_DELTA_VERSION}:{}),...(binaryEnabled?{networkBinaryVersion:NETWORK_BINARY_VERSION}:{})}))lastHello=clock();
  }
  function stage(report){
    if(failed||!report)return false;
    if(sendingEpoch!==report.epoch){sendingEpoch=report.epoch;next=0;outgoing.clear();known.clear();sendDelta.clear();poseFrame=-1;lastPoseAck=-Infinity;stagedFrame=-1;}
    stagedFrame=Math.max(stagedFrame,report.frameSeq);
    const actions=(report.actions??[]).filter(action=>!known.has(action.id));
    if(!actions.length)return true;
    if(reliableTransport===true){
      const tail=outgoing.get(next);
      if(tail&&!occupiesCredit(tail)&&tail.packet.report.epoch===report.epoch&&tail.packet.report.actions.length+actions.length<=16){
        // Only a wholly unsent tail can change. Accepted fragments and queued
        // SCTP packets already have an immutable identity at the receiver.
        // Every captured actor/effect remains its original canonical sample;
        // the common report is the actual latest source pose, never a rewind.
        const latest=report.frameSeq>=tail.packet.report.frameSeq?report:tail.packet.report;
        const packet={...tail.packet,report:{...latest,effects:[],hits:[],
          actions:[...tail.packet.report.actions,...actions].sort((a,b)=>a.id-b.id)}};
        const text=binaryNegotiated===true?null:JSON.stringify(packet),bytes=text===null?networkJsonByteLength(packet):encoder.encode(text).length;
        // The carrier allows 128KiB; its validated owner tree still retains
        // its existing 96KiB limit. Measure only a tiny null-report header to
        // avoid serializing the captured actor/effect tree a second time.
        const reportBytes=bytes-encoder.encode(JSON.stringify({...packet,report:null})).length+4;
        if(bytes<=maximumBytes&&reportBytes<=MAX_OWNER_BYTES){
          tail.packet=packet;tail.progress.text=text;tail.progress.value=packet;tail.progress.prepared=false;metrics.mergedActionBatches++;
          rememberActions(actions);pump();return !failed;
        }
      }
    }
    const packet={v:PEER_CONTROL_VERSION,matchId,type:'actions',sequence:++next,
      report:{...report,effects:[],hits:[],actions}};
    const text=binaryNegotiated===true?null:JSON.stringify(packet);
    if((text===null?networkJsonByteLength(packet):encoder.encode(text).length)>maximumBytes||outgoing.size>=maximumPackets){fault('control-backlog');return false;}
    rememberActions(actions);
    outgoing.set(next,{packet,created:clock(),sent:-Infinity,progress:reliableTransport===true?{text,value:packet,nextPart:0}:null});pump();return !failed;
  }
  function rememberActions(actions){for(const action of actions)known.add(action.id);while(known.size>256)known.delete(known.values().next().value);}
  function ack(){
    if(receivedEpoch===null)return;
    pendingAck=true;flushAck();
  }
  function flushAck(){
    if(pendingAck&&wire({v:PEER_CONTROL_VERSION,matchId,type:'ack',epoch:receivedEpoch,sequence:received}))pendingAck=false;
  }
  function drain(){
    if(failed)return;
    admissionBlocked=false;
    for(;;){
      const packet=incoming.get(received+1);if(!packet)break;
      if(!packet.decodedReport){
        try{
          packet.decodedReport=packet.report.controlDeltaVersion===undefined?packet.report:receiveDelta.decode(packet.report);
          if(packet.report.controlDeltaVersion!==undefined){
            // Delta wrappers must not amplify a small wire packet beyond the
            // existing full-report admission budget. apply still performs the
            // production schema/reference checks on this reconstructed report.
            if(encoder.encode(JSON.stringify(packet.decodedReport)).length>MAX_OWNER_BYTES)throw Error('control-delta-owner-too-large');
            metrics.deltaReceivedPackets++;
          }
        }catch{fault('control-delta-invalid');return;}
      }
      if(apply(packet.decodedReport)!==true){admissionBlocked=true;break;}
      incoming.delete(packet.sequence);received=packet.sequence;
      for(const action of packet.decodedReport.actions)admitted.add(action.id);
      while(admitted.size>128)admitted.delete(admitted.values().next().value);
      metrics.admittedActions+=packet.decodedReport.actions.length;ack();
    }
    if(degraded&&received>0&&(!degradedBarrier||receivedEpoch===degradedBarrier.epoch&&received>=degradedBarrier.barrier)){
      // Clearing a timed-out visual never weakens its causal frontier. Only
      // admitted control catches it up; negotiation and transport ACKs cannot.
      degraded=false;degradedBarrier=null;metrics.poseRecoveries++;
    }
    let ready=null;
    for(const [barrier,row]of heldPoses)if(row.epoch===receivedEpoch&&barrier<=received){
      if(!ready||barrier>=ready.barrier)ready=row;heldPoses.delete(barrier);
    }
    if(ready){metrics.releasedPoses++;onPose(ready.value);}
  }
  function receive(value){
    try{
      if(failed||!value||value.v!==PEER_CONTROL_VERSION||value.matchId!==matchId)return;
      if(value.type==='hello'){
        negotiated=true;compressed=gzip&&value.gzip===true;deltaNegotiated??=deltaEnabled&&value.controlDelta===PEER_CONTROL_DELTA_VERSION;
        binaryNegotiated??=binaryEnabled&&value.networkBinaryVersion===NETWORK_BINARY_VERSION;
        // Input and control share a negotiated codec, not a failure lifetime.
        // Bytes already sent on the still-live input channel remain decodable
        // after control failure. Capture before pump can synchronously fail.
        receiveBinaryNegotiated ||= binaryNegotiated===true;
        wire({v:PEER_CONTROL_VERSION,matchId,type:'hello-ack',gzip,...(deltaEnabled?{controlDelta:PEER_CONTROL_DELTA_VERSION}:{}),...(binaryEnabled?{networkBinaryVersion:NETWORK_BINARY_VERSION}:{})});pump();return;
      }
      if(value.type==='hello-ack'){negotiated=true;compressed=gzip&&value.gzip===true;deltaNegotiated??=deltaEnabled&&value.controlDelta===PEER_CONTROL_DELTA_VERSION;
        binaryNegotiated??=binaryEnabled&&value.networkBinaryVersion===NETWORK_BINARY_VERSION;
        receiveBinaryNegotiated ||= binaryNegotiated===true;pump();return;}
      if(value.type==='ack'){
        if(value.epoch!==sendingEpoch||!integer(value.sequence)||value.sequence>next)return;
        const actionIds=[];
        for(const [seq,row]of outgoing)if(seq<=value.sequence){outgoing.delete(seq);metrics.acknowledgedPackets++;actionIds.push(...row.packet.report.actions.map(action=>action.id));}
        lastAck=clock();
        if(actionIds.length)onAcknowledged({epoch:value.epoch,actionIds});
        if(reliableTransport===true)pump();
        return;
      }
      if(value.type==='pose-ack'){
        if(value.epoch!==sendingEpoch||!integer(value.frameSeq)||value.frameSeq<=poseFrame||value.frameSeq>stagedFrame)return;
        poseFrame=value.frameSeq;lastPoseAck=clock();return;
      }
      if(value.type==='fragment'){
        if(!integer(value.epoch)||!integer(value.sequence)||!integer(value.part)||!integer(value.parts)
          ||value.parts<2||value.parts>16||value.part>=value.parts||typeof value.text!=='string'||value.text.length>fragmentBytes)throw Error('invalid-control-fragment');
        if(value.part===0)assembly={epoch:value.epoch,sequence:value.sequence,parts:value.parts,text:'',next:0,at:clock()};
        if(!assembly||assembly.epoch!==value.epoch||assembly.sequence!==value.sequence
          ||assembly.parts!==value.parts||assembly.next!==value.part||clock()-assembly.at>1500)throw Error('control-fragment-gap');
        assembly.text+=value.text;assembly.next++;
        if(encoder.encode(assembly.text).length>maximumBytes)throw Error('control-fragment-oversize');
        if(assembly.next===assembly.parts){
          const completed=assembly,parsed=JSON.parse(completed.text);assembly=null;
          if(parsed?.type!=='actions'||parsed.sequence!==completed.sequence||parsed.report?.epoch!==completed.epoch||!boundedJson(parsed))throw Error('control-fragment-identity');
          receive(parsed);
        }return;
      }
      const delta=value.report?.controlDeltaVersion!==undefined;
      const receivedActions=delta?value.report?.actionEvent?.actions:value.report?.actions;
      if(delta&&(deltaNegotiated!==true||value.report.controlDeltaVersion!==PEER_CONTROL_DELTA_VERSION))throw Error('unnegotiated-control-delta');
      if(value.type!=='actions'||!integer(value.sequence)||value.sequence<1||!integer(value.report?.epoch)
        ||!integer(value.report?.frameSeq)||!Array.isArray(receivedActions)||!receivedActions.length||receivedActions.length>16)throw Error('invalid-control-actions');
      const epoch=value.report.epoch;
      if(receivedEpoch!==null&&epoch<receivedEpoch)return;
      if(degradedBarrier&&epoch<degradedBarrier.epoch)return;
      if(epoch!==receivedEpoch){receivedEpoch=epoch;received=0;pendingAck=false;admissionBlocked=false;incoming.clear();admitted.clear();receiveDelta.clear();
        // The initial packet can share the life of a pose that timed out before
        // any control arrived. Preserve that barrier. A genuinely newer life
        // clears the old anchor, but still waits for its first valid admission.
        if(degradedBarrier&&degradedBarrier.epoch!==epoch)degradedBarrier=null;
        for(const [barrier,row]of heldPoses)if(row.epoch!==epoch)heldPoses.delete(barrier);}
      if(value.sequence<=received){ack();return;}
      if(value.sequence>received+maximumPackets||incoming.size>=maximumPackets)throw Error('control-receive-backlog');
      if(!incoming.has(value.sequence)){incoming.set(value.sequence,value);metrics.receivedPackets++;}
      drain();
    }catch{metrics.rejected++;fault('control-invalid');}
  }
  function receiveText(text){
    if(typeof text!=='string'){metrics.rejected++;fault('control-oversize');return;}
    const decodedBytes=encoder.encode(text).length;
    if(decodedBytes>maximumBytes){metrics.rejected++;fault('control-oversize');return;}
    metrics.receivedBytes+=decodedBytes;
    try{receiveBounded(JSON.parse(text));}catch{metrics.rejected++;fault('control-json');}
  }
  function receiveParsed(value,{decodedBytes}={}){
    if(failed)return;
    if(!integer(decodedBytes)||decodedBytes<1||decodedBytes>maximumBytes){metrics.rejected++;fault('control-decoded-size');return;}
    metrics.receivedBytes+=decodedBytes;receiveBounded(value);
  }
  function receiveBounded(value){
    try{
      if(!boundedJson(value)){metrics.rejected++;fault('control-oversize');return;}
      receive(value);
    }catch{metrics.rejected++;fault('control-invalid');}
  }
  function pump(){
    if(failed)return;hello();drain();flushAck();if(!negotiated)return;
    let credits=reliableTransport===true?[...outgoing.values()].filter(occupiesCredit).length:0;
    for(const row of outgoing.values()){
      if(clock()-row.created>1500){fault('control-ack-timeout');return;}
      // SCTP already guarantees reliable ordered delivery after the adapter
      // accepts a queued send. Keep the application ACK/admission deadline,
      // but never add another copy to its compression or transport FIFO.
      if(reliableTransport===true&&row.sent!==-Infinity)continue;
      // An accepted partial fragment already occupies one credit. Its tail
      // must be allowed through even when the window is full; starting a new
      // logical packet would instead add another decoder/ACK job to the FIFO.
      const partial=occupiesCredit(row);
      if(reliableTransport===true&&!partial&&credits>=nativeCredits)continue;
      if(clock()-row.sent<250)continue;
      try{if(!wire(row.packet,row.progress))break;}
      catch{fault('control-codec-invalid');return;}
      if(failed)return;
      if(reliableTransport===true&&!partial)credits++;
      row.sent=clock();metrics.sentPackets++;
    }
    // Stop advertising direct delivery as soon as control becomes unhealthy.
    // The receiver keeps its last valid pose until the server fallback arrives.
    if([...heldPoses.values()].some(row=>clock()-row.at>250)){
      const latest=[...heldPoses.values()].sort((a,b)=>b.epoch-a.epoch||b.barrier-a.barrier)[0];
      degradedBarrier={epoch:latest.epoch,barrier:latest.barrier};degraded=true;heldPoses.clear();metrics.fallbacks++;onFault('control-pose-timeout');
    }
  }
  return {stage,pump,receiveText,receiveParsed,closed(){fault('control-closed');},
    // Called after the real consumer frees space. It neither advances the
    // simulation nor opens additional send credits before true admission.
    resumeAdmission(){if(failed||!admissionBlocked)return false;metrics.admissionWakes++;drain();flushAck();return true;},
    acknowledgePose(epoch,frameSeq){if(negotiated&&!failed&&integer(epoch)&&integer(frameSeq))wire({v:PEER_CONTROL_VERSION,matchId,type:'pose-ack',epoch,frameSeq});},
    fence(value,epoch,barrier){
      if(!integer(barrier)||barrier===0)return false;
      if(failed||degraded)return true;
      if(receivedEpoch===epoch&&received>=barrier)return false;
      const saved=heldPoses.get(barrier);
      heldPoses.set(barrier,{value,epoch,barrier,at:saved?.at??clock()});
      if(heldPoses.size>32)heldPoses.delete(heldPoses.keys().next().value);
      metrics.fencedPoses++;return true;
    },
    watermark(epoch){return negotiated&&!failed&&sendingEpoch===epoch?next:0;},
    receipt(epoch){return negotiated&&!failed&&receivedEpoch===epoch?[...admitted].sort((a,b)=>a-b):[];},
    performance(){return {...metrics,negotiated,compressed,failed,degraded,reliableTransport:reliableTransport===true,
      networkBinaryVersion:binaryNegotiated===true?NETWORK_BINARY_VERSION:0,
      receiveNetworkBinaryVersion:receiveBinaryNegotiated?NETWORK_BINARY_VERSION:0,
      controlDelta:deltaNegotiated===true?PEER_CONTROL_DELTA_VERSION:null,deltaBaselineCount:sendDelta.baselineCount+receiveDelta.baselineCount,
      receivedByteScope:'decoded-control-envelope-utf8-before-fragment-assembly',pendingAck,admissionBlocked,pendingPackets:outgoing.size,pendingReceive:incoming.size,
      degradedBarrier:degradedBarrier?{...degradedBarrier}:null,
      creditLimit:reliableTransport===true?nativeCredits:null,inflightPackets:[...outgoing.values()].filter(occupiesCredit).length,
      pendingUnsentPackets:[...outgoing.values()].filter(row=>!occupiesCredit(row)).length,
      sendSequence:next,receivedSequence:received,lastAckAgeMs:lastAck===-Infinity?null:Math.max(0,clock()-lastAck),
      acknowledgedPoseEpoch:sendingEpoch,acknowledgedPoseFrame:poseFrame,poseAckAgeMs:lastPoseAck===-Infinity?null:Math.max(0,clock()-lastPoseAck),fenced:heldPoses.size>0,pendingPoses:heldPoses.size};},
  };
}
