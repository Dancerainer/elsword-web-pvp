import http from 'node:http';
import {NETWORK_BINARY_VERSION} from '../../packages/online/network-binary.mjs';
import {realpathSync} from 'node:fs';
import {isIP} from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, open, mkdir, writeFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {StaticResourceCache,StaticResourceChangedError,matchesResourceTag,createVerifiedResourceStream} from './static-resource-cache.mjs';
import {createAssetVersionInventory} from './asset-versions.mjs';
import {canonicalAssetRequest} from './asset-path-aliases.mjs';
import {createResourceDeliveryStore} from './resource-delivery.mjs';
import {createClientUpdateDelivery} from './client-update.mjs';
import {createUpdateBandwidth,hasBattleOutputPressure} from './update-bandwidth.mjs';
import {createSkillPreferencesStore,SkillPreferencesValidationError,normalize as normalizeSkillPreferences} from './skill-preferences.mjs';
import {createKeyPreferencesStore} from './key-preferences.mjs';
import {createCredentialsStore, PasswordChangeError, AccountCreationError, validNewPassword} from './credentials-store.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {createOnlineService, OnlineError} from '../../packages/online/service.mjs';
import {normalizeIceServers} from '../../packages/online/rtc-config.mjs';
import {isOnlineMode} from '../../packages/online/modes.mjs';
import {DEFAULT_ROOM_CAPACITY,normalizeRoomCapacity} from '../../packages/online/room-capacity.mjs';
import {createSseStream, acceptsSseGzip} from './sse-stream.mjs';
import {createOnlinePollChannel, PollChannelError} from './online-poll-channel.mjs';
import {createWebSocketStream,websocketHandshake,ONLINE_SOCKET_PROTOCOL} from './websocket-stream.mjs';
import {compactOwnedSocketRoom} from './owned-socket-room.mjs';
import {createOwnedRelayDelta} from '../../packages/online/owned-relay-delta.mjs';
import {createOwnerUploadDelta,OWNER_UPLOAD_DELTA_VERSION} from '../../packages/online/owner-upload-delta.mjs';
import {normalizePeerReceipts,pruneAcknowledgedPeerActions,hasPeerActionBaselines} from '../../packages/online/peer-receipts.mjs';
import {createOwnedRelayPacer} from './owned-relay-pacer.mjs';
import {ownedRelayControllerSignature,observeOwnedRelayController} from './owned-relay-controller.mjs';
import {isCurrentRoomPacket} from './room-worker-relays.mjs';
import skillProfile from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import skillPreset from '../../config/rf-preset.json' with {type:'json'};
import {PROFESSION_IDS, PROFESSIONS, normalizeProfessionId} from '../../packages/professions/catalog.mjs';
import {getProfessionProfile, getProfessionPreset} from '../../packages/professions/profiles.mjs';
import {normalizeCostumeId} from '../../packages/professions/costumes.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf':'font/ttf' };

export function safePath(root, relative) {
  if (relative.includes('\0') || relative.includes('\\')) return null;
  const result = path.resolve(root, relative);
  return result.startsWith(path.resolve(root) + path.sep) ? result : null;
}

