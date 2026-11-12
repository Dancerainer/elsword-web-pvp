/** Gameplay fixtures over production application clients. Neither an original
 * client capture nor a native WebRTC/SCTP benchmark. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {ApplicationWire} from './network-application-wire-v40.mjs';
import {createProductionPair,describeMeasurementError} from './network-production-client-v51.mjs';
import {singleAttackAudit} from './network-hit-audit-v51.mjs';
import {draw,distribution,stepMs} from './network-fault-model-v38.mjs';
import {makeNativeSimulation,makeKeyboard} from './network-native-fixture-v51.mjs';
import {measureStutter,measureVertical,measureBody} from './network-probe-metrics-v40.mjs';
export const frames=480,drainFrames=240;
const ids=['a','b'],sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const empty={held:[],pressed:[],released:[],sampledDevice:true,pureDouble:[],oneDouble:[]};
const offsetInput=(packet,offset)=>packet?{...packet,edges:(packet.edges??[]).map(edge=>({...edge,time:edge.time+offset/60}))}:empty;
const syncOptions=wire=>({clock:()=>wire.now,combatPlaybackVersion:1,ownerStatusVersion:1,continuousAuraVersion:2});
async function cleanupProbe({pair,syncs,wire,primaryError}){
 const failures=[];try{
  try{pair?.close();}catch(error){failures.push(error);}
  for(const sync of syncs)try{sync.clear();}catch(error){failures.push(error);}
  try{await wire.settle();}catch(error){failures.push(error);}
 }finally{wire.close();}
 if(failures.length){if(primaryError)for(const error of failures)console.error('cleanup-failure',JSON.stringify(describeMeasurementError(error)));
  else throw new AggregateError(failures,'probe-cleanup-failed');}
}
function movement(frame,direction){const f=direction===0?frame:frame-20;
 const key=f>=1&&f<=60?'RIGHT':f>=121&&f<=180?'LEFT':f>=181&&f<=240?'RIGHT':f>=301&&f<=360?'LEFT':f>=361&&f<=420?'RIGHT':null;return key?[key]:[];}
function rfSimulations(version,kind){
 const profile=JSON.parse(readFileSync(resolve(version.root,'packages/combat-core/rf-profile.json')));
 profile.states.TEST_ATTACK={animationName:'Wait',raw:{ANIM_NAME:'Wait',ANIM_SPEED:1,PLAY_TYPE:2,APPLY_ANIM_MOVE:0,
  ATTACK_TIME0:{1:.12,2:.22},DAMAGE_DATA:structuredClone(profile.damageEffects.RAVEN_NASOD_BALL.raw.DAMAGE_DATA)}};
 const map={sceneId:'application-network-v40-rf-synthetic',lines:[{lineId:0,start:[-10000,0,0],end:[10000,0,0],type:'LINE_TYPE.LT_NORMAL'}]};
 return ids.map(owner=>version.simulation.createSimulation({profile,map,networkOwnerId:owner,seed:2016,preset:{passives:[],guildPassives:[]},
  collisionSampler:actor=>[{kind:'sphere',center:[actor.x+30,50,0],radius:30}],
  defenderSampler:actor=>[{kind:'sphere',center:[actor.x,actor.y+50,actor.z],radius:20}],
  actors:ids.map((id,index)=>({id,team:index,position:[index?(kind==='normal-hit'?30:4000):0,0,0],lineId:0,loadout:Array(8).fill(null)}))}));
}
function sample(frame,direction,owner,remote,other,canonicalOther){return {frame,direction,x:owner.x,y:owner.y,observedX:remote.x,observedY:remote.y,
 error:Math.abs(owner.x-remote.x),yError:Math.abs(owner.y-remote.y),sourceVx:owner.vx,sourceVy:owner.vy,observedVx:remote.vx,observedVy:remote.vy,
 sourceGrounded:owner.grounded,observedGrounded:remote.grounded,sourceSerial:owner.stateSerial,observedSerial:remote.stateSerial,
 sourceState:owner.state,observedState:remote.state,sourcePhase:owner.stateTime,observedPhase:remote.stateTime,
 sourceAnimationTime:owner.animationTime,observedAnimationTime:remote.animationTime,observedAnimationLoop:remote.animationLoop,
 observedAnimationTransitionSerial:remote.animationTransitionSerial,sourceHitStop:owner.hitStop??0,observedHitStop:remote.hitStop??0,
 sourceWorldStop:owner.worldStop??0,observedWorldStop:remote.worldStop??0,localOtherX:other.x,localOtherY:other.y,
 sourceGap:Math.abs(owner.x-canonicalOther.x),observedGap:Math.abs(remote.x-other.x)};}
function trajectoryMetrics(samples){
 const freezes=[],recovery=[];
 for(const direction of [0,1]){const rows=samples.filter(row=>row.direction===direction&&row.frame<=frames);let frozen=0,start=null;
  for(let i=1;i<rows.length;i++){
   if(Math.abs(rows[i].x-rows[i-1].x)>.1&&Math.abs(rows[i].observedX-rows[i-1].observedX)<.1){frozen++;start??=rows[i].frame;}
   else if(frozen){freezes.push({direction,start,frames:frozen,ms:frozen*stepMs});frozen=0;start=null;}}
  if(frozen)freezes.push({direction,start,frames:frozen,ms:frozen*stepMs});
  for(const [type,start,end]of [['stop',61,120],['turn',181,240],['stop',241,300],['turn',361,420],['stop',421,480]]){
   const offset=direction?20:0,begins=start+offset,ends=Math.min(end+offset,rows.length);let recovered=null;
   for(let frame=begins;frame<=ends-5;frame++)if(Array.from({length:6},(_,i)=>rows[frame+i-1]).every(row=>row&&row.error<=5&&
    Math.abs((row.observedX-rows[row.frame-2].observedX)-(row.x-rows[row.frame-2].x))<=1)){recovered=(frame-begins)*stepMs;break;}
   recovery.push({direction,type,frame:begins,ms:recovered,censored:recovered===null,windowMs:Math.max(0,ends-begins+1)*stepMs});}
 }
 const rows=samples.filter(row=>row.frame<=frames),extraStop=rows.map(r=>Math.max(0,r.observedHitStop,r.observedWorldStop)-Math.max(0,r.sourceHitStop,r.sourceWorldStop));
 return {ownerTraceSha256:sha(samples.map(r=>[r.frame,r.direction,r.x,r.y,r.sourceState,r.sourceSerial])),
  positionError:distribution(rows.map(r=>r.error)),stutter:measureStutter(samples),vertical:measureVertical(samples),freezes,recovery,
  maximumFreezeMs:Math.max(0,...freezes.map(r=>r.ms)),activeFreezeMs:freezes.reduce((n,r)=>n+r.ms,0),
  stop:{remainingExcessSeconds:distribution(extraStop),positiveExcessFrames:extraStop.filter(v=>v>1e-6).length,
   sourceFreeObserverStoppedFrames:rows.filter(r=>Math.max(r.sourceHitStop,r.sourceWorldStop)<=1e-6&&Math.max(r.observedHitStop,r.observedWorldStop)>1e-6).length}};
}
export async function runPairedProbe(version,{scenario,seed,kind,nativeAssets,calibrated}){
 const nativeKind=['lk-combo','contact'].includes(kind),attackKind=['normal-hit','late-missed-hit'].includes(kind),facing=seed%2?1:-1,
  calibration=calibrated?.[facing],comboOffset=Math.floor(draw(seed,0,9,0,0,1)*90),attackAt=kind==='normal-hit'?1+Math.floor(draw(seed,0,9,0,0,0)*100):1;
 const wire=new ApplicationWire({scenario,seed,lateAttack:kind==='late-missed-hit'});wire.install();let pair,syncs=[],primaryError;
 try{
  const sims=nativeKind?await Promise.all(ids.map(async owner=>makeNativeSimulation(version,await nativeAssets.isolated(version),{owner,facing,gap:kind==='contact'?240:85}))):rfSimulations(version,kind);
  for(const sim of sims){for(const actor of sim.state.actors){actor.inputLock=0;sim.enter(actor,'RSI_WAIT','fixture');}sim.drainEvents();}
  if(kind==='late-missed-hit')for(const sim of sims)sim.actor('b').hp=1;
  syncs=ids.map(()=>version.ownership.createLocalOwnershipSync(syncOptions(wire)));
  pair=await createProductionPair({version,wire,sims,syncs});
  const samples=[],inputTrace=[],eventTrace=[],settled=[],reportedHits=new Map(),emissions=[],keyboards=ids.map(()=>makeKeyboard()),previousHeld=[[],[]];
  const initialHp=sims[1].actor('b').hp,total=attackKind?480:frames+drainFrames;
  for(let frame=1;frame<=total;frame++){
   await pair.advance(frame*stepMs);
   if(attackKind&&frame===attackAt){sims[0].enter(sims[0].actor('a'),'TEST_ATTACK','fixture-generated-attack');
    Object.assign(sims[0].actor('a'),{animationPlaybackSpeed:1,animationSpeedRamp:null});}
   if(kind==='late-missed-hit'&&frame===24)sims[1].actor('b').x=30;
   for(let i=0;i<2;i++){
    const sim=sims[i],sync=syncs[i],held=kind==='movement'&&frame<=frames?movement(frame,i):[],prior=previousHeld[i];previousHeld[i]=held;
    let input={held,pressed:held.filter(k=>!prior.includes(k)),released:prior.filter(k=>!held.includes(k))};
    if(kind==='lk-combo')input=i===0?offsetInput(calibration.inputs[frame-comboOffset-1],comboOffset):empty;
    if(kind==='contact'){const forward=facing>0?'RIGHT':'LEFT',back=facing>0?'LEFT':'RIGHT';
     input=keyboards[i](i===0?(frame<=180?[forward]:frame>=241&&frame<=360?[back]:[]):(frame>=91&&frame<=210?[forward]:frame>=301&&frame<=420?[back]:[]),frame);}
    inputTrace.push([frame,i,input]);sync.beforeStep(sim,ids[i]);pair.endpoints[ids[i]].client.notifyOwnerCapacity?.();sim.step(1/60,{...sync.remoteInputs(sim,ids[i]),[ids[i]]:input},{snapshot:false});
    const events=sim.drainEvents();for(const event of events){
     if(event.type==='hit'&&event.targetId===ids[i])settled.push({frame,owner:ids[i],eventId:event.eventId,damage:event.amount,sourceState:sim.actor(event.actorId)?.state,targetState:sim.actor(event.targetId)?.state});
     if(nativeKind&&['hit','stateChanged','landed'].includes(event.type))eventTrace.push({frame,localOwner:ids[i],...event});}
    const report=sync.afterStep(sim,ids[i],events,input);if(report){
     for(const hit of report.hits)reportedHits.set(ids[i]+':'+hit.id,{...hit,owner:ids[i]});
     emissions.push([i,frame,report.actions.map(a=>a.id)]);await pair.send(i,input,report);}
   }
   for(let direction=0;direction<2;direction++)samples.push(sample(frame,direction,sims[direction].actor(ids[direction]),sims[1-direction].actor(ids[direction]),
    sims[1-direction].actor(ids[1-direction]),sims[1-direction].actor(ids[1-direction])));
  }
  await pair.advance((total+180)*stepMs); // Queue flush only; does not fabricate additional gameplay frames.
  const transport=pair.report(),diagnostics=syncs.map(s=>s.combatPlaybackDiagnostics.receiver),endHp=sims[1].actor('b').hp,observedHp=sims[0].actor('b').hp;
  const integrity={attackAt,initialHp,endHp,observedHp,hpDelta:initialHp-endHp,localHits:settled.filter(r=>r.owner==='b'),
   duplicateHitIds:settled.length-new Set(settled.map(r=>r.owner+':'+r.eventId)).size,reportedHitCount:reportedHits.size,
   allSettledHitsReported:settled.every(r=>reportedHits.has(r.owner+':'+r.eventId)),observerMatchesOwnerHp:observedHp===endHp,
   coordinatorHits:transport.server.hits.length,
   coordinatorDuplicateHits:transport.server.canonicalHitAudit.duplicateIds.reduce((count,row)=>count+row.count-1,0),
   coordinatorCanonicalMappingComplete:transport.server.canonicalHitAudit.mappingComplete,
   singleAttack:singleAttackAudit({kind,initialHp,endHp,hits:settled.filter(r=>r.owner==='b')})};
  if(transport.errors.length)throw Error('production-client-or-driver-error:'+JSON.stringify(transport.errors));
  return {kind,integrity,comboOffset,inputSha256:sha(inputTrace),controllerEmissionSha256:sha(emissions),...trajectoryMetrics(samples),
   ...(nativeKind?{body:measureBody(samples,nativeAssets.profile.body)}:{}),diagnostics,transport,wirePackets:wire.packets,trace:samples,events:eventTrace};
 }catch(error){primaryError=error;console.error('primary-probe-failure',JSON.stringify({kind,seed,version:version.id,scenario:scenario.id,message:error.message}));throw error;
 }finally{await cleanupProbe({pair,syncs,wire,primaryError});}
}
export async function canonicalReactionSource(baseline,{seed,nativeAssets,calibrated}){
 const facing=seed%2?1:-1,calibration=calibrated[facing],offset=Math.floor(draw(seed,0,9,0,0,1)*90),
  sim=makeNativeSimulation(baseline,await nativeAssets.isolated(baseline),{facing,observer:true}),snapshot=sim.snapshot(),producer=baseline.playback.createCombatPlaybackProducer({version:1}),
  statusClock=baseline.statusClock.createOwnerStatusClock(),rows=[];let lastReport=0;
 for(let frame=1;frame<=frames+drainFrames;frame++){
  const input=offsetInput(calibration.inputs[frame-offset-1],offset);producer.beforeStep(sim,'b');sim.step(1/60,{a:input},{snapshot:false});const events=sim.drainEvents();
  const projection=statusClock.encode(baseline.ownedState.encodeOwnedStatusSource(sim.actor('b')),1,frame);
  let report=null;const getReport=()=>{if(!report){report=baseline.ownedState.encodeOwnedState(sim,'b',{epoch:1,frameSeq:frame});
   Object.assign(report.actor,projection.actor);}return report;};
  const action=producer.capture(sim,'b',{epoch:1,frameSeq:frame,events,held:[],getReport});
  if(action||frame-lastReport>=6){report=getReport();report.actions=action?[action]:[];
   report.hits=events.filter(e=>e.type==='hit'&&e.targetId==='b').map(e=>({id:e.eventId,attackerId:e.actorId,damage:e.amount}));lastReport=frame;}else report=null;
  rows.push({frame,report,actor:structuredClone(sim.actor('b')),input,hits:events.filter(e=>e.type==='hit')});
 }
 producer.clear();if(rows.flatMap(r=>r.hits).length!==3)throw Error('canonical-native-LK-source-must-have-three-real-hits');
 return {snapshot,rows,offset,facing,inputSha256:sha(rows.map(r=>r.input)),controllerEmissionSha256:sha(rows.filter(r=>r.report).map(r=>[r.frame,r.report.actions.map(a=>a.id)]))};
}
export async function runReplayProbe(version,{scenario,seed,nativeAssets,source}){
 const wire=new ApplicationWire({scenario,seed});wire.install();let pair,syncs=[],primaryError;
 try{
  const sims=await Promise.all(['b','observer'].map(async owner=>makeNativeSimulation(version,await nativeAssets.isolated(version),{owner,facing:source.facing,observer:true})));
  syncs=sims.map(()=>version.ownership.createLocalOwnershipSync(syncOptions(wire)));
  pair=await createProductionPair({version,wire,sims,syncs,ids:['b','observer']});const samples=[];
  for(const row of source.rows){await pair.advance(row.frame*stepMs);
   // Confirmed owner recording, same source actor/actions/cadence for both receivers.
   Object.assign(sims[0].actor('b'),structuredClone(row.actor));if(row.report)await pair.send(0,empty,structuredClone(row.report));
   syncs[1].beforeStep(sims[1],'observer');pair.endpoints.observer.client.notifyOwnerCapacity?.();
   try{sims[1].step(1/60,{...syncs[1].remoteInputs(sims[1],'observer'),observer:empty},{snapshot:false});}
   catch(error){error.message+='; replay frame='+row.frame+' actors='+JSON.stringify(sims[1].state.actors.map(a=>({id:a.id,state:a.state,animationTime:a.animationTime,
    stateTime:a.stateTime,forceInvincible:a.forceInvincible,animationPlaybackSpeed:a.animationPlaybackSpeed,hitStop:a.hitStop,worldStop:a.worldStop})));throw error;}
   const events=sims[1].drainEvents(),report=syncs[1].afterStep(sims[1],'observer',events,empty);if(report)await pair.send(1,empty,report);
   samples.push(sample(row.frame,1,row.actor,sims[1].actor('b'),sims[1].actor('observer'),sims[0].actor('observer')));
  }
  await pair.advance((frames+drainFrames+180)*stepMs);const transport=pair.report();
  if(transport.errors.length)throw Error('canonical-client-or-driver-error:'+JSON.stringify(transport.errors));
  return {kind:'lk-replay',inputSha256:source.inputSha256,controllerEmissionSha256:source.controllerEmissionSha256,fixedSourceCadenceFrames:6,
   comboOffset:source.offset,...trajectoryMetrics(samples),diagnostics:syncs[1].combatPlaybackDiagnostics.receiver,transport,wirePackets:wire.packets,trace:samples,
   canonicalHits:source.rows.flatMap(row=>row.hits.map(hit=>({frame:row.frame,...hit}))),canonicalSourceEndHp:source.rows.at(-1).actor.hp,
   observedEndHp:sims[1].actor('b').hp,observerMatchesOwnerHp:source.rows.at(-1).actor.hp===sims[1].actor('b').hp};
 }catch(error){primaryError=error;console.error('primary-probe-failure',JSON.stringify({kind:'lk-replay',seed,version:version.id,scenario:scenario.id,message:error.message}));throw error;
 }finally{await cleanupProbe({pair,syncs,wire,primaryError});}
}
