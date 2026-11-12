import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createOnlineService} from '../../packages/online/service.mjs';
import {createOnlineAccountStore} from '../../packages/online/account-store.mjs';
import {DEFAULT_MODE_FLAGS} from '../../packages/online/modes.mjs';

function fixture({saveMode} = {}) {
  let clock = 0, flags = {...DEFAULT_MODE_FLAGS};
  const events = [], drivers = [], users = new Set(['fixture-gm', 'idle']), saves = [];
  const store = {role: username => username === 'fixture-gm' ? 'gm' : 'player', modeFlags: () => ({...flags}),
    recordMatch: async (_, result) => ({recorded: true, result: {...result, finishedAt: clock}}),
    saveMode: saveMode ?? (async (mode, enabled) => {saves.push({mode, enabled}); flags = {...flags, [mode]: enabled}; return {...flags};})};
  const online = createOnlineService({accountStore: store, versions: {}, now: () => clock, random: () => 0.5,
    onlineUsers: () => users, emit: (username, type, data) => events.push({username, type, data}),
    driverFactory: args => {const driver = {...args, stopCount: 0, submitInput() {}, stop() {this.stopCount++;}}; drivers.push(driver); return driver;}});
  return {online, events, drivers, saves, add: async (name, mode) => {users.add(name); return online.join(name, 'player', {marker: name}, mode);},
    setClock: value => {clock = value;}, advance: async ms => {clock += ms; await online.tick();}};
}

test('three independent pools create only their own team sizes, with one frozen queue seat per identity', async t => {
  const f = fixture(); t.after(() => f.online.close());
  await f.add('duel-a', '1v1'); await f.add('duel-b', '1v1');
  for (let i = 0; i < 4; i++) await f.add('pair-' + i, '2v2');
  for (let i = 0; i < 6; i++) await f.add('trio-' + i, '3v3');
  assert.equal(f.online.status('duel-a').queue.size, 2);
  assert.deepEqual(Object.values(f.online.status('idle').queues).map(pool => pool.size), [2, 4, 6]);
  await assert.rejects(f.add('duel-a', '3v3'), error => error.code === 'already-in-queue');
  await f.advance(4999); assert.equal(f.drivers.length, 0);
  await f.advance(1); assert.equal(f.drivers.length, 1); assert.equal(f.drivers[0].match.mode, '1v1');
  assert.deepEqual(f.drivers[0].match.players.map(p => p.team), [0, 1]);
  await f.advance(6000); assert.equal(f.drivers.length, 3);
  for (const [mode, size] of [['2v2', 2], ['3v3', 3]]) {
    const match = f.drivers.find(d => d.match.mode === mode).match;
    assert.equal(match.players.length, size * 2); assert.deepEqual(match.players.map(p => p.team), Array(size).fill(0).concat(Array(size).fill(1)));
    assert.ok(match.players.every(p => p.marker === p.username));
  }
});

test('duel pool always waits five seconds even when many players arrive; remaining pair receives a fresh timer', async t => {
  const f = fixture(); t.after(() => f.online.close());
  await f.add('a', '1v1'); assert.equal(f.online.status('a').queue.deadline, null);
  f.setClock(1000); await f.add('b', '1v1');
  for (let i = 0; i < 18; i++) await f.add('extra-' + i, '1v1');
  assert.equal(f.online.status('a').queue.deadline, 6000);
  f.setClock(5999); await f.online.tick(); assert.equal(f.drivers.length, 0);
  f.setClock(6000); await f.online.tick(); assert.equal(f.drivers.length, 1);
  assert.equal(f.online.status('idle').queues['1v1'].size, 18);
  assert.equal(f.online.status('idle').queues['1v1'].deadline, 11000);
});

test('3v3 shortens with additional eligible players, never extends above six, and pauses below six', async t => {
  const f = fixture(); t.after(() => f.online.close());
  for (let i = 0; i < 6; i++) await f.add('p' + i, '3v3');
  assert.equal(f.online.status('p0').queue.deadline, 11000);
  await f.advance(1000); for (let i = 6; i < 10; i++) await f.add('p' + i, '3v3');
  assert.equal(f.online.status('p0').queue.deadline, 8000);
  for (let i = 6; i < 10; i++) f.online.leaveQueue('p' + i);
  assert.equal(f.online.status('p0').queue.deadline, 8000);
  await f.advance(1000); f.online.leaveQueue('p5'); assert.equal(f.online.status('p0').queue.paused, true);
  await f.advance(30000); assert.equal(f.drivers.length, 0);
  await f.add('replacement', '3v3'); assert.equal(f.online.status('p0').queue.deadline, 38000);
  await f.advance(6000); assert.equal(f.drivers.length, 1);
});

test('GM closing a mode unlocks its waiting players, informs idle users, blocks rejoin, and preserves active battles', async t => {
  const f = fixture(); t.after(() => f.online.close());
  await f.add('a', '1v1'); await f.add('b', '1v1'); await f.advance(5000);
  await f.add('waiting', '1v1'); await f.add('unaffected', '2v2'); f.events.length = 0;
  const disabled = await f.online.setMode('fixture-gm', '1v1', false);
  assert.equal(disabled.modes['1v1'], false); assert.equal(f.online.isLocked('waiting'), false);
  assert.equal(f.online.status('waiting').queueNotice.message, 'This mode is disabled.');
  assert.equal(f.online.status('waiting').queueNotice.mode, '1v1');
  assert.equal(f.online.isLocked('a'), true); assert.equal(f.drivers[0].stopCount, 0);
  assert.equal(f.online.status('unaffected').queued, true);
  assert.ok(f.events.some(e => e.username === 'idle' && e.type === 'status' && e.data.modes['1v1'] === false));
  assert.ok(f.events.some(e => e.username === 'waiting' && e.data.queued === false));
  await assert.rejects(f.add('waiting', '1v1'), error => error.status === 409 && error.code === 'mode-disabled');
  await assert.rejects(f.online.setMode('waiting', '1v1', true), error => error.status === 403);
  await f.online.setMode('fixture-gm', '1v1', true); await f.add('waiting', '1v1');
  assert.equal(f.online.status('waiting').queueNotice, null);
});

