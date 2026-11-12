/** Bounded late attack samples. A named exact observed victim frame supplies
 * geometry only. The real local actor owns all combat decisions and writes. No
 * world replay, guessed past search or HP restoration is performed. These are
 * Web adapters, not evidence of the original client's network delay policy. */
import {applyOwnedState,ownedAttackKey,mergeOwnedActionActor,validateOwnedTargetViews,MAX_OWNER_EFFECTS,OWNER_ACTION_HISTORY_FRAMES} from '../../packages/online/owned-state.mjs';
import {createOwnedPresentation} from './owned-presentation.mjs';
import {retireIonBlackHole} from '../../packages/combat-core/black-hole.mjs';
import {isFiniteVisualBirth} from '../../packages/combat-core/finite-visual-birth.mjs';
import {MANA_BREAK_DOWN_STATES} from '../../packages/combat-core/mana-break.mjs';
import {STANDUP_INPUT_STATES,STANDUP_ATTACK_STATES,isStandupRolling} from '../../packages/combat-core/standup-policy.mjs';
import {interpolateActorPresentation} from './actor-render-clock.mjs';
import {OWNED_CONTACT_GEOMETRY_FIELDS} from '../../packages/combat-core/contact-observation.mjs';
import {nativeBodyPushWitnessPosition} from '../../packages/online/owned-body-arrival.mjs';
import {createRemoteCombatPlayback} from './remote-combat-playback.mjs';
import {isMaximumStrikeShot,maximumStrikeHitCompleted} from '../../packages/combat-core/add-maximum-strike-native-v53.mjs';
import {orientLiteralMesh} from '../../packages/combat-core/shadow-mesh.mjs';
import {isManagedContinuousAura,validateContinuousAuraMarker,acceptContinuousAuraState,endContinuousAura,
  setContinuousAuraVersion,prepareContinuousAuraLives} from '../../packages/combat-core/continuous-aura.mjs';
const temporaryMeshEvents=new Set(['effectStarted','effectStartParticles','effectTimedParticles','effectEnded']);
const effectStage=effect=>effect.sourcePhantomSword?'phantom:'+effect.sourcePhantomAttackSerial:
  effect.damage?.CLEAR_HIT_UNIT_ON_DAMAGE_DATA_CHANGE?effect.stage:0;
const victimContactFields=OWNED_CONTACT_GEOMETRY_FIELDS;
const controlAction=action=>(action.actor?.fired??[]).some(field=>/^STOP_OTHER_UNIT\d+$/.test(field));
// A completed owner-side break/down/standup reaction is current authority.
// Replacing it with a pre-break witness would spend MP then undo its sourced
// INVINCIBLE window. All current owner guards remain final combat authority.
const protectedRecovery=actor=>Boolean(actor&&(actor.invincible||actor.forceInvincible>0)&&
  (actor.manaBreak?.pendingDown||MANA_BREAK_DOWN_STATES.has(actor.state)||STANDUP_INPUT_STATES.has(actor.state)||STANDUP_ATTACK_STATES.has(actor.state)||isStandupRolling(actor)));

