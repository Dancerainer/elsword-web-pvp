/** Local prediction continuation, not a new combat clock or original baseline.
 * The server snapshot supplies the complete state/version seal. Only local
 * sampled packets newer than its acknowledged frame are replayed. Remote SSE
 * packets have already executed and contribute held levels, never new edges.
 *
 * At maxFrames overflow the prior continuation is cleared and the newest
 * packet is retained. This bounds memory without throwing from a render loop;
 * overflowCount records the loss until clear(). The next server snapshot is
 * still authoritative. No discarded frames or combat effects are invented.
 */
const clone=value=>structuredClone(value);
const sequence=(value,name)=>{if(!Number.isSafeInteger(value)||value<0)throw new TypeError(`${name} must be a nonnegative safe integer`);return value;};
const levelList=(value,name)=>{
  if(!Array.isArray(value)||value.some(key=>typeof key!=='string')||new Set(value).size!==value.length)throw new TypeError(`${name} must contain distinct action names`);
  return [...value];
};
export function createInputPredictionHistory({maxFrames=120}={}){
  if(!Number.isSafeInteger(maxFrames)||maxFrames<1)throw new TypeError('maxFrames must be a positive safe integer');
  let pending=[],lastRecorded=null,lastAcknowledged=0,overflowCount=0;
  return {
    record(frameSeq,input){
      sequence(frameSeq,'frameSeq');if(lastRecorded!==null&&frameSeq<=lastRecorded)throw new RangeError('Prediction frame sequence must strictly increase');
      if(frameSeq<=lastAcknowledged)throw new RangeError('Prediction frame was already acknowledged');
      if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Sampled input packet required');
      for(const field of ['held','pressed','released'])levelList(input[field]??[],field);
      const packet=clone(input);let overflow=false;
      if(pending.length>=maxFrames){pending=[];overflow=true;overflowCount++;}
      pending.push({frameSeq,input:packet});lastRecorded=frameSeq;
      return {frameSeq,overflow,pending:pending.length};
    },
    reconcile(simulation,snapshot,localId,serverInputs={}){
      if(typeof simulation?.restore!=='function'||typeof simulation?.step!=='function')throw new TypeError('Prediction simulation restore and step required');
      if(typeof localId!=='string'||!localId||!Array.isArray(snapshot?.actors)||!snapshot.actors.some(actor=>actor.id===localId))throw new TypeError('Authoritative snapshot must contain the local actor');
      const acknowledged=sequence(serverInputs?.[localId]?.frameSeq??0,'server acknowledged frameSeq');
      if(acknowledged<lastAcknowledged)throw new RangeError('Prediction acknowledgement must not move backwards');
      const remoteInputs={};
      for(const actor of snapshot.actors){
        if(actor.id===localId)continue;
        const packet=serverInputs?.[actor.id];
        remoteInputs[actor.id]={held:levelList(packet?.held??[],`server held ${actor.id}`),pressed:[],released:[],sampledDevice:true,pureDouble:[],oneDouble:[]};
      }
      // Clone before restore so host-side restore adapters cannot mutate the
      // received snapshot. Its versions and every other state field survive.
      simulation.restore(clone(snapshot));
      pending=pending.filter(frame=>frame.frameSeq>acknowledged);lastAcknowledged=acknowledged;
      for(const frame of pending){
        const inputs=clone(remoteInputs);inputs[localId]=clone(frame.input);
        simulation.step(1/60,inputs,{snapshot:false});
      }
      return pending.length;
    },
    clear(){pending=[];lastRecorded=null;lastAcknowledged=0;overflowCount=0;},
    get pending(){return pending.length;},get lastRecorded(){return lastRecorded;},get lastAcknowledged(){return lastAcknowledged;},get overflowCount(){return overflowCount;},
  };
}
import {OWNERSHIP_PROTOCOL,encodeOwnedState,encodeOwnedStatusSource,encodeCriticalAction,encodeEffectState,validateOwnedState,validateOwnedReferences,applyOwnedState,flushAddTimeRingNotices} from '../../packages/online/owned-state.mjs';
import {createOwnerStatusClock,decodeOwnerStatusClock,MAX_OWNER_STATUS_CLOCK_FRAMES} from '../../packages/online/owner-status-clock.mjs';
import {validateOwnedMotion} from '../../packages/online/owned-motion.mjs';
import {validateOwnerBuffSnapshot} from '../../packages/online/owner-buff-sync.mjs';
import {validateOwnedBuffReferences} from '../../packages/online/owned-state.mjs';
import {createCombatPlaybackProducer} from '../../packages/online/combat-playback.mjs';
import {encodeOwnedStatus,validateOwnedStatus,validateOwnedStatusReferences,captureOwnedStatusActor,applyOwnedStatusActor} from '../../packages/online/owned-status.mjs';
import {flushAddTargetNotices} from '../../packages/combat-core/add-target-notices.mjs';
import {flushAddStigmaNotices} from '../../packages/combat-core/add-stigma.mjs';
import {flushElesisFireAbsorbNotices} from '../../packages/combat-core/elesis-fire-absorb-v45.mjs';
import {flushAddMoonlightNotices} from '../../packages/combat-core/add-moonlight-receipts-v45.mjs';
import {createRemoteActionConsumer} from './owned-actions.mjs';
import {retireIonBlackHole} from '../../packages/combat-core/black-hole.mjs';
import {isFiniteVisualBirth} from '../../packages/combat-core/finite-visual-birth.mjs';
import {effectStageDamageData} from '../../packages/combat-core/literal-mesh-clock.mjs';
import {createOwnedBodyArrivalGuard} from '../../packages/online/owned-body-arrival.mjs';
import {isContinuousRavenAura,setContinuousAuraVersion as setSimulationAuraVersion,clearContinuousAuraOwner,prepareContinuousAuraLives} from '../../packages/combat-core/continuous-aura.mjs';

