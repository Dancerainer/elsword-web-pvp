import {replaceActorStopProjection} from '../../packages/combat-core/source-stop-queues-v53.mjs';
import {applyOwnedState,encodeOwnedState,receiveOverheatNotice} from '../../packages/online/owned-state.mjs';
import {initializeArcStartMesh} from '../../packages/combat-core/archenemy-mesh.mjs';
import {commitAddSkillResources} from '../../packages/combat-core/add-systems.mjs';
import {validateOwnedMotion,PASSIVE_REACTION_STATES,PASSIVE_LOCOMOTION_STATES} from '../../packages/online/owned-motion.mjs';
import {nativeBodyOverlap,nativeBodyPassBlocked} from '../../packages/combat-core/reaction-policy.mjs';
import {receiveForceFingerResourceNumbers} from '../../packages/online/force-finger-resource-numbers-v49.mjs';
import {restoredOwnedBuffDisplay,isCurrentOwnedBuffDisplay} from '../../packages/online/owned-buff-display.mjs';
import {sourceSoundEventMetadata} from '../../packages/combat-core/source-sound-event-v45.mjs';

/** Receiver-local playback, never a zero-dt historical collision executor.
 * Source order supplies relative scheduling, not permission to fast-forward
 * animation, move the local owner, or settle an earlier contact. */
const copy=value=>structuredClone(value),integer=n=>Number.isSafeInteger(n)&&n>=0;
const keys=new Set(['LEFT','RIGHT','UP','DOWN','Z','X','AWAKEN','Q','W','E','R','A','S','D','C','SPECIAL']);
const excluded=new Set(['id','ownerId','networkId','networkEpoch','networkFrameSeq','definition','damage','templateFields',
  'elapsed','setElapsed','animationTime','animationBeforeTime','phaseTime','attackElapsed','delayElapsed','age',
  'nowLifeTime','meshLifetimeElapsed','nowAnimationTime','animationResetTime','cooldown','start','setStartAnimation','setStartState','x','y','z','position','currentAnchor','birthAnchor',
  'sourceDamageAnchor','sourcePosedAnchor','sourceAddSummonPose','matrix','matrixQueue','rotation',
  'sourceArcController','sourceArcPose','sourceArcStartController','sourceArcGlobalTime','sourceArcGlobalTimeBefore','sourceArcMeshAnimationTime',
  'sourceMeshGlobalTime','sourceSinglePlayMeshEndPending','sourceXCrashMeshEndPending','sourceArcStartEndPending',
  'sourceArcMeshPosition','sourceShadowMesh','sourceFollowLine','sourceShadowMeshPending',
  'sourceAddMaximumStrikeOrbit','unlockRemaining','manualDirDegree','useManualDir','hasManual','previousHitCount','previousHits','historySnapshot',
  'globalTime','followBeforePosition','followEndPending',
  'hits','hitGaps','sourceHitMemory2016','hitCount','childCounts','soundFired','active','dead','endEmitted','combatRetired']);
const recoverableMotionStates=new Set(['RSI_WAIT','ESSI_SWORD_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END',
  'RSI_JUMP_READY','RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_JUMP_LANDING','RSI_DASH_JUMP','RSI_DASH_JUMP_LANDING','RSI_DASH_JUMP_POWER_LANDING']);
const actorControls=['sourceArcEnemy','sourceMegaDrill','sourceMegaDrillNowSupported','sourceWildCharge','sourceXCrash',
  'sourceLordKnight','sourceRuneSlayer','sourceInfinitySword','sourceBladeMaster','sourceVeteranCommander',
  'sourceElesisSkills','sourceElesisCommand','sourceAddCombat','sourceAddMovement','sourceAddSummon'];
const actorRuntimeFields=new Set(['time','stateTime','remaining','cooldowns','waitInterval','loopTime','chivalryTime','lightningTime',
  'commandChargeTime','charge','sourceChargeEquivalent','afterFull','previousHp','attacks','currentAttack']);
const arcDamageNames=new Set(['RAVEN_OVER_TAKER_ARC_ENEMY','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO','RAVEN_OVER_TAKER_FLYING_IMPACT',
  'RAVEN_OVER_TAKER_ARC_ENEMY_HYPER','RAVEN_OVER_TAKER_ARC_ENEMY_MEMO_HYPER','RAVEN_OVER_TAKER_FLYING_IMPACT_HYPER']);
const runtimeActorControl=key=>actorRuntimeFields.has(key)||/(?:Cooldown|Remaining|Elapsed)$/.test(key);
const ended=effect=>effect.dead===true||effect.endEmitted===true||effect.combatRetired===true||effect.sourceContinuousAura?.phase==='ended';
const passiveIdentity=value=>value&&PASSIVE_REACTION_STATES.includes(value.state)?JSON.stringify([value.stateSerial,value.state,value.animationName]):null;
const stopIdentity=value=>value&&(PASSIVE_REACTION_STATES.includes(value.state)||PASSIVE_LOCOMOTION_STATES.includes(value.state))
  &&integer(value.stateSerial)&&typeof value.animationName==='string'?JSON.stringify([value.stateSerial,value.state,value.animationName]):null;
function mergeControls(current,source){
  if(source===null||typeof source!=='object')return copy(source);
  if(Array.isArray(source))return source.map((value,index)=>{
    const list=Array.isArray(current)?current:[],identity=value&&typeof value==='object'&&Object.hasOwn(value,'handle')?'handle':
      value&&typeof value==='object'&&Object.hasOwn(value,'id')?'id':null;
    const previous=identity?list.find(row=>row?.[identity]===value[identity]):list[index];
    return mergeControls(previous,value);
  });
  const result=current&&typeof current==='object'&&!Array.isArray(current)?{...current}:{};
  for(const [key,value]of Object.entries(source))if(!excluded.has(key))result[key]=mergeControls(result[key],value);
  return result;
}
function marker(action){
  const value=action?.playback;
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>['version','start','held'].includes(key))
    &&value.version===1&&typeof value.start==='boolean'&&(value.held===undefined||Array.isArray(value.held)&&value.held.length<=16
      &&new Set(value.held).size===value.held.length&&value.held.every(key=>keys.has(key)))&&!action.targetViews;
}

