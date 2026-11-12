/** Player-owned combat, server-owned room lifecycle. This is a Web adapter to
 * the acquired V5 ownership split; it does not claim native packet fidelity or
 * a server proof of every client-reported hit. */
import {performance} from 'node:perf_hooks';
import {invincibleBungeeHp} from '../../packages/combat-core/map-mechanics.mjs';
import {OWNERSHIP_PROTOCOL,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {registerLocalOwnerInputConsumer} from '../../packages/online/service.mjs';
import {encodeOwnedStatus} from '../../packages/online/owned-status.mjs';
import {decodeOwnerStatusClock} from '../../packages/online/owner-status-clock.mjs';
import {buffControls} from '../../packages/combat-core/buffs.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';

export function createLocalOwnerBattleDriver({match,simulation,pvp,emit,finish,clock=()=>performance.now(),manual=false}){
  if(match.combatPlaybackVersion!==undefined&&![0,1].includes(match.combatPlaybackVersion)||
    match.combatPlaybackVersion===1&&(match.ownerStatusVersion!==1||match.continuousAuraVersion!==2))throw new TypeError('invalid-combat-playback-capability');
  const loadingTimeoutSeconds=match.loadingTimeoutSeconds??30;
  if(!Number.isFinite(loadingTimeoutSeconds)||loadingTimeoutSeconds<=0||loadingTimeoutSeconds>180)throw Error('invalid-loading-timeout');
  const ready=new Set(),owners=new Map(),epochs=new Map(match.players.map(player=>[player.id,0]));
  const frameSeq=new Map(),hitReceipts=new Map(),hitSourceFrontier=new Map(),actionReceipts=new Map(),recentActions=new Map(),ownedStatuses=new Map(),inputs={},outEvents=[];
  const statusHitCounts=new Map();
  const stats={steps:0,totalStepMs:0,maxStepMs:0,broadcasts:0,broadcastBytes:0,combatSteps:0,ownerReports:0};
  let stopped=false,finished=false,started=false,sequence=0,loadingAge=0,last=clock(),timer=null;
  const ownership=()=>({mode:OWNERSHIP_PROTOCOL,...(match.continuousAuraVersion>0?{continuousAuraVersion:match.continuousAuraVersion}:{}),
    ...(match.ownerStatusVersion===1?{ownerStatusVersion:1}:{}),
    ...(match.combatPlaybackVersion===1?{combatPlaybackVersion:1}:{}),
    actors:Object.fromEntries(match.players.map(player=>[player.id,{epoch:epochs.get(player.id),frameSeq:frameSeq.get(player.id)??0}]))});
  function state({consumeEvents=true,includeActions=false}={}){return {matchId:match.id,sequence:sequence++,snapshot:simulation.snapshot(),pvp:pvp.snapshot(),ownership:ownership(),
    // Actor clocks already occur in snapshot. Send effect clocks once, without
    // their immutable damage/template definitions or a duplicate actor copy.
    owners:Object.fromEntries([...new Set([...owners.keys(),...ownedStatuses.keys()])].map(id=>{
      const report=owners.get(id),status=ownedStatuses.get(id);
      return [id,{protocol:OWNERSHIP_PROTOCOL,epoch:report?.epoch??epochs.get(id),frameSeq:report?.frameSeq??frameSeq.get(id)??0,
        effects:structuredClone(report?.effects??[]),hits:[],...(status?{status:structuredClone(status)}:{})}];})),
    ...(includeActions?{recentActions:Object.fromEntries([...recentActions].filter(([,row])=>clock()-row.receivedAt<=1000)
      .map(([id,row])=>[id,{epoch:row.epoch,frameSeq:frameSeq.get(id)??row.frameSeq,actions:structuredClone(row.actions)}]))}:{}),
    inputs:structuredClone(inputs),events:consumeEvents?outEvents.splice(0):structuredClone(outEvents)};}
  function broadcast(){if(stopped)return;const value=state();stats.broadcastBytes+=Buffer.byteLength(JSON.stringify(value));stats.broadcasts++;emit('state',value);}
  function drainRoom(){
    const events=pvp.drainEvents();for(const event of events)if(event.type==='respawn'||event.type==='reconnect'){
      epochs.set(event.playerId,epochs.get(event.playerId)+1);owners.delete(event.playerId);ownedStatuses.delete(event.playerId);statusHitCounts.delete(event.playerId);hitReceipts.delete(event.playerId);hitSourceFrontier.delete(event.playerId);actionReceipts.delete(event.playerId);recentActions.delete(event.playerId);
      delete inputs[event.playerId];if(event.type==='reconnect')frameSeq.delete(event.playerId);
    }
    outEvents.push(...events);
  }
  function begin(){
    started=true;pvp.start(simulation);
    // created is only a loading template. Intro installs the configured
    // starting gauges and position exactly once as a new server-issued life.
    for(const player of match.players)epochs.set(player.id,epochs.get(player.id)+1);
    for(const id of Object.keys(inputs))delete inputs[id];
    owners.clear();ownedStatuses.clear();statusHitCounts.clear();hitReceipts.clear();hitSourceFrontier.clear();actionReceipts.clear();recentActions.clear();simulation.drainEvents();drainRoom();broadcast();
  }
  function finishIfNeeded(){
    const result=pvp.snapshot();if(result.phase==='result'&&!finished){finished=true;broadcast();
      Promise.resolve(finish(result.result)).catch(()=>emit('server-error',{error:'result-save-failed'}));stop();}
  }
  function tick(dt=.1){
    if(stopped)return;if(!Number.isFinite(dt)||dt<0||dt>30)throw new TypeError('invalid-room-dt');
    if(!started){loadingAge+=dt;if(loadingAge>=loadingTimeoutSeconds){
      for(const player of match.players)if(!ready.has(player.id)&&!simulation.state.actors.find(actor=>actor.id===player.id)?.pvpDisconnected){
        emit('player-timeout',{playerId:player.id,reason:'loading-timeout'});
        if(!simulation.state.actors.find(actor=>actor.id===player.id)?.pvpDisconnected)disconnect(player.id);
      }
      if(!stopped&&pvp.snapshot().phase==='created')begin();
    }return;}
    const before=clock();
    // No combat step: locks/invincibility are room wall-clock values, rather
    // than fields decremented by an otherwise unnecessary full simulation.
    for(const actor of simulation.state.actors){actor.inputLock=0;actor.forceInvincible=0;}
    pvp.advance(dt,simulation);drainRoom();
    stats.steps++;const elapsed=clock()-before;stats.totalStepMs+=elapsed;stats.maxStepMs=Math.max(stats.maxStepMs,elapsed);
    finishIfNeeded();if(!stopped)broadcast();
  }
  function disconnect(id,options){
    const actor=simulation.state.actors.find(actor=>actor.id===id);if(!actor||stopped)return;
    if(actor.pvpDisconnected){pvp.disconnect(id,simulation,options);drainRoom();finishIfNeeded();if(!stopped)broadcast();return;}
    const status=ownedStatuses.get(id);
    if(options?.recoverable&&status&&status.frameSeq>(frameSeq.get(id)??-1)){
      // A validated Buff change may already have escaped an incomplete action
      // prefix. Preserve that status domain without accepting its held pose,
      // HP/MP or attacks. The byte is part of Buff 408's finalizer lifetime.
      actor.buffs=decodeOwnerStatusClock(status.actor,status.frameSeq).buffs;
      const count=statusHitCounts.get(id);if(count!==undefined)actor.sourceHitCountByte=count;
      const controls=buffControls(actor.buffs);actor.buffControls={inputBlock:controls.inputBlock,dashBlock:controls.dashBlock};
      const hp=actor.hp,mp=actor.mp;if(actor.stats&&actor.buffBaseStats)synchronizeBuffStats(actor);actor.hp=hp;actor.mp=mp;
    }
    owners.delete(id);ownedStatuses.delete(id);statusHitCounts.delete(id);recentActions.delete(id);actionReceipts.delete(id);hitReceipts.delete(id);hitSourceFrontier.delete(id);inputs[id]={held:[],frameSeq:frameSeq.get(id)??0};pvp.disconnect(id,simulation,options);drainRoom();
    actor.hidden=true;actor.hp=0;actor.deathComplete=true;if(actor.core)actor.core.phase='absent';
    simulation.state.effects=simulation.state.effects.filter(effect=>effect.ownerId!==id);
    if(pvp.snapshot().phase!=='created')started=true;finishIfNeeded();if(!stopped)broadcast();
  }
  function reconnect(id){
    if(stopped||!pvp.reconnect(id,simulation))return {resumed:false};
    simulation.drainEvents();drainRoom();broadcast();
    return {resumed:true,epoch:epochs.get(id)};
  }
  function stop(){if(stopped)return;stopped=true;clearInterval(timer);clearTimeout(initial);owners.clear();ownedStatuses.clear();statusHitCounts.clear();recentActions.clear();actionReceipts.clear();hitReceipts.clear();hitSourceFrontier.clear();}
  const initial=setTimeout(broadcast,0);initial.unref?.();
  if(!manual){timer=setInterval(()=>{const now=clock(),dt=Math.min(.5,Math.max(0,(now-last)/1000));last=now;tick(dt);},100);timer.unref?.();}
  function consumeInput(id,batch,validatedOwner=false){
      const actor=simulation.state.actors.find(actor=>actor.id===id);if(!actor)throw Error('player-not-in-match');
      if(stopped||actor.pvpDisconnected)return {accepted:false};
      const newest=batch.frames.at(-1),room=pvp.snapshot(),player=room.players.find(player=>player.id===id);
      const input=()=>{if((newest.frameSeq??0)>=(inputs[id]?.frameSeq??-1))
        inputs[id]={held:[...newest.held],frameSeq:newest.frameSeq??0};};
      // Loading/intro frames are not a held-input baseline for the first
      // playable life. Keep the same gate for reports without an owner body.
      if(!started||!['fight','slow'].includes(room.phase))return {accepted:true,ignored:'room-locked',consumedActionIds:[],consumedHitIds:[]};
      if(!batch.owner){if(room.phase==='fight')input();return {accepted:true};}
      const report=validatedOwner?batch.owner:validateOwnedState(batch.owner);
      // A room freezes one combat settlement policy. Never relay a historical
      // collision sample into independent local playback, or a playback event
      // into a legacy receiver, including previously acknowledged retries.
      if(match.combatPlaybackVersion===1){
        if((report.actions??[]).some(action=>action.playback?.version!==1))throw new TypeError('combat-playback-required');
      }else if((report.actions??[]).some(action=>action.playback!==undefined))throw new TypeError('combat-playback-not-negotiated');
      // Room negotiation is frozen before the first life. A legacy room must
      // never silently retire captured hits that an older receiver still needs.
      if([report.effects,...(report.actions??[]).map(action=>action.effects)]
        .some(effects=>effects.some(effect=>effect.sourceContinuousAura!==undefined&&effect.sourceContinuousAura.version!==(match.continuousAuraVersion??0))))
        throw new TypeError('continuous-aura-not-negotiated');
      const hasStatusClock=[report.actor,...(report.actions??[]).map(action=>action.actor)].some(value=>value.sourceStatusClock!==undefined);
      if(match.ownerStatusVersion!==1&&(hasStatusClock||(report.actions??[]).some(action=>action.targetViews?.some(view=>view.bodyPushFrames!==undefined))))
        throw new TypeError('owner-status-not-negotiated');
      if(match.ownerStatusVersion===1&&!report.actor.sourceStatusClock)throw new TypeError('owner-status-clock-required');
      if(report.epoch!==epochs.get(id))return {accepted:true,ignored:'old-life',consumedActionIds:[],consumedHitIds:[]};
      const oldState=report.frameSeq<=(frameSeq.get(id)??-1);
      const seen=actionReceipts.get(id)??new Set();
      const seenHits=hitReceipts.get(id)??new Set();
      // Transport admission is independent of source-time combat expiry and
      // replaceable pose freshness. A late sparse ID must not disappear merely
      // because a later pose or another canonical ID was received first.
      const actions=(report.actions??[]).filter(action=>!seen.has(action.id));
      let statusValidated=false;
      if(match.ownerStatusVersion===1&&report.actor.sourceStatusClock){
        // Full source references are validated before the independent domain
        // can escape. A pending attack prefix may hold pose, never protection.
        validateOwnedReferences({...report,actions},actor,simulation.profileFor?.(actor)??simulation.profile,simulation.map,
          {profiles:simulation.profiles,actors:simulation.state.actors});statusValidated=true;
        const status=encodeOwnedStatus(report),previous=ownedStatuses.get(id);
        if(previous&&status.actor.sourceStatusClock.revision>previous.actor.sourceStatusClock.revision&&
          (status.frameSeq<previous.frameSeq||status.actor.sourceStatusClock.frameSeq<previous.actor.sourceStatusClock.frameSeq))
          throw new TypeError('owner-status-frame-regression');
        if(!previous||status.actor.sourceStatusClock.revision>previous.actor.sourceStatusClock.revision){
          ownedStatuses.set(id,status);statusHitCounts.set(id,report.actor.sourceHitCountByte);emit('owner-status',{matchId:match.id,playerId:id,status:structuredClone(status)});
        }
      }
      const mayConsume=player.alive&&room.phase==='fight'&&player.lockUntil<=room.fightTime;
      if(mayConsume)input();
      const retireActions=!player.alive||room.phase==='slow';
      const receipts=()=>({consumedActionIds:(report.actions??[]).filter(action=>seen.has(action.id)).map(action=>action.id),
        consumedHitIds:report.hits.filter(hit=>seenHits.has(hit.id)).map(hit=>hit.id)});
      function consumeHits(){
        // A same-life corpse cannot accrue new damage or final-hit credit.
        // Retire its late IDs explicitly so fade reports do not replay an
        // unconsumable hit forever; a respawn clears this life-owned ledger.
        if(!player.alive){for(const hit of report.hits)seenHits.add(hit.id);}
        else for(const hit of [...report.hits].sort((a,b)=>a.id-b.id))if(!seenHits.has(hit.id)){
          // A late source pose cannot erase an independently unconsumed hit.
          // recordHit retains room phase, team, connection and victim checks.
          const victim=pvp.player(id),lastAttackerId=victim.lastAttackerId,frontier=hitSourceFrontier.get(id)??-1;
          if(pvp.recordHit({attackerId:hit.attackerId,targetId:id,damage:hit.damage})){
            if(hit.id>frontier)hitSourceFrontier.set(id,hit.id);
            else victim.lastAttackerId=lastAttackerId;
          }
          seenHits.add(hit.id);
        }
        while(seenHits.size>256)seenHits.delete(seenHits.values().next().value);
        hitReceipts.set(id,seenHits);
      }
      function consumeActions(){
        if((!mayConsume&&!retireActions)||!actions.length)return;
        for(const action of actions)seen.add(action.id);
        while(seen.size>256)seen.delete(seen.values().next().value);
        actionReceipts.set(id,seen);
        // Dead-life / terminal slow-phase actions can never execute again.
        // Explicitly retire their IDs so an old bounded prefix cannot hold
        // corpse fade and the room's pending final result forever. A temporary
        // respawn input lock keeps pending actions for the same living life.
        if(!mayConsume)return;
        const previous=recentActions.get(id)?.actions??[];
        recentActions.set(id,{epoch:report.epoch,frameSeq:report.frameSeq,receivedAt:clock(),actions:[...previous,...actions].slice(-16)});
        emit('input',{matchId:match.id,playerId:id,epoch:report.epoch,frameSeq:report.frameSeq,actions:structuredClone(actions)});
      }
      if(oldState||report.actionFrontierComplete===false){
        if(mayConsume&&actions.length&&!statusValidated){
          validateOwnedReferences({...report,actions},actor,simulation.profileFor?.(actor)??simulation.profile,simulation.map,
            {profiles:simulation.profiles,actors:simulation.state.actors});
        }
        consumeActions();
        consumeHits();
        // A bounded reliable prefix is not permission to publish the latest
        // model before the remaining actions. Hold both owned-state and room
        // actor clocks until a complete batch closes this source frontier.
        return {accepted:true,ignored:oldState?'old-state':'actions-pending',...receipts()};
      }
      // Reliable history repeats until acknowledged. A consumed action cannot
      // affect this room again, so do not recheck its frozen effect catalog on
      // every later owner report. Shape/size validation still covers the full
      // packet, and every newly consumable action gets reference validation.
      if(!statusValidated)validateOwnedReferences({...report,actions},actor,simulation.profileFor?.(actor)??simulation.profile,simulation.map,
        {profiles:simulation.profiles,actors:simulation.state.actors});
      // A sender can only update its authenticated actor, never room scores,
      // another victim, frozen configuration, or a server-issued life epoch.
      // Public validation and the service both produce a new isolated report.
      // The private synchronous service handler never leaks it before this
      // consumption, so cloning the whole action history again is unnecessary.
      const incoming=report;
      if(!player.alive)incoming.actor.hp=0;
      else if(player.invincibleUntil>room.fightTime&&incoming.actor.hp<actor.hp)incoming.actor.hp=invincibleBungeeHp(actor,incoming.actor,simulation.map);
      if(player.lockUntil>room.fightTime){for(const field of ['x','y','z','vx','vy','vz'])if(actor[field]!==undefined)incoming.actor[field]=actor[field];}
      const beforeHp=actor.hp;applyOwnedState(simulation,id,incoming,{effects:false});
      consumeHits();
      // Invulnerability prevents a forged death as well as a delayed old hit.
      if(player.alive&&player.invincibleUntil>room.fightTime)actor.hp=incoming.actor.hp<beforeHp?incoming.actor.hp:beforeHp;
      actor.pvpDead=!player.alive;actor.pvpDisconnected=false;
      owners.set(id,{...incoming,actor:{...incoming.actor,hp:actor.hp},hits:[]});frameSeq.set(id,report.frameSeq);stats.ownerReports++;
      consumeActions();
      // Both the first actor baseline and later clocks may be delivered
      // immediately. Publish reliable actions first so the server fallback
      // cannot present a skill/STOP pose before its canonical action arrives.
      // Room workers preserve the same emission order through their IPC FIFO.
      emit('owned-state',{matchId:match.id,playerId:id,report:{protocol:report.protocol,epoch:report.epoch,frameSeq:report.frameSeq,
        actor:structuredClone(owners.get(id).actor),effects:structuredClone(incoming.effects),hits:[]}});
      return {accepted:true,frameSeq:report.frameSeq,...receipts()};
  }
  const driver={
    ownership:OWNERSHIP_PROTOCOL,
    submitInput(id,batch){return consumeInput(id,batch);},
    ready(id){if(!epochs.has(id))throw Error('player-not-in-match');if(stopped)return {ok:false};ready.add(id);
      if(!started&&ready.size===match.players.length)begin();return {ok:true};},
    tick,disconnect,reconnect,stop,
    snapshot(){return {...state({consumeEvents:false,includeActions:true}),stats:{...stats,meanStepMs:stats.steps?stats.totalStepMs/stats.steps:0}};},
  };
  registerLocalOwnerInputConsumer(driver,(id,batch)=>consumeInput(id,batch,true));
  return driver;
}