test('failed mode persistence leaves live flags and queue locks untouched', async t => {
  const f = fixture({saveMode: async () => {throw Error('disk-write-failed');}}); t.after(() => f.online.close());
  await f.add('a', '3v3'); f.events.length = 0;
  await assert.rejects(f.online.setMode('fixture-gm', '3v3', false), error => error.code === 'mode-settings-unavailable' && error.status === 503);
  assert.equal(f.online.status('a').modes['3v3'], true); assert.equal(f.online.isLocked('a'), true); assert.deepEqual(f.events, []);
});

test('a join racing a persisted disable cannot enter the closed pool', async t => {
  let resolve, entered;
  const ready = new Promise(r => {entered = r;});
  const f = fixture({saveMode: async () => {entered(); return new Promise(r => {resolve = r;});}}); t.after(() => f.online.close());
  const closing = f.online.setMode('fixture-gm', '2v2', false); await ready;
  const joining = f.online.transaction(() => f.add('late', '2v2'));
  resolve({...DEFAULT_MODE_FLAGS, '2v2': false}); await closing;
  await assert.rejects(joining, error => error.code === 'mode-disabled'); assert.equal(f.online.isLocked('late'), false);
});

test('persistent role migration preserves credentials, profiles and history; trusted bootstrap roles override cached privileges', async t => {
  const accountRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-mode-store-'));
  t.after(async () => {assert.ok(path.resolve(accountRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(accountRoot, {recursive: true, force: true});});
  const credentials = '{"username":"fixture-gm","password":"unchanged-local-fixture"}\n';
  await fs.writeFile(path.join(accountRoot, 'dev-account.json'), credentials);
  await fs.writeFile(path.join(accountRoot, 'account-roles.json'), JSON.stringify({schemaVersion: 1, accounts: {'fixture-gm': 'player', other: 'gm', 'stale-admin': 'gm', unknown: 'gm'}}));
  const accounts = [{username: 'fixture-gm', role: 'gm'}, {username: 'other'}, {username: 'new', role: 'player'}];
  let store = createOnlineAccountStore({accountRoot}); await store.initialize(accounts);
  assert.equal(store.role('fixture-gm'), 'gm'); for (const id of ['other', 'stale-admin', 'new', 'unknown']) assert.equal(store.role(id), 'player');
  await store.saveNickname('other', '\uac1e\uac40\uac16');
  const match = {id: 'retain-history', versions: {}, players: [{id: 'other', username: 'other', team: 0}]};
  await store.recordMatch(match, {winnerTeam: 0, score: [1, 0], players: [{id: 'other', kills: 1, assists: 0, deaths: 0}]});
  await Promise.all([store.saveMode('1v1', false), store.saveMode('3v3', false)]);
  store = createOnlineAccountStore({accountRoot}); await store.initialize(accounts);
  assert.deepEqual(store.modeFlags(), {'1v1': false, '2v2': true, '3v3': false});
  assert.equal((await store.summary('other')).wins, 1); assert.equal((await store.profile('other')).nickname, '\uac1e\uac40\uac16');
  assert.equal(await fs.readFile(path.join(accountRoot, 'dev-account.json'), 'utf8'), credentials);
  const bad = createOnlineAccountStore({accountRoot, fileSystem: {...fs, rename: async (from, to) => {
    if (to.endsWith('online-modes.json')) throw Error('write-failed');
    return fs.rename(from, to);
  }}});
  await bad.initialize(accounts);
  await assert.rejects(bad.saveMode('2v2', false), /write-failed/);
  assert.deepEqual(bad.modeFlags(), store.modeFlags());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(accountRoot, 'online-modes.json'), 'utf8')).modes, store.modeFlags());
  assert.equal((await fs.readdir(accountRoot)).some(name => name.endsWith('.tmp')), false);
  await fs.writeFile(path.join(accountRoot, 'online-modes.json'), JSON.stringify({schemaVersion: 1, modes: {'1v1': false, '2v2': 'true', '3v3': false}}));
  await assert.rejects(createOnlineAccountStore({accountRoot}).initialize(accounts), /invalid-online-modes/);
});

test('a long-waiting player receives priority in an oversubscribed random draw without duplicate seats', async t => {
  const f = fixture(); t.after(() => f.online.close());
  await f.add('oldest', '3v3'); await f.advance(60000);
  for (let i = 0; i < 16; i++) await f.add('new-' + i, '3v3');
  assert.equal(f.online.status('oldest').queue.deadline, 60000);
  await f.online.tick(); const players = f.drivers[0].match.players;
  assert.equal(players.length, 6); assert.equal(new Set(players.map(p => p.id)).size, 6);
  assert.ok(players.some(p => p.id === 'oldest')); assert.equal(f.online.status('idle').queues['3v3'].size, 11);
});