export function createRemoteCombatPlayback({clock=()=>performance.now(),maxQueued=96,maxEventsPerStep=8,maxQueueMs=1000,
  maxSourceLagFrames=60,maxTombstones=1024,positionBlend=.35,maxJitterFrames=3,maxAdditionalAgeMs=250,motionBlend=.65,
  maxMotionExtrapolationFrames=6,maxMotionSilenceFrames=15,experimentalEvolvedMotionContinuation=false}={}){
  if(!integer(maxQueued)||maxQueued<1||!integer(maxEventsPerStep)||maxEventsPerStep<1||!Number.isFinite(maxQueueMs)||maxQueueMs<=0
    ||!integer(maxSourceLagFrames)||!integer(maxTombstones)||maxTombstones<1||!integer(maxJitterFrames)||!(positionBlend>0&&positionBlend<=1)
    ||!Number.isFinite(maxAdditionalAgeMs)||maxAdditionalAgeMs<=0||!(motionBlend>0&&motionBlend<=1)
    ||!integer(maxMotionExtrapolationFrames)||maxMotionExtrapolationFrames>12
    ||!integer(maxMotionSilenceFrames)||maxMotionSilenceFrames<1||maxMotionSilenceFrames>120
    ||typeof experimentalEvolvedMotionContinuation!=='boolean')throw new RangeError('invalid-playback-bounds');
  const owners=new Map(),bindings=new Map();let simulation=null,localId=null,epochFor=()=>0,localFrame=0,nextOwner=null;
  const metrics={admitted:0,duplicates:0,rejected:0,staleLife:0,lateOrder:0,expired:0,overflowed:0,played:0,starts:0,
    births:0,claimedBirths:0,controls:0,ends:0,naturalEnds:0,lateBirthsRejected:0,rebasedStarts:0,adoptedStarts:0,
    calibratedPoses:0,unmatchedPoses:0,positionCorrectionDistance:0,maxSchedulingDelayFrames:0,phaseMismatches:0,invalidatedCorrections:0,motionRecoveries:0,
    budgetRotations:0,expiredAdditionalAge:0,expiredWitnessedStarts:0,maxObservedActionAgeMs:0,maxPlayedActionAgeMs:0,
    motionReceived:0,motionStale:0,motionApplied:0,motionCorrectionDistance:0,expiredBirthsRetired:0,
    motionProjected:0,maxMotionProjectionFrames:0,motionClockRebases:0,reactionCheckpoints:0,reactionSuperseded:0,
    motionCrossingRecovered:0,airMotionProjected:0,locomotionCheckpoints:0,terminalOnlyRetired:0,retiredPassiveMotion:0,reopenedPassiveStop:0,
    staleControlMotionPreserved:0};
  function row(id,epoch){
    let value=owners.get(id);if(value&&epoch<value.epoch)return null;
    if(!value||value.epoch!==epoch){reset(id,epoch);value=owners.get(id);}return value;
  }
  function rememberTerminal(owner,id){
    owner.nativeArcClaims.delete(id);
    owner.tombstones.add(id);while(owner.tombstones.size>maxTombstones){
      const oldest=owner.tombstones.values().next().value;owner.tombstones.delete(oldest);
      // Source effect IDs increase within a life. A bounded exact set must not
      // forget an old retirement and permit the same birth to replay later.
      // Existing live entries remain usable below this unknown-birth floor.
      owner.retiredThrough=Math.max(owner.retiredThrough,oldest);
    }
  }
  const birthRetired=(owner,id)=>owner.tombstones.has(id)||id<=owner.retiredThrough;
  function parentLocalId(owner,id){
    if(!integer(id))return undefined;
    return owner.effects.get(id)?.effect?.id??owner.links.get(id)??
      owner.predicted.find(entry=>entry.effect.networkId===id&&entry.effect.networkEpoch===owner.epoch)?.effect.id;
  }
  function closeNetworkEffect(effect,reason){
    if(!effect||effect.dead)return false;
    // A network terminal closes identity; it cannot run a delayed death attack.
    // Locally reached natural deaths retain their normal Native child callback.
    effect.dead=true;effect.suppressSecondaryDamage=true;effect.endReason=reason;return true;
  }
  function retireOwner(owner){
    for(const entry of owner.effects.values())closeNetworkEffect(entry.effect,'playback-life-ended');
    for(const entry of owner.predicted)closeNetworkEffect(entry.effect,'playback-life-ended');
  }
  function reset(id,epoch=0){
    if(typeof id!=='string'||!id||!integer(epoch))return false;
    const previous=owners.get(id);if(previous&&epoch<previous.epoch)return false;if(previous){retireOwner(previous);const actor=simulation?.actor?.(id)??simulation?.state?.actors?.find(a=>a.id===id);if(actor){replaceActorStopProjection(actor,'hitStop',0);replaceActorStopProjection(actor,'worldStop',0);}}
    owners.set(id,{id,epoch,queue:[],seen:new Set(),effects:new Map(),links:new Map(),predicted:[],nativeArcClaims:new Set(),tombstones:new Set(),retiredThrough:0,droppedControllers:new Set(),
      latestFrame:-1,sourceWitnessAt:null,expiredStartThroughFrame:-1,playedFrame:-1,controller:null,sourceBase:null,localBase:null,minOffset:null,held:[],pose:null,
      motion:null,motionPending:null,motionCorrection:[0,0,0],motionAppliedFrame:-1,motionMinOffset:null,motionReceivedLocalFrame:null,
      motionReceivedAt:null,motionAppliedAt:null,motionReceiveGapMaxMs:0,motionAdmissionToApplyMaxMs:0,
      largestNetworkStep:null,
      reactionFrame:-1,reactionSerial:-1,passiveStops:null,stopZeros:new Map(),stopMotion:null,motionCrossing:null,motionFrame:-1,confirmedPassive:null,retiredPassive:new Set(),passiveDeparture:null,
      poses:[],positions:new Map(),headers:new Map(),correction:[0,0,0],correctionController:null,correctionAnimation:null,correctionVelocity:[0,0,0],needsRecovery:false,recovery:null,phaseOffset:0,phaseController:null,phaseAnimation:null,stops:{}});return true;
  }
  function trackCreated(effect){
    if(effect?.ownerId===localId)return;const owner=owners.get(effect?.ownerId);if(!owner)return;
    owner.predicted.push({effect,claimed:false,ended:false});
    // Unclaimed births are bounded just like the receive dictionary. Retired
    // entries keep their slot long enough to reject a late canonical birth.
    while(owner.predicted.length>maxTombstones)owner.predicted.shift();
  }
  let installingBirth=false;
  function bind(sim,local,life=epochFor){
    simulation=sim;localId=local;epochFor=life;
    owners.delete(local);
    if(!bindings.has(sim)){
      const original=sim.createEffect,wrapped=function(...args){
        const [actor,definition,options]=args,owner=owners.get(actor?.id);
        if(!installingBirth&&actor?.id!==localId&&actor?.skillId===24008&&arcDamageNames.has(definition?.NAME)&&!options?.setName&&owner){
          // The canonical spear may have arrived before a paused receiver's
          // matching Native allocation. Adopt that complete local instance
          // once, instead of creating an orphan second set of four spears.
          const existing=[...owner.effects.values()].map(row=>row.effect).filter(effect=>!ended(effect)
            &&effect.name===definition.NAME&&effect.ownerStateSerial===actor.stateSerial&&effect.sourceArcHandle
            &&!owner.nativeArcClaims.has(effect.networkId)).sort((a,b)=>a.sourceArcHandle-b.sourceArcHandle)[0];
          if(existing){owner.nativeArcClaims.add(existing.networkId);metrics.claimedBirths++;return existing;}
        }
        const effect=original.apply(this,args);trackCreated(effect);return effect;
      };
      if(typeof original==='function'){sim.createEffect=wrapped;bindings.set(sim,{original,wrapped});}
    }
    for(const actor of sim.state.actors)if(actor.id!==local){const epoch=life(actor.id);if(integer(epoch))row(actor.id,epoch);}
  }
  function advanceStartExpiry(owner,now){
    if(owner.sourceWitnessAt===null)return;
    const frame=owner.latestFrame,elapsed=Math.max(0,now-owner.sourceWitnessAt);
    // Only already witnessed source frames can expire. Never extrapolate
    // future source ticks through a sender pause, nor translate peer clocks.
    const expired=sourceFrame=>(frame-sourceFrame)*1000/60+elapsed>maxAdditionalAgeMs;
    let through=Math.min(frame,Math.max(-1,Math.ceil(frame-(maxAdditionalAgeMs-elapsed)*60/1000)-1));
    // Check the original strict comparison around floating-point boundaries;
    // do not turn exactly 250ms into expiration with an arbitrary epsilon.
    while(through>=0&&!expired(through))through--;
    while(through<frame&&expired(through+1))through++;
    owner.expiredStartThroughFrame=Math.max(owner.expiredStartThroughFrame,through);
  }
  function witnessSource(owner,frameSeq,now){
    // Preserve old expiration evidence before a newer frame resets receipt
    // time. Duplicate/older envelopes cannot make an old Start young again.
    advanceStartExpiry(owner,now);
    if(frameSeq>owner.latestFrame){owner.latestFrame=frameSeq;owner.sourceWitnessAt=now;}
  }
  function observeSource(id,epoch,frameSeq){
    if(id===localId||!integer(epoch)||!integer(frameSeq))return false;
    const owner=row(id,epoch);if(!owner)return false;witnessSource(owner,frameSeq,clock());
    if(owner.sourceBase!==null)owner.minOffset=Math.min(owner.minOffset,localFrame+1-frameSeq);return true;
  }
  function receiveActions(id,actions,epoch,frameSeq){
    if(id===localId||!integer(epoch)||!integer(frameSeq)||!Array.isArray(actions)||actions.length>16
      ||actions.some(action=>!marker(action)||!integer(action.id)||!integer(action.frameSeq)||action.frameSeq>frameSeq
        ||!action.actor||!Array.isArray(action.effects))){metrics.rejected++;return false;}
    const owner=row(id,epoch);if(!owner){metrics.staleLife++;return true;}witnessSource(owner,frameSeq,clock());
    if(owner.sourceBase!==null)owner.minOffset=Math.min(owner.minOffset,localFrame+1-frameSeq);
    let admitted=true;
    for(const action of actions){
      // A reliable zero is source generation evidence even when its old pose
      // is superseded, expired, or behind the played frontier. Receipt never
      // mutates the actor or replays any part of that action.
      rememberStopZeros(owner,action);
      if(owner.seen.has(action.id)||owner.queue.some(item=>item.action.id===action.id)){metrics.duplicates++;continue;}
      if(action.frameSeq<owner.playedFrame){metrics.lateOrder++;owner.seen.add(action.id);continue;}
      const pending=[...owners.values()].reduce((sum,value)=>sum+value.queue.length,0);
      if(pending>=maxQueued){metrics.overflowed++;admitted=false;continue;}
      owner.queue.push({action:copy(action),at:clock()});metrics.admitted++;
    }
    owner.queue.sort((a,b)=>a.action.frameSeq-b.action.frameSeq||a.action.id-b.action.id);return admitted;
  }
  function observeMotion(sim,id,value,local=localId){
    if(sim)bind(sim,local,epochFor);
    if(id===localId||value?.epoch!==epochFor(id))return false;
    const actor=sim?.state.actors.find(row=>row.id===id);
    if(!actor||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected)return false;
    const motion=validateOwnedMotion(value,sim.map),owner=row(id,motion.epoch);
    if(!owner)return false;
    retireDepartedPassive(owner,actor);
    if(motion.frameSeq<owner.playedFrame||motion.frameSeq<=owner.motionFrame||owner.pose&&motion.frameSeq<owner.pose.frameSeq){metrics.motionStale++;return false;}
    owner.motionFrame=motion.frameSeq;
    if(owner.retiredPassive.has(passiveIdentity(motion.reaction))&&!reopenPassiveStop(owner,actor,motion)){
      observeSource(id,motion.epoch,motion.frameSeq);metrics.retiredPassiveMotion++;return false;
    }
    // This separate mapping measures only extra delay relative to the fastest
    // observed motion delivery. It neither estimates absolute one-way latency
    // nor borrows a StateStart's local phase. Use positive simulation steps,
    // not unrelated wall clocks. A long source pause resets the mapping.
    const offset=localFrame-motion.frameSeq;
    if(owner.motion&&localFrame-owner.motionReceivedLocalFrame-(motion.frameSeq-owner.motion.frameSeq)>30){
      owner.motionMinOffset=offset;metrics.motionClockRebases++;
    }else owner.motionMinOffset=Math.min(owner.motionMinOffset??offset,offset);
    owner.motionReceivedLocalFrame=localFrame;
    observeSource(id,motion.epoch,motion.frameSeq);
    const receivedAt=clock();
    if(owner.motionReceivedAt!==null)owner.motionReceiveGapMaxMs=Math.max(owner.motionReceiveGapMaxMs,receivedAt-owner.motionReceivedAt);
    owner.motionReceivedAt=receivedAt;
    owner.motion=motion;owner.motionPending=motion;metrics.motionReceived++;return true;
  }
  function acceptHeld(owner,held,frameSeq,{expired=false}={}){
    if(!held)return;
    const movement=key=>['LEFT','RIGHT','UP','DOWN'].includes(key),motion=owner.motion;
    owner.held=expired?held.filter(movement):[...held];
    if(motion?.movementHeld&&motion.frameSeq>frameSeq)owner.held=[...owner.held.filter(key=>!movement(key)),...motion.movementHeld];
  }
  function observeState(sim,id,report,local=localId){
    if(sim)bind(sim,local,epochFor);
    if(!report?.actor||!observeSource(id,report.epoch,report.frameSeq))return false;
    const owner=owners.get(id),actor=sim?.state.actors.find(value=>value.id===id);
    if(actor&&owner.epoch===epochFor(id))receiveForceFingerResourceNumbers(sim,actor,report.epoch,report.actor.sourceForceFingerResourceNumbers,{frameSeq:report.frameSeq});
    // Older senders omit reaction intents from their action samples. Their
    // exact full header is a bounded fallback; new actions are self-contained
    // so merged relay envelopes cannot replace an earlier reaction's intent.
    owner.headers.set(report.frameSeq,Object.fromEntries(['hitStop','worldStop','vz','lastAttackerFront','downForce','flyCount','presentationTransition','animationSpeedRamp']
      .filter(key=>report.actor[key]!==undefined).map(key=>[key,copy(report.actor[key])])));
    while(owner.headers.size>maxSourceLagFrames+4)owner.headers.delete(owner.headers.keys().next().value);
    if(owner.epoch===epochFor(id)&&actor&&(!owner.pose||report.frameSeq>owner.pose.frameSeq)){
      for(const key of ['hp','mp'])if(Number.isFinite(report.actor[key])&&report.actor[key]>=0)actor[key]=report.actor[key];
      if(actor.sourceAdd&&report.actor.sourceAdd)for(const key of ['dp','mutation'])
        if(Number.isFinite(report.actor.sourceAdd[key])&&report.actor.sourceAdd[key]>=0)actor.sourceAdd[key]=report.actor.sourceAdd[key];
    }
    if(owner.epoch===epochFor(id)&&(actor?.hp<=0||actor?.pvpDead||actor?.pvpDisconnected)){owner.queue.length=0;owner.held=[];retireOwner(owner);return true;}
    if(owner.pose&&report.frameSeq<=owner.pose.frameSeq)return true;
    owner.recovery={frameSeq:report.frameSeq,actor:copy(report.actor)};
    owner.pose={frameSeq:report.frameSeq,stateSerial:report.actor.stateSerial,stateTime:report.actor.stateTime,animationName:report.actor.animationName,
      position:['x','y','z'].map(key=>report.actor[key])};
    owner.poses.push(owner.pose);while(owner.poses.length>32)owner.poses.shift();return true;
  }
  function applyController(sim,actor,owner,action){
    const captured={...owner.headers.get(action.frameSeq),...action.actor},profile=sim.profileFor?.(actor)??sim.profile;
    if(!profile.states?.[captured.state]||!integer(captured.stateSerial)){metrics.rejected++;return false;}
    // A normal Native transition can reach this exact phase before its source
    // start arrives. Its life was checked by beforeStep; equal controller and
    // animation identities plus equal cast intent prove this is the running
    // phase, rather than a same-name recast. Do not replay StateStart or erase
    // its already spent events/contacts and independent animation clock.
    if(actor.state===captured.state&&actor.stateSerial===captured.stateSerial
      &&actor.animationName===captured.animationName
      &&actor.skillId===captured.skillId
      &&JSON.stringify(actor.skillContext)===JSON.stringify(captured.skillContext)){
      // This exact controller has already played beyond the captured start.
      // Register its source stop identity without replaying its initial freeze;
      // later controls with a genuinely new deadline remain eligible below.
      applyPassiveStops(actor,owner,captured,action.frameSeq,0,
        Number.isFinite(captured.stateTime)&&actor.stateTime>captured.stateTime+1e-7);
      owner.controller=captured.stateSerial;owner.needsRecovery=false;confirmPassive(owner,captured,actor);metrics.adoptedStarts++;return true;
    }
    // Context is an intent header; clocks, source fired fields, guards and
    // recorded positions are deliberately excluded from controller admission.
    for(const key of ['skillId','skillContext','skillScale','facing','vx','vy','vz','passiveSpeed',
      'lastAttackerFront','downForce','flyCount'])if(captured[key]!==undefined)actor[key]=copy(captured[key]);
    // Ground support is a cache of this receiver's world position. Importing
    // another phase's line/land point without its position lets Native physics
    // project this actor to a different platform. Only airborne intent travels;
    // support/landing are resolved against the real local map on positive dt.
    if(captured.grounded===false){actor.grounded=false;actor.lineId=null;}
    if(actor.awakening&&captured.awakening)for(const key of ['pendingOrbs','pendingAvailableOrbs','reawakening'])
      if(captured.awakening[key]!==undefined)actor.awakening[key]=copy(captured.awakening[key]);
    applyLogicalAdd(sim,actor,captured);
    // BM's accepted-hit passive sets this cooldown before entering Shadow
    // Step with no equipped slot key. The observer does not run that victim
    // hit callback, so the admitted activation must carry its prerequisite.
    // Only this new passive start installs the remaining cooldown; duplicate
    // starts, later controls and successor phases keep its local countdown.
    if(profile.target?.unitClass===106&&captured.state==='RSI_SI_A_RF_SHADOW_STEP'
      &&captured.skillId===24217&&captured.skillContext?.key===null
      &&actor.passivePolicy?.bladeMaster?.escapeChance>0&&actor.sourceBladeMaster
      &&Number.isFinite(captured.sourceBladeMaster?.escapeCooldown)&&captured.sourceBladeMaster.escapeCooldown>0)
      actor.sourceBladeMaster.escapeCooldown=captured.sourceBladeMaster.escapeCooldown;
    actor.stateSerial=captured.stateSerial-1;
    sim.enter(actor,captured.state,'network-current-playback');
    // Hit reaction velocity is assigned by DamageReact before StateStart.
    // Admission must carry that intent too: the observer does not execute the
    // victim's damage pipeline and cannot derive a launch from a state name.
    // Captured stop timers belong only to this new remote controller.
    for(const key of ['vx','vy','vz','passiveSpeed','lastAttackerFront','downForce','flyCount'])
      if(captured[key]!==undefined)actor[key]=copy(captured[key]);
    if(!applyPassiveStops(actor,owner,captured,action.frameSeq)){
      owner.passiveStops=null;
      for(const key of ['hitStop','worldStop'])if(Number.isFinite(captured[key])){replaceActorStopProjection(actor,key,Math.max(0,captured[key]));owner.stops[key]=captured[key]>0;}
    }
    owner.controller=captured.stateSerial;owner.needsRecovery=false;metrics.starts++;
    invalidateCorrection(owner);owner.phaseOffset=0;owner.phaseController=actor.stateSerial;owner.phaseAnimation=actor.animationName;
    owner.positions.clear();rememberPosition(owner,actor,localFrame*2);
    if(captured.animationPlaybackSpeed!==undefined)actor.animationPlaybackSpeed=captured.animationPlaybackSpeed;
    // DamageReact uses direct ChangeAnim(false); ordinary enter's zero-speed
    // blend adds another transition delay to a confirmed reaction. Restore
    // the source's initial transition policy while keeping all elapsed time
    // local and preserving the receiver's own outgoing pose.
    if(captured.presentationTransition&&actor.presentationTransition)
      actor.presentationTransition.enabled=captured.presentationTransition.enabled;
    if(captured.animationSpeedRamp!==undefined)actor.animationSpeedRamp=captured.animationSpeedRamp===null?null:
      {...copy(captured.animationSpeedRamp),elapsedSeconds:0};
    confirmPassive(owner,captured,actor);
    return true;
  }
  function confirmPassive(owner,source,actor){
    // Once a source controller is actually confirmed, an older locally
    // predicted departure is no longer eligible for STOP-only restoration.
    owner.passiveDeparture=null;
    const identity=passiveIdentity(source);
    if(identity){
      if(owner.confirmedPassive&&owner.confirmedPassive.identity!==identity)owner.retiredPassive.add(owner.confirmedPassive.identity);
      while(owner.retiredPassive.size>64)owner.retiredPassive.delete(owner.retiredPassive.values().next().value);
      owner.confirmedPassive={identity,localSerial:actor.stateSerial,state:actor.state,animationName:actor.animationName};
    }
  }
  function retireDepartedPassive(owner,actor){
    const known=owner.confirmedPassive;
    if(known&&(actor.stateSerial!==known.localSerial||actor.state!==known.state||actor.animationName!==known.animationName)){
      // Retire only a source-confirmed controller. Native's predicted serials
      // cannot be used as a global source floor: a later real hit may use one.
      owner.passiveDeparture=owner.passiveStops?.identity===known.identity?
        {identity:known.identity,stops:copy(owner.passiveStops)}:null;
      owner.retiredPassive.add(known.identity);owner.confirmedPassive=null;
      while(owner.retiredPassive.size>64)owner.retiredPassive.delete(owner.retiredPassive.values().next().value);
    }
    if(owner.motion&&owner.retiredPassive.has(passiveIdentity(owner.motion.reaction))){
      owner.motion=null;owner.motionPending=null;owner.motionCorrection=[0,0,0];owner.motionCrossing=null;metrics.retiredPassiveMotion++;
    }
  }
  function reopenPassiveStop(owner,actor,motion){
    const departure=owner.passiveDeparture,reaction=motion.reaction,identity=passiveIdentity(reaction),previous=departure?.stops;
    if(!departure||departure.identity!==identity||!PASSIVE_REACTION_STATES.includes(actor.state)
      ||motion.frameSeq<=previous.frameSeq||motion.frameSeq<=owner.reactionFrame||reaction.stateSerial<owner.reactionSerial
      ||owner.motion?.reaction&&passiveIdentity(owner.motion.reaction)!==identity&&owner.motion.frameSeq>previous.frameSeq
      ||owner.recovery&&owner.recovery.frameSeq>previous.frameSeq&&passiveIdentity(owner.recovery.actor)!==identity)return false;
    // A fresh frame alone is not permission to rewind a naturally completed
    // UP/landing phase. Require source evidence of zero -> positive STOP,
    // either the last confirmed sample or a reliable intervening cancel.
    // A positive countdown (even with a changed deadline) stays retired.
    // The six-frame geometry projection budget is not a freshness budget.
    // Reject a STOP already spent during measured extra delivery delay, even
    // though the eventual physics projection itself remains strictly bounded.
    const offset=localFrame-motion.frameSeq,minOffset=Math.min(owner.motionMinOffset??offset,offset),
      age=Math.max(0,offset-minOffset)/60;
    const newStop=['hitStop','worldStop'].some(key=>reaction[key]>age+1e-7
      &&(previous.origins?.[key]===null&&previous[key]<=previous.frameSeq+1e-6
        ||stopEdgeAfterOrigin(owner,previous,key,motion.frameSeq)));
    if(!newStop)return false;
    owner.retiredPassive.delete(identity);owner.passiveDeparture=null;metrics.reopenedPassiveStop++;return true;
  }
  function applyLogicalAdd(sim,actor,source){
    const state=source.sourceAdd;if(!actor.sourceAdd||!state)return;
    for(const key of ['formation','formationPending','dp','mutation'])if(state[key]!==undefined)actor.sourceAdd[key]=copy(state[key]);
    const proposed=state.generator;if(proposed===undefined)return;
    if(proposed===null){actor.sourceAdd.generator=null;return;}
    const current=actor.sourceAdd.generator;
    if(current&&current.skillId===proposed.skillId&&current.generation===proposed.generation){current.phase=proposed.phase;return;}
    // The original select/switch consumer supplies30/45s locally. Run its
    // resource branch only in a detached foreign shell; no source countdown,
    // mutation award, or DP price can alter this browser's owner.
    const shell=copy(actor),skill=sim.skill(proposed.skillId,actor);if(!skill)return;
    commitAddSkillResources(shell,skill,{skillId:skill.skillId,formation:shell.sourceAdd.formation,
      mode:current?'generator-switch':'generator-select',dpCost:0,mutationCost:0,mpCost:0},{profile:sim.profileFor?.(actor)??sim.profile});
    actor.sourceAdd.generator={...shell.sourceAdd.generator,generation:proposed.generation,phase:proposed.phase};
  }
  function definitionBone(sim,actor,state){
    const profile=state.sourceProfessionId?sim.profiles?.[state.sourceProfessionId]:sim.profileFor?.(actor)??sim.profile;
    return profile?.effectSets?.[state.setName]?.raw?.[state.definitionMember]?.BONE_NAME;
  }
  function predictedBirth(sim,actor,owner,state){
    const bone=definitionBone(sim,actor,state),parent=parentLocalId(owner,state.parentEffectId);
    return owner.predicted.find(entry=>!entry.claimed&&entry.effect.networkId===undefined&&entry.effect.ownerStateSerial===state.ownerStateSerial
      &&entry.effect.name===state.name&&entry.effect.setName===state.setName
      &&(bone===undefined||entry.effect.definition?.BONE_NAME===bone)
      &&(state.parentEffectId==null||parent!==undefined&&entry.effect.parentEffectId===parent));
  }
  function claimPredicted(sim,owner,state,frameSeq,predicted){
    predicted.claimed=true;
    if(predicted.ended||predicted.effect.dead||!sim.state.effects.includes(predicted.effect)){
      rememberTerminal(owner,state.id);metrics.lateBirthsRejected++;return null;
    }
    Object.assign(predicted.effect,{networkId:state.id,networkEpoch:owner.epoch,networkFrameSeq:frameSeq});
    if(state.sourceArcHandle)owner.nativeArcClaims.add(state.id);
    metrics.claimedBirths++;return predicted.effect;
  }
  function registerEffect(owner,state,effect,frameSeq){
    const entry={effect,lastFrame:frameSeq};owner.effects.set(state.id,entry);
    owner.links.set(state.id,effect.id);while(owner.links.size>maxTombstones)owner.links.delete(owner.links.keys().next().value);
    return entry;
  }
  function retireEffectState(sim,actor,owner,state){
    // A duplicate terminal cannot claim the next same-name prediction. A live
    // canonical object below the compacted retirement frontier still closes.
    if(!owner.effects.has(state.id)&&birthRetired(owner,state.id))return;
    rememberTerminal(owner,state.id);
    // A late terminal can belong to an earlier application of the same Buff.
    // It retires its wire identity, not the current status-owned particle.
    // Damage/controller effects never enter this narrow display-only branch.
    if(!owner.effects.has(state.id)&&restoredOwnedBuffDisplay(sim,actor,state))return;
    const predicted=owner.effects.has(state.id)?null:predictedBirth(sim,actor,owner,state),
      effect=owner.effects.get(state.id)?.effect??predicted?.effect;
    if(predicted){predicted.claimed=true;Object.assign(effect,{networkId:state.id,networkEpoch:owner.epoch});
      owner.links.set(state.id,effect.id);while(owner.links.size>maxTombstones)owner.links.delete(owner.links.keys().next().value);}
    if(!isCurrentOwnedBuffDisplay(actor,effect)&&closeNetworkEffect(effect,'network-playback-ended'))metrics.ends++;
    // The object keeps its accepted hit ledger; only its future lifetime ends.
    owner.effects.delete(state.id);
  }
  function createBirth(sim,actor,owner,state,frameSeq){
    if(birthRetired(owner,state.id)){metrics.lateBirthsRejected++;return null;}
    const restored=restoredOwnedBuffDisplay(sim,actor,state);
    if(restored){
      const predicted=owner.predicted.find(entry=>entry.effect===restored);if(predicted)predicted.claimed=true;
      Object.assign(restored,{networkId:state.id,networkEpoch:owner.epoch,networkFrameSeq:frameSeq});
      metrics.claimedBirths++;return restored;
    }
    const predicted=predictedBirth(sim,actor,owner,state);
    if(predicted){
      return claimPredicted(sim,owner,state,frameSeq,predicted);
    }
    if(owner.droppedControllers.has(state.ownerStateSerial)){rememberTerminal(owner,state.id);metrics.lateBirthsRejected++;return null;}
    // Reuse the complete validated definition/instance decoder in an isolated
    // current actor shell. It never substitutes a past pose or executes damage.
    const actors=sim.state.actors,index=actors.indexOf(actor),originalEffects=sim.state.effects;
    const temp=copy(actor),birth=copy(state);delete birth.sourceAddSummonPose;
    delete birth.sourceAddMaximumStrikeOrbit;
    const effectProfile=state.sourceProfessionId?sim.profiles?.[state.sourceProfessionId]:sim.profileFor?.(actor)??sim.profile;
    const unlock=effectProfile?.damageEffects?.[state.name]?.raw?.LOCK_ON_DATA?.TIME_UNLOCK_FROM_START??0;
    if(birth.sourceAddMarkedDrone)birth.sourceAddMarkedDrone={...birth.sourceAddMarkedDrone,unlockRemaining:unlock};
    if(birth.sourceBlazeWingLockOn)birth.sourceBlazeWingLockOn={...birth.sourceBlazeWingLockOn,unlockRemaining:unlock,previousHitCount:0,
      useManualDir:false,manualDirDegree:[0,actor.facing<0?180:0,0],historySnapshot:[]};
    if(birth.sourceAddProjectile)birth.sourceAddProjectile={...birth.sourceAddProjectile,delay:unlock,previousHits:0,
      hasManual:false,manualDirDegree:[0,actor.facing<0?180:0,0]};
    if(birth.sourceAddLockOn)birth.sourceAddLockOn={...birth.sourceAddLockOn,useManualDir:false,manualDirDegree:[0,actor.facing<0?180:0,0]};
    for(const key of ['sourceArcController','sourceArcPose','sourceArcStartController','sourceArcGlobalTime','sourceArcGlobalTimeBefore',
      'sourceArcMeshAnimationTime','sourceMeshGlobalTime','sourceSinglePlayMeshEndPending','sourceXCrashMeshEndPending','sourceArcStartEndPending'])delete birth[key];
    Object.assign(birth,{elapsed:0,setElapsed:0,animationTime:0,meshLifetimeElapsed:0,stage:0,active:false,dead:false,
      endEmitted:false,combatRetired:false,hitCount:0,childCounts:{},soundFired:[],x:actor.x,y:actor.y,z:actor.z,
      setStartAnimation:actor.animationTime,setStartState:actor.stateTime,start:0});
    // TRACE resolves against the actually playing actor's original bones.
    // Custom world anchors remain intent data, never a completed collider.
    if(birth.sourceISSheath===true&&effectProfile?.target?.unitClass===112&&birth.name==='ElswordSheath02'&&
       effectProfile.effectTemplates?.ElswordSheath02&&!effectProfile.damageEffects?.ElswordSheath02){
      // This validated, non-damaging visual requires a complete hand matrix.
      // Follow the actually playing local hand while linked. A released
      // sheath keeps its validated frozen matrix; without a local sampler the
      // same visual-only input remains usable, never a damage collider pose.
      const hand=birth.sourceISSheathFollowing&&sim.effectAnchorSampler?.({definition:{BONE_NAME:'Dummy2_Lhand',TRACE_MATRIX:1}},actor),
        anchor=hand?.matrix?hand:birth.sourcePosedAnchor;
      birth.birthAnchor=copy(anchor);birth.currentAnchor=copy(anchor);birth.sourcePosedAnchor=copy(anchor);
      [birth.x,birth.y,birth.z]=anchor.position;
    }else{
      if(!birth.birthAnchor?.customPosition)birth.birthAnchor={position:[actor.x,actor.y,actor.z],rotation:[0,actor.facing<0?180:0,0],facing:actor.facing};
      birth.currentAnchor=copy(birth.birthAnchor);delete birth.sourcePosedAnchor;
    }
    delete birth.sourceDamageAnchor;
    // The real CEffect constructor initializes literal/Shadow motion on its
    // first normal active step. A sender's live velocity/gravity accumulator
    // is neither a new projectile's configuration nor its current position.
    if(birth.sourceShadowMesh){delete birth.sourceShadowMesh;birth.sourceShadowMeshPending=true;}
    delete birth.sourceFollowLine;delete birth.sourceArcMeshPosition;
    const current=encodeOwnedState(sim,actor.id,{epoch:owner.epoch,frameSeq}).actor;let installed;
    actors[index]=temp;installingBirth=true;
    try{
      // Isolate from unclaimed live objects too; canonical admission must not
      // reset their local clocks or erase the rest of this owner's scene.
      sim.state.effects=originalEffects.map(effect=>effect.ownerId===actor.id?copy(effect):effect);
      applyOwnedState(sim,actor.id,{epoch:owner.epoch,frameSeq,actor:current,effects:[birth],hits:[]},{endMissing:false});
      installed=sim.state.effects.find(effect=>effect.ownerId===actor.id&&effect.networkId===state.id&&effect.networkEpoch===owner.epoch);
    }finally{actors[index]=actor;sim.state.effects=originalEffects;installingBirth=false;}
    if(installed){if(installed.sourceArcStartMesh){const profile=sim.effectProfileFor?.(installed)??sim.profileFor?.(actor)??sim.profile;
        initializeArcStartMesh(installed,profile.effectTemplates[installed.mainEffectName??installed.name]);}
      sim.state.effects.push(installed);metrics.births++;}
    return installed;
  }
  function applyEffects(sim,actor,owner,action){
    for(const state of action.effects){
      if(!integer(state.id))continue;let entry=owner.effects.get(state.id);
      if(ended(state)){
        retireEffectState(sim,actor,owner,state);continue;
      }
      if(owner.tombstones.has(state.id)||!entry&&birthRetired(owner,state.id)){metrics.lateBirthsRejected++;continue;}
      const first=!entry;
      if(!entry){const effect=createBirth(sim,actor,owner,state,action.frameSeq);if(!effect)continue;
        entry=registerEffect(owner,state,effect,action.frameSeq);
      }else if(action.frameSeq<=entry.lastFrame)continue;
      entry.lastFrame=action.frameSeq;
      const effect=entry.effect;
      if(effect.dead||!sim.state.effects.includes(effect)){rememberTerminal(owner,state.id);owner.effects.delete(state.id);continue;}
      // Raven's release changes an existing waiting mesh to a .35s shot and
      // resets its lifetime locally (executeArcCommands / Native NowLifeTime).
      // It is a transition, not a sender clock sample. Retaining the waiting
      // mesh's elapsed seconds makes this newly released spear die instantly.
      const arc=action.actor.sourceArcEnemy,handle=state.sourceArcHandle;
      // Static damage tables/speed are intentionally absent from the wire.
      // Reconstruct only the original Arc controls from its validated typed
      // row and canonical identity, as the full-state decoder also does.
      const arcRow=handle&&state.skillId===24008&&arcDamageNames.has(state.name)&&arc?.effectIds?.[handle]===state.id?
        arc.effects.find(row=>row.handle===handle&&row.name===state.name&&row.alive&&row.hasMesh):null;
      const arcHeld=arcRow&&arc.data.some(row=>row.handle===handle);
      const arcReleased=arcRow&&!arcHeld&&arcRow.dirSpeed===3000&&arcRow.attackTime?.[1]===9999;
      const resetArcLifetime=arcReleased&&!first&&effect.initialDirSpeed!==3000;
      // NEXT is derived after collision by this live effect's local clocks.
      // Source and receiver STOP/delivery differ: copying stage can skip an
      // unplayed contact phase, or rewind it and clear an already accepted
      // hit ledger. New births start at zero; claimed predictions retain their
      // actual phase. Explicit Phantom attack identities remain controls.
      if(!first&&state.sourcePhantomSword&&state.sourcePhantomAttackSerial!==effect.sourcePhantomAttackSerial){effect.hits={};effect.hitGaps={};effect.sourceHitMemory2016=[];}
      for(const [key,value]of Object.entries(state))if(!excluded.has(key)&&key!=='stage'){
        const mapped=linkedControls(value,owner,key);if(mapped!==undefined)effect[key]=mergeControls(effect[key],mapped);
      }
      if(arcRow&&effect.damage){
        effect.damage.ATTACK_TIME_START=0;effect.damage.ATTACK_TIME_END=arcHeld?0:9999;
        effect.initialDirSpeed=arcHeld?0:3000;
        if(arcReleased)effect.lifeTimeSeconds=Math.fround(.35);
      }
      if(resetArcLifetime)effect.meshLifetimeElapsed=0;
      if(arcReleased&&(first||resetArcLifetime)&&sim.networkCombatPlaybackVersion===1)
        sim.emit('sound',actor.id,{name:'Raven_OT_SP2_FlyingImpact3.ogg',field:'original-arc-release',...sourceSoundEventMetadata(actor)});
      effect.networkFrameSeq=action.frameSeq;metrics.controls++;
    }
  }
  function linkedControls(source,owner,path='',actorControl=false){
    if(source===null||typeof source!=='object'){
      const field=path.split('.').at(-1),linkFields=new Set(['parentEffectId','sourceBoneEffectSetId','sourceBoneTargetMeshId',
        'sourceEffectSetId','sourceTargetMeshId','sourceVeteranTargetId','effectId','centerId','flameEffect','roseId',
        'harshEffectId','phantomSheathId','finalStrikeEffectId','sourceDashJumpEffectHandle']);
      const listLink=/\.(?:effectIds|megaEffects|windmillEffects|groundEffects|airEffects|shieldEffectIds|blastingEffectIds|swordFallEffectIds|blackHoleEffectIds|heatEffects)\.[^.]+$/.test(path);
      if(integer(source)&&(linkFields.has(field)||/EffectGroup\.\d+\.id$/.test(path)||listLink))
        return field==='parentEffectId'?parentLocalId(owner,source):owner.effects.get(source)?.effect?.id;
      return copy(source);
    }
    if(Array.isArray(source)){const values=source.map((value,index)=>linkedControls(value,owner,path+'.'+index,actorControl));return values.some(value=>value===undefined)?undefined:values;}
    const result={};for(const [key,value]of Object.entries(source))if(!excluded.has(key)&&!(actorControl&&runtimeActorControl(key))){
      const mapped=linkedControls(value,owner,path+'.'+key,actorControl);if(mapped!==undefined)result[key]=mapped;
    }return result;
  }
  function applyActorControls(actor,source,owner,presentationAge=0,frameSeq){
    receiveForceFingerResourceNumbers(simulation,actor,owner.epoch,source.sourceForceFingerResourceNumbers,{frameSeq,presentationAge});
    if(!applyPassiveStops(actor,owner,source,frameSeq))for(const key of ['hitStop','worldStop'])if(Number.isFinite(source[key])){
      const active=source[key]>0;
      if(owner.stops[key]!==active){replaceActorStopProjection(actor,key,Math.max(0,source[key]));owner.stops[key]=active;}
    }
    for(const field of actorControls)if(source[field]!==undefined){
      let value=source[field];
      if(field==='sourceVeteranCommander'&&value?.overheatNotice){
        // A notice is an atomic presentation event, not a partial controller.
        // The generic filter removes position/remaining; installing its shell
        // would make veteranPassives subtract dt from undefined and poison the
        // next owner report. Use the same life/serial receipt as full reports,
        // leaving the actor's locally advancing notice untouched.
        receiveOverheatNotice(simulation,actor.id,owner.epoch,value.overheatNotice,presentationAge,actor.hp>0);
        value={...value};delete value.overheatNotice;
      }
      // Phantom attack windows and delayed matrix queues belong to the live
      // local state-enter callbacks. A wire pointer cannot create that clock.
      if(field==='sourceInfinitySword'&&value&&typeof value==='object'){
        value={...value};if(!actor[field]?.phantomSword)delete value.phantomSword;
      }
      if(field==='sourceAddCombat'&&value&&typeof value==='object'){
        value={...value};for(const name of ['maximumStrike','magnetron','phase','stasis'])
          if(value[name]&&typeof value[name]==='object'&&!actor[field]?.[name])delete value[name];
      }
      // A missing Native summon/controller must initialize through its real
      // local callback, not a partial source record with clocks removed.
      if(['sourceAddSummon','sourceArcEnemy','sourceMegaDrill','sourceWildCharge','sourceXCrash'].includes(field)
        &&value&&typeof value==='object'&&!actor[field])continue;
      if(field==='sourceArcEnemy'&&value&&actor[field]){
        // A source spear can arrive while this receiver is still paused before
        // its Native birth. Generic control merging removes position/rotation
        // and clocks, so it cannot construct a new complete Arc ABI row. Only
        // update handles already created by the local callback; its nextHandle
        // counter must also stay local until that callback actually allocates.
        const handles=new Set(actor[field].effects.map(row=>row.handle));
        value={...value,nextHandle:actor[field].nextHandle,
          effects:value.effects.filter(row=>handles.has(row.handle)),
          data:value.data.filter(row=>handles.has(row.handle)),
          effectIds:Object.fromEntries(Object.entries(value.effectIds).filter(([handle])=>handles.has(Number(handle))))};
      }
      const summonTransition=field==='sourceAddSummon'&&actor[field]&&value&&
        (actor[field].state!==value.state||actor[field].stateSerial!==value.stateSerial);
      const controls=linkedControls(value,owner,field,true);if(controls!==undefined)actor[field]=mergeControls(actor[field],controls);
      if(summonTransition&&actor[field])Object.assign(actor[field],{animationTime:0,stateTime:0,waitInterval:0});
    }
    if(source.core&&actor.core){
      const changed=source.core.phase!==actor.core.phase||source.core.targetId!==actor.core.targetId;
      actor.core=mergeControls(actor.core,source.core);
      if(changed)Object.assign(actor.core,{phaseTime:0,animationTime:0,attackElapsed:0,delayElapsed:0});
    }
  }
  function invalidateCorrection(owner){
    if(owner.correction.some(value=>Math.abs(value)>.001))metrics.invalidatedCorrections++;
    owner.correction=[0,0,0];owner.correctionController=null;owner.correctionAnimation=null;owner.correctionVelocity=[0,0,0];
  }
  function sourcePhase(owner,actor){
    return actor.stateTime+(owner.phaseController===actor.stateSerial&&owner.phaseAnimation===actor.animationName?owner.phaseOffset:0);
  }
  function rememberPosition(owner,actor,key){
    owner.positions.set(key,{stateSerial:actor.stateSerial,stateTime:sourcePhase(owner,actor),animationName:actor.animationName,position:[actor.x,actor.y,actor.z]});
    while(owner.positions.size>maxSourceLagFrames+4)owner.positions.delete(owner.positions.keys().next().value);
  }
  function matchingPhase(owner,pose){
    let before,after,exact;
    for(const sample of owner.positions.values())if(sample.stateSerial===pose.stateSerial&&sample.animationName===pose.animationName){
      if(Math.abs(sample.stateTime-pose.stateTime)<1e-7)exact=sample.position;
      if(sample.stateTime<pose.stateTime&&(!before||sample.stateTime>before.stateTime))before=sample;
      if(sample.stateTime>pose.stateTime&&(!after||sample.stateTime<after.stateTime))after=sample;
    }
    if(exact)return exact;
    if(!before||!after)return null;
    const fraction=(pose.stateTime-before.stateTime)/(after.stateTime-before.stateTime);
    return before.position.map((value,axis)=>value+(after.position[axis]-value)*fraction);
  }
  function motionProjectionFrames(owner,motion){
    return Math.min(maxMotionExtrapolationFrames,Math.max(0,localFrame-1-motion.frameSeq-owner.motionMinOffset));
  }
  function rememberStopZeros(owner,action){
    const identity=stopIdentity(action.actor);if(!identity)return;
    let zeros=owner.stopZeros.get(identity);
    for(const key of ['hitStop','worldStop'])if(action.actor[key]===0){
      if(!zeros){zeros={};owner.stopZeros.set(identity,zeros);}
      zeros[key]=Math.max(zeros[key]??-1,action.frameSeq);
    }
    while(owner.stopZeros.size>64)owner.stopZeros.delete(owner.stopZeros.keys().next().value);
  }
  function stopEdgeAfterOrigin(owner,previous,key,frameSeq){
    const origin=previous?.origins?.[key],zero=owner.stopZeros.get(previous?.identity)?.[key];
    return integer(origin)&&origin<zero&&zero<frameSeq;
  }
  function restoreStopEdges(sim,actor,owner){
    const sample=owner.stopMotion,previous=owner.passiveStops;
    if(!sample||!previous||sample.identity!==previous.identity||sample.identity!==stopIdentity(actor)
      ||sample.frameSeq>previous.frameSeq)return;
    const elapsed=sim.state.time-sample.at;
    if(!Number.isFinite(elapsed)||elapsed<0)return;
    for(const key of ['hitStop','worldStop'])if(sample.deadlines[key]>sample.frameSeq&&previous[key]>previous.frameSeq
      &&Math.abs(sample.deadlines[key]-previous[key])<=1e-6&&stopEdgeAfterOrigin(owner,previous,key,sample.frameSeq)){
      // This is the first-applied motion's projected remainder, aged by real
      // simulation seconds since then. Reusing the six-frame projection cap
      // here would resurrect an already elapsed STOP after a late cancel.
      replaceActorStopProjection(actor,key,Math.max(0,sample.remaining[key]-elapsed));
      // A later reliable control may advance the frame of this same countdown.
      // Keep the original motion time anchor, but consume the edge through the
      // latest accepted source sample so older zeros cannot revive it again.
      previous.origins[key]=previous.frameSeq;owner.stops[key]=true;
    }
  }
  function applyPassiveStops(actor,owner,source,frameSeq,age=0,alreadyPlayed=false){
    const identity=stopIdentity(source);if(!integer(frameSeq)||!identity)return false;
    const previous=owner.passiveStops?.identity===identity?owner.passiveStops:null;
    if(previous&&frameSeq<previous.frameSeq)return true;
    const deadlines={...previous,identity,frameSeq,origins:{...previous?.origins}};
    for(const key of ['hitStop','worldStop'])if(Number.isFinite(source[key])){
      // Reliable starts/controls and replaceable motion share the same source
      // end frame. Changing delivery lanes must not restart an already played
      // stop. A different end can also be a source cancellation followed by
      // a shorter new STOP; only an equal deadline identifies the countdown.
      const deadline=frameSeq+source[key]*60,remaining=Math.max(0,source[key]-age),
        same=previous&&Math.abs(deadline-previous[key])<=1e-6,
        newEdge=source[key]>0&&stopEdgeAfterOrigin(owner,previous,key,frameSeq);
      replaceActorStopProjection(actor,key,!newEdge&&(!previous&&alreadyPlayed||same)?
        Math.min(Math.max(0,actor[key]),remaining):remaining);
      deadlines.origins[key]=source[key]<=0?null:newEdge||!same||!integer(previous?.origins?.[key])?frameSeq:previous.origins[key];
      deadlines[key]=deadline;owner.stops[key]=source[key]>0;
    }
    owner.passiveStops=deadlines;return true;
  }
  function passiveCheckpoint(sim,actor,owner,motion){
    const locomotion=motion?.locomotion,reaction=motion?.reaction??locomotion,def=(sim.profileFor?.(actor)??sim.profile).states[reaction?.state];
    if(locomotion&&!recoverableMotionStates.has(actor.state)&&!PASSIVE_REACTION_STATES.includes(actor.state))return false;
    if(!reaction||!(locomotion?PASSIVE_LOCOMOTION_STATES:PASSIVE_REACTION_STATES).includes(reaction.state)||!def||def.animationName!==reaction.animationName
      ||Object.keys(def.raw).some(key=>/^ATTACK_TIME|^DAMAGE_EFFECT|^CREATE_DAMAGE/.test(key))
      ||motion.frameSeq<owner.playedFrame||motion.frameSeq<=owner.reactionFrame||reaction.stateSerial<owner.reactionSerial)return false;
    // Native may already have advanced into the source's next passive phase.
    // Receiving that phase for the first time must not re-enter the same local
    // controller or reset its animation back to the packet's older clock.
    const changed=actor.state!==reaction.state||actor.stateSerial!==reaction.stateSerial;
    if(changed){
      const captured={...motion.actor,...reaction,skillId:null,skillContext:null,animationSpeedRamp:null};
      const vitals={hp:actor.hp,mp:actor.mp},add=actor.sourceAdd&&{dp:actor.sourceAdd.dp,mutation:actor.sourceAdd.mutation};
      const protectedFields=['buffs','buffControls','invincible','superArmor','superArmorNotRed','skillSuperArmorNotRed','forceInvincible','showInvincible'];
      const protection=Object.fromEntries(protectedFields.filter(key=>Object.hasOwn(actor,key)).map(key=>[key,copy(actor[key])]));
      let accepted;
      try{accepted=applyController(sim,actor,owner,{frameSeq:motion.frameSeq,actor:captured});}
      finally{Object.assign(actor,vitals);if(add&&actor.sourceAdd)Object.assign(actor.sourceAdd,add);
        for(const key of protectedFields){if(Object.hasOwn(protection,key))actor[key]=protection[key];else delete actor[key];}}
      if(!accepted)return false;
    }
    // The motion lane already projects a jitter-aged passive victim sample.
    // Its non-attacking state/animation clocks must use that same bounded age,
    // excluding the frozen portion, rather than describing the old sample
    // while y/vy describe a later instant. Locomotion loops keep their existing
    // clock policy; arbitrary attacking controllers are never fast-forwarded.
    const currentHeader=changed||reaction.stateTime>=actor.stateTime,
      stopAge=motionProjectionFrames(owner,motion)/60,
      elapsed=locomotion?0:Math.max(0,stopAge-Math.max(reaction.hitStop,reaction.worldStop)),
      clocks={stateTime:reaction.stateTime+elapsed,
        animationTime:!currentHeader&&actor.animationStopped?actor.animationTime:
          reaction.animationTime+(reaction.animationStopped?0:elapsed*reaction.animationPlaybackSpeed)};
    // Only a confirmed victim-owned passive phase may restore these clocks.
    // No historical step, attack window, hit receipt or effect is executed.
    // Equal-controller checkpoints must never rewind a locally advanced clock,
    // nor let an older source header resume or advance an already stopped local
    // animation. Its passive state clock may still advance independently.
    // Frame admission above already proves these logical fields belong to a
    // strictly newer source sample. A projected local clock can lead the raw
    // clock indefinitely; it must not hide a same-controller FORCE_FLY reset
    // or a new attacker direction. Animation keeps its separate phase gate so
    // an older raw phase cannot resume a locally completed clip.
    for(const key of ['downForce','flyCount','lastAttackerFront'])actor[key]=reaction[key];
    if(currentHeader){
      for(const key of ['animationStopped','animationPlaybackSpeed'])actor[key]=reaction[key];
      actor.animationSpeedRamp=null;
      if(actor.presentationTransition)actor.presentationTransition.enabled=false;
    }
    if(changed||clocks.stateTime>=actor.stateTime){
      for(const key of ['stateTime','animationTime'])actor[key]=changed?clocks[key]:Math.max(actor[key],clocks[key]);
      actor.animationBeforeTime=actor.animationTime;
    }
    applyPassiveStops(actor,owner,reaction,motion.frameSeq,stopAge);
    owner.stopMotion={identity:stopIdentity(reaction),frameSeq:motion.frameSeq,at:sim.state.time,
      remaining:Object.fromEntries(['hitStop','worldStop'].map(key=>[key,Math.max(0,reaction[key]-stopAge)])),
      deadlines:Object.fromEntries(['hitStop','worldStop'].map(key=>[key,motion.frameSeq+reaction[key]*60]))};
    owner.reactionFrame=motion.frameSeq;owner.reactionSerial=reaction.stateSerial;
    confirmPassive(owner,reaction,actor);
    owner.controller=reaction.stateSerial;owner.needsRecovery=false;owner.phaseOffset=0;
    owner.positions.clear();invalidateCorrection(owner);metrics[locomotion?'locomotionCheckpoints':'reactionCheckpoints']++;
    return changed;
  }
  function separatedCorrection(sim,actor,owner,motion,target,before){
    const profile=sim.profileFor?.(actor)??sim.profile,body={position:before,height:profile.body.UNIT_HEIGHT,width:profile.body.UNIT_WIDTH};
    const blockers=sim.state.actors.filter(other=>other.id!==actor.id&&other.team!==actor.team&&other.hp>0&&!other.pvpDead&&!other.pvpDisconnected)
      .map(other=>{const p=sim.profileFor?.(other)??sim.profile;return {id:other.id,position:[other.x,other.y,other.z],height:p.body.UNIT_HEIGHT,width:p.body.UNIT_WIDTH};});
    const crossed=blockers.filter(other=>nativeBodyPassBlocked(body,other,{position:target,backupPosition:other.position}));
    if(!crossed.length||blockers.some(other=>nativeBodyOverlap({...body,position:target},other).overlaps)){owner.motionCrossing=null;return false;}
    const key=crossed.map(other=>other.id+':'+Math.sign(target[0]-other.position[0])).sort().join('|');
    const old=owner.motionCrossing;
    owner.motionCrossing=old?.key===key?{...old,last:motion.frameSeq,count:old.count+1}:{key,first:motion.frameSeq,last:motion.frameSeq,count:1};
    // A stale remote body must not become a permanent moving obstacle after
    // the real owner is already on the other side. Three fresh, separated
    // endpoints confirm a correction; this never moves the local player.
    if(owner.motionCrossing.count<3||motion.frameSeq-owner.motionCrossing.first<6)return false;
    owner.motionCrossing=null;metrics.motionCrossingRecovered++;return true;
  }
  function beforeStep(sim,local,life=epochFor){
    bind(sim,local,life);localFrame++;let played=0;
    // Each source owns an independent ordered queue. Rotate the next starting
    // owner when this browser's global work budget is exhausted, otherwise a
    // sustained first owner's controls can starve every later player's start.
    // This is Web scheduling, not a claim about the original queue's timing.
    const ordered=[...owners.values()],start=Math.max(0,ordered.findIndex(owner=>owner.id===nextOwner));
    const scheduled=[...ordered.slice(start),...ordered.slice(0,start)];let rotated=false;
    for(const [ownerIndex,owner]of scheduled.entries()){
      if(owner.epoch>life(owner.id))continue;
      if(owner.epoch<life(owner.id)){metrics.staleLife+=owner.queue.length;owner.queue.length=0;owner.held=[];retireOwner(owner);continue;}
      const actor=sim.state.actors.find(value=>value.id===owner.id);
      if(!actor||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected){owner.queue.length=0;owner.held=[];retireOwner(owner);continue;}
      const networkStepBefore=[actor.x,actor.y,actor.z];
      advanceStartExpiry(owner,clock());
      retireDepartedPassive(owner,actor);
      const reactionChanged=passiveCheckpoint(sim,actor,owner,owner.motionPending);
      restoreStopEdges(sim,actor,owner);
      if(owner.sourceBase!==null&&owner.localBase-owner.sourceBase>owner.minOffset+maxJitterFrames){
        owner.localBase=owner.sourceBase+owner.minOffset+maxJitterFrames;
      }
      let started=false;
      while(owner.queue.length&&played<maxEventsPerStep){
        const item=owner.queue[0],action=item.action;
        if(owner.sourceBase===null){owner.sourceBase=action.frameSeq;owner.localBase=localFrame;owner.minOffset=localFrame-action.frameSeq;}
        let due=owner.localBase+action.frameSeq-owner.sourceBase;
        if(due>localFrame)break;
        // Deliver a backlog over positive simulation steps. Never overwrite
        // two distinct controller starts before either has had a native tick.
        if(action.playback.start&&started)break;
        owner.queue.shift();owner.seen.add(action.id);while(owner.seen.size>1024)owner.seen.delete(owner.seen.values().next().value);
        owner.playedFrame=Math.max(owner.playedFrame,action.frameSeq);
        // Source progress and receiver residence remain independent bounds.
        // For Start only, elapsed receipt time of an already witnessed frame
        // supplies additional evidence through a later channel blackout.
        // Its monotone expiry frontier survives reanchoring to a newer frame.
        const sourceAgeMs=Math.max(0,owner.latestFrame-action.frameSeq)*1000/60,
          actionAgeMs=Math.max(sourceAgeMs,Math.max(0,clock()-item.at)),
          witnessedStartExpired=action.playback.start&&action.frameSeq<=owner.expiredStartThroughFrame;
        metrics.maxObservedActionAgeMs=Math.max(metrics.maxObservedActionAgeMs,actionAgeMs);
        retireDepartedPassive(owner,actor);
        const superseded=owner.retiredPassive.has(passiveIdentity(action.actor))||action.frameSeq<=owner.reactionFrame&&action.actor.stateSerial<=owner.reactionSerial;
        const expired=clock()-item.at>maxQueueMs||owner.latestFrame-action.frameSeq>maxSourceLagFrames||actionAgeMs>maxAdditionalAgeMs||witnessedStartExpired;
        if(superseded&&!expired){
          metrics.reactionSuperseded++;
          // A newer passive phase supersedes the old controller, not a key
          // release. Discard its stale attack levels but retain the latest
          // independently received direction, as for an expired controller.
          // Otherwise a previously held X/Z can survive its release forever.
          acceptHeld(owner,action.playback.held,action.frameSeq,{expired:true});
          // A victim's newer passive controller invalidates old StateStart,
          // but does not end an independent projectile already released by
          // that caster. Retain its normal current-time lifecycle. Effects
          // explicitly deleted on damage/state change cannot be resurrected.
          const independent=action.effects.filter(effect=>ended(effect)||
            effect.deleteOnStateEnd!==true&&!(effect.deleteConditions??[]).some(reason=>[1,2,5].includes(reason)));
          applyEffects(sim,actor,owner,{...action,effects:independent});
          for(const effect of action.effects)if(!independent.includes(effect)&&integer(effect.id))retireEffectState(sim,actor,owner,effect);
          played++;metrics.played++;continue;
        }
        if(expired){
          if(superseded)metrics.reactionSuperseded++;
          if(actionAgeMs>maxAdditionalAgeMs)metrics.expiredAdditionalAge++;
          if(witnessedStartExpired)metrics.expiredWitnessedStarts++;
          metrics.expired++;if(action.playback.start){owner.droppedControllers.add(action.actor.stateSerial);if(!superseded)owner.needsRecovery=true;}
          // Held is a replaceable device level, not an expired attack edge.
          // Losing its release would leave a remote dash/charge running forever.
          acceptHeld(owner,action.playback.held,action.frameSeq,{expired:true});
          for(const state of action.effects){
            if(!integer(state.id))continue;
            // Terminals remain safe; an unknown expired birth must also keep
            // a closed identity. Otherwise its next active snapshot can reset
            // it to local time zero and create a delayed damage opportunity.
            if(ended(state)){retireEffectState(sim,actor,owner,state);continue;}
            if(owner.effects.has(state.id)||birthRetired(owner,state.id))continue;
            // A real locally playing prediction already owns its clock and
            // hit receipt. Claim that exact object without replay or reset;
            // expiry must not turn an already accepted hit into another one.
            const predicted=predictedBirth(sim,actor,owner,state);
            const current=predicted&&claimPredicted(sim,owner,state,action.frameSeq,predicted);
            if(current)registerEffect(owner,state,current,action.frameSeq);
            else {rememberTerminal(owner,state.id);metrics.expiredBirthsRetired++;}
          }
          continue;
        }
        metrics.maxPlayedActionAgeMs=Math.max(metrics.maxPlayedActionAgeMs,actionAgeMs);
        // Experimental: preserving evolved gravity avoids repeated old-control
        // rewinds, but current geometry can then run ahead of delayed attack
        // animation. Keep the V50 continuation default until those clocks are
        // validated together; formal V51 main/holdout both lost a LK down-hit.
        // A control-only record has no new launch/enter intent. Once a newer
        // motion sample was consumed, applying this older control must not
        // reinstall that sample's *old* velocity after positive physics steps
        // have advanced it. In particular, a late effect/control update cannot
        // relaunch an actor which has already landed. New StateStart retains
        // its separate, conservative phase policy below.
        const preserveControlMotion=!action.playback.start&&owner.motion&&owner.motionAppliedFrame>action.frameSeq;
        const movement=(experimentalEvolvedMotionContinuation||preserveControlMotion)&&owner.motion&&owner.motionAppliedFrame>action.frameSeq?
          {...Object.fromEntries(['vx','vy','vz','facing','grounded','lineId'].map(key=>[key,actor[key]])),
            landPosition:[...actor.landPosition]}:null;
        if(action.playback.start){
          if(due<localFrame){
            const offset=owner.localBase-owner.sourceBase;
            const bounded=Math.max(offset,Math.min(localFrame-action.frameSeq,(owner.minOffset??offset)+maxJitterFrames));
            if(bounded!==offset){owner.localBase=owner.sourceBase+bounded;metrics.rebasedStarts++;}
          }
          if(!applyController(sim,actor,owner,action))continue;
          started=true;
        }else applyLogicalAdd(sim,actor,action.actor);
        if(action.actor.facing===1||action.actor.facing===-1)actor.facing=action.actor.facing;
        acceptHeld(owner,action.playback.held,action.frameSeq);
        applyEffects(sim,actor,owner,action);applyActorControls(actor,{...owner.headers.get(action.frameSeq),...action.actor},owner,
          Math.max(0,(owner.latestFrame-action.frameSeq)/60,(clock()-item.at)/1000),action.frameSeq);
        if(movement){
          // A delayed controller may supply its original launch intent, but
          // cannot undo a newer owner-confirmed stop/turn/landing. Reuse only
          // latest movement intent; never pull back to an already used pose.
          Object.assign(actor,movement);
          if(preserveControlMotion)metrics.staleControlMotionPreserved++;
        }else if(!experimentalEvolvedMotionContinuation&&owner.motion&&owner.motionAppliedFrame>action.frameSeq){
          // Compatibility default: exactly the V50 packet-intent restoration.
          for(const key of ['vx','vy','vz','facing','grounded','lineId'])actor[key]=owner.motion.actor[key];
          actor.landPosition=[...owner.motion.actor.landPosition];
        }
        played++;metrics.played++;
      }
      if(!rotated&&played>=maxEventsPerStep){
        nextOwner=scheduled[(ownerIndex+1)%scheduled.length].id;rotated=true;metrics.budgetRotations++;
      }
      // A whole control frontier can expire during a transport outage. Once
      // it drains, a verified current non-attacking motion checkpoint restores
      // its identity/velocity. Never revive an expired attack or effect window.
      const recovery=owner.recovery;
      if(owner.needsRecovery&&!owner.queue.length&&recovery&&recovery.frameSeq>=owner.playedFrame
        &&recoverableMotionStates.has(recovery.actor.state)){
        const position=['x','y','z'].map(key=>recovery.actor[key]);
        if(position.every(Number.isFinite)&&applyController(sim,actor,owner,{frameSeq:recovery.frameSeq,actor:recovery.actor})){
          // This is a current motion checkpoint, not its original start.
          // Map history to that phase without installing/advancing a Native
          // clock, or future poses would compare against a second phase zero.
          owner.phaseController=actor.stateSerial;owner.phaseAnimation=actor.animationName;
          owner.phaseOffset=recovery.actor.stateTime-actor.stateTime;owner.positions.clear();rememberPosition(owner,actor,localFrame*2);
          owner.correction=position.map((value,axis)=>value-[actor.x,actor.y,actor.z][axis]);
          owner.correctionController=actor.stateSerial;owner.correctionAnimation=actor.animationName;owner.playedFrame=Math.max(owner.playedFrame,recovery.frameSeq);metrics.motionRecoveries++;
        }
      }
      // Packet frame order schedules controls, but late StateStart still begins
      // at local phase zero. Its pose may only calibrate the same actual Native
      // state phase. A global source-frame estimate would turn network delay
      // into a fictitious spatial error, especially after a backlog or jump.
      if(owner.correctionController!==actor.stateSerial||owner.correctionAnimation!==actor.animationName)invalidateCorrection(owner);
      // A slightly newer full pose must not alternate Native-phase geometry
      // correction with the independent motion timeline. Both are valid but
      // target different local phases. Keep motion in charge while that lane
      // is active; after bounded silence the full-pose fallback is available.
      const currentMotion=owner.motion&&owner.motion.frameSeq>=owner.playedFrame&&localFrame-1-owner.motionReceivedLocalFrame<=maxMotionSilenceFrames;
      if(owner.motionPending&&owner.motionPending.frameSeq<owner.playedFrame){owner.motionPending=null;owner.motionCorrection=[0,0,0];metrics.motionStale++;}
      if(currentMotion)invalidateCorrection(owner);
      if(owner.sourceBase!==null&&!currentMotion){
        const waiting=[];
        for(const pose of owner.poses){
          if(pose.stateSerial!==actor.stateSerial||pose.animationName!==actor.animationName){
            if(pose.stateSerial>actor.stateSerial)waiting.push(pose);else metrics.phaseMismatches++;
            continue;
          }
          if(pose.stateTime>sourcePhase(owner,actor)+1e-7){waiting.push(pose);continue;}
          const previous=matchingPhase(owner,pose);
          if(previous&&pose.position.every(Number.isFinite)){
            owner.correction=pose.position.map((value,axis)=>value-previous[axis]);
            owner.correctionController=actor.stateSerial;owner.correctionAnimation=actor.animationName;metrics.calibratedPoses++;
          }else metrics.unmatchedPoses++;
        }
        owner.poses=waiting;
        metrics.maxSchedulingDelayFrames=Math.max(metrics.maxSchedulingDelayFrames,
          owner.localBase-owner.sourceBase-(owner.minOffset??0));
      }
      if(owner.correction.some(value=>Math.abs(value)>.001)){
        const before=[actor.x,actor.y,actor.z],profile=sim.profileFor?.(actor)??sim.profile;
        // After an actual outage, missed held-input motion leaves a real world
        // offset even when phases match. Reconcile it as continuous movement:
        // one normal run distance per native 60 Hz packet, ramped over four
        // packets. This is a network recovery policy, not an original mechanic.
        // Native skill displacement and reaction velocity remain untouched.
        const limit=Math.max(1,(profile.physics?.RUN_SPEED??600)*(actor.stats?.moveSpeedMultiplier??1)/60),
          bounded=(vector,maximum)=>{const length=Math.hypot(...vector);return length>maximum?vector.map(v=>v*maximum/length):vector;},
          desired=bounded(owner.correction.map(value=>value*positionBlend),limit),
          change=bounded(desired.map((value,axis)=>value-owner.correctionVelocity[axis]),limit/4);
        let step=owner.correctionVelocity.map((value,axis)=>value+change[axis]);
        if(step.reduce((sum,value,axis)=>sum+value*owner.correction[axis],0)<=0)step=[0,0,0];
        step=bounded(step,Math.hypot(...owner.correction));owner.correctionVelocity=step;
        for(const [axis,key]of ['x','y','z'].entries())actor[key]+=step[axis];
        // Projection is movement too. Apply the original body pass/push
        // rules before the next native step takes its position backup;
        // otherwise a large correction can already be across the local body.
        sim.blockUnits?.(actor,...before);
        const applied=['x','y','z'].map((key,axis)=>actor[key]-before[axis]);
        // A correction is an offset to a matching Native-phase prediction,
        // never a stationary anchor that pulls a running actor back at 60Hz.
        for(const position of owner.positions.values())for(let axis=0;axis<3;axis++)position.position[axis]+=applied[axis];
        owner.correction=owner.correction.map((value,axis)=>value-step[axis]);
        metrics.positionCorrectionDistance+=Math.hypot(...applied);
      }
      // The independent motion frontier can pass a blocked control stream.
      // Only geometry/device directions change here, on a positive simulation
      // step; no StateStart, attack window, hit receipt, HP or MP is replayed.
      const motion=owner.motionPending;
      if(motion){
        owner.motionPending=null;owner.motionAppliedFrame=motion.frameSeq;
        owner.motionAppliedAt=clock();
        owner.motionAdmissionToApplyMaxMs=Math.max(owner.motionAdmissionToApplyMaxMs,
          Math.max(0,owner.motionAppliedAt-owner.motionReceivedAt));
        for(const key of ['vx','vy','vz','facing','grounded','lineId'])actor[key]=motion.actor[key];
        actor.landPosition=[...motion.actor.landPosition];
        if(motion.movementHeld)owner.held=[...owner.held.filter(key=>!['LEFT','RIGHT','UP','DOWN'].includes(key)),...motion.movementHeld];
        const target=['x','y','z'].map(key=>motion.actor[key]);
        // Align a jittered moving sample with the same relative motion time.
        // Without this, identical constant-speed samples at different delays
        // pull the actor backwards/forwards on every arrival. Project only a
        // bounded grounded line translation; never integrate attacks, gravity,
        // animation roots, or an endlessly missing sample. Do not cross a line
        // endpoint: the next owner checkpoint must authorize that transition.
        const frames=motionProjectionFrames(owner,motion),
          line=motion.actor.grounded&&sim.map?.lines.find(line=>line.lineId===motion.actor.lineId);
        if(frames>0&&line){
          const delta=line.end.map((value,axis)=>value-line.start[axis]),length=Math.hypot(...delta),
            minimumX=Math.min(line.start[0],line.end[0]),maximumX=Math.max(line.start[0],line.end[0]),
            speedLimit=Math.max(1,(sim.profileFor?.(actor)??sim.profile).physics?.RUN_SPEED??600)*(actor.stats?.moveSpeedMultiplier??1),
            speed=Math.max(-speedLimit,Math.min(speedLimit,motion.actor.vx)),passive=motion.reaction??motion.locomotion,
            elapsed=Math.max(0,frames/60-Math.max(passive?.hitStop??0,passive?.worldStop??0)),distance=speed*elapsed;
          if(length>0&&Math.abs(delta[0])>1e-6&&target[0]>=minimumX&&target[0]<=maximumX){
            const dx=distance*Math.abs(delta[0])/length,
              x=Math.max(minimumX,Math.min(maximumX,target[0]+dx)),
              fraction=(x-target[0])/delta[0];
            target[0]=x;target[1]+=delta[1]*fraction;target[2]+=delta[2]*fraction;
            metrics.motionProjected++;metrics.maxMotionProjectionFrames=Math.max(metrics.maxMotionProjectionFrames,frames);
          }
        }
        if(frames>0&&motion.reaction&&owner.reactionFrame===motion.frameSeq&&!motion.actor.grounded){
          const profile=sim.profileFor?.(actor)??sim.profile,raw=profile.states[motion.reaction.state].raw;
          // Integrate only the known free-fall part of passive victim motion.
          // Stops, authored gravity gates, landing and state changes bound it;
          // arbitrary airborne skills and animation roots are never projected.
          if(!raw.DISABLE_GRAVITY_TIME_END&&!actor.skillDisableGravity&&!actor.skillDownAccel&&!actor.applyMotionOffset){
            let vy=motion.actor.vy,stop=Math.max(motion.reaction.hitStop,motion.reaction.worldStop),advanced=0;
            for(let i=0;i<frames;i++){
              // The real positive tick consumes a partial STOP remainder and
              // advances physics for the unfrozen part of that same packet.
              const elapsed=1/60-Math.min(1/60,stop);stop=Math.max(0,stop-1/60);
              if(elapsed<=0)continue;
              const nextVy=Math.max(raw.SET_LIMIT_MAX_G_SPEED??profile.physics.MAX_G_SPEED,vy-profile.physics.G_ACCEL*elapsed),nextY=target[1]+nextVy*elapsed;
              // Do not predict a landing or a platform crossing. Let the next
              // ordinary positive physics step resolve its actual state.
              if(nextY<=motion.actor.landPosition[1]+profile.referenceSemantics.lineRadius)break;
              vy=nextVy;target[1]=nextY;advanced++;
            }
            if(advanced){actor.vy=vy;metrics.airMotionProjected++;}
          }
        }
        const before=[actor.x,actor.y,actor.z];
        if(separatedCorrection(sim,actor,owner,motion,target,before)){
          [actor.x,actor.y,actor.z]=target;owner.motionCorrection=[0,0,0];
        }else owner.motionCorrection=target.map((value,axis)=>value-actor[['x','y','z'][axis]]);
        // A launch/impact changes the vertical trajectory immediately at its
        // confirmed checkpoint. Ground-plane separation remains collision-safe.
        if(reactionChanged){actor.y=target[1];owner.motionCorrection[1]=0;}
        metrics.motionApplied++;
      }
      if(currentMotion&&owner.motionCorrection.some(value=>Math.abs(value)>.001)){
        const before=[actor.x,actor.y,actor.z],step=owner.motionCorrection.map(value=>Math.abs(value)<.05?value:value*motionBlend);
        for(const [axis,key]of ['x','y','z'].entries())actor[key]+=step[axis];
        sim.blockUnits?.(actor,...before);
        const applied=['x','y','z'].map((key,axis)=>actor[key]-before[axis]);
        for(const position of owner.positions.values())for(let axis=0;axis<3;axis++)position.position[axis]+=applied[axis];
        // A map/body block owns the residual position. Do not accumulate a
        // rejected push and release it as a jump when a player moves away.
        owner.motionCorrection=owner.motionCorrection.map((value,axis)=>Math.abs(applied[axis]-step[axis])>.01?0:value-applied[axis]);
        metrics.motionCorrectionDistance+=Math.hypot(...applied);
      }
      // Observe what playback actually changed before the ordinary Native
      // step. This is neither a rendered teleport nor a packet-loss estimate.
      const networkStepDelta=[actor.x,actor.y,actor.z].map((value,axis)=>value-networkStepBefore[axis]),
        networkStepDistance=Math.hypot(...networkStepDelta);
      if(networkStepDistance>(owner.largestNetworkStep?.distance??0))owner.largestNetworkStep={
        distance:networkStepDistance,delta:networkStepDelta,localFrame,motionSourceFrame:owner.motionAppliedFrame,
        state:actor.state,at:clock()};
    }
    if(!rotated)nextOwner=null;
    return played;
  }
  function afterStep(sim=simulation){
    if(!sim)return;
    for(const owner of owners.values()){
      const actor=sim.state.actors.find(value=>value.id===owner.id);
      if(actor)retireDepartedPassive(owner,actor);
      if(actor&&owner.sourceBase!==null){
        rememberPosition(owner,actor,localFrame*2+1);
      }
      for(const entry of owner.predicted)if(entry.effect.dead||!sim.state.effects.includes(entry.effect))entry.ended=true;
      for(const [id,entry]of owner.effects)if(entry.effect.dead||!sim.state.effects.includes(entry.effect)){
        rememberTerminal(owner,id);owner.effects.delete(id);metrics.naturalEnds++;
      }
      while(owner.droppedControllers.size>256)owner.droppedControllers.delete(owner.droppedControllers.values().next().value);
    }
  }
  function receiveTerminals(sim,id,actions,epoch,frameSeq,local=localId,life=epochFor){
    bind(sim,local,life);
    if(id===local||epoch!==life(id)||!integer(epoch)||!integer(frameSeq)||!Array.isArray(actions)||actions.length>16
      ||actions.some(action=>!marker(action)||!integer(action.id)||!integer(action.frameSeq)||action.frameSeq>frameSeq||!action.actor||!Array.isArray(action.effects)))return false;
    const owner=row(id,epoch),actor=sim.state.actors.find(actor=>actor.id===id);if(!owner||!actor||actor.pvpDisconnected)return false;
    for(const action of actions){
      for(const effect of action.effects)if(integer(effect.id)&&ended(effect)){retireEffectState(sim,actor,owner,effect);metrics.terminalOnlyRetired++;}
      owner.seen.add(action.id);
    }
    while(owner.seen.size>1024)owner.seen.delete(owner.seen.values().next().value);
    return true;
  }
  function consumeTerminals(sim=simulation,local=localId,life=epochFor){
    bind(sim,local,life);
    for(const owner of owners.values()){
      const queued=owner.queue.splice(0);
      for(let i=0;i<queued.length;i+=16)receiveTerminals(sim,owner.id,queued.slice(i,i+16).map(item=>item.action),owner.epoch,owner.latestFrame,local,life);
      owner.held=[];owner.motionPending=null;owner.motionCorrection=[0,0,0];invalidateCorrection(owner);
    }
  }
  function remoteInputs(sim=simulation,local=localId){
    const result={};for(const owner of owners.values())if(owner.id!==local&&sim?.state.actors.some(actor=>actor.id===owner.id))
      result[owner.id]={held:[...owner.held],pressed:[],released:[],sampledDevice:true};return result;
  }
  function clear(){
    for(const owner of owners.values())retireOwner(owner);
    for(const [sim,binding]of bindings)if(sim.createEffect===binding.wrapped)sim.createEffect=binding.original;
    owners.clear();bindings.clear();simulation=null;localId=null;epochFor=()=>0;localFrame=0;nextOwner=null;
    for(const key of Object.keys(metrics))metrics[key]=0;
  }
  return {bind,receiveActions,receiveTerminals,consumeTerminals,observeSource,observeState,observeMotion,beforeStep,afterStep,remoteInputs,reset,clear,
    get diagnostics(){return {...metrics,pending:[...owners.values()].reduce((sum,owner)=>sum+owner.queue.length,0),localFrame,
      owners:Object.fromEntries([...owners].map(([id,owner])=>[id,{epoch:owner.epoch,queued:owner.queue.length,controller:owner.controller,
        effects:owner.effects.size,parentLinks:owner.links.size,tombstones:owner.tombstones.size,retiredThrough:owner.retiredThrough,latestSourceFrame:owner.latestFrame,playedSourceFrame:owner.playedFrame,
        sourceWitnessAt:owner.sourceWitnessAt,expiredStartThroughFrame:owner.expiredStartThroughFrame,
        schedulingDelayFrames:owner.sourceBase===null?0:owner.localBase-owner.sourceBase-(owner.minOffset??0),
        pendingPoses:owner.poses.length,positionHistory:owner.positions.size,motionSourceFrame:owner.motion?.frameSeq??-1,motionAppliedFrame:owner.motionAppliedFrame,
        geometryTiming:{scope:'Receiver-local accepted motion and pre-Native playback geometry; not network one-way delay, packet-loss rate or rendered teleport',
          receiveSilenceMs:owner.motionReceivedAt===null?null:Math.max(0,clock()-owner.motionReceivedAt),
          appliedAgeMs:owner.motionAppliedAt===null?null:Math.max(0,clock()-owner.motionAppliedAt),
          pendingAgeMs:owner.motionPending?Math.max(0,clock()-owner.motionReceivedAt):null,
          maximumReceiveGapMs:owner.motionReceiveGapMaxMs,maximumAdmissionToApplyMs:owner.motionAdmissionToApplyMaxMs,
          remainingCorrectionDistance:Math.hypot(...owner.motionCorrection),largestNetworkStep:copy(owner.largestNetworkStep)}}]))};}};
}
