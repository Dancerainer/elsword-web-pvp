import {randomBytes, randomUUID, randomInt} from 'node:crypto';
import {normalizeCostumeId,selectedCostume,COSTUME_VERSION} from '../professions/costumes.mjs';
import {OWNERSHIP_PROTOCOL,validateOwnedState} from './owned-state.mjs';
import {ONLINE_MODES, MODE_CONFIG, DEFAULT_MODE_FLAGS, isOnlineMode, queueWaitSeconds} from './modes.mjs';
import {DEFAULT_SCENE_ID, mapDisplayName, isMapId} from './map-pool.mjs';
import {normalizeProfessionFlags, PROFESSION_IDS, PROFESSIONS, effectiveProfessionFlags, normalizeProfessionId, selectEnabledProfession} from '../professions/catalog.mjs';
import {DEFAULT_ROOM_CAPACITY,normalizeRoomCapacity} from './room-capacity.mjs';
import {normalizePeerReceipts} from './peer-receipts.mjs';
import {readRtcSignalIdentity,compareRtcSignalIdentity} from './rtc-signal.mjs';

export class OnlineError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const allowedKeys = new Set(['LEFT', 'RIGHT', 'UP', 'DOWN', 'Z', 'X', 'AWAKEN', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'C', 'SPECIAL']);
const inputFields = new Set(['held', 'pressed', 'released', 'sampledDevice', 'pureDouble', 'oneDouble', 'frameSeq']);
// The handler is never exposed on the public driver or returned to callers.
// Only this service invokes it, synchronously after validating a fresh batch.
// A previously validated mutable object carries no reusable trust marker.
const localOwnerInputConsumers=new WeakMap();
export function registerLocalOwnerInputConsumer(driver,consumer){
  if(!driver||typeof driver!=='object'||driver.ownership!==OWNERSHIP_PROTOCOL||typeof consumer!=='function')throw new TypeError('invalid-owner-input-consumer');
  if(localOwnerInputConsumers.has(driver))throw new TypeError('owner-input-consumer-already-registered');
  localOwnerInputConsumers.set(driver,consumer);
}
const keyList = value => Array.isArray(value) && value.length <= allowedKeys.size
  && value.every(key => typeof key === 'string' && allowedKeys.has(key)) && new Set(value).size === value.length;
export function validateInputBatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['matchId', 'sequence', 'frames', 'owner','peerReceipts'].includes(key))
    || typeof body.matchId !== 'string' || !Number.isSafeInteger(body.sequence) || body.sequence < 0
    || !Array.isArray(body.frames) || body.frames.length < 1 || body.frames.length > 8) throw new OnlineError('invalid-input-batch');
  const frames = body.frames.map(frame => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).some(key => !inputFields.has(key))
      || !keyList(frame.held) || frame.sampledDevice !== undefined && typeof frame.sampledDevice !== 'boolean'
      || frame.frameSeq !== undefined && (!Number.isSafeInteger(frame.frameSeq) || frame.frameSeq < 0)
      || ['pressed', 'released', 'pureDouble', 'oneDouble'].some(key => frame[key] !== undefined && !keyList(frame[key]))) throw new OnlineError('invalid-input-batch');
    return {held: [...frame.held], pressed: [...(frame.pressed ?? [])], released: [...(frame.released ?? [])],
      ...(frame.sampledDevice !== undefined ? {sampledDevice: frame.sampledDevice} : {}),
      ...(frame.frameSeq !== undefined ? {frameSeq: frame.frameSeq} : {}),
      ...(frame.pureDouble ? {pureDouble: [...frame.pureDouble]} : {}), ...(frame.oneDouble ? {oneDouble: [...frame.oneDouble]} : {})};
  });
  let owner;
  if(body.owner!==undefined){try{owner=validateOwnedState(body.owner);}catch{throw new OnlineError('invalid-owner-state');}
    if(!frames.some(frame=>frame.frameSeq>=owner.frameSeq))throw new OnlineError('invalid-owner-frame');}
  let peerReceipts;
  if(body.peerReceipts!==undefined){
    if(!owner)throw new OnlineError('invalid-peer-receipts');
    try{peerReceipts=normalizePeerReceipts(body.peerReceipts);}catch{throw new OnlineError('invalid-peer-receipts');}
  }
  return {matchId: body.matchId, sequence: body.sequence, frames,...(owner?{owner}:{}),...(peerReceipts?{peerReceipts}:{})};
}

// The worker entry owns the same validation boundary as the in-process
// service. A caller never obtains the private consumer or a reusable marker.
export function consumeLocalOwnerWorkerInput(driver,id,body){
  const batch=validateInputBatch(body),consumer=localOwnerInputConsumers.get(driver);
  if(!consumer)throw new TypeError('owner-input-consumer-required');
  return consumer(id,batch);
}
function inputEnvelope(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||typeof body.matchId!=='string'
    ||!Number.isSafeInteger(body.sequence)||body.sequence<0||!Array.isArray(body.frames)||body.frames.length<1||body.frames.length>8)
    throw new OnlineError('invalid-input-batch');
  return body;
}