/** The local player never rolls back to an HTTP acknowledgement. Only room
 * lifecycle changes (a new life, disconnect or final result) reset that actor. */
export function createLocalOwnershipSync({reportEvery=3,presentation,remotePresentation,clock=()=>performance.now(),continuousAuraVersion=0,ownerStatusVersion=0,combatPlaybackVersion=0,playbackMaxAdditionalAgeMs=250}={}){
  if(![0,1,2].includes(continuousAuraVersion))throw new TypeError('invalid-continuous-aura-version');
  if(![0,1].includes(ownerStatusVersion))throw new TypeError('invalid-owner-status-version');
  let statusVersion=ownerStatusVersion;const statusClock=createOwnerStatusClock(),remoteStatuses=new Map(),remoteProtections=new Map(),remoteBuffs=new Map();
  const protectionFields=['invincible','showInvincible','superArmor','superArmorNotRed','skillSuperArmorNotRed','forceInvincible'];
  // A domain already applied at this source frame is also authoritative:
  // cross-channel duplicates must not restart its locally elapsed timers.
  const atOrAfter=(row,status)=>row&&row.epoch===status.epoch&&(row.revision>status.actor.sourceStatusClock.revision||row.frameSeq>=status.frameSeq);
  const protection=actor=>Object.fromEntries(protectionFields.filter(key=>Object.hasOwn(actor,key)).map(key=>[key,structuredClone(actor[key])]));
  function restoreProtection(actor,saved){for(const key of protectionFields)if(Object.hasOwn(saved,key))actor[key]=saved[key];else delete actor[key];}
  let playbackVersion=combatPlaybackVersion;const playbackProducer=createCombatPlaybackProducer({version:combatPlaybackVersion});
  const statusDiagnostics={accepted:0,duplicates:0,stale:0,restoredAfterBody:0,rejected:0};
  let auraVersion=continuousAuraVersion,lastSimulation=null;const ownedAuras=new Map();
  if(!Number.isSafeInteger(reportEvery)||reportEvery<1)throw new TypeError('reportEvery must be positive');
  const epochs=new Map(),received=new Map(),hits=new Map(),critical=[],effectSamples=new Map(),disconnected=new Set(),disconnectedEpochs=new Map();
  const bodyArrivals=createOwnedBodyArrivalGuard();
  const consumer=createRemoteActionConsumer({presentation,clock,continuousAuraVersion,bodyPushWitnessVersion:ownerStatusVersion,combatPlaybackVersion,playbackMaxAdditionalAgeMs});let frames=0,lastReportFrame=0,lastPhase=null,lastDirect=-10,lastPresentation=-10,priorEffects=new Map();
  function configurePlayback(value){if(![0,1].includes(value))throw new TypeError('invalid-combat-playback-version');
    if(playbackVersion===1&&value!==1&&epochs.size)throw new TypeError('combat-playback-room-downgrade');
    playbackVersion=value;playbackProducer.setVersion(value);consumer.setCombatPlaybackVersion(value);
    if(lastSimulation)lastSimulation.networkCombatPlaybackVersion=value;}
  function configureAura(value){if(![0,1,2].includes(value))throw new TypeError('invalid-continuous-aura-version');
    if(auraVersion!==value)ownedAuras.clear();auraVersion=value;consumer.setContinuousAuraVersion(value);
    if(lastSimulation)setSimulationAuraVersion(lastSimulation,value);}
  function useAura(simulation){lastSimulation=simulation;setSimulationAuraVersion(simulation,auraVersion);simulation.networkCombatPlaybackVersion=playbackVersion;}
  function configureStatus(value){if(![0,1].includes(value))throw new TypeError('invalid-owner-status-version');
    if(value!==statusVersion){statusClock.clear();remoteStatuses.clear();remoteProtections.clear();remoteBuffs.clear();}statusVersion=value;remotePresentation?.setBodyPushWitnessVersion?.(value);consumer.setBodyPushWitnessVersion(value);}
  function receiveBuffs(simulation,playerId,value,localId){
    if(statusVersion!==1||playbackVersion!==1||playerId===localId||disconnected.has(playerId))return false;
    validateOwnerBuffSnapshot(value);const actor=simulation.state.actors.find(a=>a.id===playerId);
    if(!actor||actor.pvpDead||actor.pvpDisconnected||epochs.get(playerId)!==value.epoch)return false;
    const prior=remoteBuffs.get(playerId),full=remoteStatuses.get(playerId),observed=remoteProtections.get(playerId);
    if(prior?.epoch===value.epoch&&(value.revision<prior.revision||value.revision===prior.revision&&value.frameSeq<=prior.anchorFrameSeq)
      ||full?.epoch===value.epoch&&value.frameSeq<=(full.buffFrameSeq??full.frameSeq)||observed?.epoch===value.epoch&&value.revision<observed.buffRevision)return false;
    validateOwnedBuffReferences(value.buffs,actor,simulation.profileFor?.(actor)??simulation.profile,{profiles:simulation.profiles,actors:simulation.state.actors});
    const frameSeq=Math.max(value.frameSeq,observed?.epoch===value.epoch?observed.frameSeq:value.frameSeq);
    if(prior?.epoch===value.epoch&&prior.revision===value.revision&&prior.frameSeq>=frameSeq){
      prior.anchorFrameSeq=value.frameSeq;return false;
    }
    // Repair can arrive after a compact protection checkpoint. Reconstruct
    // on that known source clock, never on this browser's simulation clock.
    if(frameSeq-value.frameSeq>MAX_OWNER_STATUS_CLOCK_FRAMES)return false;
    const materialized=decodeOwnerStatusClock({...captureOwnedStatusActor(actor),buffs:value.buffs,
      sourceStatusClock:{version:1,revision:1,frameSeq:value.frameSeq}},frameSeq);
    applyOwnedStatusActor(simulation,playerId,{...captureOwnedStatusActor(actor),buffs:materialized.buffs});
    remoteBuffs.set(playerId,{epoch:value.epoch,revision:value.revision,frameSeq,anchorFrameSeq:value.frameSeq});return true;
  }
  function receiveProtection(simulation,playerId,value,localId,buffRevision){
    if(statusVersion!==1||playbackVersion!==1||playerId===localId||disconnected.has(playerId))return false;
    if(buffRevision!==undefined&&(!Number.isSafeInteger(buffRevision)||buffRevision<1))throw new TypeError('invalid-owner-buff-revision');
    const status=validateOwnedStatus(value),actor=simulation.state.actors.find(a=>a.id===playerId);
    if(!actor||actor.pvpDisconnected||actor.pvpDead||epochs.get(playerId)!==status.epoch||status.actor.buffs.length!==0)return false;
    const prior=remoteProtections.get(playerId),marker=status.actor.sourceStatusClock;
    if(atOrAfter(remoteStatuses.get(playerId),status)||atOrAfter(prior,status))return false;
    const decoded=decodeOwnerStatusClock(status.actor,status.frameSeq);delete decoded.sourceStatusClock;
    applyOwnedStatusActor(simulation,playerId,{...decoded,buffs:actor.buffs});
    remoteProtections.set(playerId,{epoch:status.epoch,revision:marker.revision,frameSeq:status.frameSeq,buffRevision});return true;
  }
  function receiveStatus(simulation,playerId,value,localId){
    if(statusVersion!==1||playerId===localId||disconnected.has(playerId)){statusDiagnostics.rejected++;return false;}
    const status=validateOwnedStatus(value),actor=simulation.state.actors.find(a=>a.id===playerId);
    if(!actor||actor.pvpDisconnected||actor.pvpDead||epochs.get(playerId)!==status.epoch){statusDiagnostics.rejected++;return false;}
    validateOwnedStatusReferences(status,actor,simulation.profileFor?.(actor)??simulation.profile,{profiles:simulation.profiles,actors:simulation.state.actors});
    const marker=status.actor.sourceStatusClock,old=remoteStatuses.get(playerId);
    if(old&&old.epoch===status.epoch){
      if(marker.revision<old.revision||status.frameSeq<old.frameSeq){statusDiagnostics.stale++;return false;}
      if(marker.revision===old.revision&&status.frameSeq===old.frameSeq){statusDiagnostics.duplicates++;return false;}
    }
    const observed=remoteProtections.get(playerId),saved=atOrAfter(observed,status)?protection(actor):null,priorBuff=remoteBuffs.get(playerId);
    const decoded=decodeOwnerStatusClock(status.actor,status.frameSeq);delete decoded.sourceStatusClock;
    const preserveBuffs=priorBuff?.epoch===status.epoch&&priorBuff.frameSeq>=status.frameSeq
      ||observed?.epoch===status.epoch&&observed.buffRevision!==undefined&&observed.frameSeq>status.frameSeq;
    if(preserveBuffs)decoded.buffs=actor.buffs;
    if(saved)restoreProtection(decoded,saved);applyOwnedStatusActor(simulation,playerId,decoded);
    remoteStatuses.set(playerId,{epoch:status.epoch,revision:marker.revision,frameSeq:status.frameSeq,
      buffFrameSeq:preserveBuffs?(old?.epoch===status.epoch?(old.buffFrameSeq??old.frameSeq):-1):status.frameSeq});statusDiagnostics.accepted++;return true;
  }
  function receiveMotion(simulation,playerId,value,localId){
    if(playbackVersion!==1||playerId===localId||disconnected.has(playerId))return false;
    const actor=simulation.state.actors.find(row=>row.id===playerId);
    if(!actor||actor.hp<=0||actor.pvpDead||actor.pvpDisconnected||epochs.get(playerId)!==value?.epoch)return false;
    const motion=validateOwnedMotion(value,simulation.map);
    // Movement has its own monotonic frontier. Do not advance `received`,
    // admit any actions, or acknowledge a complete owner pose on this path.
    return consumer.observeMotion(simulation,playerId,motion,localId);
  }
  function projectStatus(report,projection){
    if(statusVersion===1)Object.assign(report.actor,projection.actor);
    else {delete report.actor.forceInvincible;delete report.actor.sourceStatusClock;}
    return report;
  }
  function captureAuras(simulation,actor,events){
    if(auraVersion===0)return [];
    const profile=simulation.profileFor?.(actor)??simulation.profile,changes=[];
    const live=simulation.state.effects.filter(effect=>effect.ownerId===actor.id&&effect.active&&!effect.dead&&isContinuousRavenAura(effect,profile,auraVersion));
    const renewing=events.some(event=>event.actorId===actor.id&&event.type==='reawakenCoreRefill');
    for(const effect of live){
      if(actor.hp<=0||actor.pvpDead||actor.pvpDisconnected)continue;
      let row=ownedAuras.get(effect.id);const born=!row;
      if(!row){row={effect,revision:1};ownedAuras.set(effect.id,row);}else if(renewing)row.revision++;
      row.effect=effect;
      effect.sourceContinuousAura={version:auraVersion,revision:row.revision,phase:'active'};
      if(born||renewing)changes.push(encodeEffectState(effect,profile));
    }
    const ids=new Set(live.filter(()=>actor.hp>0&&!actor.pvpDead&&!actor.pvpDisconnected).map(effect=>effect.id));
    for(const [id,row]of ownedAuras)if(!ids.has(id)){
      const effect=row.effect;row.revision++;
      changes.push({...encodeEffectState(effect,profile),active:false,dead:true,endEmitted:true,
        sourceContinuousAura:{version:auraVersion,revision:row.revision,phase:'ended'}});
      if(effect.active&&!effect.endEmitted)simulation.emit?.('effectEnded',actor.id,{effectId:id,name:effect.name,setName:effect.setName,reason:'continuous-aura-ended'});
      effect.dead=true;effect.endEmitted=true;ownedAuras.delete(id);
    }
    return changes;
  }
  const track=actor=>[actor.state,actor.stateSerial,actor.facing,actor.grounded,actor.lineId,actor.lastTouchLineId,
    actor.animationName,actor.animationTransitionSerial];
  let previousTrack=null;
  const roomFields=['pvpPresentation','pvpModifiers','onlineBuffs','pvpDead','pvpDisconnected','pvpInvincibleRemaining','pvpWhiteFlash'];
  function removeEffects(simulation,id){
    for(const effect of simulation.state.effects)if(effect.ownerId===id){
      retireIonBlackHole(effect,simulation.state.actors);
      if(effect.active&&simulation.emit)simulation.emit('effectEnded',id,{effectId:effect.id,name:effect.name,setName:effect.setName,reason:'network-owner-effect-ended'});
    }
    simulation.state.effects=simulation.state.effects.filter(effect=>effect.ownerId!==id);
  }
  function disconnect(simulation,id,epoch=epochs.get(id)){
    if(typeof id!=='string'||!id)return false;
    if(Number.isSafeInteger(epoch)&&epoch>=0){
      if(epoch<(epochs.get(id)??-1))return false;
      disconnectedEpochs.set(id,Math.max(epoch,disconnectedEpochs.get(id)??-1));
    }
    disconnected.add(id);
    remoteStatuses.delete(id);
    const actor=simulation.state.actors.find(actor=>actor.id===id);if(!actor)return false;
    Object.assign(actor,{pvpDisconnected:true,pvpDead:true,hidden:true,hp:0,deathComplete:true,inputLock:1e9,onlineBuffs:[]});
    removeEffects(simulation,id);clearContinuousAuraOwner(simulation,id);remotePresentation?.reset(id);
    if(playbackVersion===1)consumer.resetPlayback(id,epochs.get(id)??0);
    if(simulation.state.contactObservations)delete simulation.state.contactObservations[id];
    return true;
  }
  function applyRoom(actor,server,pvp){
    for(const key of roomFields)if(Object.hasOwn(server,key))actor[key]=structuredClone(server[key]);else delete actor[key];
    const player=pvp?.players?.find(player=>player.id===actor.id);
    if(player){
      if(!player.connected){actor.hidden=true;actor.hp=0;actor.deathComplete=true;actor.inputLock=1e9;}
      else if(!['fight','slow'].includes(pvp.phase)||!player.alive)actor.inputLock=Math.max(actor.inputLock??0,1);
      else if(player.lockUntil>pvp.fightTime)actor.inputLock=Math.max(actor.inputLock??0,player.lockUntil-pvp.fightTime);
      else if(pvp.phase==='fight'&&lastPhase!=='fight')actor.inputLock=0;
      if(player.invincibleUntil>pvp.fightTime)actor.forceInvincible=Math.max(actor.forceInvincible??0,player.invincibleUntil-pvp.fightTime);
      if(pvp.phase==='slow')actor.inputLock=Math.max(actor.inputLock??0,1);
      if(pvp.phase==='result')actor.forceInvincible=9999;
    }
  }
  function applyRemote(simulation,playerId,report,localId){
    if(playbackVersion===1){consumer.observeState(simulation,playerId,report,localId);
      if(report.actor.sourceStatusClock&&statusVersion===1)receiveStatus(simulation,playerId,encodeOwnedStatus(report),localId);
      return;}
    const prior=remoteStatuses.get(playerId),marker=report.actor.sourceStatusClock;
    const preserve=statusVersion===1&&prior&&prior.epoch===report.epoch&&
      (!marker||marker.revision<prior.revision||report.frameSeq<prior.frameSeq);
    const saved=preserve?captureOwnedStatusActor(simulation.state.actors.find(a=>a.id===playerId)):null;
    const before=bodyArrivals.capture(simulation,playerId,localId);
    applyOwnedState(simulation,playerId,report);
    if(saved){applyOwnedStatusActor(simulation,playerId,saved);statusDiagnostics.restoredAfterBody++;}
    else if(marker&&statusVersion===1)remoteStatuses.set(playerId,{epoch:report.epoch,revision:marker.revision,frameSeq:report.frameSeq});
    bodyArrivals.accept(simulation,playerId,report,localId,before);
    remotePresentation?.observe(simulation.state.actors.find(actor=>actor.id===playerId),report);
  }
  function receivePeerResult(simulation,playerId,report,localId){
    const rejected=reason=>({validated:false,applied:false,reason});
    if(playerId===localId||epochs.get(playerId)!==report?.epoch)return rejected('life-or-owner');
    report=validateOwnedState(report);const actor=simulation.state.actors.find(actor=>actor.id===playerId);
    if(!actor||actor.pvpDisconnected||actor.pvpDead||disconnected.has(playerId))return rejected('retired-owner');
    validateOwnedReferences(report,actor,simulation.profileFor?.(actor)??simulation.profile,simulation.map,{profiles:simulation.profiles,actors:simulation.state.actors});
    if(report.actor.sourceStatusClock&&statusVersion!==1)return rejected('unnegotiated-status-clock');
    // A relay copy can win the race without making the following direct copy
    // an invalid delivery. Keep the boolean application API, but let transport
    // confirmation distinguish a fully validated duplicate from a rejection.
    const delivered={validated:true,playerId,epoch:report.epoch,frameSeq:report.frameSeq};
    consumer.observeSource(playerId,report.epoch,report.frameSeq);
    if(report.actions?.length){consumer.receive(playerId,report.actions,report.epoch,report.frameSeq);bodyArrivals.observeActions(playerId,report.actions,report.epoch,report.frameSeq);}
    if(report.frameSeq<=(received.get(playerId)??-1)){
      // A replaceable pose may outrun a reliable controller packet. Preserve
      // that older packet's exact-frame reaction header without rewinding its
      // newer vitals/pose; queued starts still need the owning victim's STOP.
      if(playbackVersion===1)consumer.observeState(simulation,playerId,report,localId);
      return {...delivered,applied:false,reason:'already-applied'};
    }
    applyRemote(simulation,playerId,report,localId);
    consumer.adopt(simulation,playerId,report.epoch);received.set(playerId,report.frameSeq);
    return {...delivered,applied:true,reason:'applied'};
  }
  return {
    setContinuousAuraVersion:configureAura,
    setOwnerStatusVersion:configureStatus,
    setCombatPlaybackVersion:configurePlayback,
    remoteInputs:(simulation,localId)=>consumer.remoteInputs(simulation,localId),
    get combatPlaybackDiagnostics(){return {producer:playbackProducer.diagnostics,receiver:consumer.playbackDiagnostics};},
    receiveStatus,
    receiveProtection,
    receiveBuffs,
    receiveMotion,
    reconcile(simulation,value,localId){
      if(value?.ownership?.mode!==OWNERSHIP_PROTOCOL)throw new TypeError('local-ownership-state-required');
      if(Object.hasOwn(value.ownership,'continuousAuraVersion'))configureAura(value.ownership.continuousAuraVersion);
      if(Object.hasOwn(value.ownership,'ownerStatusVersion'))configureStatus(value.ownership.ownerStatusVersion);
      if(Object.hasOwn(value.ownership,'combatPlaybackVersion'))configurePlayback(value.ownership.combatPlaybackVersion);
      useAura(simulation);
      simulation.networkEpochFor=id=>epochs.get(id)??0;
      consumer.bind(simulation,localId,id=>epochs.get(id)??0);
      bodyArrivals.observe(simulation,localId);
      let resets=0;
      simulation.deferAddTimeRingNotices=true;
      try{
      for(const server of value.snapshot.actors){
        const own=value.ownership.actors?.[server.id];if(!own||!Number.isSafeInteger(own.epoch)||own.epoch<0)throw new TypeError('invalid-life-epoch');
        const oldEpoch=epochs.get(server.id);if(oldEpoch!==undefined&&own.epoch<oldEpoch)continue;
        if(disconnected.has(server.id)){
          // Only the room can reincarnate a confirmed missing seat. Neither a
          // delayed peer packet nor a same-epoch full snapshot removes it.
          const connected=value.pvp?.players?.find(player=>player.id===server.id)?.connected===true;
          const retiredEpoch=disconnectedEpochs.get(server.id)??oldEpoch;
          if(!connected||server.pvpDisconnected||retiredEpoch===undefined||own.epoch<=retiredEpoch){disconnect(simulation,server.id,server.pvpDisconnected?own.epoch:retiredEpoch);continue;}
          disconnected.delete(server.id);disconnectedEpochs.delete(server.id);
        }
        const index=simulation.state.actors.findIndex(actor=>actor.id===server.id);if(index<0)throw new TypeError('missing-owner-actor');
        if(oldEpoch!==own.epoch){
          if(oldEpoch!==undefined)clearContinuousAuraOwner(simulation,server.id);
          simulation.state.actors[index]=structuredClone(server);epochs.set(server.id,own.epoch);received.delete(server.id);
          remoteStatuses.delete(server.id);remoteProtections.delete(server.id);remoteBuffs.delete(server.id);
          if(playbackVersion===1)consumer.resetPlayback(server.id,own.epoch);
          if(server.id===localId)bodyArrivals.clear();
          bodyArrivals.reset(server.id,own.epoch);
          remotePresentation?.reset(server.id);
          if(simulation.state.contactObservations)delete simulation.state.contactObservations[server.id];
          removeEffects(simulation,server.id);resets++;
          if(server.id===localId){playbackProducer.clear();hits.clear();critical.length=0;effectSamples.clear();priorEffects.clear();ownedAuras.clear();statusClock.clear();frames=0;lastReportFrame=0;lastDirect=-10;lastPresentation=-10;previousTrack=track(server);}
        }
        const actor=simulation.state.actors[index],wire=value.owners?.[server.id],report=wire?{...wire,actor:wire.actor??server}:null;
        if(report&&server.id!==localId&&report.epoch===own.epoch)consumer.observeSource(server.id,report.epoch,report.frameSeq);
        const past=value.recentActions?.[server.id];if(past&&server.id!==localId)bodyArrivals.observeActions(server.id,past.actions,past.epoch,past.frameSeq);
        if(server.id!==localId&&report&&report.epoch===own.epoch&&report.frameSeq>(received.get(server.id)??-1)){
          validateOwnedReferences(report,actor,simulation.profileFor?.(actor)??simulation.profile,simulation.map,{profiles:simulation.profiles,actors:simulation.state.actors});applyRemote(simulation,server.id,report,localId);
          consumer.adopt(simulation,server.id,report.epoch);received.set(server.id,report.frameSeq);
        }
        if(server.id!==localId&&wire?.status&&statusVersion===1)receiveStatus(simulation,server.id,wire.status,localId);
        // Remote owner reports may predate a room death/respawn. Apply the
        // server's lifecycle fields last; peers cannot revive disconnected units.
        applyRoom(simulation.state.actors[index],server,value.pvp);
        if(server.pvpDisconnected||value.pvp?.players?.find(player=>player.id===server.id)?.connected===false)disconnect(simulation,server.id);
        if(simulation.state.actors[index].pvpDisconnected)removeEffects(simulation,server.id);
        if(simulation.state.actors[index].pvpDisconnected||simulation.state.actors[index].pvpDead)remotePresentation?.reset(server.id);
        if(past&&server.id!==localId)consumer.receive(server.id,past.actions,past.epoch,past.frameSeq);
      }
      }catch(error){flushAddTimeRingNotices(simulation,{discard:true});flushAddTargetNotices(simulation,{discard:true});flushAddStigmaNotices(simulation,{discard:true});flushElesisFireAbsorbNotices(simulation,{discard:true});flushAddMoonlightNotices(simulation,{discard:true});throw error;}
      finally{simulation.deferAddTimeRingNotices=false;}
      flushAddTimeRingNotices(simulation);
      flushAddTargetNotices(simulation);
      flushAddStigmaNotices(simulation);
      flushElesisFireAbsorbNotices(simulation);
      flushAddMoonlightNotices(simulation,{powerFor:(a,r)=>simulation.addMoonlightPowerFor(a,r)});
      lastPhase=value.pvp?.phase;return {resets,replayed:0};
    },
    receivePeerResult,
    receivePeer(simulation,playerId,report,localId){return receivePeerResult(simulation,playerId,report,localId).applied;},
    receiveActions(playerId,actions,epoch,frameSeq){if(disconnected.has(playerId))return false;const count=consumer.receive(playerId,actions,epoch,frameSeq);bodyArrivals.observeActions(playerId,actions,epoch,frameSeq);return count;},
    receiveTerminals(simulation,playerId,actions,epoch,frameSeq,localId){
      if(playbackVersion!==1||playerId===localId||disconnected.has(playerId)||!epochs.has(playerId))return false;
      return consumer.receiveTerminals(simulation,playerId,actions,epoch,frameSeq,localId,id=>epochs.get(id)??0);
    },
    beforeTerminalStep(simulation,localId){
      if(playbackVersion!==1)return 0;
      useAura(simulation);simulation.setContactObservations?.([]);
      // Slow still advances existing local effects. Preserve their exact
      // pre-step identities for terminal capture, without playing new input.
      playbackProducer.beforeStep(simulation,localId);
      consumer.bind(simulation,localId,id=>epochs.get(id)??0);
      return consumer.consumeTerminals(simulation,localId,id=>epochs.get(id)??0);
    },
    disconnect,
    beforeStep(simulation,localId,{now}={}){
      useAura(simulation);prepareContinuousAuraLives(simulation,id=>epochs.get(id)??0);
      if(playbackVersion===1){simulation.setContactObservations?.([]);
        consumer.bind(simulation,localId,id=>epochs.get(id)??0);playbackProducer.beforeStep(simulation,localId);
        consumer.consume(simulation,localId,id=>epochs.get(id)??0);return;}
      if(remotePresentation?.contacts)simulation.setContactObservations(remotePresentation.contacts(simulation.state.actors,localId,{now}));
      bodyArrivals.observe(simulation,localId);
      consumer.remember(simulation,localId,id=>epochs.get(id)??0);
      consumer.consume(simulation,localId,id=>epochs.get(id)??0);
      priorEffects=new Map(simulation.state.effects.filter(effect=>effect.ownerId===localId).map(effect=>[effect.id,effect]));
    },
    afterStep(simulation,localId,events=[],input={}){
      useAura(simulation);
      for(const event of events)if(event.type==='hit'&&event.targetId===localId&&event.amount>0)hits.set(event.eventId,event);
      if(hits.size>128)throw new RangeError('owner-hit-history-overflow');
      frames++;const actor=simulation.state.actors.find(actor=>actor.id===localId),effectIds=new Set(),liveSampleIds=new Set();
      const statusProjection=statusVersion===1?statusClock.encode(encodeOwnedStatusSource(actor),epochs.get(localId)??0,frames):null;
      if(playbackVersion===1){
        consumer.afterPlaybackStep(simulation);
        let report;
        const getReport=()=>report??=encodeOwnedState(simulation,localId,{epoch:epochs.get(localId)??0,frameSeq:frames});
        const sample=playbackProducer.capture(simulation,localId,{epoch:epochs.get(localId)??0,frameSeq:frames,events,held:input.held??[],getReport});
        const currentTrack=track(actor),changed=!previousTrack||currentTrack.some((value,i)=>value!==previousTrack[i]);previousTrack=currentTrack;
        if(frames-lastReportFrame<Math.max(3,reportEvery)&&!sample&&!changed&&!statusProjection?.changed&&!statusProjection?.checkpoint&&!hits.size)return null;
        report=projectStatus(getReport(),statusProjection);
        report.hits=[...hits.values()].map(event=>({id:event.eventId,attackerId:event.actorId,damage:event.amount}));hits.clear();
        report.actions=sample?[{...sample,ageFrames:0}]:[];
        if(sample)projectStatus({actor:sample.actor},statusProjection);
        lastReportFrame=frames;return report;
      }
      const auraEvents=captureAuras(simulation,actor,events);
      // A controller boundary is already authoritative locally. Publish its
      // actual source tick rather than quantizing starts/turns/stops to 20 Hz.
      // Ordinary movement keeps the periodic cadence; at most one report can
      // leave each 60 Hz step, through the transport's replaceable pending slot.
      const currentTrack=track(actor),changed=!previousTrack||currentTrack.some((value,i)=>value!==previousTrack[i]);
      previousTrack=currentTrack;
      for(const effect of simulation.state.effects)if(effect.ownerId===localId&&effect.active&&!effect.dead){
        liveSampleIds.add(effect.id);
        if(auraVersion>0&&isContinuousRavenAura(effect,simulation.profileFor?.(actor)??simulation.profile,auraVersion))continue;
        if(!effect.damage||((effectStageDamageData(effect.damage,effect.stage))?.REACT_TYPE??0)===0)continue;
        const clock=effect.damage.USE_GLOBAL_TIME===1?effect.elapsed:effect.animationTime;
        if(clock>=(effect.damage.ATTACK_TIME_START??0)&&clock<(effect.damage.ATTACK_TIME_END??Infinity)&&
          (effectSamples.get(effect.id)??-100)<frames-2){effectIds.add(effect.id);effectSamples.set(effect.id,frames);}
      }
      // IDs advance throughout a life. Once a mesh retires its throttle no
      // longer serves a collision sample; retain only currently active meshes.
      for(const id of effectSamples.keys())if(!liveSampleIds.has(id))effectSamples.delete(id);
      const direct=frames-lastDirect>=3&&events.some(event=>event.type==='attackWindow'&&event.actorId===localId);
      // A once-only stop/core trigger cannot be throttled behind a sound from
      // the previous source step. Its collision/control history must survive
      // replacement of this body's ordinary dynamic upload.
      const urgent=events.some(event=>event.actorId===localId&&(event.type==='worldStop'||event.type==='coreAttackStarted'));
      const outward=urgent||frames-lastPresentation>=3&&events.some(event=>event.actorId===localId&&
        event.type==='sound'&&/^(?:SOUND_PLAY|STATE_SOUND_PLAY)/.test(event.field??''));
      const born=events.filter(event=>event.type==='effectStarted'&&event.actorId===localId);
      let report;
      if(direct||outward||effectIds.size||born.length||auraEvents.length){
        report=projectStatus(encodeOwnedState(simulation,localId,{epoch:epochs.get(localId)??0,frameSeq:frames}),statusProjection);
        const targetViews=simulation.state.actors.filter(target=>target.id!==localId&&target.team!==actor.team&&!target.pvpDead&&!target.pvpDisconnected)
          .flatMap(target=>{const reference=remotePresentation?.observationReference?.(target.id);return reference?[{playerId:target.id,...reference}]:[];});
        const sample=encodeCriticalAction(report,{id:frames,effectIds,targetViews});
        for(const state of auraEvents)if(!sample.effects.some(effect=>effect.id===state.id))sample.effects.push(state);
        // A one-hit effect may be born and retired in one source step. Preserve
        // its actual last object, or its canonical birth if created this step.
        for(const event of born)if(!sample.effects.some(effect=>effect.id===event.effectId)){
          const actorProfile=simulation.profileFor?.(actor)??simulation.profile;
          // A managed newborn can be retired by the same native tick (for
          // example its caster dies). Never turn that closed birth into the
          // legacy synthetic active history collider.
          if(auraVersion>0&&isContinuousRavenAura({name:event.name,setName:event.setName},actorProfile,auraVersion))continue;
          const old=priorEffects.get(event.effectId),definition=actorProfile.damageEffects[event.name]?.raw;
          const visual=event.visualBirth&&isFiniteVisualBirth(actorProfile,event.visualBirth);
          if(!visual&&(!definition||(definition.DAMAGE_DATA?.REACT_TYPE??0)===0))continue;
          const wire=visual?encodeEffectState(event.visualBirth,actorProfile):old?encodeEffectState(old,actorProfile):{id:event.effectId,name:event.name,setName:event.setName,
            ownerStateSerial:event.ownerStateSerial,clock:'custom',start:0,setElapsed:0,elapsed:0,animationTime:0,
            x:event.birthAnchor?.position?.[0]??actor.x,y:event.birthAnchor?.position?.[1]??actor.y,z:event.birthAnchor?.position?.[2]??actor.z,
            facing:actor.facing,birthAnchor:structuredClone(event.birthAnchor),deleteConditions:event.deleteConditions??[],
            skillId:actor.skillId,powerMultiplier:actor.skillScale,hits:{},hitGaps:{},hitCount:0,childCounts:{},soundFired:[]};
          Object.assign(wire,{active:true,dead:false,combatRetired:false,endEmitted:false,hitCount:0});sample.effects.push(wire);
        }
        critical.push({sample,captured:frames});if(direct)lastDirect=frames;if(outward)lastPresentation=frames;
      }
      // An already-captured collision sample must not wait for the ordinary
      // pose heartbeat. Count its report toward that heartbeat too, so a
      // sustained effect does not add a second, out-of-phase 20 Hz stream.
      if(frames-lastReportFrame<reportEvery&&!changed&&!statusProjection?.changed&&!statusProjection?.checkpoint&&!critical.length&&!born.length&&!hits.size)return null;
      report??=projectStatus(encodeOwnedState(simulation,localId,{epoch:epochs.get(localId)??0,frameSeq:frames}),statusProjection);report.hits=[...hits.values()].map(event=>({id:event.eventId,attackerId:event.actorId,damage:event.amount}));hits.clear();
      report.actions=critical.splice(0).map(({sample,captured})=>({...sample,ageFrames:frames-captured}));lastReportFrame=frames;return report;
    },
    epoch:id=>epochs.get(id)??0,
    recordSentFrame(simulation,localId,frameSeq){return playbackVersion===1?false:consumer.rememberVictim(simulation,localId,epochs.get(localId)??0,frameSeq);},
    get sampledEffectCount(){return effectSamples.size;},
    get actionDiagnostics(){return consumer.diagnostics;},
    get bodyDiagnostics(){return bodyArrivals.diagnostics;},
    get statusDiagnostics(){return {version:statusVersion,...statusDiagnostics};},
    get continuousAuraDiagnostics(){return {version:auraVersion,localActive:ownedAuras.size,...consumer.diagnostics};},
    clear(){epochs.clear();received.clear();disconnected.clear();disconnectedEpochs.clear();hits.clear();critical.length=0;effectSamples.clear();consumer.clear();consumer.setBodyPushWitnessVersion(0);bodyArrivals.clear();remotePresentation?.clear();priorEffects.clear();ownedAuras.clear();statusClock.clear();remoteStatuses.clear();remoteProtections.clear();remoteBuffs.clear();statusVersion=0;if(lastSimulation){setSimulationAuraVersion(lastSimulation,0);lastSimulation.networkCombatPlaybackVersion=0;}lastSimulation=null;auraVersion=0;consumer.setContinuousAuraVersion(0);playbackVersion=0;playbackProducer.clear();playbackProducer.setVersion(0);consumer.setCombatPlaybackVersion(0);previousTrack=null;frames=0;lastReportFrame=0;lastPhase=null;lastDirect=-10;lastPresentation=-10;},
  };
}