async function readBody(req, limit=8192) {
  const chunks=[];let length=0;
  for await (const chunk of req) { length+=chunk.length;if(length>limit)throw Error('body-too-large');chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
function pollJson(req, res, data) {
  const compressed = acceptsSseGzip(req.headers['accept-encoding']);
  res.writeHead(200, {'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', Vary: 'Accept-Encoding',
    ...(compressed ? {'Content-Encoding': 'gzip'} : {})});
  const body = JSON.stringify(data);
  if (!compressed) return res.end(body);
  const gzip = createGzip({level: 1});
  pipeline(gzip, res, () => {}); gzip.end(body);
}

export async function createDevServer({ root = ROOT, credentials, additionalCredentials, sessionSeconds = 3600,
  assetRoot = path.join(root, 'artifacts'), accountRoot = path.join(root, 'runtime'), publicOrigin = null, credentialsFileSystem,
  driverFactory, onlineVersions = {}, heartbeatSeconds = 5, heartbeatTimeoutSeconds = 20,
  disconnectGraceMs = 2500, now = Date.now, createPlayerAccount = credentials === undefined, rtcIceServers = [], peerMode = 'hybrid',
  disconnectTimers = {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout},
  onlineEventTransport = 'sse', pollWaitMs = 10_000, trustLoopbackProxy = false, resourceValidation = 'metadata',
  pollTimers = {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout},
  roomWorkers = true, roomCapacity = DEFAULT_ROOM_CAPACITY, resourceDeliveryEnabled = true, clientUpdateRoot=null,
  updateBandwidthOptions = {},
  ownedRelayClock = Date.now, ownedRelayTimers = {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout} } = {}) {
  const iceServers = normalizeIceServers(rtcIceServers);
  if(!['hybrid','relay'].includes(peerMode))throw Error('invalid-peer-mode');
  // Old launchers may still pass the retired aggregate limits. They must not
  // silently reinstate a hidden total-room/player cap behind the GM controls.
  const legacyCapacity=roomCapacity&&typeof roomCapacity==='object'&&!Array.isArray(roomCapacity)
    &&Object.keys(roomCapacity).length>0&&Object.keys(roomCapacity).every(key=>['maxActivePlayers','maxActiveRooms'].includes(key));
  const initialRoomCapacity=normalizeRoomCapacity(legacyCapacity?DEFAULT_ROOM_CAPACITY:roomCapacity);
  if(typeof roomWorkers!=='boolean')throw Error('invalid-room-workers');
  if(!['metadata','digest'].includes(resourceValidation))throw Error('invalid-resource-validation');
  if(typeof trustLoopbackProxy!=='boolean')throw Error('invalid-loopback-proxy-config');
  if (!Number.isFinite(heartbeatSeconds) || heartbeatSeconds <= 0 || !Number.isFinite(heartbeatTimeoutSeconds)
    || heartbeatTimeoutSeconds <= heartbeatSeconds || !Number.isFinite(disconnectGraceMs) || disconnectGraceMs < 0) throw Error('invalid-heartbeat-config');
  if (typeof disconnectTimers?.setTimeout !== 'function' || typeof disconnectTimers?.clearTimeout !== 'function') throw Error('invalid-disconnect-timers');
  if (!['sse', 'poll'].includes(onlineEventTransport)) throw Error('invalid-online-event-transport');
  if(typeof ownedRelayClock!=='function'||typeof ownedRelayTimers?.setTimeout!=='function'
    ||typeof ownedRelayTimers?.clearTimeout!=='function')throw Error('invalid-owned-relay-pacer-config');
  if (!Number.isFinite(pollWaitMs) || pollWaitMs < 0 || pollWaitMs > 10_000
    || typeof pollTimers?.setTimeout !== 'function' || typeof pollTimers?.clearTimeout !== 'function') throw Error('invalid-poll-config');
  if (publicOrigin) {
    const parsed = new URL(publicOrigin);
    if (parsed.protocol !== 'https:' || parsed.origin !== publicOrigin) throw Error('invalid-public-origin');
  }
  // The test account is local to this workbench; this is not the future production account database.
  const runtime = path.join(root, 'runtime');
  let buildVersion = null;
  try { buildVersion = createHash('sha256').update(await readFile(path.join(root, 'dist/game.js'))).digest('hex'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  let account = credentials;
  if (!account) {
    await mkdir(accountRoot, { recursive: true });
    const accountFile = path.join(accountRoot, 'dev-account.json');
    try { account = JSON.parse(await readFile(accountFile, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      account = { username: 'rf-tester', password: randomBytes(12).toString('base64url') };
      await writeFile(accountFile, JSON.stringify(account, null, 2) + '\n', { flag: 'wx' });
    }
  }
  let extra = additionalCredentials;
  if (extra === undefined) {
    try {
      const config = JSON.parse((await readFile(path.join(accountRoot, 'dev-accounts.json'), 'utf8')).replace(/^\uFEFF/, ''));
      if (config.schemaVersion !== 1 || !Array.isArray(config.accounts)) throw Error('invalid-test-accounts');
      extra = config.accounts;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      extra = [];
    }
  }
  if (!Array.isArray(extra)) throw Error('invalid-test-accounts');
  let playerAccount = null;
  if (createPlayerAccount) {
    const playerFile = path.join(accountRoot, 'dev-player-account.json');
    await mkdir(accountRoot, {recursive: true});
    try { playerAccount = JSON.parse((await readFile(playerFile, 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      let username = 'rf-player';
      while ([account, ...extra].some(entry => entry.username === username)) username = `rf-player-${randomBytes(3).toString('hex')}`;
      playerAccount = {username, password: randomBytes(12).toString('base64url'), role: 'player'};
      await writeFile(playerFile, JSON.stringify(playerAccount, null, 2) + '\n', {flag: 'wx', mode: 0o600});
    }
    if (playerAccount.role !== 'player') throw Error('invalid-player-test-account');
    extra = [...extra, playerAccount];
  }
  const accounts = createCredentialsStore({accountRoot, fileSystem: credentialsFileSystem});
  await accounts.initialize([account, ...extra]);
  const accountStore = createOnlineAccountStore({accountRoot});
  await accountStore.initialize([account, ...extra, ...accounts.playerIdentities()]);
  const sessions = new Map(), usernameSessions = new Map(), attempts = new Map(), staticCache=new StaticResourceCache();
  const replacedSessions=new Map(),retiredPageTokens=new Map(),successfulLogins=new Map();let loginSequence=0,nextRetiredSweep=0;
  const replacedMessage={error:'session-replaced',message:'Your account signed in on another client. This session has ended.'};
  function rememberRetired(map,key){
    if(!key)return;map.delete(key);map.set(key,now()+Math.max(sessionSeconds*1000,60000));
    while(map.size>8192)map.delete(map.keys().next().value);
  }
  const assetVersions=createAssetVersionInventory(assetRoot,staticCache);
  const resourceDelivery=createResourceDeliveryStore({accountRoot,enabled:resourceDeliveryEnabled});
  await resourceDelivery.initialize();
  const resourceTransfers=new Set();
  const skillPreferences=Object.fromEntries(PROFESSION_IDS.map(professionId => [professionId, createSkillPreferencesStore({accountRoot,
    professionId,profile:getProfessionProfile(professionId),preset:getProfessionPreset(professionId)})]));
  const defaultSkillPreferences=Object.fromEntries(PROFESSION_IDS.map(professionId => {
    const profile = getProfessionProfile(professionId), preset = getProfessionPreset(professionId);
    return [professionId, normalizeSkillPreferences({loadout:preset.loadout ?? profile.loadout ?? Array(8).fill(null), branchChoices:{}},
      profile,preset,{mode:'restore'})];
  }));
  const keyPreferences=createKeyPreferencesStore({accountRoot});
  if (driverFactory === undefined) {
    try {
      const {createBattleDriverFactory} = await import('./battle-driver.mjs');
      driverFactory = await createBattleDriverFactory({root, assetRoot});
      if(roomWorkers&&driverFactory){
        const {createRoomWorkerFactory}=await import('./room-worker-factory.mjs');
        driverFactory=await createRoomWorkerFactory({root,assetRoot,metadataFactory:driverFactory});
      }
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !String(error.message).includes('battle-driver.mjs')) throw error;
      driverFactory = null;
    }
  }
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const streams = new Map(), streamClosures = new Map(), socketRelays=new Map(),downstreamRelays=new Map();
  const relayBinding=relay=>({generation:relay.bindingGeneration,token:relay.token,splitDeltas:relay.splitDeltas,deltaVersion:relay.deltaVersion});
  if(driverFactory?.workerDiagnostics)driverFactory.relayBindings=match=>match.players.flatMap(player=>{
    const relay=downstreamRelays.get(player.id);return relay?[{playerId:player.id,...relayBinding(relay)}]:[];
  });
  const transportStats={sseOpened:0,sseClosed:0,socketOpened:0,socketClosed:0,downstreamRecoveryPreserved:0,
    ownedRelaySkipped:0,controlActionsSkipped:0,controlRelaySkipped:0,receiptsAccepted:0,stalePeerReceipts:0,invalidPeerReceipts:0,sessionReleases:{},recentClosedStreams:[]};
  const recordClosed=(kind,metrics)=>{transportStats.recentClosedStreams.push({kind,...metrics});if(transportStats.recentClosedStreams.length>32)transportStats.recentClosedStreams.shift();};
  const onlineDiagnostic=process.env.RF_ACCESS_LOG==='1'?(event,details)=>console.log(JSON.stringify({event,at:new Date().toISOString(),...details})):()=>{};
  let eventSequence = 0;
  const directIsHealthy=(relay,playerId,epoch,frameSeq)=>{
    const receipt=relay.peerReceipts.get(playerId);
    return Boolean(receipt&&now()-receipt.at<750&&receipt.epoch===epoch&&receipt.frameSeq>=frameSeq-18);
  };
  function preparePeerReceipts(user,body){
    let receipts;try{receipts=normalizePeerReceipts(body?.peerReceipts??[]);}catch{transportStats.invalidPeerReceipts++;throw new OnlineError('invalid-peer-receipts');}
    const downstream=downstreamRelays.get(user.username),pageGeneration=user.pageGeneration;
    const knownReceipt=row=>downstream?.matchId===body.matchId&&downstream.sourceClocks.has(row.playerId);
    const receiptMatch=receipts.some(row=>!knownReceipt(row))?online.status(user.username).match:null;
    if(receipts.some(row=>row.playerId===user.username||!knownReceipt(row)
      &&(receiptMatch?.id!==body.matchId||!receiptMatch.players.some(player=>player.id===row.playerId)))){
      transportStats.invalidPeerReceipts++;throw new OnlineError('invalid-peer-receipts');
    }
    return {receipts,downstream,pageGeneration};
  }
  function acceptPeerReceipts(user,body,{receipts,downstream,pageGeneration}){
    const current=downstreamRelays.get(user.username);
    // Old POST/WS completions cannot clear the replacement page/mailbox.
    if(current!==downstream||!current||user.pageGeneration!==pageGeneration||current.matchId!==body.matchId)return;
    current.peerReceipts.clear();for(const receipt of receipts){
      const source=current.sourceClocks.get(receipt.playerId);
      if(!source||source.epoch!==receipt.epoch||receipt.frameSeq>source.frameSeq+120){transportStats.stalePeerReceipts++;continue;}
      current.peerReceipts.set(receipt.playerId,{...receipt,at:now()});transportStats.receiptsAccepted++;
      if(directIsHealthy(current,receipt.playerId,source.epoch,source.frameSeq))current.pacer.clear(receipt.playerId,{resetClock:false});
    }
  }
  function prunePeerInput(relay,data){
    return pruneAcknowledgedPeerActions(data,relay.peerReceipts.get(data.playerId),{now:now()});
  }
  const clearRelayPending=username=>{const relay=downstreamRelays.get(username);relay?.pacer.clearAll();relay?.sourceControllers.clear();};
  const sameCapability=(a,b)=>a?.splitDeltas===b?.splitDeltas&&a?.deltaVersion===b?.deltaVersion;
  function readDownstreamCapability(value){
    if(value===undefined||value===null)return null;
    if(!['2','3'].includes(value))throw new OnlineError('invalid-owned-delta');
    return {splitDeltas:true,deltaVersion:Number(value)};
  }
  const rememberedCapability=user=>user.ownedDownstreamCapability?.pageGeneration===user.pageGeneration?user.ownedDownstreamCapability.capability:null;
  function retireDownstream(username,expected=downstreamRelays.get(username)){
    if(!expected||downstreamRelays.get(username)!==expected)return;
    expected.pacer.clearAll();expected.sourceControllers.clear();downstreamRelays.delete(username);online.bindRelay(username,null);
  }
  function installDownstream(user,sessionId,capability){
    retireDownstream(user.username);
    if(!capability)return null;
    const pageGeneration=user.pageGeneration;
    user.ownedDownstreamCapability={pageGeneration,capability:{...capability}};
    const relay={sessionId,pageGeneration,epochs:new Map(),deltas:createOwnedRelayDelta(),token:randomBytes(16).toString('hex'),
      sourceClocks:new Map(),sourceLives:new Map(),sourceControllers:new Map(),roomLives:new Map(),peerReceipts:new Map(),bindingGeneration:0,...capability};
    relay.pacer=createOwnedRelayPacer({clock:ownedRelayClock,timers:ownedRelayTimers,
      canSend:(value,context)=>{
        const current=streams.get(user.username),source=relay.sourceClocks.get(value.playerId);
        if(downstreamRelays.get(user.username)!==relay||sessions.get(sessionId)!==user||user.pageGeneration!==pageGeneration
          ||current!==context.stream||current?.sessionId!==sessionId||current.pageGeneration!==pageGeneration
          ||relay.token!==context.token||relay.matchId!==context.matchId||source?.epoch!==value.epoch
          ||current.transport==='poll'&&current.channel.closed||current.transport!=='poll'&&current.response.destroyed)return false;
        if(!context.lifeChanged&&directIsHealthy(relay,value.playerId,value.epoch,source.frameSeq)){
          transportStats.ownedRelaySkipped++;return false;
        }
        return true;
      },
      send:(value,{stream,lifeChanged,controllerChanged=false})=>{
        // A controller boundary has already bypassed the movement pacer. Keep
        // it reliable through the downstream queue as well: otherwise a later
        // ordinary pose can erase this turn/landing/reaction while gzip or the
        // socket is blocked. Only ordinary clocks remain replaceable; reliable
        // pressure still retires the bounded mailbox instead of losing edges.
        const critical=lifeChanged||controllerChanged;
        const key=critical?null:'owner:'+value.matchId+':'+value.playerId;
        if(stream.transport==='poll')return stream.channel.push('owned-state',value.wireJson?JSON.parse(value.wireJson):value,{replaceKey:key,critical});
        return stream.write(`id: ${++eventSequence}\nevent: owned-state\ndata: ${value.wireJson??JSON.stringify(value)}\n\n`,{replaceKey:key,urgent:lifeChanged||controllerChanged});
      }});
    downstreamRelays.set(user.username,relay);return relay;
  }
  const emit = (username, type, data) => {
    const stream = streams.get(username);
    if (!stream) return;
    const eventId=++eventSequence;
    if(type==='owner-status'){
      // Full independent snapshots can replace one another while blocked;
      // neither peer pose receipts nor attack dictionaries fence this domain.
      if(stream.transport==='poll')stream.channel.push(type,data,{replaceKey:'owner-status:'+data.matchId+':'+data.playerId,critical:true});
      else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: owner-status\ndata: ${JSON.stringify(data)}\n\n`,
        {replaceKey:'owner-status:'+data.matchId+':'+data.playerId,urgent:true});
      return;
    }
    const workerPrepared=!!data.__roomPackets;
    const relay=downstreamRelays.get(username);
    if(relay&&stream.sessionId===relay.sessionId&&stream.pageGeneration===relay.pageGeneration&&sessions.get(relay.sessionId)?.pageGeneration===relay.pageGeneration){
      if(data.matchId&&relay.matchId!==data.matchId){relay.pacer.clearAll();relay.matchId=data.matchId;relay.epochs.clear();relay.deltas.clear();relay.sourceClocks.clear();relay.sourceLives.clear();relay.sourceControllers.clear();relay.roomLives.clear();relay.peerReceipts.clear();}
      if(type==='disconnect'){const id=data.playerId??data.id;relay.pacer.clear(id);relay.sourceControllers.delete(id);}
      let value=data,critical=false;
      const prepared=data.__roomPackets?.[username];
      if(isCurrentRoomPacket(prepared,relay)){
        if(type==='input'){
          let wireJson=prepared.json;
          const omitted=prunePeerInput(relay,data);
          if(omitted.skipped){
            const wire=JSON.parse(wireJson),pruned=prunePeerInput(relay,wire);
            // A worker has already advanced its independent action codec.
            // The first reliable baseline must reach this receiver even if
            // RTC already delivered all actions that introduced it.
            if(pruned.value.actions.length||!hasPeerActionBaselines(wire)){
              transportStats.controlActionsSkipped+=pruned.skipped;
              if(!pruned.value.actions.length){transportStats.controlRelaySkipped++;return;}
              wireJson=JSON.stringify(pruned.value);
            }
          }
          if(stream.transport==='poll')stream.channel.push(type,JSON.parse(wireJson),{critical:true});
          else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: ${type}\ndata: ${wireJson}\n\n`,{urgent:true});
          return;
        }
        if(type==='state'){
          for(const [id,row]of Object.entries(data.ownership.actors)){
            if(relay.sourceClocks.get(id)?.epoch!==row.epoch){relay.pacer.clear(id);relay.sourceControllers.delete(id);}
            relay.sourceClocks.set(id,{epoch:row.epoch,frameSeq:row.frameSeq});
          }
          for(const actor of data.snapshot.actors){const life=`${!!actor.pvpDead}:${!!actor.pvpDisconnected}`;
            if(relay.roomLives.has(actor.id)&&relay.roomLives.get(actor.id)!==life){relay.pacer.clear(actor.id);relay.sourceControllers.delete(actor.id);}
            relay.roomLives.set(actor.id,life);}
          const key=prepared.critical?null:'room:'+data.matchId;
          if(stream.transport==='poll')stream.channel.push(type,JSON.parse(prepared.json),{replaceKey:key,critical:prepared.critical});
          else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: ${type}\ndata: ${prepared.json}\n\n`,{replaceKey:key,urgent:prepared.critical});
          return;
        }
        if(type==='owned-state'){
          const {epoch,frameSeq}=data.report;relay.sourceClocks.set(data.playerId,{epoch,frameSeq});
          if(prepared.split){
            const controllerChanged=typeof prepared.controllerSignature==='string'&&
              observeOwnedRelayController(relay.sourceControllers,data.playerId,prepared.controllerSignature);
            if(prepared.baselineJson){
              relay.pacer.clear(data.playerId,{resetClock:prepared.actorBaseline||prepared.lifeChanged});
              if(stream.transport==='poll')stream.channel.push(type,JSON.parse(prepared.baselineJson),{critical:true});
              else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: ${type}\ndata: ${prepared.baselineJson}\n\n`,{urgent:true});
            }
            if(!prepared.lifeChanged&&directIsHealthy(relay,data.playerId,epoch,frameSeq)){
              relay.pacer.clear(data.playerId,{resetClock:false});transportStats.ownedRelaySkipped++;return;
            }
            relay.pacer.offer(data.playerId,{matchId:data.matchId,playerId:data.playerId,epoch,frameSeq,wireJson:prepared.json},
              {stream,token:relay.token,matchId:data.matchId,lifeChanged:prepared.lifeChanged,controllerChanged},{immediate:prepared.lifeChanged||controllerChanged});return;
          }
          const key=prepared.critical?null:'owner:'+data.matchId+':'+data.playerId;
          if(stream.transport==='poll')stream.channel.push(type,JSON.parse(prepared.json),{replaceKey:key,critical:prepared.critical});
          else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: ${type}\ndata: ${prepared.json}\n\n`,{replaceKey:key,urgent:prepared.critical});
          return;
        }
      }
      // An old process binding cannot seed a replacement transport. Room
      // snapshots still have a complete fallback for a connection's seed.
      if(type==='owned-state'&&data.__roomPackets)return;
      if(data.__roomPackets){const {__roomPackets,...plain}=data;data=plain;value=plain;}
      if(type==='input'&&data.actions?.length){
        const pruned=prunePeerInput(relay,data);transportStats.controlActionsSkipped+=pruned.skipped;
        if(!pruned.value.actions.length){transportStats.controlRelaySkipped++;return;}
        data=pruned.value;value=data;
      }
      if(type==='state'&&data.ownership?.mode==='local-owner-v1'){
        let roomLifeChanged=false;
        for(const [id,row]of Object.entries(data.ownership.actors)){
          if(relay.sourceClocks.get(id)?.epoch!==row.epoch){relay.pacer.clear(id);relay.sourceControllers.delete(id);roomLifeChanged=true;}
          relay.sourceClocks.set(id,{epoch:row.epoch,frameSeq:row.frameSeq});
        }
        for(const actor of data.snapshot.actors){
          const life=`${!!actor.pvpDead}:${!!actor.pvpDisconnected}`;
          if(relay.roomLives.has(actor.id)&&relay.roomLives.get(actor.id)!==life){relay.pacer.clear(actor.id);relay.sourceControllers.delete(actor.id);roomLifeChanged=true;}
          relay.roomLives.set(actor.id,life);
        }
        // Canonical complete actors are sent on each life before a room-only
        // patch. Static actor configuration does not need repeated10Hz copies.
        const compact=compactOwnedSocketRoom(data,relay.epochs);value=compact.data;critical=compact.critical||roomLifeChanged;
      }else if(type==='owned-state'){
        relay.sourceClocks.set(data.playerId,{epoch:data.report.epoch,frameSeq:data.report.frameSeq});
        if(!relay.splitDeltas){
          // Old coordinators on the same gzip subprotocol understand full
          // reports / top-level patches, not baseline-only or nested v2 rows.
          const delta=relay.deltas.encode(data.playerId,data.report);
          value={matchId:data.matchId,relayToken:relay.token,...delta.value};critical=delta.critical;
        }else{
         const split=relay.deltas.encodeSplit(data.playerId,data.report,{cacheKey:data,deltaVersion:relay.deltaVersion});
         const controllerChanged=observeOwnedRelayController(relay.sourceControllers,data.playerId,ownedRelayControllerSignature(data.report));
         const life=`${data.report.epoch}:${data.report.actor.hp<=0}:${!!data.report.actor.hidden}:${!!data.report.actor.deathComplete}`;
         const lifeChanged=relay.sourceLives.has(data.playerId)&&relay.sourceLives.get(data.playerId)!==life;
         relay.sourceLives.set(data.playerId,life);
         if(split.baseline){
          relay.pacer.clear(data.playerId,{resetClock:!!split.baseline.actorBaseline||lifeChanged});
          const baseline={matchId:data.matchId,relayToken:relay.token,...split.baseline};
          // A small reliable birth template always precedes a replaceable
          // clock update. It also keeps decoding ready if RTC later goes away.
          if(stream.transport==='poll')stream.channel.push(type,baseline,{critical:true});
          else if(!stream.response.destroyed)stream.write(`id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(baseline)}\n\n`,{urgent:true});
         }
         if(!lifeChanged&&directIsHealthy(relay,data.playerId,data.report.epoch,data.report.frameSeq)){
          relay.pacer.clear(data.playerId,{resetClock:false});transportStats.ownedRelaySkipped++;return;
         }
         value={matchId:data.matchId,relayToken:relay.token,...split.value};
         relay.pacer.offer(data.playerId,value,{stream,token:relay.token,matchId:data.matchId,lifeChanged,controllerChanged},{immediate:lifeChanged||controllerChanged});
         return;
        }
      }else if(type==='input'&&data.actions?.length&&relay.deltaVersion===3&&!workerPrepared){
        value={...relay.deltas.encodeActions(data.playerId,data,{cacheKey:data}),relayToken:relay.token};
      }
      const key=type==='owned-state'&&!critical?'owner:'+data.matchId+':'+data.playerId:type==='state'&&!critical?'room:'+data.matchId:null;
      // Keep downstream's shared gzip dictionary. Independently gzipping each
      // owner packet over WS costs more bandwidth than this persistent stream.
      if(stream.transport==='poll'){stream.channel.push(type,value,{replaceKey:key,critical:key===null});return;}
      if(!stream.response.destroyed){const id=type==='owned-state'?++eventSequence:eventId;stream.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`,{replaceKey:key,urgent:critical||type==='signal'||type==='input'&&!!value.actions?.length});return;}
    }
    if(type==='owned-state')return;
    if(data.__roomPackets){const {__roomPackets,...plain}=data;data=plain;}
    if (stream.transport === 'poll') {
      const replaceKey=type==='state'&&!data.events?.length?'state:'+data.matchId:null;
      stream.channel.push(type,data,{replaceKey,critical:replaceKey===null});return;
    }
    if (stream.response.destroyed) return;
    const packet = `id: ${eventId}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    // Negotiation/recovery does not need the ordinary movement batch delay.
    // The stream's urgent microtask retains FIFO and honors compression/drain.
    stream.write(packet,{replaceKey:type==='state'&&!data.events?.length?'state:'+data.matchId:null,
      urgent:type==='signal'||type==='match-preparing'||type==='match-preparation-ended'});
  };
  const driverVersions = driverFactory?.versions ?? {};
  const online = createOnlineService({driverFactory, accountStore, now, emit,sharedBroadcasts:true,roomCapacity:initialRoomCapacity,
    onlineUsers: () => usernameSessions.keys(),
    onDrop: (username, reason) => releaseSession(usernameSessions.get(username), reason),
    versions: {...driverVersions, ...onlineVersions,
      reference: onlineVersions.reference ?? onlineVersions.baseline ?? driverVersions.referenceVersion ?? driverVersions.baseline
        ?? hash({target: skillProfile.target, nativeManifestSha256: driverVersions.nativeManifestSha256 ?? null}),
      preset: onlineVersions.preset ?? driverVersions.presetSha256 ?? hash(skillPreset),
      program: onlineVersions.program ?? driverVersions.program ?? driverVersions.hostProgramSha256
        ?? driverVersions.programVersion ?? buildVersion ?? hash(skillProfile),
      browserBuildVersion: buildVersion,
      nativeProgram: onlineVersions.nativeProgram ?? driverVersions.nativeProgram ?? null,
      profile: onlineVersions.profile ?? driverVersions.profileSha256 ?? hash(skillProfile)},
    isActive: username => {
      const session = sessions.get(usernameSessions.get(username));
      return Boolean(validSession(session) && (!requiresLiveness(username) || now() - session.lastSeen < heartbeatTimeoutSeconds * 1000));
    }});
  const updateBandwidth=createUpdateBandwidth({...updateBandwidthOptions,getPressure:()=>{
    const blocked=hasBattleOutputPressure(streams.values(),socketRelays.values());
    return {...online.bandwidthDemand(),blocked};
  }});
  const clientUpdates=createClientUpdateDelivery({root:clientUpdateRoot,buildVersion,bandwidth:updateBandwidth});
  // Practice/lobby is local play. Only queue/loading use the short downstream
  // recovery gate; entered matches have a separate authenticated-activity
  // deadline below, so closing every connection cannot retain a ghost forever.
  const requiresLiveness = username => online.isLocked(username) && !online.isPlaying(username);
  const validSession = session => Boolean(session && (session.expires > now() || online.isPlaying(session.username)));
  const sessionCookie = id => `rf_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionSeconds}${publicOrigin ? '; Secure' : ''}`;
  function releaseSession(id, reason) {
    const session = sessions.get(id); if (!session) return;
    const ownsUsername=usernameSessions.get(session.username)===id;
    if(reason==='session-replaced'){
      rememberRetired(replacedSessions,id);
      for(const token of session.pageInitTokens??[])rememberRetired(retiredPageTokens,token);
      rememberRetired(retiredPageTokens,session.pageInitToken);
      const previous=streams.get(session.username);
      if(previous?.sessionId===id){
        if(previous.transport==='poll'){
          const pending=previous.activeRequest;
          if(pending&&!pending.response.destroyed&&!pending.response.headersSent)json(pending.response,401,replacedMessage);
          previous.activeRequest=null;pending?.handle.cancel();
        }else previous.write(`event: session-replaced\ndata: ${JSON.stringify(replacedMessage)}\n\n`,{urgent:true});
      }
    }
    // A delayed response must never reinstall a revoked cookie over a newer
    // login in another same-origin tab.
    for(const response of session.cookieRefreshResponses??[])if(!response.headersSent)response.removeHeader('Set-Cookie');
    transportStats.sessionReleases[reason]=(transportStats.sessionReleases[reason]??0)+1;
    sessions.delete(id);
    if(ownsUsername){usernameSessions.delete(session.username);clearDisconnect(session.username);}
    const stream = streams.get(session.username);
    const downstream=downstreamRelays.get(session.username);if(downstream?.sessionId===id)retireDownstream(session.username,downstream);
    if (stream?.sessionId === id) { streams.delete(session.username); stream.end(); }
    const relay=socketRelays.get(session.username);if(relay?.sessionId===id){socketRelays.delete(session.username);relay.channel.close();}
    if(ownsUsername)online.disconnect(session.username, reason);
  }
  function clearDisconnect(username) {
    disconnectTimers.clearTimeout(streamClosures.get(username)); streamClosures.delete(username);
  }
  function suspendPlayingSession(id,reason){
    const session=sessions.get(id);if(!session||session.combatSuspended)return;
    // Keep authentication so an ordinary transport reopen can recover the
    // saved seat. Confirmed absence immediately retires every old mailbox.
    session.combatSuspended=true;
    if(!Object.hasOwn(session,'suspendedPageGeneration')){session.suspendedPageGeneration=session.pageGeneration;session.suspendedPageToken=session.pageInitToken;}
    clearDisconnect(session.username);
    const stream=streams.get(session.username),relay=socketRelays.get(session.username);
    if(stream?.sessionId===id){streams.delete(session.username);retireDownstream(session.username);stream.end();}
    if(relay?.sessionId===id){socketRelays.delete(session.username);relay.channel.close();}
    online.disconnect(session.username,reason,{recoverable:true});
  }
  function scheduleDisconnect(id, user, pageGeneration, graceMs=disconnectGraceMs) {
    if (user.combatSuspended||!requiresLiveness(user.username)&&!online.isPlaying(user.username)) {clearDisconnect(user.username); return;}
    if (sessions.get(id) !== user || user.pageGeneration !== pageGeneration && (!online.isLocked(user.username)||online.isPageLoading(user.username))) return;
    // Rotating a poll lease cannot extend the original gap deadline.
    if (streamClosures.has(user.username)) return;
    const generation = user.pageGeneration;
    onlineDiagnostic('stream-disconnect-scheduled',{username:user.username,pageGeneration,generation,graceMs});
    const timer = disconnectTimers.setTimeout(() => {
      if (streamClosures.get(user.username) !== timer || sessions.get(id) !== user || user.pageGeneration !== generation) return;
      streamClosures.delete(user.username);
      if (user.combatSuspended||!requiresLiveness(user.username)&&!online.isPlaying(user.username)) return;
      const current = streams.get(user.username);
      onlineDiagnostic('stream-disconnect-deadline',{username:user.username,generation,transport:current?.transport??null,activeRequest:Boolean(current?.activeRequest)});
      if (!current || current.transport === 'poll' && !current.activeRequest) {
        const relay=socketRelays.get(user.username),age=relay?.lastInputAt===null||relay?.lastInputAt===undefined?Infinity:now()-relay.lastInputAt;
        if(online.isPlaying(user.username)){
          const activityAge=now()-user.lastSeen;
          // Accepted WS or HTTP uploads keep combat alive even while a
          // downstream lease reopens. With all channels silent, confirmation
          // uses the existing short grace rather than twenty idle seconds.
          if(activityAge<disconnectGraceMs||relay?.sessionId===id&&!relay.channel.closed&&age<disconnectGraceMs)
            scheduleDisconnect(id,user,generation,Math.max(1,disconnectGraceMs-Math.min(activityAge,age)));
          else suspendPlayingSession(id,'combat-stream-disconnected');
          return;
        }
        const loadingHeartbeatAge=user.loadingHeartbeatGeneration===generation&&Number.isFinite(user.loadingHeartbeatAt)?now()-user.loadingHeartbeatAt:Infinity;
        // A shader-blocked loading page may miss its next HTTP poll while its
        // worker remains authenticated. Only the current page's tagged beat
        // establishes this lease; queue/playing and retired pages keep their
        // existing recovery rules. The room still has a finite loading limit.
        if(online.hasMatch(user.username)&&!online.isPlaying(user.username)&&loadingHeartbeatAge<heartbeatTimeoutSeconds*1000){
          transportStats.downstreamRecoveryPreserved++;
          scheduleDisconnect(id,user,generation,Math.max(1,heartbeatTimeoutSeconds*1000-loadingHeartbeatAge));return;
        }
        // Retiring a blocked downstream is recovery, not proof that its owner
        // vanished. Accepted authenticated WS inputs independently establish
        // liveness, while the original heartbeat timeout bounds a silent WS.
        // Exact page identity remains mandatory, so a retired tab cannot keep
        // a newer page's locked room alive or postpone its original deadline.
        if(relay?.sessionId===id&&relay.pageGeneration===generation&&!relay.channel.closed&&age<heartbeatTimeoutSeconds*1000){
          transportStats.downstreamRecoveryPreserved++;
          scheduleDisconnect(id,user,generation,Math.max(1,heartbeatTimeoutSeconds*1000-age));
        }else releaseSession(id, 'stream-disconnected');
      }
    }, graceMs);
    timer.unref?.(); streamClosures.set(user.username, timer);
  }
  async function seedEvents(username) {
    const session=sessions.get(usernameSessions.get(username)),pageGeneration=session?.pageGeneration,pageToken=session?.pageInitToken,
      stream=streams.get(username),downstream=downstreamRelays.get(username),
      deferUntilReady=session?.suspendedPageGeneration!==undefined&&
        (session.suspendedPageGeneration!==pageGeneration||session.suspendedPageToken!==pageToken),
      recovery=await online.reconnect(username,{deferUntilReady});
    if(!session||sessions.get(usernameSessions.get(username))!==session||session.pageGeneration!==pageGeneration||session.pageInitToken!==pageToken
      ||streams.get(username)!==stream||downstreamRelays.get(username)!==downstream)return;
    session.combatSuspended=false;
    if(!recovery.pending){delete session.suspendedPageGeneration;delete session.suspendedPageToken;}
    clearRelayPending(username);
    const relay=downstreamRelays.get(username);
    if(relay){relay.bindingGeneration++;online.bindRelay(username,relayBinding(relay));}
    const initialStatus = online.status(username);
    emit(username, 'status', initialStatus);
    if (initialStatus.match) emit(username, 'match', initialStatus.match);
    const snapshot = online.matchSnapshot(username);
    if (snapshot) emit(username, 'state', snapshot);
    if (!recovery.ended&&!initialStatus.match && initialStatus.lastResult) emit(username, 'result', initialStatus.lastResult);
  }
  function closePollLease(lease) {
    if (!lease || streams.get(lease.session.username) !== lease || sessions.get(lease.sessionId) !== lease.session) return;
    retireDownstream(lease.session.username);streams.delete(lease.session.username); lease.end();
    scheduleDisconnect(lease.sessionId, lease.session, lease.pageGeneration);
  }
  const expireSessions = () => {
    if(now()>=nextRetiredSweep){nextRetiredSweep=now()+1000;
      for(const map of [replacedSessions,retiredPageTokens])for(const [key,expires]of map)if(expires<=now())map.delete(key);}
    for (const [id, session] of sessions) {
      if (online.isPlaying(session.username)) {
        // An active match may outlive its login cookie and short downstream
        // gaps. It cannot outlive all incoming authenticated activity. Outgoing
        // SSE keepalives are not evidence that its owner is still connected.
        const combatTimeout=Math.min(heartbeatTimeoutSeconds*1000,Math.max(6000,heartbeatSeconds*2000));
        if (!session.combatSuspended&&now() - session.lastSeen >= combatTimeout) suspendPlayingSession(id, 'combat-heartbeat-timeout');
        continue;
      }
      if (session.expires <= now()) releaseSession(id, 'session-expired');
      else if (requiresLiveness(session.username) && now() - session.lastSeen >= heartbeatTimeoutSeconds * 1000) releaseSession(id, 'heartbeat-timeout');
    }
  };
  function authenticationAttempt(req) {
    // Nginx overwrites X-Real-IP; trust it only on the explicit private loopback listener.
    const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    const forwardedIp = trustLoopbackProxy ? req.headers['x-real-ip'] : publicOrigin ? req.headers['cf-connecting-ip'] : undefined;
    const ip = localProxy && typeof forwardedIp === 'string' && isIP(forwardedIp) ? forwardedIp : req.socket.remoteAddress;
    let record = attempts.get(ip);
    if (!record || record.reset < Date.now()) { record = {failures: 0, reset: Date.now() + 60_000}; attempts.set(ip, record); }
    return {ip, record};
  }
  const server = http.createServer(async (req, res) => {
    if (process.env.RF_ACCESS_LOG === '1') {
      const started = Date.now();
      res.once('finish', () => console.log(JSON.stringify({
        method: req.method, path: req.url.split('?')[0], status: res.statusCode, ms: Date.now() - started,
      })));
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const cookie = req.headers.cookie?.match(/(?:^|;\s*)rf_session=([A-Za-z0-9_-]+)/)?.[1];
      expireSessions();
      const session = sessions.get(cookie);
      const user = validSession(session) ? session : null;
      const requestPageToken=req.headers['x-rf-page-init']??(pathname==='/api/online/events'?url.searchParams.get('pageInitToken'):null);
      const publicAuthenticationRoute=['/api/login','/api/change-password','/api/resource-delivery'].includes(pathname)||pathname.startsWith('/api/client-update');
      if(pathname.startsWith('/api/')&&!publicAuthenticationRoute&&
        (replacedSessions.has(cookie)||retiredPageTokens.has(requestPageToken)))return json(res,401,replacedMessage);
      if(user&&requestPageToken&&user.pageInitToken!==undefined&&requestPageToken!==user.pageInitToken&&
        !publicAuthenticationRoute&&!['/api/session','/api/online/handoff'].includes(pathname))return json(res,409,{error:'page-generation-retired'});
      const requireCurrentSession=()=>{if(sessions.get(cookie)!==user||!user)throw new OnlineError('session-replaced',401);};
      if (user) user.lastSeen = now();
      const origin = req.headers.origin;
      // Pin the public HTTPS origin rather than trusting forwarded Host/proto.
      if (req.method !== 'GET' && req.method !== 'HEAD'
        && (publicOrigin ? origin !== publicOrigin : origin && origin !== `http://${req.headers.host}`)) {
        return json(res, 403, { error: 'origin-denied' });
      }
      // Keep the authenticated browser cookie valid during long practice and
      // matches. Explicit logout/password changes still revoke this identity.
      if (user && user.expires - now() < sessionSeconds * 500) {
        user.expires = now() + sessionSeconds * 1000;
        res.setHeader('Set-Cookie', sessionCookie(cookie));
        user.cookieRefreshResponses??=new Set();user.cookieRefreshResponses.add(res);
        const finished=()=>user.cookieRefreshResponses.delete(res);res.once('finish',finished);res.once('close',finished);
      }
      if(pathname.startsWith('/api/client-update')&&await clientUpdates.handle(req,res,url))return;
      if(pathname==='/api/resource-delivery'){
        if(req.method!=='GET')return json(res,405,{error:'method-not-allowed'});
        return json(res,200,resourceDelivery.status());
      }
      if(pathname==='/api/admin/resource-delivery'){
        if(!user)return json(res,401,{error:'login-required'});
        if(user.role!=='gm')return json(res,403,{error:'gm-required'});
        if(req.method==='GET')return json(res,200,resourceDelivery.status());
        if(req.method!=='POST')return json(res,405,{error:'method-not-allowed'});
        let body;try{body=await readBody(req);}catch{return json(res,400,{error:'invalid-resource-delivery'});}
        if(!body||Array.isArray(body)||Object.keys(body).length!==1||typeof body.enabled!=='boolean')return json(res,400,{error:'invalid-resource-delivery'});
        let value;try{value=await resourceDelivery.save(body.enabled);}catch{return json(res,500,{error:'resource-delivery-save-failed'});}
        if(!value.enabled)for(const response of resourceTransfers)response.destroy();
        for(const username of usernameSessions.keys())emit(username,'resource-delivery',value);
        return json(res,200,value);
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        const {ip, record} = authenticationAttempt(req);
        if (record.failures >= 10) return json(res, 429, { error: 'too-many-attempts' });
        const body = await readBody(req);
        const username = typeof body.username === 'string' ? body.username : '';
        const order=++loginSequence;
        if (!await accounts.verify(username, body.password)) {
          record.failures++; attempts.set(ip, record); return json(res, 401, { error: 'invalid-credentials' });
        }
        attempts.delete(ip);
        // Verification may await a concurrent password save. An earlier
        // request finishing late cannot evict an already successful later one.
        if((successfulLogins.get(username)??0)>order)return json(res,409,{error:'login-superseded',message:'A newer sign-in succeeded. Use the most recently signed-in client.'});
        successfulLogins.set(username,order);
        releaseSession(usernameSessions.get(username),'session-replaced');
        if (cookie) releaseSession(cookie, 'account-changed');
        const id = randomBytes(32).toString('base64url');
        const role = accountStore.role(username);
        sessions.set(id, { username, role, expires: now() + sessionSeconds * 1000, lastSeen: now(), pageGeneration: 0 });
        usernameSessions.set(username, id);
        return json(res, 200, { username, role }, { 'Set-Cookie': sessionCookie(id) });
      }
      if (pathname === '/api/change-password') {
        if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
        const {ip, record} = authenticationAttempt(req);
        if (record.failures >= 10) return json(res, 429, {error: 'too-many-attempts'});
        let body;
        try { body = await readBody(req); }
        catch { return json(res, 400, {error: 'invalid-password-change'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.username !== 'string'
          || typeof body.oldPassword !== 'string' || Object.keys(body).some(key => !['username', 'oldPassword', 'newPassword'].includes(key)))
          return json(res, 400, {error: 'invalid-password-change'});
        if (!validNewPassword(body.newPassword)) return json(res, 400, {error: 'invalid-new-password'});
        try {
          await accounts.changePassword(body.username, body.oldPassword, body.newPassword,
            () => releaseSession(usernameSessions.get(body.username), 'password-changed'));
        } catch (error) {
          if (!(error instanceof PasswordChangeError)) throw error;
          if (error.status === 401) { record.failures++; attempts.set(ip, record); }
          return json(res, error.status, {error: error.code});
        }
        attempts.delete(ip);
        const headers = user?.username === body.username&&!usernameSessions.has(body.username)
          ? {'Set-Cookie': `rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicOrigin ? '; Secure' : ''}`} : {};
        return json(res, 200, {ok: true}, headers);
      }
      if (pathname === '/api/session') {
        if(user&&req.method==='GET'){
          const token=req.headers['x-rf-page-init'];
          if(token!==undefined&&(typeof token!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(token)))return json(res,400,{error:'invalid-page-init'});
          const fresh=token!==undefined&&token!==user.pageInitToken;
          if(fresh&&user.pageInitTokens?.has(token))return json(res,409,{error:'page-initialization-retired'});
          if(fresh&&(user.pageInitTokens?.size??0)>=256)return json(res,409,{error:'page-initialization-limit'});
          // Only a new authenticated page can hand over a queued connection.
          // Ordinary status reads cannot pause matching or renew combat grace.
          // Eligibility is suspended synchronously before the first asset await.
          // An untagged status read cannot replace a page that already has an
          // explicit identity. Otherwise its still-open SSE/poll lease keeps
          // an obsolete generation and the following handoff rejects itself.
          // Legacy untagged clients retain their existing reload behavior.
          if((!online.isLocked(user.username)&&(fresh||token===undefined&&user.pageInitToken===undefined))||fresh&&online.beginPageLoad(user.username)){
            retireDownstream(user.username);user.pageGeneration++;clearDisconnect(user.username);
          }
          // Never evict retired identities into reusable ones. Matched pages
          // may change connection identity, but never renew their grace timer.
          if(fresh){
            user.pageInitTokens??=new Set();user.pageInitTokens.add(token);user.pageInitToken=token;
            // The newly authenticated page owns this session now. A former
            // page may keep its idle upload open indefinitely; leaving that
            // socket installed rejects both the new upload and its handoff.
            // Detach by exact session before closing, so delayed old close
            // callbacks cannot retire a replacement installed afterwards.
            const previous=streams.get(user.username),upload=socketRelays.get(user.username);
            if(previous?.sessionId===cookie){streams.delete(user.username);retireDownstream(user.username);previous.end();}
            if(upload?.sessionId===cookie){socketRelays.delete(user.username);upload.channel.close();}
          }
        }
        const profile=user?await accountStore.profile(user.username):null;
        if(user)requireCurrentSession();
        return json(res, user ? 200 : 401, user ? { username: user.username, role: user.role, nickname: profile.nickname,
          ...online.professionStatus(user.username), buildVersion, resourceDelivery:resourceDelivery.status(),
          traceExport: publicOrigin ? 'download' : 'server', heartbeatSeconds, heartbeatTimeoutSeconds,
          rtcIceServers: iceServers, peerMode, onlineEventTransport, pageInitToken:user.pageInitToken??null, online: online.status(user.username) } : { error: 'login-required' });
      }
      if (pathname === '/api/heartbeat' && req.method === 'POST') {
        if (!user) return json(res, 401, {error: 'login-required'});
        const token=req.headers['x-rf-page-init'];
        if(token!==undefined&&token!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
        if(token&&token===user.pageInitToken){user.loadingHeartbeatAt=now();user.loadingHeartbeatGeneration=user.pageGeneration;}
        return json(res, 200, {ok: true, serverTime: now(), online: online.status(user.username)});
      }
      if (pathname === '/api/logout' && req.method === 'POST') {
        releaseSession(cookie, 'logout'); return json(res, 200, { ok: true }, user?{ 'Set-Cookie': `rf_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicOrigin ? '; Secure' : ''}` }:{});
      }
      if (pathname === '/api/preferences/costume') {
        if(!user)return json(res,401,{error:'login-required'});
        if(req.method==='GET')return json(res,200,online.professionStatus(user.username));
        if(req.method!=='POST')return json(res,405,{error:'method-not-allowed'});
        let body;try{body=await readBody(req);}catch{return json(res,400,{error:'invalid-costume-request'});}
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'professionId')||!Object.hasOwn(body,'costumeId'))return json(res,400,{error:'invalid-costume-request'});
        try{
          const professionId=normalizeProfessionId(body.professionId),costumeId=normalizeCostumeId(body.costumeId);
          const result=await online.transaction(async()=>{
            if(online.isLocked(user.username))throw new OnlineError('preferences-locked',409);
            await accountStore.saveCostume(user.username,professionId,costumeId);
            return online.professionStatus(user.username);
          });return json(res,200,result);
        }catch(error){return json(res,error instanceof OnlineError?error.status:error instanceof RangeError?400:500,
          {error:error instanceof OnlineError?error.code:error instanceof RangeError?'invalid-costume-request':'costume-preferences-unavailable'});}
      }
      if (pathname === '/api/preferences/profession') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (req.method === 'GET') return json(res, 200, online.professionStatus(user.username));
        if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
        let body;
        try { body = await readBody(req); }
        catch { return json(res, 400, {error: 'invalid-profession-request'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
          || !Object.hasOwn(body, 'professionId')) return json(res, 400, {error: 'invalid-profession-request'});
        try {
          const professionId = normalizeProfessionId(body.professionId);
          const result = await online.transaction(async () => {
            if (online.isLocked(user.username)) throw new OnlineError('preferences-locked', 409);
            if (!online.professionStatus(user.username).professions[professionId]) throw new OnlineError('profession-disabled', 409);
            await accountStore.saveProfession(user.username, professionId);
            return online.professionStatus(user.username);
          });
          return json(res, 200, result);
        } catch (error) {
          return json(res, error instanceof OnlineError ? error.status : error instanceof RangeError ? 400 : 500,
            {error: error instanceof OnlineError ? error.code : error instanceof RangeError ? 'invalid-profession-request' : 'profession-preferences-unavailable'});
        }
      }
      if (pathname === '/api/admin/professions') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (user.role !== 'gm') return json(res, 403, {error: 'gm-required'});
        if (req.method === 'GET') return json(res, 200, online.professionStatus(user.username));
        if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
        let body;
        try { body = await readBody(req); }
        catch { return json(res, 400, {error: 'invalid-professions-request'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
          || !Object.hasOwn(body, 'professions')) return json(res, 400, {error: 'invalid-professions-request'});
        return json(res, 200, await online.setProfessions(user.username, body.professions));
      }
      if(pathname==='/api/skill-preferences'){
        if(!user)return json(res,401,{error:'login-required'});
        if(!['GET','PUT'].includes(req.method))return json(res,405,{error:'method-not-allowed'});
        let config;
        if(req.method==='PUT'){
          try {config=await readBody(req);}
          catch{return json(res,400,{error:'invalid-skill-preferences'});}
          if(config?.schemaVersion!==1)return json(res,400,{error:'invalid-skill-preferences'});
        }
        try {
          const requested = req.method === 'GET' ? url.searchParams.get('professionId') ?? undefined : config.professionId;
          const professionId = requested === undefined ? online.professionStatus(user.username).professionId : normalizeProfessionId(requested);
          const preferences=req.method==='GET'?await skillPreferences[professionId].load(user.username):
            await online.transaction(async () => {
              if (online.isLocked(user.username)) throw new OnlineError('preferences-locked', 409);
              if (!online.professionStatus(user.username).professions[professionId]) throw new OnlineError('profession-disabled', 409);
              return skillPreferences[professionId].save(user.username,config);
            });
          return json(res,200,{preferences,professionId});
        } catch(error){
          if(error instanceof OnlineError)return json(res,error.status,{error:error.code});
          if(error instanceof RangeError && !(error instanceof SkillPreferencesValidationError))return json(res,400,{error:'invalid-profession-request'});
          return json(res,error instanceof SkillPreferencesValidationError?400:500,
            {error:error instanceof SkillPreferencesValidationError?'invalid-skill-preferences':'skill-preferences-unavailable'});
        }
      }
      if (pathname === '/api/key-preferences') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (!['GET', 'PUT'].includes(req.method)) return json(res, 405, {error: 'method-not-allowed'});
        try {
          const config = req.method === 'PUT' ? await readBody(req) : null;
          const preferences = req.method === 'GET' ? await keyPreferences.load(user.username) : await online.transaction(async () => {
            if (online.isLocked(user.username)) throw new OnlineError('preferences-locked', 409);
            return keyPreferences.save(user.username, config);
          });
          return json(res, 200, {preferences});
        } catch (error) {
          return json(res, error instanceof OnlineError ? error.status : req.method === 'PUT' && (error instanceof TypeError || error instanceof SyntaxError) ? 400 : 500,
            {error: error instanceof OnlineError ? error.code : req.method === 'PUT' && (error instanceof TypeError || error instanceof SyntaxError) ? 'invalid-key-preferences' : 'key-preferences-unavailable'});
        }
      }
      if (pathname === '/api/nickname-preferences') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (!['GET', 'PUT'].includes(req.method)) return json(res, 405, {error: 'method-not-allowed'});
        try {
          const config = req.method === 'PUT' ? await readBody(req) : null;
          if (req.method === 'PUT' && (!config || typeof config !== 'object' || Array.isArray(config)
            || Object.keys(config).length !== 1 || !Object.hasOwn(config, 'nickname'))) throw new TypeError('invalid-nickname-request');
          const preferences = req.method === 'GET' ? await accountStore.profile(user.username) : await online.transaction(async () => {
            if (online.isLocked(user.username)) throw new OnlineError('preferences-locked', 409);
            return accountStore.saveNickname(user.username, config.nickname);
          });
          return json(res, 200, preferences);
        } catch (error) {
          const invalid = req.method === 'PUT' && (error instanceof TypeError || error instanceof SyntaxError);
          return json(res, error instanceof OnlineError ? error.status : invalid ? 400 : 500,
            {error: error instanceof OnlineError ? error.code : invalid ? 'invalid-nickname' : 'nickname-preferences-unavailable',
              ...(invalid ? {message: error.message} : {})});
        }
      }
      if(pathname==='/api/asset-versions'&&req.method==='GET'){
        if(!user)return json(res,401,{error:'login-required'});
        return pollJson(req,res,await assetVersions());
      }
      if (pathname === '/api/history') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (req.method !== 'GET') return json(res, 405, {error: 'method-not-allowed'});
        return json(res, 200, {history: await accountStore.summary(user.username)});
      }
      if (pathname === '/api/admin/accounts') {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (user.role !== 'gm') return json(res, 403, {error: 'gm-required'});
        if (req.method === 'GET') return json(res, 200, {accounts: [...accounts.keys()].map(username => ({username, role: accountStore.role(username), online: usernameSessions.has(username)}))});
        if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
        let body;
        try { body = await readBody(req); }
        catch { return json(res, 400, {error: 'invalid-account'}); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
          || !Object.hasOwn(body, 'username') || !Object.hasOwn(body, 'password')) return json(res, 400, {error: 'invalid-account'});
        try {
          const username = await accounts.createPlayer(body.username, body.password, accountStore.registerPlayer);
          return json(res, 201, {ok: true, username, role: 'player'});
        } catch (error) {
          if (!(error instanceof AccountCreationError)) throw error;
          return json(res, error.status, {error: error.code});
        }
      }
      if (pathname.startsWith('/api/online/')) {
        if (!user) return json(res, 401, {error: 'login-required'});
        if (pathname === '/api/online/status' && req.method === 'GET') return json(res, 200, online.status(user.username));
        if (pathname === '/api/online/maps') {
          if (req.method === 'GET') return json(res, 200, online.maps());
          if (user.role !== 'gm') return json(res, 403, {error: 'gm-required'});
          if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
          const data = await readBody(req);
          if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.mapId !== 'string'
            || typeof data.enabled !== 'boolean' || Object.keys(data).length !== 2) return json(res, 400, {error: 'invalid-map-request'});
          return json(res, 200, await online.setMap(user.username, data.mapId, data.enabled));
        }
        if (pathname === '/api/online/modes') {
          if (req.method === 'GET') return json(res, 200, {modes: online.status(user.username).modes});
          if (user.role !== 'gm') return json(res, 403, {error: 'gm-required'});
          if (req.method !== 'POST') return json(res, 405, {error: 'method-not-allowed'});
          const data = await readBody(req);
          if (!data || typeof data !== 'object' || Array.isArray(data) || !isOnlineMode(data.mode)
            || typeof data.enabled !== 'boolean' || Object.keys(data).length !== 2) return json(res, 400, {error: 'invalid-mode-request'});
          return json(res, 200, await online.setMode(user.username, data.mode, data.enabled));
        }
        if (pathname === '/api/online/capacity') {
          if(req.method==='GET')return json(res,200,online.roomCapacityStatus());
          if(user.role!=='gm')return json(res,403,{error:'gm-required'});
          if(req.method!=='POST')return json(res,405,{error:'method-not-allowed'});
          let configuration;
          try{configuration=normalizeRoomCapacity(await readBody(req));}
          catch{return json(res,400,{error:'invalid-room-capacity'});}
          return json(res,200,await online.setRoomCapacity(user.username,configuration));
        }
        if (pathname === '/api/online/events' && req.method === 'GET') {
          if(user.pageInitToken!==undefined&&url.searchParams.get('pageInitToken')!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
          const capability=readDownstreamCapability(url.searchParams.get('ownedDelta'))??rememberedCapability(user);
          const previous=streams.get(user.username);
          if(previous&&previous.pageGeneration!==user.pageGeneration&&!online.hasMatch(user.username)){
            retireDownstream(user.username);streams.delete(user.username);previous.end();
          }else if(previous)return json(res, 409, {error: 'stream-already-open'});
          disconnectTimers.clearTimeout(streamClosures.get(user.username)); streamClosures.delete(user.username);
          const pageGeneration = user.pageGeneration;
          const sse=createSseStream(req,res,{onDiagnostic:process.env.RF_ACCESS_LOG==='1'?({event,...detail})=>onlineDiagnostic('sse-'+event,{username:user.username,pageGeneration,...detail}):null});
          streams.set(user.username, {...sse, transport: 'sse', sessionId: cookie, pageGeneration,ownedCapability:capability});
          onlineDiagnostic('sse-open',{username:user.username,pageGeneration,compressed:sse.compressed});
          if(process.env.RF_ACCESS_LOG==='1'){
            req.once('aborted',()=>onlineDiagnostic('sse-request-aborted',{username:user.username,pageGeneration}));
            req.once('error',error=>onlineDiagnostic('sse-request-error',{username:user.username,pageGeneration,code:error.code}));
            res.once('error',error=>onlineDiagnostic('sse-response-error',{username:user.username,pageGeneration,code:error.code}));
          }
          transportStats.sseOpened++;const openedStream=streams.get(user.username);
          // A stalled stream is retired rather than serving seconds-old input
          // histories. Reopen promptly within the existing disconnect grace.
          streams.get(user.username).write('retry: 250\n\n');
          installDownstream(user,cookie,capability);
          online.completePageLoad(user.username);
          res.once('close', () => {
            transportStats.sseClosed++;recordClosed('sse',openedStream.performance());
            if (sessions.get(cookie) !== user || streams.get(user.username)?.response !== res) return;
            retireDownstream(user.username);streams.delete(user.username);
            scheduleDisconnect(cookie, user, pageGeneration);
          });
          await seedEvents(user.username);
          return;
        }
        if (pathname === '/api/online/poll/open' && req.method === 'POST') {
          const requestPageGeneration=user.pageGeneration,requestPageToken=req.headers['x-rf-page-init'];
          if(user.pageInitToken!==undefined&&requestPageToken!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
          const requestedCapability=readDownstreamCapability(req.headers['x-rf-owned-delta']);
          const data = await readBody(req);
          if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length) return json(res, 400, {error: 'invalid-poll-open'});
          if (sessions.get(cookie) !== user) return json(res, 401, {error: 'login-required'});
          if(user.pageGeneration!==requestPageGeneration||user.pageInitToken!==undefined&&requestPageToken!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
          const previous = streams.get(user.username);
          const lobbyReplacement = previous && previous.pageGeneration !== user.pageGeneration && !online.hasMatch(user.username);
          if (previous && !lobbyReplacement && (previous.transport !== 'poll' || previous.activeRequest)) {
            return json(res, 409, {error: 'stream-already-open'});
          }
          let lease;
          const reuseChannel=previous&&!lobbyReplacement;
          if(reuseChannel&&requestedCapability&&!sameCapability(requestedCapability,previous.ownedCapability))return json(res,409,{error:'poll-codec-conflict'});
          const capability=reuseChannel?previous.ownedCapability:requestedCapability??rememberedCapability(user);
          const channel = reuseChannel ? previous.channel : createOnlinePollChannel({
            waitMs: pollWaitMs, timers: pollTimers, onOverflow: () => closePollLease(streams.get(user.username))});
          clearRelayPending(user.username);
          if (lobbyReplacement) { streams.delete(user.username); previous.end(); }
          lease = {transport: 'poll', connectionId: randomBytes(24).toString('base64url'), sessionId: cookie,
            session: user, pageGeneration: requestPageGeneration, ownedCapability:capability,channel, activeRequest: null,
            end() {channel.close(); this.activeRequest?.response.destroy();}};
          streams.set(user.username, lease);
          if(!reuseChannel)installDownstream(user,cookie,capability);
          scheduleDisconnect(cookie, user, lease.pageGeneration);
          await seedEvents(user.username);
          return json(res, 200, {connectionId: lease.connectionId, cursor: channel.cursor});
        }
        if (pathname === '/api/online/poll' && req.method === 'GET') {
          const connectionId = url.searchParams.get('connectionId'), value = url.searchParams.get('after');
          if (url.searchParams.size !== 2 || !connectionId || !/^(0|[1-9]\d*)$/.test(value ?? '')) {
            return json(res, 400, {error: 'invalid-poll-cursor'});
          }
          const lease = streams.get(user.username);
          if (lease?.transport !== 'poll' || lease.connectionId !== connectionId || lease.session !== user || lease.sessionId !== cookie) {
            return json(res, 409, {error: 'poll-connection-not-active'});
          }
          if(lease.pageGeneration!==user.pageGeneration&&online.isPageLoading(user.username))return json(res,409,{error:'poll-connection-not-active'});
          if (lease.activeRequest) return json(res, 409, {error: 'poll-already-pending'});
          const handle = lease.channel.poll(Number(value)), active = {response: res, handle};
          lease.activeRequest = active; clearDisconnect(user.username);
          if(lease.pageGeneration===user.pageGeneration)online.completePageLoad(user.username);
          res.once('close', () => {
            if (lease.activeRequest !== active) return;
            lease.activeRequest = null; handle.cancel();
            if (streams.get(user.username) === lease) scheduleDisconnect(cookie, user, lease.pageGeneration);
          });
          const result = await handle.promise;
          if(res.writableEnded)return;
          if (!res.destroyed && streams.get(user.username) === lease && sessions.get(cookie) === user) {
            if (result.error) json(res, 409, {error: result.error}); else pollJson(req, res, result);
          } else if (!res.destroyed) res.destroy();
          return;
        }
        if (pathname === '/api/online/poll/close' && req.method === 'POST') {
          const data = await readBody(req);
          if (!data || typeof data.connectionId !== 'string' || Object.keys(data).length !== 1) return json(res, 400, {error: 'invalid-poll-close'});
          if (sessions.get(cookie) !== user) return json(res, 401, {error: 'login-required'});
          const lease = streams.get(user.username);
          if (lease?.transport === 'poll' && lease.connectionId === data.connectionId && lease.session === user) closePollLease(lease);
          return json(res, 200, {ok: true});
        }
        if(pathname==='/api/online/handoff'&&req.method==='POST'){
          const data=await readBody(req);
          if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==1||
            typeof data.pageInitToken!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(data.pageInitToken))
            return json(res,400,{error:'invalid-page-handoff'});
          if(sessions.get(cookie)!==user)return json(res,401,{error:'login-required'});
          if(data.pageInitToken!==user.pageInitToken){
            const completed=user.pageHandoff;
            // A lost ACK can be retried, but it cannot revoke the replacement
            // or reveal a genuinely later page's token. Retain one bounded
            // receipt only while its issued identity is still current.
            if(completed?.fromToken===data.pageInitToken&&completed.pageInitToken===user.pageInitToken&&
              completed.pageGeneration===user.pageGeneration)
              return json(res,200,{ok:true,pageInitToken:completed.pageInitToken});
            return json(res,409,{error:'page-generation-retired'});
          }
          const prior=streams.get(user.username),socketRelay=socketRelays.get(user.username);
          if(prior&&(prior.sessionId!==cookie||prior.pageGeneration!==user.pageGeneration)||
            socketRelay&&(socketRelay.sessionId!==cookie||socketRelay.pageGeneration!==user.pageGeneration))
            return json(res,409,{error:'page-generation-retired'});
          if((user.pageInitTokens?.size??0)>=256)return json(res,409,{error:'page-initialization-limit'});
          const fromToken=user.pageInitToken;let replacementToken;
          do{replacementToken=randomBytes(24).toString('base64url');}while(replacementToken===fromToken||user.pageInitTokens?.has(replacementToken));
          user.pageInitTokens??=new Set();user.pageInitTokens.add(replacementToken);
          // Rotate both externally checked identity and await fences before
          // ending anything. Old SSE reconnects and poll/open requests already
          // awaiting bodies must not install a lease after this commit.
          user.pageInitToken=replacementToken;user.pageGeneration++;clearDisconnect(user.username);
          user.pageHandoff={fromToken,pageInitToken:replacementToken,pageGeneration:user.pageGeneration};
          streams.delete(user.username);retireDownstream(user.username);prior?.end();
          if(socketRelay){socketRelays.delete(user.username);socketRelay.channel.close();}
          scheduleDisconnect(cookie,user,user.pageGeneration);
          return json(res,200,{ok:true,pageInitToken:replacementToken});
        }
        if (pathname === '/api/online/queue' && req.method === 'DELETE') {
          return json(res, 200, await online.transaction(() => {requireCurrentSession();return online.leaveQueue(user.username);}));
        }
        if (pathname === '/api/online/queue' && req.method === 'POST') {
          const data = await readBody(req);
          if (!data || typeof data !== 'object' || Array.isArray(data) || !isOnlineMode(data.mode)
            || Object.keys(data).some(key=>!['mode','continuousAuraVersion','ownerStatusVersion','combatPlaybackVersion'].includes(key))
            || data.continuousAuraVersion!==undefined && ![0,1,2].includes(data.continuousAuraVersion)
            || data.ownerStatusVersion!==undefined && ![0,1].includes(data.ownerStatusVersion)
            || data.combatPlaybackVersion!==undefined && ![0,1].includes(data.combatPlaybackVersion)
            || data.combatPlaybackVersion===1 && (data.ownerStatusVersion!==1||data.continuousAuraVersion!==2)) return json(res, 400, {error: 'invalid-queue-request'});
          const status = await online.transaction(async () => {
            requireCurrentSession();
            const professionId = online.professionStatus(user.username).professionId;
            const preferences = await skillPreferences[professionId].load(user.username);
            const keyBindings = await keyPreferences.load(user.username);
            const {nickname} = await accountStore.profile(user.username);
            requireCurrentSession();
            const profile = getProfessionProfile(professionId), preset = getProfessionPreset(professionId);
            const professionVersions = {profile:hash(profile),preset:hash(preset),reference:hash(profile.target),
              profileId:profile.profileId,presetVersion:preset.presetVersion};
            // A brand-new account uses the shipped eight-slot preset; an explicitly empty saved tree remains empty.
            return online.join(user.username, user.role, {...(preferences ?? defaultSkillPreferences[professionId]),professionId,
              unitClass:PROFESSIONS[professionId].unitClass,professionVersions,costumeId:online.professionStatus(user.username).costumeId,keyBindings,nickname,name:nickname},data.mode,
              {continuousAuraVersion:data.continuousAuraVersion??0,ownerStatusVersion:data.ownerStatusVersion??0,combatPlaybackVersion:data.combatPlaybackVersion??0});
          });
          const stream = streams.get(user.username);
          // A lobby GET may have retired an idle poll's gap while assets load.
          // Locking that same lease restores combat liveness immediately.
          if (stream?.transport === 'poll' && !stream.activeRequest) scheduleDisconnect(cookie, user, stream.pageGeneration);
          return json(res, 200, status);
        }
        if (['/api/online/ready','/api/online/loading-progress'].includes(pathname) && req.method === 'POST') {
          const generation=user.pageGeneration,token=user.pageInitToken;
          if(token!==undefined&&req.headers['x-rf-page-init']!==token)return json(res,409,{error:'page-generation-retired'});
          const body=await readBody(req,1024);
          if(sessions.get(cookie)!==user||generation!==user.pageGeneration||token!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
          if(pathname==='/api/online/loading-progress')return json(res,200,online.loadingProgress(user.username,body));
          const value=await online.ready(user.username,body.matchId);
          if(sessions.get(cookie)!==user||generation!==user.pageGeneration||token!==user.pageInitToken)return json(res,409,{error:'page-generation-retired'});
          if(value.ok||value.ended){delete user.suspendedPageGeneration;delete user.suspendedPageToken;}
          return json(res,200,value);
        }
        if (pathname === '/api/online/input' && req.method === 'POST') {
          const body=await readBody(req,131072);requireCurrentSession();const receipts=preparePeerReceipts(user,body);
          const value=await online.submitInput(user.username,body);acceptPeerReceipts(user,body,receipts);
          return json(res,200,value);
        }
        if (pathname === '/api/online/signal' && req.method === 'POST') {
          const pageGeneration=user.pageGeneration,pageToken=user.pageInitToken??null,requestToken=req.headers['x-rf-page-init'];
          const body=await readBody(req,16384);
          if(sessions.get(cookie)!==user)return json(res,401,{error:'login-required'});
          if(user.pageGeneration!==pageGeneration||(user.pageInitToken??null)!==pageToken
            ||body?.signalVersion!==undefined&&pageToken!==null&&requestToken!==pageToken)
            return json(res,409,{error:'page-generation-retired'});
          return json(res,200,online.signal(user.username,body,{session:user,pageGeneration,pageToken}));
        }
        // Result/score routes intentionally do not exist; only the server battle driver may settle a match.
        return json(res, 404, {error: 'not-found'});
      }
      if (pathname === '/api/traces' && req.method === 'POST') {
        if(!user)return json(res,401,{error:'login-required'});
        if(user.role!=='gm')return json(res,403,{error:'gm-required'});
        if(publicOrigin)return json(res,403,{error:'public-trace-upload-disabled'});
        const trace=await readBody(req,64*1024*1024);
        if(trace.schemaVersion!==1 || trace.purpose!=='current-simulation-trace-not-native-ground-truth'
          || !Array.isArray(trace.inputs) || trace.inputs.length>216000
          || !Array.isArray(trace.initial?.actors) || !Array.isArray(trace.final?.actors))return json(res,400,{error:'invalid-simulation-trace'});
        const folder=path.join(runtime,'traces');await mkdir(folder,{recursive:true});
        const filename=`rf-${Date.now()}-${randomBytes(4).toString('hex')}.json`;
        const file=path.join(folder,filename);
        await writeFile(file,JSON.stringify(trace,null,2)+'\n',{flag:'wx'});
        return json(res,200,{file:'runtime/traces/'+filename,filename,kind:'simulation-implementation'});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method-not-allowed' });
      let filename;
      if (pathname === '/') filename = path.join(root, 'apps/web/index.html');
      else if (pathname === '/login.mjs') filename = path.join(root, 'apps/web/login.mjs');
      else if (pathname === '/login.css') filename = path.join(root, 'apps/web/login.css');
      else {
        if (!user) return json(res, 401, { error: 'login-required' });
        if (pathname.startsWith('/game/')) {
          // The build directory also contains private deployment metadata and source maps.
          if(!/\.(?:js|css)$/.test(pathname))return json(res,404,{error:'not-found'});
          filename = safePath(path.join(root, 'dist'), pathname.slice(6));
        }
        else if (pathname.startsWith('/assets/')) {
          if(!resourceDelivery.status().enabled)return json(res,503,{error:'remote-resources-disabled',message:'Remote asset downloads are disabled. Use the packaged client.'},{'Retry-After':'60'});
          resourceTransfers.add(res);res.once('close',()=>resourceTransfers.delete(res));
          filename = safePath(assetRoot, canonicalAssetRequest(pathname.slice(8)));
        }
        else if (pathname === '/api/coverage') filename = path.join(root, 'contracts/milestones.json');
        else return json(res, 404, { error: 'not-found' });
      }
      if (!filename) return json(res, 400, { error: 'invalid-path' });
      for(let retry=0;retry<3;retry++){
        let handle;
        try { handle = await open(filename,'r'); } catch (error) { if (error.code === 'ENOENT') return json(res, 404, { error: 'file-not-built', path: pathname }); throw error; }
        try {
          const file=await handle.stat();
          if (!file.isFile()) return json(res, 404, { error: 'not-found' });
          const extension = path.extname(filename);
          const compress = file.size > 1024
            && ['.html', '.js', '.mjs', '.css', '.json', '.map', '.glb', '.wasm'].includes(extension)
            && /(?:^|[,\s])gzip(?:\s*[,;]|$)/i.test(req.headers['accept-encoding'] || '')
            && !/gzip\s*;\s*q=0(?:\.0*)?(?:\s*,|$)/i.test(req.headers['accept-encoding'] || '');
          const entry=staticCache.record(filename,file),etag=await staticCache.etag(entry,compress);
          const requestedVersion=new URL(req.url,'http://localhost').searchParams.get('v');
          const contentVersioned=pathname.startsWith('/assets/')&&requestedVersion!==null;
          if(contentVersioned&&requestedVersion!==await entry.digest)return json(res,409,{error:'asset-version-mismatch'});
          const cacheHeaders={ETag:etag,'Cache-Control':contentVersioned?'private, max-age=31536000, immutable':'private, no-cache, max-age=0, must-revalidate',
            Vary:'Accept-Encoding'};
          if(matchesResourceTag(req.headers['if-none-match'],etag)){res.writeHead(304,cacheHeaders);return res.end();}
          const compressed=req.method!=='HEAD'&&compress?await staticCache.compressed(entry):null;
          const decodedDigest=await entry.digest;
          await staticCache.verify(entry);
          res.writeHead(200, { 'Content-Type': TYPES[extension] || 'application/octet-stream',
            ...(compress ? { 'Content-Encoding': 'gzip' } : { 'Content-Length': file.size }),
            ...cacheHeaders });
          if (req.method === 'HEAD') res.end();
          else {
            if (compressed) res.end(compressed);
            else await new Promise(resolve=>{
              const finish = error => { if (error && !res.destroyed) res.destroy(error);resolve(); };
              const stream=handle.createReadStream({start:0,autoClose:false});
              const verified=createVerifiedResourceStream(decodedDigest,file.size,{verifyDigest:resourceValidation==='digest'});
              if(compress)pipeline(stream,verified,createGzip(),res,finish);else pipeline(stream,verified,res,finish);
            });
          }
          return;
        } catch(error){if(!(error instanceof StaticResourceChangedError)||res.headersSent||retry===2)throw error;}
        finally {await handle.close();}
      }
    } catch (error) { if (!res.headersSent) json(res, error instanceof OnlineError || error instanceof PollChannelError ? error.status : 400,
      { error: error instanceof OnlineError || error instanceof PollChannelError ? error.code : error.message === 'body-too-large' ? error.message : 'invalid-request' }); else res.destroy(); }
  });
  server.on('upgrade',(req,socket,head)=>{
    const reject=status=>{socket.end(`HTTP/1.1 ${status} ${status===401?'Unauthorized':status===403?'Forbidden':'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
    try{
      const url=new URL(req.url,'http://localhost'),cookie=req.headers.cookie?.match(/(?:^|;\s*)rf_session=([A-Za-z0-9_-]+)/)?.[1];
      expireSessions();const user=sessions.get(cookie),accept=websocketHandshake(req);
      if(url.pathname!=='/api/online/socket'||!accept){reject(400);return;}
      if(!validSession(user)){reject(401);return;}
      if(req.headers.origin!==(publicOrigin??`http://${req.headers.host}`)){reject(403);return;}
      if(user.pageInitToken!==undefined&&url.searchParams.get('pageInitToken')!==user.pageInitToken){reject(409);return;}
      const lease=streams.get(user.username);
      if(!lease||lease.sessionId!==cookie||lease.pageGeneration!==user.pageGeneration||socketRelays.has(user.username)){reject(409);return;}
      const pageGeneration=user.pageGeneration;user.lastSeen=now();
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: ${ONLINE_SOCKET_PROTOCOL}\r\n\r\n`);
      const relay={sessionId:cookie,pageGeneration,channel:null,lastInputAt:null,
        ownerUploadDelta:url.searchParams.get('ownerUploadDelta')===String(OWNER_UPLOAD_DELTA_VERSION),
        ownerUploadMatchId:null,ownerUploadCodec:createOwnerUploadDelta()};
      // A legacy page can still negotiate decoding on its first WS upgrade.
      // An upload reconnection must never reset or downgrade a live SSE/poll
      // mailbox's already advertised codec and reliable baseline history.
      const needsDownstream=!downstreamRelays.has(user.username);
      if(needsDownstream){
        const capability=lease.ownedCapability??rememberedCapability(user)??{
          splitDeltas:['2','3'].includes(url.searchParams.get('ownedDelta')),deltaVersion:url.searchParams.get('ownedDelta')==='3'?3:2};
        lease.ownedCapability=capability;installDownstream(user,cookie,capability);
      }
      relay.channel=createWebSocketStream(socket,{head,textMessageBytes:url.searchParams.get('textAck')==='1'?1024:0,
        networkBinaryVersion:url.searchParams.get('networkBinaryVersion')===String(NETWORK_BINARY_VERSION)?NETWORK_BINARY_VERSION:0,
        maximumConsumerInFlight:driverFactory?.orderedInputDispatch==='synchronous-owner-ipc-v1'&&driverFactory.ownership==='local-owner-v1'?8:1,
        onMessage:async body=>{
        if(sessions.get(cookie)!==user||!validSession(user)||user.pageGeneration!==pageGeneration||socketRelays.get(user.username)!==relay){relay.channel.close(1008);return;}
        let acknowledgement,uploadCandidate=null,uploadCodec=null,obsoleteBaseline=false;
        try{
          if(Object.hasOwn(body,'ownerUpload')){
            if(!relay.ownerUploadDelta||Object.hasOwn(body,'owner')
              ||Object.keys(body).some(key=>!['matchId','sequence','frames','peerReceipts','ownerUpload'].includes(key)))
              throw new OnlineError('invalid-owner-upload');
            // The raw codec belongs to this physical authenticated upload and
            // current room. A bad room ID cannot retire its usable baseline.
            if(relay.ownerUploadMatchId!==body.matchId){
              if(online.status(user.username).match?.id!==body.matchId)throw new OnlineError('match-not-active',409);
              relay.ownerUploadMatchId=body.matchId;relay.ownerUploadCodec=createOwnerUploadDelta();
            }
            uploadCodec=relay.ownerUploadCodec;uploadCandidate=uploadCodec.decode(body.ownerUpload);
            const {ownerUpload,...envelope}=body;body={...envelope,owner:uploadCandidate.report};
            // The transport's decompressed limit applies to the compact wire.
            // Restore the complete original limits before validation or IPC.
            if(Buffer.byteLength(JSON.stringify(body))>128*1024)throw new OnlineError('input-batch-too-large');
          }
          // validateInputBatch validates shape/size. Only this authenticated
          // receiver's already issued room/life identities can suppress its
          // duplicate dynamic relay; reliable actions and births still flow.
          const receipts=preparePeerReceipts(user,body);
          const value=await online.submitInput(user.username,body,{ownerReceipt:relay.ownerUploadDelta});
          if(sessions.get(cookie)!==user||user.pageGeneration!==pageGeneration||socketRelays.get(user.username)!==relay)return;
          if(uploadCandidate&&(uploadCodec!==relay.ownerUploadCodec||relay.ownerUploadMatchId!==body.matchId))return;
          if(uploadCandidate&&value.accepted===true&&value.ignored===undefined
            &&value.ownerReceipt?.epoch===uploadCandidate.ownerReceipt.epoch
            &&value.ownerReceipt?.frameSeq===uploadCandidate.ownerReceipt.frameSeq)obsoleteBaseline=uploadCandidate.commit()===false;
          user.lastSeen=now();relay.lastInputAt=now();
          acceptPeerReceipts(user,body,receipts);
          acknowledgement={...value,matchId:body.matchId};
          if(obsoleteBaseline)delete acknowledgement.ownerReceipt;
        }
        catch(error){acknowledgement={accepted:false,sequence:body.sequence,matchId:body.matchId,error:error instanceof OnlineError?error.code:'invalid-request'};}
        relay.channel.sendJson({type:'ack',data:acknowledgement});
      },onClose:metrics=>{
        transportStats.socketClosed++;recordClosed('socket',metrics);
        relay.ownerUploadCodec.reset();
        if(socketRelays.get(user.username)!==relay)return;socketRelays.delete(user.username);
        if(sessions.get(cookie)!==user||user.pageGeneration!==pageGeneration)return;
        downstreamRelays.get(user.username)?.peerReceipts.clear();
        // Upload failure does not retire an independently authenticated
        // downstream mailbox. Keep its compact room/owner/action baselines.
        const current=streams.get(user.username);
        if(current?.sessionId!==cookie||current.pageGeneration!==pageGeneration)scheduleDisconnect(cookie,user,pageGeneration);
      }});
      transportStats.socketOpened++;
      socketRelays.set(user.username,relay);
      relay.channel.sendJson({type:'transport',data:{connected:true,kind:'websocket',
        ...(url.searchParams.get('networkBinaryVersion')===String(NETWORK_BINARY_VERSION)?{networkBinaryVersion:NETWORK_BINARY_VERSION}:{}),
        ...(relay.ownerUploadDelta?{ownerUploadDelta:OWNER_UPLOAD_DELTA_VERSION}:{})}});
      if(needsDownstream)seedEvents(user.username).catch(()=>relay.channel.close());
    }catch{socket.destroy();}
  });
  const scheduler = setInterval(() => { expireSessions(); online.tick().catch(() => {}); }, 250); scheduler.unref();
  server.on('connection',socket=>updateBandwidth.attachSocket(socket));
  const keepAlive = setInterval(() => { for (const stream of streams.values()) if (stream.transport !== 'poll') stream.write(': keepalive\n\n',{replaceKey:'keepalive'}); }, 5000); keepAlive.unref();
  server.once('close', () => {
    clearInterval(scheduler); clearInterval(keepAlive); clientUpdates.close(); online.close();
    for (const timer of streamClosures.values()) disconnectTimers.clearTimeout(timer);
    streamClosures.clear(); sessions.clear(); usernameSessions.clear(); attempts.clear();replacedSessions.clear();retiredPageTokens.clear();successfulLogins.clear();
    for(const relay of downstreamRelays.values())relay.pacer.clearAll();downstreamRelays.clear();
    for (const stream of streams.values()) stream.end(); streams.clear();
    for(const relay of socketRelays.values())relay.channel.close();socketRelays.clear();
  });
  return { server, account, playerAccount, sessions, get accountCount() { return accounts.size; },staticCache, online, accountStore,
    // Internal read-only evidence for controlled capacity runs; no usernames,
    // account records, cookies, room identities or source IDs are exposed.
    transportDiagnostics:()=>structuredClone({...transportStats,updateBandwidth:updateBandwidth.performance(),roomWorkers:online.workerDiagnostics(),
      streams:[...streams.values()].filter(stream=>stream.transport==='sse').map(stream=>stream.performance()),
      sockets:[...socketRelays.values()].map(relay=>relay.channel.performance()),
      ownedRelayPacers:[...downstreamRelays.values()].filter(relay=>relay.splitDeltas).map(relay=>relay.pacer.performance())}),
    expireSessions, closeStreams: () => { for(const [username,relay] of downstreamRelays)retireDownstream(username,relay);for (const stream of streams.values()) stream.end(); streams.clear();for(const relay of socketRelays.values())relay.channel.close();socketRelays.clear(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { server, account, playerAccount } = await createDevServer({
    assetRoot: process.env.RF_ASSET_ROOT || path.join(ROOT, 'artifacts'),
    accountRoot: process.env.RF_ACCOUNT_ROOT || path.join(ROOT, 'runtime'),
    clientUpdateRoot:process.env.RF_CLIENT_UPDATE_ROOT||path.join(path.dirname(process.env.RF_ACCOUNT_ROOT||path.join(ROOT,'runtime/accounts')),'client-updates'),
    updateBandwidthOptions:process.env.RF_EGRESS_BYTES_PER_SECOND?{bytesPerSecond:Number(process.env.RF_EGRESS_BYTES_PER_SECOND)}:{},
    publicOrigin: process.env.RF_PUBLIC_ORIGIN || null,
    rtcIceServers: process.env.RF_RTC_ICE_SERVERS ? JSON.parse(process.env.RF_RTC_ICE_SERVERS) : [],
    peerMode: process.env.RF_NETWORK_PEER_MODE || 'hybrid',
    onlineEventTransport: process.env.RF_ONLINE_EVENT_TRANSPORT || 'sse',
    trustLoopbackProxy: process.env.RF_TRUST_LOOPBACK_PROXY === '1',
    roomWorkers:process.env.RF_ROOM_WORKERS!=='0',
    resourceDeliveryEnabled:process.env.RF_RESOURCE_DELIVERY==='1',
  });
  const port = Number(process.env.RF_PORT || 4196);
  const host = process.env.RF_HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`web pvp listening on ${host} port ${server.address().port}`);
    console.log(`Local account: ${account.username}. Password is in runtime/dev-account.json.`);
    if (playerAccount) console.log(`Ordinary test account: ${playerAccount.username}. Password is in runtime/dev-player-account.json.`);
  });
}