/** Lobby policies and persistence only; battle decisions belong to the injected pure-core driver. */
export function createOnlineService({driverFactory = null, accountStore, versions, now = Date.now,
  random = () => randomInt(1, 0x1000000) / 0x1000000, emit = () => {}, isActive = () => true, onDrop = () => {}, onlineUsers = () => [],
  sharedBroadcasts=false,roomCapacity=null}) {
  if(typeof sharedBroadcasts!=='boolean')throw new TypeError('invalid-shared-broadcasts');
  const storedCapacity=accountStore.roomCapacity?.();
  // Explicit old options remain available to historical service fixtures.
  // Production uses the per-mode schema; a saved GM choice always takes
  // precedence and never inherits either legacy aggregate limit.
  const initialCapacity=storedCapacity??roomCapacity??DEFAULT_ROOM_CAPACITY;
  let capacity,capacityRevision=accountStore.roomCapacityRevision?.()??0;
  if(!Number.isSafeInteger(capacityRevision)||capacityRevision<0)throw new TypeError('invalid-room-capacity-revision');
  if(Object.hasOwn(initialCapacity,'maxRoomsByMode'))capacity=normalizeRoomCapacity(initialCapacity);
  else{
    if(Object.keys(initialCapacity).some(key=>!['maxActivePlayers','maxActiveRooms'].includes(key))
      ||![initialCapacity.maxActivePlayers,initialCapacity.maxActiveRooms].every(value=>value===Infinity||Number.isSafeInteger(value)&&value>0))
      throw new TypeError('invalid-room-capacity');
    capacity={...initialCapacity,maxRoomsByMode:Object.fromEntries(ONLINE_MODES.map(mode=>[mode,Infinity]))};
  }
  const queue = new Map(), matches = new Map(), playerMatch = new Map(), lastResults = new Map(), suspendedMatches = new Map();
  const matchSignaling=new WeakMap();
  const occupied=()=>[...matches.values()].filter(match=>!['finished','aborted'].includes(match.status));
  const capacityStatus=()=>{const active=occupied();return {revision:capacityRevision,activeRooms:active.length,activePlayers:active.reduce((sum,match)=>sum+match.players.length,0),
    activeRoomsByMode:Object.fromEntries(ONLINE_MODES.map(mode=>[mode,active.filter(match=>match.mode===mode).length])),
    maxRoomsByMode:Object.fromEntries(ONLINE_MODES.map(mode=>[mode,Number.isFinite(capacity.maxRoomsByMode[mode])?capacity.maxRoomsByMode[mode]:null])),
    maxActiveRooms:Number.isFinite(capacity.maxActiveRooms)?capacity.maxActiveRooms:null,maxActivePlayers:Number.isFinite(capacity.maxActivePlayers)?capacity.maxActivePlayers:null};};
  const hasCapacity=mode=>{const current=capacityStatus();return current.activeRoomsByMode[mode]<capacity.maxRoomsByMode[mode]
    &&current.activeRooms<(capacity.maxActiveRooms??Infinity)
    &&current.activePlayers+MODE_CONFIG[mode].playerCount<=(capacity.maxActivePlayers??Infinity);};
  const rates = new Map();
  const clocks = new Map(ONLINE_MODES.map(mode => [mode, {deadline: null, pausedRemaining: null}])), queueNotices = new Map();
  let modeFlags = {...DEFAULT_MODE_FLAGS, ...accountStore.modeFlags?.()};
  let professionFlags = Object.fromEntries(PROFESSION_IDS.map(id => [id, accountStore.professionFlags?.()[id] ?? true]));
  const availableProfessionFlags = () => effectiveProfessionFlags(Object.fromEntries(PROFESSION_IDS.map(id => [id,
    professionFlags[id] && (id === 'RF' || typeof driverFactory === 'function') && driverFactory?.professions?.[id] !== false
      &&(['RF','LK'].includes(id)||driverFactory?.professions?.[id]===true)])));
  const professionStatus = username => {
    const waiting=queue.get(username),match=matches.get(playerMatch.get(username));
    const frozen=waiting?.configuration??(match&&match.status!=='finished'?match.players.find(player=>player.username===username):null);
    const professionId=frozen?.professionId??selectEnabledProfession(accountStore.selectedProfession?.(username) ?? 'RF', availableProfessionFlags());
    const costumes=accountStore.costumes?.(username)??{elsword:'default',raven:'default'};
    return {professionId,costumes,costumeId:frozen?.costumeId??selectedCostume(costumes,professionId),costumeVersion:COSTUME_VERSION,
      selectedProfessionId: accountStore.selectedProfession?.(username) ?? 'RF', professions: availableProfessionFlags(),
      professionFlags: {...professionFlags},
      ...(driverFactory?.assetDiagnostics?.length ? {professionDiagnostics:structuredClone(driverFactory.assetDiagnostics)} : {})};
  };
  const mapPool = structuredClone(driverFactory?.maps ?? [{id: DEFAULT_SCENE_ID, modes: [...ONLINE_MODES]}])
    .map(map => ({...map, name: mapDisplayName(map)}));
  if (!Array.isArray(mapPool) || !mapPool.length || new Set(mapPool.map(row => row.id)).size !== mapPool.length
    || mapPool.some(row => !isMapId(row.id) || !Array.isArray(row.modes) || !row.modes.length || row.modes.some(mode => !isOnlineMode(mode)))) throw Error('invalid-online-map-pool');
  let mapFlags = {...accountStore.mapFlags?.()};
  const enabledMaps = mode => mapPool.filter(row => mapFlags[row.id] !== false && row.modes.includes(mode));
  const publicMaps = () => mapPool.map(row => ({...structuredClone(row), enabled: mapFlags[row.id] !== false}));
  let pending = Promise.resolve(), closed = false, lastQueuePublished = null,lastCapacityPublished=null;
  const transaction = callback => {
    const result = pending.then(callback); pending = result.then(() => undefined, () => undefined); return result;
  };
  const publicMatch = match => ({id: match.id, mode: match.mode, sceneId: match.sceneId, createdAt: match.createdAt, seed: match.seed,
    loadingTimeoutSeconds:match.loadingTimeoutSeconds,
    ownership:match.ownership,
    ...(match.continuousAuraVersion>0?{continuousAuraVersion:match.continuousAuraVersion}:{}),
    ...(match.ownerStatusVersion===1?{ownerStatusVersion:1}:{}),
    ...(match.combatPlaybackVersion===1?{combatPlaybackVersion:1}:{}),
    versions: structuredClone(match.versions), players: structuredClone(match.players), status: match.status,
    result: match.result ? structuredClone(match.result) : null});
  const entries = mode => [...queue.values()].filter(entry => entry.mode === mode);
  const eligibleEntries = mode => entries(mode).filter(entry => !entry.pageLoading);
  const poolStatus = (mode, stamp) => {
    const {deadline, pausedRemaining} = clocks.get(mode);
    return {size: entries(mode).length, eligibleSize: eligibleEntries(mode).length, deadline,
      remainingSeconds: deadline === null ? null : Math.max(0, (deadline - stamp) / 1000), paused: pausedRemaining !== null};
  };
  function status(username) {
    const waiting = queue.get(username), match = matches.get(playerMatch.get(username)),stamp=now();
    const mode = waiting?.mode ?? match?.mode ?? '2v2', pool = poolStatus(mode, stamp);
    return {available: !closed && typeof driverFactory === 'function', transport: driverFactory?.ownership===OWNERSHIP_PROTOCOL?'local-owner-http-with-optional-p2p-state':'server-authoritative-http-sse',
      modes: {...modeFlags}, maps: publicMaps(), defaultSceneId: DEFAULT_SCENE_ID, ...professionStatus(username),
      mapsAvailable: Object.fromEntries(ONLINE_MODES.map(mode => [mode, enabledMaps(mode).length > 0])),
      queues: Object.fromEntries(ONLINE_MODES.map(mode => [mode, poolStatus(mode, stamp)])),
      queueNotice: structuredClone(queueNotices.get(username) ?? null),
      roomCapacity:{...capacityStatus(),waitingForCapacity:Boolean(waiting&&eligibleEntries(mode).length>=MODE_CONFIG[mode].playerCount&&!hasCapacity(mode))},
      queued: Boolean(waiting), locked: Boolean(waiting || match && match.status !== 'finished'),
      queue: {mode, size: pool.size, eligibleSize: pool.eligibleSize, loading:Boolean(waiting?.pageLoading), joinedAt: waiting?.joinedAt ?? null, deadline: pool.deadline,
        elapsedSeconds:waiting?Math.max(0,(stamp-waiting.joinedAt)/1000):null,
        remainingSeconds: pool.remainingSeconds, paused: pool.paused},
      match: match&&(!suspendedMatches.has(username)||match.status==='playing') ? publicMatch(match) : null,
      // A downstream reconnect (including a coordinator restart) must recover
      // the committed result even when its one-shot result event was lost.
      lastResult: closed||suspendedMatches.has(username) ? null : structuredClone(lastResults.get(username) ?? accountStore.lastResult?.(username) ?? null)};
  }
  const queuePublishKey = () => JSON.stringify(ONLINE_MODES.map(mode => {
    const {size, eligibleSize, deadline, remainingSeconds, paused} = poolStatus(mode, now());
    return [mode, size, eligibleSize, deadline, remainingSeconds === null ? null : Math.ceil(remainingSeconds), paused, modeFlags[mode],hasCapacity(mode)];
  }));
  function publishStatus({queueOnly = false, everyone = false, additional = []} = {}) {
    lastQueuePublished = queuePublishKey();
    const capacityKey=JSON.stringify(capacityStatus()),capacityChanged=capacityKey!==lastCapacityPublished;lastCapacityPublished=capacityKey;
    const capacityAdmins=capacityChanged?[...onlineUsers()].filter(username=>accountStore.role?.(username)==='gm'&&!playerMatch.has(username)):[];
    for (const username of new Set([...queue.keys(), ...(queueOnly ? [] : playerMatch.keys()),
      ...(everyone ? onlineUsers() : []), ...capacityAdmins,...additional])) emit(username, 'status', status(username));
  }
  function adjustDeadline() {
    const stamp = now();
    for (const mode of ONLINE_MODES) {
      const count = eligibleEntries(mode).length, clock = clocks.get(mode);
      if (!modeFlags[mode] || !enabledMaps(mode).length || count < MODE_CONFIG[mode].playerCount) {
        if (clock.deadline !== null) clock.pausedRemaining = Math.max(0, clock.deadline - stamp);
        clock.deadline = null;
      } else {
        const desired = queueWaitSeconds(mode, count) * 1000;
        if (clock.deadline === null) { clock.deadline = stamp + Math.min(clock.pausedRemaining ?? desired, desired); clock.pausedRemaining = null; }
        else if (!MODE_CONFIG[mode].fixedQueueWait) clock.deadline = Math.min(clock.deadline, stamp + desired);
      }
      if (entries(mode).length === 0 || !modeFlags[mode]) clock.pausedRemaining = null;
    }
  }
  const broadcast = (match, type, data) => {
    // The HTTP host opts into a synchronous read-only view. Other consumers
    // retain detached copies. This avoids N identical deep clones before the
    // host serializes the same source report for each room member.
    for (const player of match.players) if (player.connected&&(!['owned-state','input','owner-status'].includes(type)||!data.actions&&!data.report&&!data.status||player.id!==data.playerId)) emit(player.username, type, sharedBroadcasts?data:structuredClone(data));
  };
  function activeMatch(username, id) {
    const match = matches.get(playerMatch.get(username));
    if (!match || match.id !== id || !['starting', 'playing'].includes(match.status)
      || !match.players.find(player => player.id === username)?.connected) throw new OnlineError('match-not-active', 409);
    return match;
  }
  async function finish(match, result) {
    if (match.status === 'finished' || match.recording || closed) return false;
    match.recording = true;
    if (!match.pendingResult) {
      // The first terminal statistics are the only settlement candidate. A
      // retry, a late worker callback or a caller mutation cannot replace them.
      match.pendingResult = structuredClone(result);
      match.finalState = structuredClone(match.driver?.snapshot?.() ?? match.lastState ?? null);
      match.status = 'settling';
      matchSignaling.delete(match);
      broadcast(match, 'match', publicMatch(match));
    }
    try {
      // Persistence adapters receive their own copy on every attempt. Failed
      // writes must not mutate the frozen retry candidate either.
      const saved = await accountStore.recordMatch(match, structuredClone(match.pendingResult));
      // An atomic write already in progress may finish after shutdown, but it
      // must not recreate lobby state or publish callbacks from a retired service.
      if (closed) return saved.recorded;
      match.result = structuredClone(saved.result); match.status = 'finished'; match.pendingResult = null;
      match.lastState = null; match.finalState = null;
      match.driver?.stop?.();
      broadcast(match, 'result', {matchId: match.id, result: match.result});
      for (const player of match.players) {
        lastResults.set(player.username, {matchId: match.id, result: structuredClone(match.result)});
        if (playerMatch.get(player.username) === match.id) playerMatch.delete(player.username);
        if (player.connected) emit(player.username, 'status', status(player.username));
      }
      adjustDeadline();publishStatus({queueOnly:true});
      return saved.recorded;
    } catch {
      if (closed) return false;
      match.retryAt = now() + 1000;
      broadcast(match, 'server-error', {matchId: match.id, error: 'result-save-retrying'}); return false;
    } finally { match.recording = false; }
  }
  async function startMatch(mode) {
    if(!hasCapacity(mode))return;
    const stamp = now();
    const availableMaps = enabledMaps(mode);
    if (!availableMaps.length) return;
    const sceneId = availableMaps[Math.min(availableMaps.length - 1, Math.floor(random() * availableMaps.length))].id;
    const spec = MODE_CONFIG[mode], clock = clocks.get(mode);
    const candidates = eligibleEntries(mode).map(entry => ({entry,
      // Longer waits increase the draw weight; waiting one minute guarantees a seat in the next draw.
      priority: stamp - entry.joinedAt >= 60_000 ? 2 + (stamp - entry.joinedAt) / 60_000
        : Math.max(0.000001, random()) ** (1 / (1 + (stamp - entry.joinedAt) / 15_000))}));
    candidates.sort((a, b) => b.priority - a.priority || a.entry.joinedAt - b.entry.joinedAt);
    const selected = candidates.slice(0, spec.playerCount).map(row => row.entry);
    // Shuffle selected players so queue age does not determine team assignment.
    for (let index = selected.length - 1; index > 0; index--) {
      const other = Math.min(index, Math.floor(random() * (index + 1)));
      [selected[index], selected[other]] = [selected[other], selected[index]];
    }
    // Publish presentation admission at the queue deadline. No combat input,
    // resource acknowledgement or peer binding is admitted until the sealed
    // final match and its driver exist.
    const preparingId=randomUUID();
    const preparation={id:preparingId,mode,sceneId,players:selected.map((entry,index)=>({
      id:entry.username,username:entry.username,nickname:entry.configuration.nickname,
      professionId:entry.configuration.professionId,team:index<spec.teamSize?0:1,loadingProgress:0}))};
    const endPreparation=reason=>{for(const entry of selected)if(isActive(entry.username))
      emit(entry.username,'match-preparation-ended',{id:preparingId,reason});};
    for(const entry of selected)emit(entry.username,'match-preparing',structuredClone(preparation));
    let mapVersions;
    try { mapVersions = await driverFactory.mapVersions?.(sceneId); }
    catch { if (!closed) {endPreparation('map-unavailable');clock.deadline = now() + 5000; publishStatus();} return; }
    if (closed) return;
    // Map preparation may be asynchronous. A departed/reloaded queue entry
    // must not become a ghost participant while its resource seal is loading.
    if (selected.some(entry => queue.get(entry.username) !== entry || entry.pageLoading || !isActive(entry.username))) {
      endPreparation('roster-changed');
      adjustDeadline(); publishStatus(); return;
    }
    const match = {id: preparingId, mode, sceneId, createdAt: stamp,
      loadingTimeoutSeconds:driverFactory.mapLoadTimeoutSeconds?.(sceneId,spec.playerCount)??30,
      ownership:driverFactory?.ownership??'server-authoritative',
      continuousAuraVersion:driverFactory?.ownership===OWNERSHIP_PROTOCOL?Math.min(...selected.map(entry=>entry.continuousAuraVersion??0)):0,
      ownerStatusVersion:driverFactory?.ownership===OWNERSHIP_PROTOCOL&&selected.every(entry=>entry.ownerStatusVersion===1)?1:0,
      combatPlaybackVersion:driverFactory?.ownership===OWNERSHIP_PROTOCOL&&selected.every(entry=>entry.combatPlaybackVersion===1)?1:0,
      seed: randomBytes(4).readUInt32LE(), versions: {...structuredClone(versions), ...structuredClone(mapVersions ?? {}), sceneId,
        ...(selected.some(entry=>entry.configuration.professionVersions) ? {
          professions: Object.fromEntries(selected.map(entry => [entry.configuration.professionId, structuredClone(entry.configuration.professionVersions ?? {})]))} : {})}, status: 'starting', result: null,
      players: selected.map((entry, index) => ({id: entry.username, username: entry.username, role: entry.role,
        team: index < spec.teamSize ? 0 : 1, ...structuredClone(entry.configuration), connected: true}))};
    matches.set(match.id, match);
    for (const entry of selected) { queue.delete(entry.username); playerMatch.set(entry.username, match.id); }
    clock.deadline = null; clock.pausedRemaining = null; adjustDeadline();
    try {
      const driver = await driverFactory({match: publicMatch(match),
        emit: (type, data) => {
          if (closed || matches.get(match.id) !== match || ['settling','finished','aborted'].includes(match.status)) return;
          if(type==='room-failed'){
            // A process failure cancels only this room. It is not a victory,
            // defeat or account result, and must not consume capacity forever.
            if(match.recording||match.pendingResult)return;
            endPreparation('room-unavailable');
            match.status='aborted';matchSignaling.delete(match);match.driver?.stop?.();matches.delete(match.id);
            for(const player of match.players){
              if(playerMatch.get(player.username)===match.id)playerMatch.delete(player.username);
              queueNotices.set(player.username,{mode:match.mode,reason:'room-worker-unavailable',message:'The match server stopped. Queue again. This match does not count toward your record.'});
              emit(player.username,'server-error',{matchId:match.id,error:'room-worker-unavailable'});
              if(player.connected)emit(player.username,'status',status(player.username));
            }
            adjustDeadline();publishStatus({queueOnly:true});return;
          }
          if (type === 'player-timeout') {
            if (match.status !== 'starting') return;
            const player = match.players.find(row => row.id === data?.playerId);
            if (player?.connected && playerMatch.get(player.username) === match.id) onDrop(player.username, data.reason ?? 'loading-timeout');
            return;
          }
          // The first room snapshot is still a loading template. Only intro
          // or combat means the successful match has entered the game.
          if (type === 'state' && match.status === 'starting' && data?.pvp?.phase !== 'created') match.status = 'playing';
          // Real owner drivers build complete isolated seeds on demand. Their
          // ordinary state cache is unused by matchSnapshot, so do not clone
          // that complete actor/effect tree on every10Hz broadcast.
          if (type === 'state' && !(localOwnerInputConsumers.has(match.driver)&&typeof match.driver?.snapshot==='function')&&!match.driver?.cachedSnapshot) match.lastState = structuredClone(data);
          broadcast(match, type, data);
        }, finish: result => finish(match, result)});
      // close() cannot stop a driver that has not been returned yet. Retire it
      // here before installation or publication, even when creation succeeded.
      if (closed || matches.get(match.id) !== match) { driver?.stop?.(); return; }
      match.driver = driver;
      if (!match.driver || typeof match.driver.submitInput !== 'function') throw Error('invalid-battle-driver');
      for(const [username,binding]of match.pendingRelayBindings??[])match.driver.bindRelay?.(username,binding);
      delete match.pendingRelayBindings;
      broadcast(match, 'match', publicMatch(match));
      for (const player of match.players) if (!player.connected) match.driver.disconnect?.(player.id);
    } catch {
      match.driver?.stop?.(); matches.delete(match.id);
      if (closed) return;
      endPreparation('room-unavailable');
      for (const entry of selected) {
        const belongsToMatch = playerMatch.get(entry.username) === match.id;
        const player = match.players.find(row => row.username === entry.username);
        if (belongsToMatch) playerMatch.delete(entry.username);
        // A same-name login after disconnect is a new lobby participant. Do not
        // restore the departed participant's frozen preferences into its queue.
        if (belongsToMatch && player?.connected && isActive(entry.username)) {
          queue.set(entry.username, entry);
          emit(entry.username, 'server-error', {error: 'match-start-failed'});
        }
      }
      adjustDeadline();
      // Do not repeatedly retry a broken factory every scheduler tick.
      if (clock.deadline !== null) clock.deadline = Math.max(clock.deadline, now() + 5000);
    }
    publishStatus();
  }
  function checkRate(username, category, maximum, cost = 1) {
    const key = `${username}:${category}`, stamp = now(), current = rates.get(key);
    const row = current && stamp - current.started < 1000 ? current : {started: stamp, count: 0};
    if (row.count + cost > maximum) throw new OnlineError('input-rate-exceeded', 429);
    row.count += cost; rates.set(key, row);
  }
  const service={
    transaction, status, professionStatus,
    roomCapacityStatus:capacityStatus,
    setRoomCapacity(username,value){
      let requested;try{requested=normalizeRoomCapacity(value);}catch{}
      return transaction(async()=>{
        if(closed)throw new OnlineError('online-driver-unavailable',503);
        if(!isActive(username))throw new OnlineError('login-required',401);
        if(accountStore.role?.(username)!=='gm')throw new OnlineError('gm-required',403);
        if(!requested)throw new OnlineError('invalid-room-capacity');const next=requested;
        let saved;try{saved=await accountStore.saveRoomCapacity(next);}catch{throw new OnlineError('room-capacity-settings-unavailable',503);}
        if(closed)return capacityStatus();
        capacity=next;capacityRevision=saved?.revision??capacityRevision+1;
        adjustDeadline();publishStatus({everyone:true,additional:[username]});
        return capacityStatus();
      });
    },
    setProfessions(username, flags) {
      return transaction(async () => {
        if (closed) throw new OnlineError('online-driver-unavailable', 503);
        if (!isActive(username)) throw new OnlineError('login-required', 401);
        if (accountStore.role?.(username) !== 'gm') throw new OnlineError('gm-required', 403);
        try {flags=normalizeProfessionFlags(flags);} catch {throw new OnlineError('invalid-professions-request');}
        let saved;
        try { saved = await accountStore.saveProfessions(flags); }
        catch { throw new OnlineError('profession-settings-unavailable', 503); }
        if (closed) return status(username);
        professionFlags = {...saved};
        const effective = availableProfessionFlags(), removed = [];
        for (const entry of queue.values()) if (!effective[entry.configuration.professionId]) {
          queue.delete(entry.username); removed.push(entry.username);
          queueNotices.set(entry.username, {mode: entry.mode, professionId: entry.configuration.professionId,
            reason: 'profession-disabled', message: 'This class is disabled. Choose another class.'});
        }
        for (const [id, notice] of queueNotices) if (notice.reason === 'profession-disabled' && effective[notice.professionId]) queueNotices.delete(id);
        adjustDeadline(); publishStatus({everyone: true, additional: [username, ...removed]});
        return professionStatus(username);
      });
    },
    maps: () => ({maps: publicMaps(), defaultSceneId: DEFAULT_SCENE_ID}),
    setMap(username, mapId, enabled) {
      return transaction(async () => {
        if (closed) throw new OnlineError('online-driver-unavailable', 503);
        if (!isActive(username)) throw new OnlineError('login-required', 401);
        if (accountStore.role?.(username) !== 'gm') throw new OnlineError('gm-required', 403);
        if (!mapPool.some(row => row.id === mapId) || typeof enabled !== 'boolean') throw new OnlineError('invalid-map-request');
        let flags;
        try { flags = await accountStore.saveMap(mapId, enabled); }
        catch { throw new OnlineError('map-settings-unavailable', 503); }
        if (closed) return status(username);
        mapFlags = {...flags};
        const removed = [];
        for (const entry of queue.values()) if (!enabledMaps(entry.mode).length) {
          queue.delete(entry.username); removed.push(entry.username);
          queueNotices.set(entry.username, {mode: entry.mode, reason: 'maps-disabled', message: 'All maps are disabled.'});
        }
        for (const [id, notice] of queueNotices) if (notice.reason === 'maps-disabled' && enabledMaps(notice.mode).length) queueNotices.delete(id);
        adjustDeadline(); publishStatus({everyone: true, additional: [username, ...removed]});
        return status(username);
      });
    },
    setMode(username, mode, enabled) {
      return transaction(async () => {
        if (closed) throw new OnlineError('online-driver-unavailable', 503);
        if (!isActive(username)) throw new OnlineError('login-required', 401);
        if (accountStore.role?.(username) !== 'gm') throw new OnlineError('gm-required', 403);
        if (!isOnlineMode(mode) || typeof enabled !== 'boolean') throw new OnlineError('invalid-mode-request');
        // Persist before changing live queues: a failed write leaves players and
        // configuration locks intact, and all mode changes share the join/tick lock.
        let flags;
        try { flags = await accountStore.saveMode(mode, enabled); }
        catch { throw new OnlineError('mode-settings-unavailable', 503); }
        if (closed) return status(username);
        modeFlags = {...flags};
        const removed = [];
        if (!enabled) {
          for (const entry of entries(mode)) {
            queue.delete(entry.username); removed.push(entry.username);
            queueNotices.set(entry.username, {mode, reason: 'mode-disabled', message: 'This mode is disabled.'});
          }
        } else {
          for (const [id, notice] of queueNotices) if (notice.mode === mode) queueNotices.delete(id);
        }
        adjustDeadline(); publishStatus({everyone: true, additional: [username, ...removed]});
        return status(username);
      });
    },
    isLocked: username => Boolean(queue.has(username) || playerMatch.has(username)),
    isPlaying:username=>matches.get(playerMatch.get(username))?.status==='playing',
    bandwidthDemand:()=>{const playing=[...matches.values()].filter(match=>match.status==='playing');
      return {playingRooms:playing.length,playingPlayers:playing.reduce((sum,match)=>sum+match.players.length,0)};},
    isPageLoading:username=>Boolean(queue.get(username)?.pageLoading),
    hasMatch:username=>playerMatch.has(username),
    beginPageLoad(username){
      if(closed||playerMatch.has(username))return false;
      const waiting=queue.get(username);if(waiting&&!waiting.pageLoading){waiting.pageLoading=true;adjustDeadline();publishStatus();}
      return true;
    },
    completePageLoad(username){
      const waiting=queue.get(username);if(waiting?.pageLoading){waiting.pageLoading=false;adjustDeadline();publishStatus();}
    },
    async join(username, role, configuration, mode = '2v2', capabilities = {}) {
      if (closed || typeof driverFactory !== 'function') throw new OnlineError('online-driver-unavailable', 503);
      if (!isActive(username)) throw new OnlineError('login-required', 401);
      if (!isOnlineMode(mode)) throw new OnlineError('invalid-queue-request');
      if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)
        || Object.keys(capabilities).some(key=>!['continuousAuraVersion','ownerStatusVersion','combatPlaybackVersion'].includes(key))
        || capabilities.continuousAuraVersion!==undefined && ![0,1,2].includes(capabilities.continuousAuraVersion)
        || capabilities.ownerStatusVersion!==undefined && ![0,1].includes(capabilities.ownerStatusVersion)
        || capabilities.combatPlaybackVersion!==undefined && ![0,1].includes(capabilities.combatPlaybackVersion)
        || capabilities.combatPlaybackVersion===1 && (capabilities.ownerStatusVersion!==1||capabilities.continuousAuraVersion!==2))
        throw new OnlineError('invalid-queue-request');
      if (!modeFlags[mode]) throw new OnlineError('mode-disabled', 409);
      if (!enabledMaps(mode).length) throw new OnlineError('maps-disabled', 409);
      let professionId;
      try { professionId = normalizeProfessionId(configuration?.professionId ?? 'RF'); }
      catch { throw new OnlineError('invalid-profession-request'); }
      if (!availableProfessionFlags()[professionId]) throw new OnlineError('profession-disabled', 409);
      if (configuration?.unitClass !== undefined && configuration.unitClass !== PROFESSIONS[professionId].unitClass)
        throw new OnlineError('invalid-profession-configuration');
      if (playerMatch.has(username)) throw new OnlineError('already-in-match', 409);
      if (queue.has(username) && queue.get(username).mode !== mode) throw new OnlineError('already-in-queue', 409);
      queueNotices.delete(username);
      let costumeId;try{costumeId=normalizeCostumeId(configuration?.costumeId);}catch{throw new OnlineError('invalid-costume');}
      if (!queue.has(username)) queue.set(username, {username, role, mode, joinedAt: now(), continuousAuraVersion:capabilities.continuousAuraVersion??0,ownerStatusVersion:capabilities.ownerStatusVersion??0,combatPlaybackVersion:capabilities.combatPlaybackVersion??0,
        configuration: {...structuredClone(configuration), professionId,costumeId,costumeVersion:COSTUME_VERSION}});
      adjustDeadline(); publishStatus(); return status(username);
    },
    leaveQueue(username) {
      queue.delete(username); queueNotices.delete(username); adjustDeadline(); publishStatus(); emit(username, 'status', status(username)); return status(username);
    },
    ready(username, id) {
      const complete=()=>{
        const match = activeMatch(username, id);
        const player=match.players.find(p=>p.id===username);player.loadingProgress=100;
        for(const p of match.players)if(p.connected)emit(p.username,'match',publicMatch(match));
        const value=match.driver?.ready?.(username);
        return value?.then?value.then(()=>({ok:true,matchId:id})):{ok: true, matchId: id};
      };
      if(suspendedMatches.get(username)===id)return service.reconnect(username).then(value=>value.ended?{ok:false,ended:true,matchId:id}:complete());
      return complete();
    },
    loadingProgress(username,body){
      const suspended=suspendedMatches.get(username)===body?.matchId&&matches.get(body?.matchId);
      const match=suspended&&suspended.status==='playing'?suspended:activeMatch(username,body?.matchId),value=body?.percent;
      if(!Number.isInteger(value)||value<0||value>99)throw new OnlineError('invalid-loading-progress');
      checkRate(username,'loading-progress',16);
      const player=match.players.find(p=>p.id===username);
      if(value<=(player.loadingProgress??0)||match.status!=='starting')return {ok:true};
      player.loadingProgress=value;
      for(const p of match.players)if(p.connected)emit(p.username,'match',publicMatch(match));
      return {ok:true};
    },
    submitInput(username, body, {ownerReceipt:requestOwnerReceipt=false}={}) {
      const envelope=inputEnvelope(body),match=activeMatch(username,envelope.matchId),remote=match.driver?.inputValidation==='room-worker-v1';
      const batch = remote?envelope:validateInputBatch(body);
      const player = match.players.find(row => row.id === username);
      if(batch.owner&&match.ownership!==OWNERSHIP_PROTOCOL)throw new OnlineError('owner-state-not-enabled',409);
      const prior=Math.max(player.lastSequence??-1,player.lastReservedSequence??-1);
      if (batch.sequence <= prior || batch.sequence > prior + 1024) throw new OnlineError('input-sequence-rejected', 409);
      checkRate(username, 'input', 120, batch.frames.length);
      // Held levels are authoritative input requests; the driver reconstructs edges and double taps.
      const consumer=match.ownership===OWNERSHIP_PROTOCOL?localOwnerInputConsumers.get(match.driver):null;
      // Worker IPC detaches the report. Keep its small receipt metadata at
      // dispatch too, so an asynchronous completion cannot acknowledge a
      // caller-mutated batch or advance a changed source/packet sequence.
      const submittedSequence=batch.sequence,submittedFrames=batch.frames.map(frame=>frame.frameSeq);
      const submittedOwner=batch.owner?{epoch:batch.owner.epoch,frameSeq:batch.owner.frameSeq}:null;
      const suppliedActions=new Set(Array.isArray(batch.owner?.actions)&&batch.owner.actions.length<=16?batch.owner.actions.map(action=>action.id):[]);
      const suppliedHits=new Set(Array.isArray(batch.owner?.hits)&&batch.owner.hits.length<=128?batch.owner.hits.map(hit=>hit.id):[]);
      const accepted = consumer?consumer(username,batch):match.driver.submitInput(username, batch);
      const complete=value=>{
        if(value===false||value?.accepted===false)throw new OnlineError('input-rejected',409);
        if(closed||matches.get(match.id)!==match||!['starting','playing'].includes(match.status)||!player.connected)
          throw new OnlineError('match-not-active',409);
        let consumedActionIds,consumedHitIds;
        if(value?.consumedActionIds!==undefined){
          if(!Array.isArray(value.consumedActionIds)||value.consumedActionIds.length>16
            ||new Set(value.consumedActionIds).size!==value.consumedActionIds.length
            ||value.consumedActionIds.some(id=>!Number.isSafeInteger(id)||id<0||!suppliedActions.has(id)))throw new OnlineError('input-rejected',409);
          consumedActionIds=[...value.consumedActionIds];
        }
        if(value?.consumedHitIds!==undefined){
          if(!Array.isArray(value.consumedHitIds)||value.consumedHitIds.length>128
            ||new Set(value.consumedHitIds).size!==value.consumedHitIds.length
            ||value.consumedHitIds.some(id=>!Number.isSafeInteger(id)||id<0||!suppliedHits.has(id)))throw new OnlineError('input-rejected',409);
          consumedHitIds=[...value.consumedHitIds];
        }
        player.lastSequence=Math.max(player.lastSequence??-1,submittedSequence);
        for(const frame of submittedFrames)if(frame!==undefined)player.lastFrameSeq=Math.max(player.lastFrameSeq??-1,frame);
        // accepted:true can mean only old-life/locked/prefix event handling.
        // Only the driver's complete normally accepted owner clock permits a
        // raw upload baseline. Never infer it from input-frame advancement.
        const ownerReceipt=requestOwnerReceipt===true&&match.ownership===OWNERSHIP_PROTOCOL&&submittedOwner&&value?.ignored===undefined
          &&Number.isSafeInteger(submittedOwner.epoch)&&submittedOwner.epoch>=0
          &&Number.isSafeInteger(submittedOwner.frameSeq)&&submittedOwner.frameSeq>=0
          &&value?.frameSeq===submittedOwner.frameSeq?submittedOwner:null;
        return {accepted:true,sequence:submittedSequence,...(consumedActionIds?{consumedActionIds}:{}),...(consumedHitIds?{consumedHitIds}:{}),
          ...(typeof value?.ignored==='string'?{ignored:value.ignored}:{}),...(ownerReceipt?{ownerReceipt}:{})};
      };
      if(accepted?.then){player.lastReservedSequence=submittedSequence;
        return accepted.then(complete,error=>{throw new OnlineError(error.code??error.message??'input-rejected',error.status??409);})
          .finally(()=>{if(player.lastReservedSequence===submittedSequence)player.lastReservedSequence=player.lastSequence??-1;});}
      return complete(accepted);
    },
    signal(username, body, authenticatedPage=null) {
      if (!body || typeof body !== 'object' || !['offer', 'answer', 'candidate'].includes(body.type)
        || typeof body.to !== 'string' || body.payload === undefined || JSON.stringify(body.payload).length > 12_000) throw new OnlineError('invalid-signal');
      const match = activeMatch(username, body.matchId), target = match.players.find(player => player.id === body.to);
      if (!target?.connected || target.id === username) throw new OnlineError('invalid-signal-target');
      checkRate(username, 'signal', 32);
      let identity=null;
      if(body.signalVersion!==undefined){
        try{identity=readRtcSignalIdentity(body);}catch{throw new OnlineError('invalid-signal-identity');}
        // The HTTP boundary checks this page before and after reading the
        // body. Session objects and page tokens are never supplied by JSON.
        if(!authenticatedPage?.session||!Number.isSafeInteger(authenticatedPage.pageGeneration)
          ||authenticatedPage.pageGeneration<0||!(authenticatedPage.pageToken===null||typeof authenticatedPage.pageToken==='string'))
          throw new OnlineError('signal-page-required',409);
        let signaling=matchSignaling.get(match);
        if(!signaling){signaling={pages:new Map(),frontiers:new Map()};matchSignaling.set(match,signaling);}
        let page=signaling.pages.get(username);
        if(!page||page.session!==authenticatedPage.session||page.pageToken!==authenticatedPage.pageToken||page.pageGeneration!==authenticatedPage.pageGeneration){
          page={...authenticatedPage,sourceEpoch:(page?.sourceEpoch??0)+1};signaling.pages.set(username,page);
        }
        identity={...identity,sourceEpoch:page.sourceEpoch};
        const key=JSON.stringify([username,target.id]),previous=signaling.frontiers.get(key);
        if(previous){const order=compareRtcSignalIdentity(identity,previous);
          if(order<0)return {ok:true,stale:true};
          if(order===0&&identity.offerId!==previous.offerId)throw new OnlineError('signal-generation-conflict',409);
        }
        // At most roster.size pages and roster.size*(roster.size-1) frontiers;
        // both maps belong to this match and retire with its normal teardown.
        signaling.frontiers.set(key,identity);
      }
      emit(target.username, 'signal', {matchId: match.id, from: username, type: body.type, payload: body.payload,...identity}); return {ok: true};
    },
    disconnect(username, reason = 'connection-lost', {recoverable=false}={}) {
      queue.delete(username); queueNotices.delete(username); adjustDeadline();
      const match = matches.get(playerMatch.get(username));
      const canResume=recoverable&&match?.status==='playing'&&typeof match.driver?.reconnect==='function';
      if(canResume)suspendedMatches.set(username,match.id);else suspendedMatches.delete(username);
      if (match && match.status !== 'finished') {
        const player = match.players.find(row => row.id === username);
        if (player?.connected) {
          const epoch=match.driver?.snapshot?.()?.ownership?.actors?.[username]?.epoch;
          player.connected = false;
          // Driver removes the actor and grants disadvantage buffs in the same authoritative update.
          match.driver?.disconnect?.(username,{recoverable:canResume});
          broadcast(match, 'disconnect', {matchId: match.id, playerId: username, reason,recoverable:canResume,
            ...(Number.isSafeInteger(epoch)&&epoch>=0?{epoch}:{})});
        }else if(player&&!canResume)match.driver?.disconnect?.(username,{recoverable:false});
      }
      if(!canResume)playerMatch.delete(username); publishStatus();
      return {recoverable:canResume};
    },
    reconnect(username,{deferUntilReady=false}={}) {return transaction(async()=>{
      const matchId=suspendedMatches.get(username);if(!matchId)return {resumed:false};
      const match=matches.get(matchId),player=match?.players.find(row=>row.id===username);
      if(closed)return {resumed:false};
      // A newly loaded page needs the ordinary resource/view ready handshake.
      // Keep its missing actor absent until that handshake, so loading cannot
      // consume the protection window or leave a fresh farming target.
      if(deferUntilReady&&match?.status==='playing'&&player&&!player.connected)return {resumed:false,pending:true,matchId};
      let restored;
      if(match?.status==='playing'&&player&&!player.connected)restored=await match.driver?.reconnect?.(username);
      // The worker may finish while the request crosses IPC. Settlement wins
      // over a stale successful restoration response.
      if(restored?.resumed&&match.status==='playing'&&playerMatch.get(username)===matchId){
        player.connected=true;suspendedMatches.delete(username);
        // Preserve the other peers' authenticated signaling frontiers. Only
        // this seat starts a new source epoch after its connection was retired.
        const page=matchSignaling.get(match)?.pages.get(username);if(page)page.session=null;
        broadcast(match,'match',publicMatch(match));publishStatus();return {resumed:true,matchId,...restored};
      }
      suspendedMatches.delete(username);if(playerMatch.get(username)===matchId)playerMatch.delete(username);
      // A finished round is never rehydrated as a playable/result battle when
      // recovering this disconnected seat. Its normal statistics stay saved.
      emit(username,'reconnect-ended',{matchId});emit(username,'status',status(username));
      return {resumed:false,ended:true,matchId};
    });},
    tick: () => transaction(async () => {
      if (closed) return;
      for (const [username] of queue) if (!isActive(username)) {queue.delete(username); onDrop(username,'queue-timeout');}
      adjustDeadline();
      if (queuePublishKey() !== lastQueuePublished) publishStatus({queueOnly: true});
      for (const mode of ONLINE_MODES) {
        const {deadline} = clocks.get(mode);
        if (modeFlags[mode] && hasCapacity(mode) && deadline !== null && now() >= deadline
          && eligibleEntries(mode).length >= MODE_CONFIG[mode].playerCount) await startMatch(mode);
        if (closed) return;
      }
      for (const match of matches.values()) {
        if (match.pendingResult && !match.recording && now() >= match.retryAt) await finish(match, match.pendingResult);
        if (match.status === 'finished' && now() - match.result.finishedAt > 300_000) matches.delete(match.id);
      }
    }),
    close() {
      if (closed) return;
      closed = true;
      for (const match of matches.values()){matchSignaling.delete(match);match.driver?.stop?.();}
      driverFactory?.close?.();
      queue.clear(); matches.clear(); playerMatch.clear(); lastResults.clear(); suspendedMatches.clear();rates.clear();
      queueNotices.clear();
      for (const clock of clocks.values()) {clock.deadline = null; clock.pausedRemaining = null;}
    },
    matchSnapshot(username) {
      const match = matches.get(playerMatch.get(username));
      if (!match) return null;
      if(match.status==='settling')return match.finalState ? {matchId:match.id,...structuredClone(match.finalState)} : null;
      if(match.ownership===OWNERSHIP_PROTOCOL)return {matchId:match.id,...(match.driver?.snapshot?.()??match.lastState??{})};
      return match.lastState ? structuredClone(match.lastState) : {matchId: match.id, ...(match.driver?.snapshot?.() ?? {})};
    },
    bindRelay(username,binding){
      const match=matches.get(playerMatch.get(username));if(!match)return;
      if(match.driver)match.driver.bindRelay?.(username,binding);
      else{match.pendingRelayBindings??=new Map();match.pendingRelayBindings.set(username,structuredClone(binding));}
    },
    workerDiagnostics:()=>driverFactory?.workerDiagnostics?.()??{mode:'in-process',active:0,workers:[]},
  };
  return service;
}
