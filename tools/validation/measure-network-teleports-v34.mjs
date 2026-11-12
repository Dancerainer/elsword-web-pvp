/** Deterministic fault injection around the production peer codec, control
 * admission and ownership sync, with positive-dt Native combat on Garpai.
 * These are current simulation measurements, not original-client/WAN proof.
 * Reliable-channel loss is retransmission/HOL delay, never silent event loss.
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadPlaybackNativeAssets,playbackNativeOwner,nativeDt} from './measure-combat-playback-v12.mjs';
import {createPeerControl} from '../../apps/web/online-peer-control.mjs';
import {createOwnerPoseDelta} from '../../packages/online/owner-pose-delta.mjs';
import {validateOwnedState} from '../../packages/online/owned-state.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {createSampledKeyboardBuffer} from '../../apps/web/sampled-keyboard.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),copy=structuredClone;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]:0;
const scenarios=[
  {name:'stall-1300',oneWayMs:40,jitterMs:30,loss:.01,spikeMs:1300,spikeStartFrame:85,spikeEndFrame:170},
  {name:'spike-300',oneWayMs:40,jitterMs:10,loss:.01,spikeMs:300},
  {name:'spike-650',oneWayMs:40,jitterMs:30,loss:.01,spikeMs:650},
  {name:'lan',oneWayMs:0,jitterMs:0,loss:0},
  {name:'fixed-rtt-80',oneWayMs:40,jitterMs:0,loss:0},
  {name:'fixed-rtt-160',oneWayMs:80,jitterMs:0,loss:0},
  {name:'jitter-rtt-80',oneWayMs:40,jitterMs:30,loss:0},
  {name:'jitter-loss-1pct',oneWayMs:40,jitterMs:30,loss:.01},
];
function desired(id,frame,workload){
  if(workload==='platform'){
    if(id!=='source')return [];
    if([40,240].includes(frame))return ['UP'];
    if(frame>=120&&frame<123)return ['DOWN'];
    if(frame>=300&&frame<340)return ['RIGHT'];
    if(frame>=380&&frame<420)return ['LEFT'];
    return [];
  }
  if(workload==='air-command'){
    if(id!=='source')return [];
    const f=(frame-40)%180;
    if(frame<40||frame>=400)return [];
    const held=f<65&&f!==1?['RIGHT']:f>=90&&f<155&&f!==91?['LEFT']:[];
    if(f===10||f===100)held.push('UP');
    if(f===15||f===105)held.push('X');
    return held;
  }
  if(workload==='dash'){
    if(id!=='source')return [];
    const f=(frame-40)%180;
    if(frame<40||frame>=400)return [];
    if(f>=0&&f<65&&f!==1)return ['RIGHT'];
    if(f>=90&&f<155&&f!==91)return ['LEFT'];
    return [];
  }
  if(workload==='engage'){
    const f=(frame-40)%240,inward=id==='source'?'RIGHT':'LEFT',outward=id==='source'?'LEFT':'RIGHT';
    if(frame<40||frame>=450)return [];
    if(f>=0&&f<38&&f!==1)return [inward];
    if(f>=140&&f<180&&f!==141)return [outward];
    const attack=id==='source'?[42,60,78,104]:[50,68,86,120];
    return attack.includes(f)?['X']:[];
  }
  // A reproducible unmodified RF close-range Z sequence from both owners.
  // The second participant starts later, so a missing hit reaction is visible.
  const attacks=id==='source'?[40,58,76,180,198,216,320,338,356]:[110,128,146,250,268,286,390,408,426];
  return attacks.includes(frame)?['Z']:[];
}
export async function measureTeleportScenario(assets,scenario,{workload='dash',frames=540,seed=20161014,controlHeaders=false}={}){
  let now=0,serial=0,rng=seed>>>0;
  const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/4294967296;};
  const queue=[],lastDelivery=new Map(),faults=[],wire={messages:0,bytes:0,unreliableDropped:0,reliableRetransmitted:0,delivered:0,maxPending:0,poseBaselineMisses:0};
  const contexts=['source','target'].map(id=>playbackNativeOwner(assets,id,{clock:()=>now}));
  for(const ctx of contexts){
    ctx.corrections=[];ctx.keyboard=createSampledKeyboardBuffer();ctx.held=new Set();ctx.hits=[];ctx.positions=[];ctx.reports=0;ctx.actions=0;
    for(const actor of ctx.sim.state.actors){
      const x=actor.id==='source'?(['dash','platform','air-command'].includes(workload)?-1000:workload==='engage'?-350:-40):actor.id==='target'?(['dash','platform','air-command'].includes(workload)?1400:workload==='engage'?350:40):actor.id==='buddy'?-2300:2300;
      const y=workload==='platform'&&actor.id==='source'?3320:3080,lineId=y===3320?3:2,positionX=workload==='platform'&&actor.id==='source'?-1250:x;
      Object.assign(actor,{x:positionX,y,z:0,lineId,lastTouchLineId:lineId,grounded:true,vx:0,vy:0,vz:0,landPosition:[positionX,y,0],
        inputLock:0,forceInvincible:0,pvpPresentation:null,mp:actor.mpMax});
      actor.facing=actor.team===0?1:-1;ctx.sim.enter(actor,'RSI_WAIT','explicit-original-map-fault-fixture');
    }
    ctx.sim.drainEvents();
  }
  function send(channel,kind,value,deliver,{reliable=false,hops=1}={}){
    const text=JSON.stringify(value);wire.messages++;wire.bytes+=Buffer.byteLength(text);
    let delay=Math.max(0,scenario.oneWayMs+(random()*2-1)*scenario.jitterMs)*hops;
    if(random()<scenario.loss){if(!reliable){wire.unreliableDropped++;return true;}
      wire.reliableRetransmitted++;delay+=Math.max(80,scenario.oneWayMs*2);}
    if(scenario.spikeMs&&now>=(scenario.spikeStartFrame??110)*1000/60&&now<(scenario.spikeEndFrame??145)*1000/60)delay+=scenario.spikeMs;
    let due=now+delay;
    if(reliable){due=Math.max(due,lastDelivery.get(channel)??0);lastDelivery.set(channel,due);}
    queue.push({due,serial:serial++,kind,text,deliver});wire.maxPending=Math.max(wire.maxPending,queue.length);return true;
  }
  function deliver(){
    let count=0;
    for(;;){queue.sort((a,b)=>a.due-b.due||a.serial-b.serial);if(!queue.length||queue[0].due>now+1e-6)break;
      assert.ok(++count<10000,'bounded ACK delivery');const next=queue.shift();wire.delivered++;next.deliver(JSON.parse(next.text));}
  }
  const routes=contexts.map((from,index)=>({from,to:contexts[1-index],poseSend:createOwnerPoseDelta(),poseReceive:createOwnerPoseDelta(),statusRevision:null}));
  function applyPose(route,{pose,candidate}){
    const result=route.to.sync.receivePeerResult(route.to.sim,route.from.id,pose,route.to.id);
    assert.equal(result.validated,true,'actual production pose admission');candidate.commit();route.receiver.acknowledgePose(pose.epoch,pose.frameSeq);
  }
  for(const route of routes){
    const incoming=routes.find(value=>value.to===route.from);
    route.control=createPeerControl({matchId:'experience-v33',clock:()=>now,reliableTransport:true,controlDelta:true,
      send:(text,metadata)=>send(route.from.id+':control',metadata.type,JSON.parse(text),value=>route.receiver.receiveParsed(value,{decodedBytes:Buffer.byteLength(JSON.stringify(value))}),{reliable:true}),
      apply:value=>{const report=validateOwnedState(value),accepted=incoming.to.sync.receiveActions(incoming.from.id,report.actions??[],report.epoch,report.frameSeq);
        if(accepted&&controlHeaders)assert.equal(incoming.to.sync.receivePeerResult(incoming.to.sim,incoming.from.id,report,incoming.to.id).validated,true);
        return accepted;},
      onPose:proposal=>applyPose(incoming,proposal),onFault:reason=>faults.push({at:now,from:route.from.id,reason})});
  }
  for(const route of routes)route.receiver=routes.find(other=>other.from===route.to).control;
  for(const route of routes)route.control.pump();deliver();
  const startHp=contexts.map(ctx=>ctx.sim.actor(ctx.id).hp),trace=[],inputs=[];
  try{
    for(let frame=1;frame<=frames;frame++){
      now=frame*1000/60;deliver();for(const route of routes)route.control.pump();deliver();
      const produced=[];
      for(const ctx of contexts){
        const held=new Set(desired(ctx.id,frame,workload));
        for(const key of ctx.held)if(!held.has(key))ctx.keyboard.up(key,now);
        for(const key of held)if(!ctx.held.has(key))ctx.keyboard.down(key,now);
        ctx.held=held;const input=ctx.keyboard.consume(now,nativeDt);inputs.push({frame,id:ctx.id,input});
        const others=ctx.sim.state.actors.filter(a=>a.id!==ctx.id).map(a=>({id:a.id,x:a.x,y:a.y,state:a.state,serial:a.stateSerial,time:a.stateTime}));
        ctx.sync.beforeStep(ctx.sim,ctx.id);
        for(const before of others){const a=ctx.sim.actor(before.id);ctx.corrections.push({frame,id:a.id,dx:a.x-before.x,dy:a.y-before.y,
          before,after:{x:a.x,y:a.y,state:a.state,serial:a.stateSerial,time:a.stateTime}});}
        const result=ctx.step(input,{prepared:true});
        for(const event of result.events)if(event.type==='hit'&&event.targetId===ctx.id&&event.amount>0)
          ctx.hits.push({frame,eventId:event.eventId,attacker:event.actorId,damage:event.amount});
        const actor=ctx.sim.actor(ctx.id);ctx.positions.push({frame,x:actor.x,y:actor.y,state:actor.state,stateSerial:actor.stateSerial,lineId:actor.lineId,hp:actor.hp});
        if(result.report){ctx.reports++;ctx.actions+=result.report.actions.length;produced.push({ctx,report:result.report});}
      }
      for(const {ctx,report}of produced){
        const route=routes.find(value=>value.from===ctx);
        route.control.stage({...report,hits:[]});
        // The authenticated server relay is modelled as two reliable hops;
        // its ownership receiver is production code, its HTTP/worker is not.
        send(ctx.id+':relay','relay',report,value=>route.to.sync.receivePeer(route.to.sim,ctx.id,value,route.to.id),{reliable:true,hops:2});
        const marker=report.actor.sourceStatusClock;
        if(marker&&route.statusRevision!==marker.revision){route.statusRevision=marker.revision;
          send(ctx.id+':status','status',encodeOwnedStatus(report),value=>route.to.sync.receiveStatus(route.to.sim,ctx.id,value,route.to.id),{reliable:true});}
        const pose={...report,hits:[],actions:[]};delete pose.actionFrontierComplete;
        const peer=route.control.performance();
        const packet={ownerDelta:route.poseSend.encode(pose,{acknowledgedEpoch:peer.acknowledgedPoseEpoch,acknowledgedFrameSeq:peer.acknowledgedPoseFrame??-1}),controlSequence:route.control.watermark(report.epoch)};
        send(ctx.id+':pose','pose',packet,value=>{
          let candidate;try{candidate=route.poseReceive.decode(value.ownerDelta);}catch(error){
            if(['pose-delta-baseline-required','invalid-pose-delta-base'].includes(error.message)){wire.poseBaselineMisses++;return;}throw error;
          }
          const proposal={pose:candidate.report,candidate};
          if(!route.receiver.fence(proposal,proposal.pose.epoch,value.controlSequence))applyPose(route,proposal);
        });
      }
      deliver();
      const row={frame};for(const ctx of contexts){const other=contexts.find(value=>value!==ctx),own=ctx.sim.actor(ctx.id),remote=other.sim.actor(ctx.id);
        row[ctx.id]={ownerX:own.x,observedX:remote.x,error:Math.abs(own.x-remote.x),ownerHp:own.hp,observedHp:remote.hp,
          ownerState:own.state,observedState:remote.state,ownerY:own.y,observedY:remote.y,ownerSerial:own.stateSerial,observedSerial:remote.stateSerial,ownerTime:own.stateTime,observedTime:remote.stateTime,ownerLine:own.lineId,observedLine:remote.lineId,pending:other.sync.combatPlaybackDiagnostics.receiver?.pending??null};}
      trace.push(row);
      for(const route of routes){const state=route.control.performance();assert.ok(state.inflightPackets<=8&&state.pendingPackets<=32,'real peer queue bounds');}
    }
    const owners=contexts.map((ctx,index)=>{
      const other=contexts.find(value=>value!==ctx),own=ctx.sim.actor(ctx.id),remote=other.sim.actor(ctx.id),samples=trace.map(row=>row[ctx.id]);
      let contrarySteps=0;const steadyVelocityErrors=[];for(let i=3;i<samples.length;i++){
        const a=samples[i-1],b=samples[i],sourceDelta=b.ownerX-a.ownerX,remoteDelta=b.observedX-a.observedX;
        const steady=Math.sign(sourceDelta)===Math.sign(samples[i-1].ownerX-samples[i-2].ownerX)&&Math.sign(sourceDelta)===Math.sign(samples[i-2].ownerX-samples[i-3].ownerX);
        if(steady&&Math.abs(sourceDelta)>1&&sourceDelta*remoteDelta<-.5)contrarySteps++;
        if(i>=15&&Math.abs(sourceDelta)>1&&Array.from({length:15},(_,k)=>Math.abs(samples[i-k].ownerX-samples[i-k-1].ownerX-sourceDelta)).every(value=>value<.02))
          steadyVelocityErrors.push(Math.abs(remoteDelta-sourceDelta));
      }
      return {id:ctx.id,reports:ctx.reports,actions:ctx.actions,damageTaken:startHp[index]-own.hp,hitCount:ctx.hits.length,hits:ctx.hits,
        final:{ownerX:own.x,observedX:remote.x,error:Math.abs(own.x-remote.x),ownerHp:own.hp,observedHp:remote.hp,ownerState:own.state,observedState:remote.state,ownerY:own.y,observedY:remote.y,ownerLine:own.lineId,observedLine:remote.lineId},
        positionErrorP95:percentile(samples.map(row=>row.error),.95),contrarySteps,
        corrections:other.corrections.filter(x=>x.id===ctx.id&&(Math.abs(x.dx)>.001||Math.abs(x.dy)>.001)),
        lineTransitions:ctx.positions.filter((p,i,all)=>i&&p.lineId!==all[i-1].lineId).map(p=>({frame:p.frame,lineId:p.lineId})),
        maximumCorrection:Math.max(0,...other.corrections.filter(x=>x.id===ctx.id).map(x=>Math.hypot(x.dx,x.dy))),
        steadyVelocityErrorP95:percentile(steadyVelocityErrors,.95),steadyVelocitySamples:steadyVelocityErrors.length,receiver:other.sync.combatPlaybackDiagnostics,
        control:routes.find(value=>value.from===ctx).control.performance()};
    });
    return {scenario,workload,frames,seed,controlHeaders,inputSha256:sha(JSON.stringify(inputs)),wire,faults,owners,trace};
  }finally{for(const ctx of contexts)ctx.clear();}
}
export async function measureNetworkTeleports({assetRoot,only,workload,frames=540,controlHeaders=false}={}){
  const assets=await loadPlaybackNativeAssets({assetRoot}),rows=[];
  for(const scenario of scenarios.filter(value=>!only||value.name===only))for(const kind of workload?[workload]:['dash','air-command','platform'])
    rows.push(await measureTeleportScenario(assets,scenario,{workload:kind,frames,controlHeaders}));
  const files=['apps/web/game.mjs','apps/web/input-prediction.mjs','apps/web/online-client.mjs','apps/web/remote-combat-playback.mjs','apps/web/online-peer-control.mjs','packages/online/combat-playback.mjs',
    'tools/validation/measure-network-teleports-v34.mjs'];
  return {schemaVersion:1,createdAt:new Date().toISOString(),evidenceType:'current-simulation',
    limitations:['Deterministic application transport; no actual SCTP/UDP/TCP or WAN. Reliable packet loss represented by retry delay and ordered head-of-line blocking.',
      'Original Native runtime/pose/map used; no original-client gameplay capture. Server relay timing is modelled, not a worker/HTTP capacity test.',
      'Raw owner reports are staged without the full browser HTTP coalescing queue. Real coalesced relay behavior is tested separately; this matrix is not a relay capacity benchmark.',
      'Status changes use a reliable model here; production also uses repeated unordered status packets. Loss results cover action/pose playback, not full status-channel reliability.',
      'Transport counters are JSON application bytes; not a compressed network bandwidth measurement.'],
    sourceHashes:Object.fromEntries(files.map(file=>[file,sha(readFileSync(resolve(root,file)))])),assetHashes:assets.seals,rows};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=resolve(process.argv[2]??'runtime/network-teleports-v34.json');mkdirSync(dirname(output),{recursive:true});
  const report=await measureNetworkTeleports({assetRoot:process.argv[3],only:process.argv[4]||undefined,workload:process.argv[5]||undefined,frames:Number(process.argv[6]||540),controlHeaders:process.env.RF_QA_CONTROL_HEADERS==='1'});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,rows:report.rows.map(({scenario,workload,owners,faults,wire})=>({scenario:scenario.name,workload,faults:faults.length,wire,
    owners:owners.map(({id,hitCount,damageTaken,final,positionErrorP95,contrarySteps,maximumCorrection})=>({id,hitCount,damageTaken,final,positionErrorP95,contrarySteps,maximumCorrection}))}))}));
}