export function createRemoteActionConsumer({clock=()=>performance.now(),maxAgeMs=1000,maxFrames=OWNER_ACTION_HISTORY_FRAMES,maxQueued=96,maxActionsPerStep=4,
  victimHistoryFrames=45,victimHistoryMs=750,presentation=createOwnedPresentation({clock}),continuousAuraVersion=0,bodyPushWitnessVersion=0,combatPlaybackVersion=0,playbackMaxAdditionalAgeMs=250}={}){
  if(![0,1].includes(combatPlaybackVersion))throw new TypeError('invalid-combat-playback-version');
  let playbackVersion=combatPlaybackVersion;
  const playback=createRemoteCombatPlayback({clock,maxQueued,maxEventsPerStep:Math.max(8,maxActionsPerStep),maxQueueMs:maxAgeMs,maxSourceLagFrames:maxFrames,
    maxAdditionalAgeMs:playbackMaxAdditionalAgeMs});
  if(![0,1,2].includes(continuousAuraVersion))throw new TypeError('invalid-continuous-aura-version');
  if(![0,1].includes(bodyPushWitnessVersion))throw new TypeError('invalid-body-push-witness-version');
  let bodyWitnessVersion=bodyPushWitnessVersion;
  const bodyPushAction=action=>Array.isArray(action.targetViews)&&action.targetViews.some(view=>view?.bodyPushFrames!==undefined);
  const validBodyPushVersions=action=>!bodyPushAction(action)||bodyWitnessVersion===1;
  let auraVersion=continuousAuraVersion;
  if(!Number.isSafeInteger(maxQueued)||maxQueued<1||!Number.isSafeInteger(maxActionsPerStep)||maxActionsPerStep<1||
    !Number.isSafeInteger(victimHistoryFrames)||victimHistoryFrames<0||victimHistoryFrames>45||!Number.isFinite(victimHistoryMs)||victimHistoryMs<0||victimHistoryMs>750)
    throw new RangeError('invalid-remote-action-bounds');
  const queued=[],seen=new Map(),histories=new Map(),bindings=new Map(),lives=new Map(),sources=new Map(),victims=new Map();
  // A source frame can name the schema's full live effects and one critical
  // action's retired effects. Keep the admitted frame window and live meshes.
  const maxEffectReceipts=2*MAX_OWNER_EFFECTS*(maxFrames+1);
  const metrics={lastConsumed:0,lastRestoredMeshes:0,lastFilteredMeshEvents:0,totalConsumed:0,totalRestoredMeshes:0,totalFilteredMeshEvents:0,
    overflowed:0,expired:0,staleLife:0,compensatedVictimContacts:0,rejectedVictimAnchors:0,unreferencedVictimActions:0,
    continuousAuraBirths:0,continuousAuraEnds:0,continuousAuraDuplicates:0,continuousAuraHistoricalSkipped:0,continuousAuraRejected:0,
    compensatedVictimBodyPushContacts:0,bodyPushWitnessRejected:0};
  const auraAction=action=>auraVersion>0&&action.effects?.some(effect=>effect.sourceContinuousAura?.version===auraVersion);
  function validAuraVersions(action){
    for(const effect of action.effects){
      if(!effect||typeof effect!=='object')return false;
      if(effect.sourceContinuousAura!==undefined){
        if(effect.sourceContinuousAura?.version!==auraVersion||auraVersion===0)return false;
        try{validateContinuousAuraMarker(effect);}catch{return false;}
      }
    }
    return true;
  }
  function applyAuraEvents(simulation,original,item,age){
    if(!(auraVersion>0))return;
    const profile=simulation.profileFor?.(original)??simulation.profile;
    for(const state of item.action.effects)if(state.sourceContinuousAura){
      validateContinuousAuraMarker(state,profile);
      if(state.sourceContinuousAura.phase==='ended'){
        const ended=endContinuousAura(simulation,item.playerId,item.epoch,state.id,item.action.frameSeq,state.sourceContinuousAura.revision);
        if(ended)metrics.continuousAuraEnds++;else metrics.continuousAuraDuplicates++;
        if(ended&&(original.networkFrameSeq??-1)<item.action.frameSeq&&item.action.actor.awakening)
          original.awakening={...structuredClone(item.action.actor.awakening),remaining:Math.max(0,item.action.actor.awakening.remaining-age)};
        continue;
      }
      if(original.hp<=0)continue;
      if(!acceptContinuousAuraState(simulation,item.playerId,item.epoch,item.action.frameSeq,state)){metrics.continuousAuraDuplicates++;continue;}
      const existing=simulation.state.effects.find(effect=>effect.ownerId===item.playerId&&effect.networkEpoch===item.epoch&&effect.networkId===state.id);
      const projectedPhase=item.action.actor.awakening&&{...structuredClone(item.action.actor.awakening),
        remaining:Math.max(0,item.action.actor.awakening.remaining-age)};
      // A newer full calibration owns its current clock. Otherwise a delayed
      // active event can already be past its local duration. Its inferred end
      // is soft: a later source renewal revision may still extend this ID.
      const newerBody=(original.networkFrameSeq??-1)>item.action.frameSeq&&existing?.sourceContinuousAura?.phase==='active'&&
        existing.sourceContinuousAura.revision>=state.sourceContinuousAura.revision;
      if(!newerBody&&projectedPhase&&(!projectedPhase.full||!(projectedPhase.remaining>0))){
        if((original.networkFrameSeq??-1)<item.action.frameSeq)original.awakening=projectedPhase;
        if(endContinuousAura(simulation,item.playerId,item.epoch,state.id,item.action.frameSeq,state.sourceContinuousAura.revision,
          'continuous-aura-local-phase-expired',{provisional:true}))metrics.continuousAuraEnds++;
        continue;
      }
      if((original.networkFrameSeq??-1)<item.action.frameSeq&&projectedPhase)original.awakening=projectedPhase;
      if(existing){existing.sourceContinuousAura={...state.sourceContinuousAura};existing.networkFrameSeq=Math.max(existing.networkFrameSeq??0,item.action.frameSeq);
        metrics.continuousAuraDuplicates++;continue;}
      // Reconstruct against the captured source definition/anchor, then keep
      // the actual live collider. The temporary actor never rewinds a body.
      const beforeEffects=simulation.state.effects,at=simulation.state.actors.indexOf(original),temporary=structuredClone(original);
      simulation.state.actors[at]=temporary;let installed;
      try{
        const projected={...state,elapsed:(state.elapsed??0)+age,animationTime:(state.animationTime??0)+age,setElapsed:(state.setElapsed??0)+age};
        applyOwnedState(simulation,item.playerId,{epoch:item.epoch,frameSeq:item.action.frameSeq,
          actor:mergeOwnedActionActor(temporary,item.action.actor),effects:[projected],hits:[]},{endMissing:false,presentationAge:age});
        installed=simulation.state.effects.find(effect=>effect.ownerId===item.playerId&&effect.networkId===state.id&&effect.networkEpoch===item.epoch);
      }finally{simulation.state.actors[at]=original;simulation.state.effects=beforeEffects;}
      if(installed){simulation.state.effects.push(installed);metrics.continuousAuraBirths++;
        const previous=history(item.playerId,item.epoch).effects.get(state.id)?.effect;
        if(previous?.networkAuraTargetLives)installed.networkAuraTargetLives={...previous.networkAuraTargetLives};
        original.sourceAwakeningAuraEffectGroup=[...(original.sourceAwakeningAuraEffectGroup??[]).filter(entry=>entry.id!==installed.id),
          {id:installed.id,name:installed.name,setName:installed.setName}];
      }
    }
  }
  const victimRejections={missingHistory:0,life:0,currentProtection:0,expiredSamples:0,positionMismatch:0,animationWitness:0,invalidWitness:0,
    bodyPushDisabled:0,bodyPushProjection:0};
  const victimProtection={missingActor:0,dead:0,disconnected:0,hidden:0,roomPresentation:0,roomInvincibility:0,reactionInvincibility:0,localInvincibility:0};
  function rejectVictim(reason){metrics.rejectedVictimAnchors++;victimRejections[reason]++;return null;}
  const itemKey=item=>item.playerId+':'+item.epoch+':'+item.action.id;
  function markSeen(item){const key=item.playerId+':'+item.epoch;let ids=seen.get(key);if(!ids){ids=new Set();seen.set(key,ids);}ids.add(item.action.id);while(ids.size>256)ids.delete(ids.values().next().value);}
  function observeSource(playerId,epoch,frameSeq){
    if(playbackVersion===1)return playback.observeSource(playerId,epoch,frameSeq);
    if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(frameSeq)||frameSeq<0)return;
    const row=sources.get(playerId);if(!row||epoch>row.epoch)sources.set(playerId,{epoch,frameSeq,at:clock()});
    else if(epoch===row.epoch&&frameSeq>row.frameSeq){row.frameSeq=frameSeq;row.at=clock();}
  }
  function rememberVictim(simulation,localId,epoch,frameSeq){
    if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(frameSeq)||frameSeq<0)return false;
    const actor=simulation.state.actors.find(actor=>actor.id===localId);if(!actor)return false;
    let row=victims.get(localId);if(!row||row.epoch!==epoch){row={epoch,latest:frameSeq,poses:new Map()};victims.set(localId,row);}
    if(frameSeq<row.latest)return false;row.latest=frameSeq;
    // Controller identity only gates compatible geometry interpolation. It is
    // never installed on the owned actor or used as a historical guard.
    const pose={id:actor.id,state:actor.state,stateSerial:actor.stateSerial};for(const field of victimContactFields)if(actor[field]!==undefined)pose[field]=structuredClone(actor[field]);
    // Permission/map metadata validates only the named native body push. It
    // remains outside victimContactFields and is never applied to the owner.
    for(const field of ['grounded','sourceBlackHoleCanPass'])if(Object.hasOwn(actor,field))pose[field]=structuredClone(actor[field]);
    row.poses.set(frameSeq,{pose,at:clock()});
    for(const [frame,item]of row.poses)if(row.latest-frame>victimHistoryFrames||clock()-item.at>victimHistoryMs)row.poses.delete(frame);
    while(row.poses.size>64)row.poses.delete(row.poses.keys().next().value);return true;
  }
  function victimGeometry(simulation,localId,epochFor,item){
    const reference=item.action.targetViews?.find(view=>view.playerId===localId);if(!reference){metrics.unreferencedVictimActions++;return null;}
    try{validateOwnedTargetViews([reference]);}catch{return rejectVictim('invalidWitness');}
    const original=simulation.state.actors.find(actor=>actor.id===localId),row=victims.get(localId),saved=row?.poses.get(reference.frameSeq);
    const samples=reference.positionSamples?.map(sample=>({...sample,saved:row?.poses.get(sample.frameSeq)}));
    if(!original||original.hp<=0||original.pvpDead||original.pvpDisconnected||original.hidden||original.pvpPresentation||original.pvpInvincibleRemaining>0||original.invincible||original.forceInvincible>0){
      if(!original)victimProtection.missingActor++;
      if(original?.hp<=0||original?.pvpDead)victimProtection.dead++;
      if(original?.pvpDisconnected)victimProtection.disconnected++;
      if(original?.hidden)victimProtection.hidden++;
      if(original?.pvpPresentation)victimProtection.roomPresentation++;
      if(original?.pvpInvincibleRemaining>0)victimProtection.roomInvincibility++;
      if(protectedRecovery(original))victimProtection.reactionInvincibility++;
      if(original?.invincible||original?.forceInvincible>0)victimProtection.localInvincibility++;
      return rejectVictim('currentProtection');
    }
    if(reference.epoch!==epochFor(localId)||row&&row.epoch!==reference.epoch)return rejectVictim('life');
    if(!saved||samples?.some(sample=>!sample.saved))return rejectVictim('missingHistory');
    if(row.latest-reference.frameSeq>victimHistoryFrames||clock()-saved.at>victimHistoryMs||
      samples?.some(sample=>row.latest-sample.frameSeq>victimHistoryFrames||clock()-sample.saved.at>victimHistoryMs))return rejectVictim('expiredSamples');
    const pushes=new Set(reference.bodyPushFrames??[]);
    if(pushes.size&&bodyWitnessVersion!==1)return rejectVictim('bodyPushDisabled');
    const source=simulation.state.actors.find(actor=>actor.id===item.playerId);
    const attacker=source&&mergeOwnedActionActor(source,item.action.actor);
    const targetProfile=simulation.profileFor?.(original)??simulation.profile;
    const attackerProfile=source&&(simulation.profileFor?.(source)??simulation.profile);
    const positions=new Map();
    for(const entry of samples??[{frameSeq:reference.frameSeq,saved,weight:1}]){
      const pose=entry.saved.pose;
      const pushed=pushes.has(entry.frameSeq)?nativeBodyPushWitnessPosition(pose,targetProfile,attacker,attackerProfile,
        {map:simulation.map,nativeGeometry:simulation.nativeGeometry}):null;
      if(pushes.has(entry.frameSeq)&&!pushed)return rejectVictim('bodyPushProjection');
      positions.set(entry.frameSeq,pushed??[pose.x,pose.y,pose.z]);
    }
    const position=samples?.reduce((values,sample)=>values.map((value,index)=>value+positions.get(sample.frameSeq)[index]*sample.weight),[0,0,0])
      ??positions.get(reference.frameSeq);
    if(reference.position.some((v,i)=>!Number.isFinite(position[i])||Math.abs(v-position[i])>1e-6))return rejectVictim('positionMismatch');
    // A bounded pose is scoped to native collision queries. The real owner
    // stays in state.actors, including its current state, guard and resources.
    const geometry={};for(const field of victimContactFields)if(Object.hasOwn(saved.pose,field))geometry[field]=structuredClone(saved.pose[field]);
    if(samples||pushes.size)[geometry.x,geometry.y,geometry.z]=position;
    if(samples){
      const frame=samples.reduce((sum,sample)=>sum+sample.frameSeq*sample.weight,0);
      const upper=samples.find(sample=>sample.frameSeq>reference.frameSeq);
      if(frame<reference.frameSeq-1e-7||upper&&frame>upper.frameSeq+1e-7)return rejectVictim('animationWitness');
      // Only a compatible displayed pose interpolates. No historical combat
      // protection or state is read into the current owner's hit decision.
      const a=saved.pose,b=upper?.saved.pose;
      if(b&&a.state===b.state&&a.stateSerial===b.stateSerial&&a.facing===b.facing&&a.animationName===b.animationName&&
        a.animationTransitionSerial===b.animationTransitionSerial&&b.animationTime>=a.animationTime){
        const alpha=Math.max(0,Math.min(1,(frame-reference.frameSeq)/(upper.frameSeq-reference.frameSeq)));
        const continuous=interpolateActorPresentation(a,b,alpha);
        geometry.animationTime=continuous.animationTime;geometry.presentationTransition=structuredClone(continuous.presentationTransition);
      }
    }
    metrics.compensatedVictimContacts++;if(pushes.size)metrics.compensatedVictimBodyPushContacts++;
    return {playerId:localId,attackerId:item.playerId,epoch:reference.epoch,pose:geometry};
  }
  function nextIndex(eligible=()=>true){
    // Source causality wins within each player. Across independent sources,
    // stop-bearing heads precede ordinary collision samples, without sorting
    // unrelated players' unsynchronized source frame numbers as global time.
    const heads=new Map();for(let i=0;i<queued.length;i++){const item=queued[i];if(!eligible(item))continue;const key=item.playerId+':'+item.epoch,old=heads.get(key);
      if(old===undefined||item.action.frameSeq<queued[old].action.frameSeq||item.action.frameSeq===queued[old].action.frameSeq&&item.action.id<queued[old].action.id)heads.set(key,i);}
    return [...heads.values()].sort((a,b)=>Number(!controlAction(queued[a].action))-Number(!controlAction(queued[b].action))||queued[a].arrived-queued[b].arrived||queued[a].playerId.localeCompare(queued[b].playerId))[0];
  }
  function history(id,epoch){
    if(epoch>(lives.get(id)??-1))lives.set(id,epoch);
    const key=id+':'+epoch;let row=histories.get(key);if(!row){row={actors:new Map(),effects:new Map(),frameSeq:0,live:new Set()};histories.set(key,row);}return row;
  }
  function retireEffectReceipts(row){
    for(const [id,effect]of row.effects)if(!row.live.has(id)&&effect.lastFrame<row.frameSeq-maxFrames)row.effects.delete(id);
    if(row.effects.size>maxEffectReceipts)for(const id of row.effects.keys()){
      if(!row.live.has(id))row.effects.delete(id);if(row.effects.size<=maxEffectReceipts)break;
    }
  }
  function retainHits(receipt,hits={},hitGaps={},sourceMemory){
    receipt??={hits,hitGaps};
    if(sourceMemory!==undefined)receipt.sourceHitMemory2016??=sourceMemory;
    // Receipt time and its birth gap travel together. A later legitimate
    // RE_ATTACK updates both; an empty replacement or older sample cannot
    // erase the receiver's last accepted collision.
    for(const [id,time]of Object.entries(hits))if(receipt.hits[id]===undefined||time>receipt.hits[id]){
      receipt.hits[id]=time;if(hitGaps[id]!==undefined)receipt.hitGaps[id]=hitGaps[id];
    }else if(time===receipt.hits[id]&&receipt.hitGaps[id]===undefined&&hitGaps[id]!==undefined)receipt.hitGaps[id]=hitGaps[id];
    return receipt;
  }
  function rememberActor(simulation,actor,epoch){
    const row=history(actor.id,epoch),key=ownedAttackKey(simulation.profileFor?.(actor)??simulation.profile,actor);
    const receipt=retainHits(row.actors.get(key),actor.hits,actor.hitGaps);
    Object.assign(actor,{hits:receipt.hits,hitGaps:receipt.hitGaps});
    // Core phases keep their existing live lifecycle. An actor action key is
    // not a unique core attack identity, so do not revive an old core receipt.
    Object.assign(receipt,{coreHits:actor.core?.hits??{},coreGaps:actor.core?.hitGaps??{},coreHit:actor.core?.hit===true});
    row.actors.set(key,receipt);while(row.actors.size>32)row.actors.delete(row.actors.keys().next().value);
  }
  function rememberEffect(effect,epoch){
    if(effect.networkId===undefined||effect.networkEpoch!==epoch)return;
    const row=history(effect.ownerId,epoch),previous=row.effects.get(effect.networkId),stages=previous?.stages??new Map();
    if(Number.isSafeInteger(effect.networkFrameSeq))row.frameSeq=Math.max(row.frameSeq,effect.networkFrameSeq);
    const stage=effectStage(effect);
    const receipt=retainHits(stages.get(stage),effect.hits,effect.hitGaps,effect.sourceHitMemory2016??=[]);
    let maximumStrikeContinuation=previous?.maximumStrikeContinuation;
    if(isMaximumStrikeShot(effect)){
      // This flag is receiver-private. Only checkHits' successful local
      // accepted-hit hook sets it; wire dead/endReason never produces it.
      // The accepted straight-flight direction belongs to its network ID
      // across NEXT tables. Owner replacements cannot reintroduce steering;
      // this receipt does not retire the shot or authorize a remote HP write.
      maximumStrikeContinuation??={accepted:false,direction:null};
      receipt.onMaximumStrikeAccepted=()=>{
        maximumStrikeContinuation.accepted=true;
        maximumStrikeContinuation.direction??=effect.sourceShadowMesh?.basis?.[0]?.slice()??null;
      };
      if(maximumStrikeContinuation.accepted){
        maximumStrikeHitCompleted(effect);
        if(maximumStrikeContinuation.direction&&effect.sourceShadowMesh)
          orientLiteralMesh(effect.sourceShadowMesh,maximumStrikeContinuation.direction);
      }
    }
    Object.assign(effect,{hits:receipt.hits,hitGaps:receipt.hitGaps,sourceHitMemory2016:receipt.sourceHitMemory2016});stages.set(stage,receipt);
    row.effects.set(effect.networkId,{...previous,effect,stages,...(maximumStrikeContinuation?{maximumStrikeContinuation}:{}),
      lastFrame:Math.max(previous?.lastFrame??0,effect.networkFrameSeq??row.frameSeq)});
    if(row.effects.size>maxEffectReceipts)retireEffectReceipts(row);
    return receipt;
  }
  function rememberLiveEffects(simulation,playerId,epoch){
    const row=history(playerId,epoch),actor=simulation.state.actors.find(actor=>actor.id===playerId);
    if(actor?.networkFrameEpoch===epoch&&Number.isSafeInteger(actor.networkFrameSeq))row.frameSeq=Math.max(row.frameSeq,actor.networkFrameSeq);
    row.live.clear();
    for(const effect of simulation.state.effects)if(effect.ownerId===playerId&&effect.networkEpoch===epoch&&effect.networkId!==undefined){
      row.live.add(effect.networkId);rememberEffect(effect,epoch);
    }
    retireEffectReceipts(row);
  }
  function bind(simulation,localId,epochFor){
    if(playbackVersion===1)playback.bind(simulation,localId,epochFor);
    else {setContinuousAuraVersion(simulation,auraVersion);prepareContinuousAuraLives(simulation,epochFor);}
    if(simulation.networkOwnerId!==undefined&&simulation.networkOwnerId!==localId)return;
    let context=bindings.get(simulation);
    if(!context){
      context={previous:simulation.receiverHitMemory};
      context.hook=({attacker,record,origin,hits,hitGaps})=>{
        if(attacker.id===context.localId||origin.kind==='core')return;
        const epoch=context.epochFor(attacker.id);
        if(origin.kind==='effect')return rememberEffect(record,epoch);
        if(origin.kind!=='character')return;
        const row=history(attacker.id,epoch),key=ownedAttackKey(simulation.profileFor?.(attacker)??simulation.profile,record);
        const previous=row.actors.get(key),receipt=retainHits(previous,hits,hitGaps);
        if(!previous)Object.assign(receipt,{coreHits:record.core?.hits??{},coreGaps:record.core?.hitGaps??{},coreHit:record.core?.hit===true});
        row.actors.set(key,receipt);
        while(row.actors.size>32)row.actors.delete(row.actors.keys().next().value);
        return receipt;
      };
      bindings.set(simulation,context);
    }
    context.localId=localId;context.epochFor=epochFor;simulation.receiverHitMemory=context.hook;
  }
  return {
    setCombatPlaybackVersion(version){
      if(![0,1].includes(version))throw new TypeError('invalid-combat-playback-version');
      if(version!==playbackVersion){for(const item of queued)item.releaseControl?.();queued.length=0;playback.clear();}
      playbackVersion=version;
    },
    observeState(simulation,playerId,report,localId){if(playbackVersion!==1)return false;return playback.observeState(simulation,playerId,report,localId);},
    observeMotion(simulation,playerId,motion,localId){if(playbackVersion!==1)return false;return playback.observeMotion(simulation,playerId,motion,localId);},
    remoteInputs(simulation,localId){return playbackVersion===1?playback.remoteInputs(simulation,localId):{};},
    resetPlayback(playerId,epoch){return playback.reset(playerId,epoch);},
    afterPlaybackStep(simulation){if(playbackVersion===1)playback.afterStep(simulation);},
    receiveTerminals(simulation,playerId,actions,epoch,frameSeq,localId,epochFor){
      if(playbackVersion!==1)return false;
      return playback.receiveTerminals(simulation,playerId,actions,epoch,frameSeq,localId,epochFor);
    },
    consumeTerminals(simulation,localId,epochFor){
      if(playbackVersion!==1)return 0;
      return playback.consumeTerminals(simulation,localId,epochFor);
    },
    get playbackDiagnostics(){return {version:playbackVersion,...playback.diagnostics};},
    setContinuousAuraVersion(version){if(![0,1,2].includes(version))throw new TypeError('invalid-continuous-aura-version');auraVersion=version;},
    setBodyPushWitnessVersion(version){if(![0,1].includes(version))throw new TypeError('invalid-body-push-witness-version');bodyWitnessVersion=version;},
    bind,observeSource,rememberVictim,
    adopt(simulation,playerId,epoch){
      if(playbackVersion===1)return;
      const actor=simulation.state.actors.find(actor=>actor.id===playerId);if(actor)rememberActor(simulation,actor,epoch);
      rememberLiveEffects(simulation,playerId,epoch);
    },
    remember(simulation,localId,epochFor){
      bind(simulation,localId,epochFor);
      if(playbackVersion===1)return;
      // Live and temporary history objects share the receiver's identity
      // ledger, even when the historical collision preceded the live mesh.
      for(const actor of simulation.state.actors)if(actor.id!==localId){const epoch=epochFor(actor.id);rememberActor(simulation,actor,epoch);rememberLiveEffects(simulation,actor.id,epoch);}
    },
    receive(playerId,actions,epoch,latestFrame){
      if(playbackVersion===1)return playback.receiveActions(playerId,actions,epoch,latestFrame);
      if(Array.isArray(actions)&&actions.some(action=>action.playback!==undefined))return false;
      if(!Array.isArray(actions)||actions.length>16||!Number.isSafeInteger(epoch)||epoch<0||!Number.isSafeInteger(latestFrame)||latestFrame<0)return false;
      if(actions.some(action=>!Number.isSafeInteger(action?.id)||action.id<0||!Number.isSafeInteger(action.frameSeq)||action.frameSeq<0||action.frameSeq>latestFrame||!action.actor||!Array.isArray(action.effects)))return false;
      if(actions.some(action=>!validAuraVersions(action))){metrics.continuousAuraRejected++;return false;}
      if(actions.some(action=>!validBodyPushVersions(action))){metrics.bodyPushWitnessRejected++;return false;}
      // A late previous-life history must not delete the current life's
      // collision ledger, even through the standalone consumer entry point.
      if(epoch<(lives.get(playerId)??-1))return false;lives.set(playerId,epoch);
      observeSource(playerId,epoch,latestFrame);
      const receiptHistory=history(playerId,epoch);receiptHistory.frameSeq=Math.max(receiptHistory.frameSeq,latestFrame);retireEffectReceipts(receiptHistory);
      const key=playerId+':'+epoch;let ids=seen.get(key);if(!ids){ids=new Set();seen.set(key,ids);}
      let admitted=true;
      for(const action of actions){
        if(ids.has(action.id)||latestFrame-action.frameSeq>maxFrames&&!auraAction(action))continue;
        const item={playerId,epoch,action,sourceAge:(latestFrame-action.frameSeq)/60,arrived:clock()};
        if(queued.some(old=>itemKey(old)===itemKey(item)))continue;
        const limit=controlAction(action)?maxQueued:Math.max(1,maxQueued-Math.min(16,Math.floor(maxQueued/4)));
        if(queued.length>=limit){metrics.overflowed++;admitted=false;continue;}
        item.releaseControl=presentation.deferControls?.(playerId,epoch,action);queued.push(item);
      }
      // Reserve control capacity and never evict an already-admitted event.
      // Backpressure is a negative admission receipt; a reliable peer retries.
      // Keep only the last life for each player, with at most256 receipts.
      for(const [identity,ids]of seen){while(ids.size>256)ids.delete(ids.values().next().value);if(identity.startsWith(playerId+':')&&identity!==key){seen.delete(identity);histories.delete(identity);}}
      return admitted;
    },
    consume(simulation,localId,epochFor){
      bind(simulation,localId,epochFor);
      if(playbackVersion===1)return playback.beforeStep(simulation,localId,epochFor);
      metrics.lastConsumed=metrics.lastRestoredMeshes=metrics.lastFilteredMeshEvents=0;
      let count=0;
      while(queued.length&&(count<maxActionsPerStep||count<16&&queued.some(item=>controlAction(item.action)))){
        const index=nextIndex(item=>item.epoch<=epochFor(item.playerId)||clock()-item.arrived>maxAgeMs);if(index===undefined)break;
        const item=queued[index],currentEpoch=epochFor(item.playerId);
        queued.splice(index,1);
        item.releaseControl?.();markSeen(item);
        if(!validAuraVersions(item.action)){metrics.continuousAuraRejected++;continue;}
        if(!validBodyPushVersions(item.action)){metrics.bodyPushWitnessRejected++;continue;}
        const latest=sources.get(item.playerId),now=clock();
        const sourceAge=latest?.epoch===item.epoch?Math.max(item.sourceAge,(latest.frameSeq-item.action.frameSeq)/60):item.sourceAge;
        // These are two observations of the same advancing source clock.
        // Project each from its own arrival, then use the newer observation;
        // adding the entire queue wait to an updated frontier counts it twice.
        const presentationAge=Math.max(item.sourceAge+Math.max(0,now-item.arrived)/1000,
          latest?.epoch===item.epoch?(latest.frameSeq-item.action.frameSeq)/60+Math.max(0,now-latest.at)/1000:0);
        if(item.epoch!==currentEpoch||item.playerId===localId){metrics.staleLife++;continue;}
        const expired=now-item.arrived>maxAgeMs||sourceAge>maxFrames/60;
        if(expired&&!auraAction(item.action)){metrics.expired++;continue;}
        const actorIndex=simulation.state.actors.findIndex(actor=>actor.id===item.playerId),original=simulation.state.actors[actorIndex];
        if(!original||original.pvpDisconnected||original.pvpDead)continue;
        applyAuraEvents(simulation,original,item,presentationAge);
        if(expired){metrics.expired++;continue;}
        count++;metrics.lastConsumed++;metrics.totalConsumed++;
        const actorProfile=simulation.profileFor?.(original)??simulation.profile;
        const stored=history(item.playerId,item.epoch),actionKey=ownedAttackKey(actorProfile,item.action.actor);
        let actorHits=stored.actors.get(actionKey);if(!actorHits){
          const same=ownedAttackKey(actorProfile,original)===actionKey;
          const core=original.core?.phase===item.action.actor.core?.phase&&original.core?.targetId===item.action.actor.core?.targetId&&original.core?.attackLevel===item.action.actor.core?.attackLevel;
          actorHits={hits:same?original.hits??{}:{},hitGaps:same?original.hitGaps??{}:{},coreHits:core?original.core?.hits??{}:{},coreGaps:core?original.core?.hitGaps??{}:{},coreHit:core&&original.core?.hit===true};stored.actors.set(actionKey,actorHits);
        }
        while(stored.actors.size>32)stored.actors.delete(stored.actors.keys().next().value);
        const originalEffects=simulation.state.effects,temporary=structuredClone(original),before=presentation.capture(simulation,localId),createdReactions=[];
        const victim=victimGeometry(simulation,localId,epochFor,item),savedGeometry=simulation.receiverContactGeometry;
        const eventStart=simulation.state.events?.length??0;
        const controls=simulation.state.actors.map(actor=>({actor,hasIds:Object.hasOwn(actor,'effectiveBlackHoleIds'),
          ids:actor.effectiveBlackHoleIds===undefined?undefined:[...actor.effectiveBlackHoleIds]}));let samples=[];
        simulation.state.actors[actorIndex]=temporary;
        if(victim)simulation.receiverContactGeometry=victim;else delete simulation.receiverContactGeometry;
        try{
          const existingIds=new Set(originalEffects.filter(effect=>effect.ownerId===item.playerId).map(effect=>effect.networkId));
          // Receipts retain their full bounded identity history, but only the
          // meshes named by this action need to be materialized. Re-cloning
          // every retired mesh makes even one-effect histories grow with the
          // number of past skill effects before applyOwnedState discards them.
          const sampleIds=new Set(item.action.effects.filter(effect=>!(auraVersion>0&&effect.sourceContinuousAura?.version===auraVersion)).map(effect=>effect.id));
          const restored=[...sampleIds].filter(id=>!existingIds.has(id)).map(id=>stored.effects.get(id)?.effect).filter(Boolean);
          metrics.lastRestoredMeshes+=restored.length;metrics.totalRestoredMeshes+=restored.length;
          const historicalEffects=item.action.effects.filter(effect=>!(auraVersion>0&&effect.sourceContinuousAura?.version===auraVersion));
          metrics.continuousAuraHistoricalSkipped+=item.action.effects.length-historicalEffects.length;
          simulation.state.effects=[...originalEffects.map(effect=>effect.ownerId===item.playerId?structuredClone(effect):effect),
            ...restored.map(effect=>structuredClone(effect))];
          applyOwnedState(simulation,item.playerId,{epoch:item.epoch,frameSeq:item.action.frameSeq,actor:mergeOwnedActionActor(temporary,item.action.actor),effects:historicalEffects,hits:[]},
            {endMissing:false,presentationAge});
          Object.assign(temporary,{hits:actorHits.hits,hitGaps:actorHits.hitGaps});
          if(temporary.core)Object.assign(temporary.core,{hits:actorHits.coreHits,hitGaps:actorHits.coreGaps,hit:actorHits.coreHit});
          samples=simulation.state.effects.filter(effect=>effect.ownerId===item.playerId&&!(auraVersion>0&&effect.sourceContinuousAura?.version===auraVersion&&isManagedContinuousAura(effect,original)));
          for(const effect of samples){let row=stored.effects.get(effect.networkId);if(!row){
            const live=originalEffects.find(old=>old.ownerId===item.playerId&&old.networkId===effect.networkId&&old.networkEpoch===item.epoch);
            row={stages:new Map()};if(live)row.stages.set(effectStage(live),{hits:live.hits??{},hitGaps:live.hitGaps??{},sourceHitMemory2016:live.sourceHitMemory2016??[]});stored.effects.set(effect.networkId,row);
          }
          row.lastFrame=Math.max(row.lastFrame??0,item.action.frameSeq);
          // applyOwnedState can strictly claim a predicted local mesh which
          // has not received its source network ID yet. Its own accepted hit
          // and birth gap must join the canonical receipt, never be erased by
          // the first delayed history sample. Wire hit maps are not adopted.
          const stage=effectStage(effect),hit=retainHits(row.stages.get(stage),effect.hits,effect.hitGaps,effect.sourceHitMemory2016??=[]);
          row.stages.set(stage,hit);Object.assign(effect,{hits:hit.hits,hitGaps:hit.hitGaps,sourceHitMemory2016:hit.sourceHitMemory2016});row.effect=effect;}
          retireEffectReceipts(stored);
          presentation.consume(simulation,before,localId,epochFor,()=>presentationAge,
            {onlyActorId:item.playerId,historical:true});
          // Use actual posed native helpers at the captured active clock. No
          // dt is accepted from the wire and no world/local movement advances.
          simulation.checkCharacterAttack(temporary,temporary.animationTime,temporary.animationTime);
          createdReactions.push(...simulation.state.effects.filter(effect=>effect.ownerId===localId&&!originalEffects.includes(effect)));
          // Received-hit callbacks must see the real owner's live effect
          // groups, while only this source's captured colliders execute at dt0.
          simulation.tickEffects(0,samples);simulation.tickCore(temporary,0);
          actorHits.coreHit=temporary.core?.hit===true;
          if(ownedAttackKey(actorProfile,original)===actionKey){original.hits=actorHits.hits;original.hitGaps=actorHits.hitGaps;}
          for(const effect of originalEffects){const row=stored.effects.get(effect.networkId),hit=row?.stages.get(effectStage(effect));if(effect.ownerId===item.playerId&&hit)Object.assign(effect,{hits:hit.hits,hitGaps:hit.hitGaps,sourceHitMemory2016:hit.sourceHitMemory2016});}
        }finally{
          // Keep own effects created by a genuine received hit (e.g. a passive
          // reaction), while restoring remote presentation to its newest state.
          const localEffects=new Set(simulation.state.effects.filter(effect=>effect.ownerId===localId));
          const reactions=[...localEffects].filter(effect=>!originalEffects.includes(effect));
          for(const effect of samples)if(!originalEffects.some(live=>live.id===effect.id))retireIonBlackHole(effect,simulation.state.actors);
          for(const {actor,ids,hasIds}of controls){if(hasIds)actor.effectiveBlackHoleIds=ids;else delete actor.effectiveBlackHoleIds;}
          simulation.state.effects=[...originalEffects.filter(effect=>effect.ownerId!==localId||localEffects.has(effect)),
            ...new Set([...createdReactions,...reactions])];simulation.state.actors[actorIndex]=original;
          if(savedGeometry===undefined)delete simulation.receiverContactGeometry;else simulation.receiverContactGeometry=savedGeometry;
          // These remote meshes existed only during collision compensation.
          // Their birth events must not leave persistent visual parents after
          // restoring the newest live state. Keep pre-existing live events,
          // hit/sound/stop feedback and victim-owned passive reaction effects.
          const events=simulation.state.events;
          if(Array.isArray(events)){
            let write=eventStart;
            for(let read=eventStart;read<events.length;read++){
              const event=events[read];
              // Audited finite pure-visual births have no live mesh control:
              // its original particle runtime owns retirement. The cached
              // active source identity suppresses repeated historical births.
              const finiteBirth=event.type==='effectStarted'&&samples.some(effect=>effect.id===event.effectId&&isFiniteVisualBirth(actorProfile,effect));
              if(event.actorId!==item.playerId||!temporaryMeshEvents.has(event.type)||finiteBirth)events[write++]=event;
              else{metrics.lastFilteredMeshEvents++;metrics.totalFilteredMeshEvents++;}
            }
            events.length=write;
          }
        }
      }
      // A renewal can reinstall a locally expired mesh while a target respawned.
      // Clear its changed life after the shared historical receipt is adopted,
      // and before the next real collision frame gets a chance to use it.
      prepareContinuousAuraLives(simulation,epochFor);return count;
    },
    clear(){
      playback.clear();playbackVersion=0;
      for(const [simulation,context]of bindings)if(simulation.receiverHitMemory===context.hook)simulation.receiverHitMemory=context.previous;
      for(const item of queued)item.releaseControl?.();
      bindings.clear();queued.length=0;seen.clear();histories.clear();lives.clear();sources.clear();victims.clear();presentation.clear();
      for(const key of Object.keys(metrics))metrics[key]=0;
      for(const key of Object.keys(victimRejections))victimRejections[key]=0;
      for(const key of Object.keys(victimProtection))victimProtection[key]=0;
    },
    get diagnostics(){
      let actorReceipts=0,effectReceipts=0,stageReceipts=0;
      for(const row of histories.values()){
        actorReceipts+=row.actors.size;effectReceipts+=row.effects.size;
        for(const effect of row.effects.values())stageReceipts+=effect.stages.size;
      }
      return {...metrics,bodyPushWitnessVersion:bodyWitnessVersion,combatPlaybackVersion:playbackVersion,playback:playback.diagnostics,victimRejections:{...victimRejections},victimProtection:{...victimProtection},pending:playbackVersion===1?playback.diagnostics.pending:queued.length,lifeHistories:histories.size,actorReceipts,effectReceipts,stageReceipts,
        victimHistorySamples:[...victims.values()].reduce((n,row)=>n+row.poses.size,0)};
    },
    get pending(){return playbackVersion===1?playback.diagnostics.pending:queued.length;},
  };
}
