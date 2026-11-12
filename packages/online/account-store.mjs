import {createHash, randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {normalizeNickname} from './nickname.mjs';
import {DEFAULT_MODE_FLAGS, ONLINE_MODES, isOnlineMode} from './modes.mjs';
import {isMapId} from './map-pool.mjs';
import {PROFESSION_IDS, normalizeProfessionId, normalizeProfessionFlags} from '../professions/catalog.mjs';
import {normalizeCostumePreferences,normalizeCostumeId,costumeCharacter} from '../professions/costumes.mjs';
import {normalizeRoomCapacity} from './room-capacity.mjs';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

/** Atomic, serialized account data. Password files are owned by the authentication layer. */
export function createOnlineAccountStore({accountRoot, fileSystem = fs}) {
  const rolesFile = path.join(accountRoot, 'account-roles.json');
  const historyFile = path.join(accountRoot, 'match-history.json');
  const profilesFile = path.join(accountRoot, 'account-profiles.json');
  const modesFile = path.join(accountRoot, 'online-modes.json');
  const mapsFile = path.join(accountRoot, 'online-maps.json');
  const professionsFile = path.join(accountRoot, 'online-professions.json');
  const roomCapacityFile = path.join(accountRoot, 'online-room-capacity.json');
  let roles = Object.create(null), history = {schemaVersion: 1, accounts: {}, matches: {}}, profiles = {schemaVersion: 1, accounts: {}};
  let modeFlags = {...DEFAULT_MODE_FLAGS};
  let mapFlags = {};
  let professionFlags = Object.fromEntries(PROFESSION_IDS.map(id => [id, true]));
  let roomCapacity=null,roomCapacityRevision=0;
  let pending = Promise.resolve();
  async function load(file, fallback) {
    try { return JSON.parse((await fileSystem.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  }
  async function atomic(file, value) {
    await fileSystem.mkdir(accountRoot, {recursive: true});
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fileSystem.open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n');
      await handle.sync(); await handle.close(); handle = null;
      for (let attempt = 0; ; attempt++) {
        try { await fileSystem.rename(temporary, file); break; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          await delay(10 * 2 ** attempt);
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fileSystem.rm(temporary, {force: true}).catch(() => {});
    }
  }
  const transact = callback => {
    const result = pending.then(callback);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const accountKey = username => createHash('sha256').update(username).digest('hex');
  function summary(username) {
    const row = history.accounts[accountKey(username)] ?? {wins: 0, losses: 0, draws: 0, kills: 0, assists: 0, deaths: 0, recent: []};
    return {...structuredClone(row), games: row.wins + row.losses + row.draws,
      // A zero denominator is represented explicitly, rather than JSON Infinity or a fabricated death.
      kda: row.deaths === 0 ? null : (row.kills + row.assists) / row.deaths,
      kdaDisplay: row.deaths === 0 ? row.kills + row.assists > 0 ? '∞' : '—' : ((row.kills + row.assists) / row.deaths).toFixed(2)};
  }
  return {
    async initialize(accounts) {
      const storedRoles = await load(rolesFile, {schemaVersion: 1, accounts: {}});
      if (storedRoles?.schemaVersion !== 1 || !record(storedRoles.accounts)
        || Object.values(storedRoles.accounts).some(role => !['gm', 'player'].includes(role))) throw Error('invalid-account-roles');
      const nextRoles = Object.assign(Object.create(null), storedRoles.accounts);
      // Only current bootstrap configuration can grant GM privileges.
      for (const username of Object.keys(nextRoles)) nextRoles[username] = 'player';
      for (const entry of accounts) {
        if (entry.role !== undefined && !['gm', 'player'].includes(entry.role)) throw Error('invalid-account-role');
        nextRoles[entry.username] = entry.role ?? 'player';
      }
      const storedModes = await load(modesFile, {schemaVersion: 1, modes: {...DEFAULT_MODE_FLAGS}});
      if (storedModes?.schemaVersion !== 1 || !record(storedModes.modes)
        || Object.keys(storedModes.modes).length !== ONLINE_MODES.length
        || ONLINE_MODES.some(mode => typeof storedModes.modes[mode] !== 'boolean')) throw Error('invalid-online-modes');
      const storedMaps = await load(mapsFile, {schemaVersion: 1, maps: {}});
      if (storedMaps?.schemaVersion !== 1 || !record(storedMaps.maps)
        || Object.entries(storedMaps.maps).some(([id, enabled]) => !isMapId(id) || typeof enabled !== 'boolean')) throw Error('invalid-online-maps');
      const storedProfessions = await load(professionsFile, {schemaVersion: 1, professions: professionFlags});
      if (storedProfessions?.schemaVersion !== 1) throw Error('invalid-online-professions');
      let storedFlags;try {storedFlags=normalizeProfessionFlags(storedProfessions.professions);} catch {throw Error('invalid-online-professions');}
      const storedRoomCapacity=await load(roomCapacityFile,undefined);let nextRoomCapacity=null,nextRoomCapacityRevision=0;
      if(storedRoomCapacity!==undefined){
        if(!record(storedRoomCapacity)||storedRoomCapacity.schemaVersion!==1)throw Error('invalid-online-room-capacity');
        const {schemaVersion,revision=0,...settings}=storedRoomCapacity;
        if(!integer(revision))throw Error('invalid-online-room-capacity');
        try{nextRoomCapacity=normalizeRoomCapacity(settings);}catch{throw Error('invalid-online-room-capacity');}
        nextRoomCapacityRevision=revision;
      }
      const storedHistory = await load(historyFile, history);
      if (storedHistory?.schemaVersion !== 1 || !record(storedHistory.accounts) || !record(storedHistory.matches)) throw Error('invalid-match-history');
      for (const row of Object.values(storedHistory.accounts)) {
        if (!record(row) || !['wins', 'losses', 'draws', 'kills', 'assists', 'deaths'].every(key => integer(row[key]))
          || !Array.isArray(row.recent)) throw Error('invalid-match-history');
      }
      const storedProfiles = await load(profilesFile, profiles);
      if (storedProfiles?.schemaVersion !== 1 || !record(storedProfiles.accounts)) throw Error('invalid-account-profiles');
      for (const [key, row] of Object.entries(storedProfiles.accounts)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !record(row) || Object.keys(row).length === 0
          || Object.keys(row).some(field => !['nickname', 'professionId','costumes'].includes(field)))
          throw Error('invalid-account-profiles');
        try {
          if (row.nickname !== undefined && normalizeNickname(row.nickname) !== row.nickname) throw Error('noncanonical-nickname');
          if (row.professionId !== undefined) normalizeProfessionId(row.professionId);
          if (row.costumes !== undefined) normalizeCostumePreferences(row.costumes);
        }
        catch { throw Error('invalid-account-profiles'); }
      }
      await atomic(rolesFile, {schemaVersion: 1, accounts: nextRoles});
      roles = nextRoles; history = storedHistory; profiles = storedProfiles; modeFlags = {...storedModes.modes};
      mapFlags = {...storedMaps.maps};
      professionFlags = storedFlags;
      roomCapacity=nextRoomCapacity;roomCapacityRevision=nextRoomCapacityRevision;
    },
    role: username => roles[username] ?? null,
    // The authentication store owns the single durable player-identity archive.
    // Startup includes its identities; no second file commit is needed here.
    registerPlayer: username => { roles[username] = 'player'; },
    modeFlags: () => ({...modeFlags}),
    mapFlags: () => ({...mapFlags}),
    professionFlags: () => ({...professionFlags}),
    roomCapacity: () => roomCapacity===null?null:structuredClone(roomCapacity),
    roomCapacityRevision:()=>roomCapacityRevision,
    saveRoomCapacity(value) {
      // Capture the caller's complete choice before entering the disk queue.
      const next=normalizeRoomCapacity(value);
      return transact(async()=>{
        const revision=roomCapacityRevision+1;
        if(!integer(revision))throw Error('room-capacity-revision-exhausted');
        await atomic(roomCapacityFile,{schemaVersion:1,revision,...next});
        roomCapacity=next;roomCapacityRevision=revision;return {...structuredClone(next),revision};
      });
    },
    selectedProfession: username => profiles.accounts[accountKey(username)]?.professionId ?? 'RF',
    costumes: username => normalizeCostumePreferences(profiles.accounts[accountKey(username)]?.costumes),
    saveCostume(username, professionId, value) {
      return transact(async () => {
        const character=costumeCharacter(professionId),costumeId=normalizeCostumeId(value);
        if(!Object.hasOwn(roles,username))throw Error('unknown-account');
        const next=structuredClone(profiles),key=accountKey(username),row=next.accounts[key]??{};
        const costumes={...normalizeCostumePreferences(row.costumes),[character]:costumeId};
        next.accounts[key]={...row,costumes};await atomic(profilesFile,next);profiles=next;
        return {...costumes};
      });
    },
    saveProfessions(flags) {
      return transact(async () => {
        let next;try {next=normalizeProfessionFlags(flags);} catch {throw Error('invalid-online-professions');}
        await atomic(professionsFile, {schemaVersion: 1, professions: next});
        professionFlags = next; return {...next};
      });
    },
    saveMap(mapId, enabled) {
      return transact(async () => {
        if (!isMapId(mapId) || typeof enabled !== 'boolean') throw Error('invalid-online-map');
        const next = {...mapFlags, [mapId]: enabled};
        await atomic(mapsFile, {schemaVersion: 1, maps: next});
        mapFlags = next; return {...next};
      });
    },
    saveMode(mode, enabled) {
      return transact(async () => {
        if (!isOnlineMode(mode) || typeof enabled !== 'boolean') throw Error('invalid-online-mode');
        const next = {...modeFlags, [mode]: enabled};
        await atomic(modesFile, {schemaVersion: 1, modes: next});
        modeFlags = next; return {...next};
      });
    },
    summary: async username => { await pending; return summary(username); },
    // This is the last committed result, not an in-flight write. Membership
    // comes from this account's persisted recent list, never a caller match ID.
    lastResult(username) {
      const matchId=history.accounts[accountKey(username)]?.recent?.[0]?.matchId;
      const result=typeof matchId==='string'&&Object.hasOwn(history.matches,matchId)?history.matches[matchId]:null;
      if(!result||!Array.isArray(result.players)||!result.players.some(player=>player.id===username))return null;
      return {matchId,result:structuredClone(result)};
    },
    profile: async username => {
      await pending;
      return {schemaVersion: 1, nickname: profiles.accounts[accountKey(username)]?.nickname ?? username};
    },
    saveNickname(username, value) {
      return transact(async () => {
        const nickname = normalizeNickname(value);
        if (!Object.hasOwn(roles, username)) throw Error('unknown-account');
        const next = structuredClone(profiles);
        next.accounts[accountKey(username)] = {...next.accounts[accountKey(username)], nickname};
        await atomic(profilesFile, next); profiles = next;
        return {schemaVersion: 1, nickname};
      });
    },
    saveProfession(username, value) {
      return transact(async () => {
        const professionId = normalizeProfessionId(value);
        if (!Object.hasOwn(roles, username)) throw Error('unknown-account');
        const next = structuredClone(profiles), key = accountKey(username);
        next.accounts[key] = {...next.accounts[key], professionId};
        await atomic(profilesFile, next); profiles = next;
        return {professionId};
      });
    },
    async recordMatch(match, result) {
      // Capture before joining the serialized disk queue. The room and caller
      // can keep changing while another account write is waiting for fsync.
      match={id:match.id,versions:structuredClone(match.versions),players:structuredClone(match.players)};
      result=structuredClone(result);
      return transact(async () => {
        if (Object.hasOwn(history.matches,match.id)) return {recorded: false, result: structuredClone(history.matches[match.id])};
        if (![0, 1, null].includes(result?.winnerTeam) || !Array.isArray(result.players)
          || result.players.length !== match.players.length || !Array.isArray(result.score) || result.score.length !== 2
          || !result.score.every(integer)) throw Error('invalid-authoritative-result');
        const ids = new Set(match.players.map(player => player.id));
        for (const player of result.players) {
          if (!ids.delete(player.id) || !['kills', 'assists', 'deaths'].every(key => integer(player[key]))) throw Error('invalid-authoritative-result');
        }
        if (ids.size) throw Error('invalid-authoritative-result');
        const stored = {...structuredClone(result), matchId: match.id, finishedAt: Date.now(), versions: match.versions};
        const next = structuredClone(history); next.matches[match.id] = stored;
        for (const player of match.players) {
          const key = accountKey(player.username), stats = result.players.find(row => row.id === player.id);
          const row = next.accounts[key] ?? {wins: 0, losses: 0, draws: 0, kills: 0, assists: 0, deaths: 0, recent: []};
          if (result.winnerTeam === null) row.draws++;
          else if (result.winnerTeam === player.team) row.wins++;
          else row.losses++;
          for (const field of ['kills', 'assists', 'deaths']) row[field] += stats[field];
          row.recent.unshift({matchId: match.id, finishedAt: stored.finishedAt, team: player.team,
            winnerTeam: result.winnerTeam, score: result.score, reason: result.reason ?? null, ...stats});
          row.recent = row.recent.slice(0, 100); next.accounts[key] = row;
        }
        await atomic(historyFile, next); history = next;
        // The committed cache is never returned by reference to a consumer.
        return {recorded: true, result: structuredClone(stored)};
      });
    },
  };
}
