import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile, mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createGunzip} from 'node:zlib';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';
import {listenLoopback} from '../helpers/listen-loopback.mjs';

const accounts = [{username: 'fixture-gm', role:'gm', password: 'secret-a'}, {username: 'normal-b', password: 'secret-b', role: 'player'},
  {username: 'gm-c', password: 'secret-c'}, {username: 'gm-d', password: 'secret-d'}];
function controlledDisconnectTimers() {
  const pending = new Set(), scheduled = [];
  return {pending,
    setTimeout(callback, delay) {const timer = {callback, delay, unref() {}}; pending.add(timer);
      for (const resolve of scheduled.splice(0)) resolve(timer); return timer;},
    clearTimeout(timer) {pending.delete(timer);},
    waitScheduled() {return pending.size ? Promise.resolve([...pending][0]) : new Promise(resolve => scheduled.push(resolve));},
    fireAll() {for (const timer of [...pending]) if (pending.delete(timer)) timer.callback();},
  };
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-online-api-')), drivers = [];
  await mkdir(path.join(root, 'dist')); await writeFile(path.join(root, 'dist/game.js'), 'fixture browser build');
  let clock = 100_000;
  const driverFactory = args => {
    const driver = {...args, inputs: [], disconnected: [], readyIds: [], submitInput(id, input) {this.inputs.push({id, input});},
      disconnect(id) {this.disconnected.push(id);}, ready(id) {this.readyIds.push(id);}, stop() {}, snapshot: () => null};
    drivers.push(driver); return driver;
  };
  const instance = await createDevServer({root, credentials: accounts[0], additionalCredentials: accounts.slice(1),
    driverFactory, now: () => clock, ...options});
  await listenLoopback(instance.server);
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  t.after(async () => {instance.closeStreams(); await new Promise(resolve => instance.server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, {recursive: true, force: true});});
  const request = (route, {cookie, method = 'GET', body, signal,headers={}} = {}) => fetch(base + route, {method, signal,
    headers: {...(cookie ? {cookie} : {}), 'Content-Type': 'application/json',...headers}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
  const login = async account => {const response = await request('/api/login', {method: 'POST', body: account});
    assert.equal(response.status, 200); await response.json(); return response.headers.get('set-cookie').split(';')[0];};
  return {root, base, instance, drivers, request, login, advance: async milliseconds => {clock += milliseconds; await instance.online.tick();},
    loginFour: async () => Promise.all(accounts.map(login))};
}

async function openEvents(t, f, cookie, pageInitToken=null) {
  const abort = new AbortController();
  const route='/api/online/events'+(pageInitToken?'?pageInitToken='+encodeURIComponent(pageInitToken):'');
  let observe;
  const closed = new Promise(resolve => {
    observe = (req, res) => {
      if (req.url !== route) return;
      f.instance.server.off('request', observe); res.once('close', resolve);
    };
    f.instance.server.on('request', observe);
  });
  t.after(() => {abort.abort(); f.instance.server.off('request', observe);});
  const response = await f.request(route, {cookie, signal: abort.signal});
  assert.equal(response.status, 200);
  return {async close() {abort.abort(); await response.body.cancel().catch(() => {}); await closed;}};
}

test('account roles enforce GM endpoints and a successful second login replaces the first session', async t => {
  const f = await fixture(t), old = await f.login(accounts[0]), b = await f.login(accounts[1]);
  const existing = await f.request('/api/login', {method: 'POST', body: accounts[0]});
  assert.equal(existing.status, 200);await existing.json();const a=existing.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.request('/api/session', {cookie:old})).status,401);
  assert.equal((await f.request('/api/session', {cookie: a})).status, 200);
  assert.equal((await (await f.request('/api/session', {cookie: a})).json()).role, 'gm');
  assert.equal((await (await f.request('/api/session', {cookie: b})).json()).role, 'player');
  assert.equal((await f.request('/api/admin/accounts', {cookie: b})).status, 403);
  assert.equal((await f.request('/api/admin/accounts', {cookie: a})).status, 200);
  assert.equal((await f.request('/api/traces', {cookie: b, method: 'POST', body: {}})).status, 403);
  await f.request('/api/logout', {cookie: a, method: 'POST'}); const fresh = await f.login(accounts[0]); assert.notEqual(fresh, a);
  assert.equal((await f.request('/api/session', {cookie: a})).status, 401);
});

test('authenticated GM mode controls persist, remove queued players, unlock configuration and expose flags in sessions', async t => {
  const f = await fixture(t), gm = await f.login(accounts[0]), player = await f.login(accounts[1]);
  assert.equal((await f.request('/api/online/modes', {method: 'POST', body: {mode: '1v1', enabled: false}})).status, 401);
  assert.equal((await f.request('/api/online/modes', {cookie: player, method: 'POST', body: {mode: '1v1', enabled: false}})).status, 403);
  for (const body of [{mode: '4v4', enabled: false}, {mode: '1v1', enabled: 'false'}, {mode: '1v1', enabled: false, username: 'fixture-gm'}, null, []]) {
    assert.equal((await f.request('/api/online/modes', {cookie: gm, method: 'POST', body})).status, 400);
  }
  assert.equal((await f.request('/api/online/queue', {cookie: player, method: 'POST', body: {mode: '1v1'}})).status, 200);
  const closing = await f.request('/api/online/modes', {cookie: gm, method: 'POST', body: {mode: '1v1', enabled: false}});
  assert.equal(closing.status, 200); assert.equal((await closing.json()).modes['1v1'], false);
  const status = await (await f.request('/api/online/status', {cookie: player})).json();
  assert.equal(status.queued, false); assert.equal(status.locked, false); assert.equal(status.queueNotice.message, 'This mode is disabled.');
  assert.equal((await (await f.request('/api/session', {cookie: player})).json()).online.modes['1v1'], false);
  assert.equal((await f.request('/api/online/queue', {cookie: player, method: 'POST', body: {mode: '1v1'}})).status, 409);
  assert.equal((await f.request('/api/nickname-preferences', {cookie: player, method: 'PUT', body: {nickname: '\uac39\uac3f\uac15'}})).status, 200);
  const stored = JSON.parse(await readFile(path.join(f.root, 'runtime/online-modes.json'), 'utf8'));
  assert.deepEqual(stored, {schemaVersion: 1, modes: {'1v1': false, '2v2': true, '3v3': true}});
  assert.equal((await f.request('/api/online/modes', {cookie: gm, method: 'POST', body: {mode: '1v1', enabled: true}})).status, 200);
  assert.equal((await f.request('/api/online/queue', {cookie: player, method: 'POST', body: {mode: '3v3'}})).status, 200);
  assert.equal((await f.request('/api/online/queue', {cookie: player, method: 'POST', body: {mode: '2v2'}})).status, 409);
});

test('only GM can atomically set per-mode room limits; ordinary status exposes usage with no aggregate cap',async t=>{
  const f=await fixture(t,{roomCapacity:{maxActivePlayers:2,maxActiveRooms:1}}),gm=await f.login(accounts[0]),player=await f.login(accounts[1]);
  const url='/api/online/capacity',body={maxRoomsByMode:{'1v1':4,'2v2':0,'3v3':20}};
  assert.equal((await f.request(url)).status,401);assert.equal((await f.request(url,{method:'POST',body})).status,401);
  assert.equal((await f.request(url,{cookie:player,method:'POST',body})).status,403);
  const initial=await (await f.request(url,{cookie:player})).json();
  assert.deepEqual(initial.maxRoomsByMode,{'1v1':3,'2v2':3,'3v3':2});assert.equal(initial.revision,0);assert.equal(initial.maxActivePlayers,null);assert.equal(initial.maxActiveRooms,null);
  for(const invalid of [null,[],{}, {maxActivePlayers:12,maxActiveRooms:3}, {...body,username:'fixture-gm'},
    {maxRoomsByMode:{'1v1':3,'2v2':2}}, {maxRoomsByMode:{'1v1':3,'2v2':2,'3v3':2,'4v4':1}},
    ...[-1,1.5,21,'2',null].map(value=>({maxRoomsByMode:{...body.maxRoomsByMode,'1v1':value}}))]){
    const response=await f.request(url,{cookie:gm,method:'POST',body:invalid});assert.equal(response.status,400);
    assert.equal((await response.json()).error,'invalid-room-capacity');
  }
  assert.equal((await f.request(url,{cookie:gm,method:'PUT',body})).status,405);
  const response=await f.request(url,{cookie:gm,method:'POST',body});assert.equal(response.status,200);
  const saved=await response.json();assert.deepEqual(saved.maxRoomsByMode,body.maxRoomsByMode);assert.equal(saved.revision,1);assert.equal(saved.maxActivePlayers,null);assert.equal(saved.maxActiveRooms,null);
  const stored=JSON.parse(await readFile(path.join(f.root,'runtime/online-room-capacity.json'),'utf8'));
  assert.deepEqual(stored,{schemaVersion:1,revision:1,...body});
  const status=await (await f.request('/api/online/status',{cookie:player})).json();assert.deepEqual(status.roomCapacity.maxRoomsByMode,body.maxRoomsByMode);
  assert.deepEqual(status.roomCapacity.activeRoomsByMode,{'1v1':0,'2v2':0,'3v3':0});assert.equal(status.roomCapacity.revision,1);
});

test('HTTP duel queue starts precisely after five seconds and assigns a single opponent to each team', async t => {
  const f = await fixture(t), cookies = await Promise.all(accounts.slice(0, 2).map(f.login));
  for (const cookie of cookies) assert.equal((await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '1v1'}})).status, 200);
  await f.advance(4999); assert.equal(f.drivers.length, 0); await f.advance(1); assert.equal(f.drivers.length, 1);
  assert.equal(f.drivers[0].match.mode, '1v1'); assert.deepEqual(f.drivers[0].match.players.map(p => p.team), [0, 1]);
});

test('matching/loading heartbeat expiry removes an unready actor and releases login exactly once', async t => {
  const f = await fixture(t), cookies = await f.loginFour();
  for (const cookie of cookies) assert.equal((await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}})).status, 200);
  await f.advance(11_000); assert.equal(f.drivers.length, 1);
  // Keep three accounts connected while the first stops reporting liveness.
  await f.advance(8000); for (const cookie of cookies.slice(1)) await f.request('/api/heartbeat', {cookie, method: 'POST'});
  await f.advance(1000); f.instance.expireSessions();
  assert.deepEqual(f.drivers[0].disconnected, [accounts[0].username]);
  assert.equal((await f.request('/api/session', {cookie: cookies[0]})).status, 401);
  const replacement = await f.login(accounts[0]); assert.notEqual(replacement, cookies[0]);
  f.instance.expireSessions(); assert.deepEqual(f.drivers[0].disconnected, [accounts[0].username]);
});

for(const downstream of ['open','closed'])test(`an entered game expires a silent owner even when its SSE is ${downstream}, without using the short downstream gap`,async t=>{
  const disconnectTimers=controlledDisconnectTimers(),f=await fixture(t,{disconnectTimers}),cookies=await f.loginFour();
  for(const cookie of cookies)await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});
  await f.advance(11_000);const driver=f.drivers[0],stream=await openEvents(t,f,cookies[0]);
  driver.emit('state',{pvp:{phase:'fight'}});
  for(const cookie of cookies.slice(1))await f.request('/api/heartbeat',{cookie,method:'POST'});
  if(downstream==='closed')await stream.close();
  assert.equal(disconnectTimers.pending.size,0,'entered games do not use the 2.5-second downstream recovery gate');
  await f.advance(19_999);for(const cookie of cookies.slice(1))await f.request('/api/heartbeat',{cookie,method:'POST'});
  f.instance.expireSessions();assert.deepEqual(driver.disconnected,[]);
  await f.advance(1);f.instance.expireSessions();
  assert.deepEqual(driver.disconnected,[accounts[0].username]);assert.equal(f.instance.sessions.size,3);
  assert.equal((await f.request('/api/session',{cookie:cookies[0]})).status,401);
  f.instance.expireSessions();driver.emit('player-timeout',{playerId:accounts[0].username,reason:'loading-timeout'});
  assert.deepEqual(driver.disconnected,[accounts[0].username],'old loading callbacks and further expiry cannot disconnect twice');
  const replacement=await f.login(accounts[0]);assert.notEqual(replacement,cookies[0]);
  assert.equal(f.instance.online.status(accounts[0].username).match,null,'relogin cannot restore the retired combat slot');
});

test('recent authenticated activity preserves an entered game across short SSE gaps and absolute login expiry, but explicit logout removes its actor',async t=>{
  const disconnectTimers=controlledDisconnectTimers(),f=await fixture(t,{disconnectTimers,sessionSeconds:15}),cookies=await f.loginFour();
  for(const cookie of cookies)await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});
  await f.advance(11_000);const driver=f.drivers[0];
  driver.emit('state',{pvp:{phase:'created'}});assert.equal(f.instance.online.isPlaying(accounts[0].username),false);
  const stream=await openEvents(t,f,cookies[0]);await stream.close();const stale=await disconnectTimers.waitScheduled();
  driver.emit('state',{pvp:{phase:'intro'}});assert.equal(f.instance.online.isPlaying(accounts[0].username),true);
  for(const cookie of cookies.slice(1))await f.request('/api/heartbeat',{cookie,method:'POST'});
  await f.advance(15_000);f.instance.expireSessions();stale.callback();disconnectTimers.fireAll();
  assert.equal(f.instance.sessions.size,4);assert.deepEqual(driver.disconnected,[]);
  driver.emit('player-timeout',{playerId:accounts[0].username,reason:'loading-timeout'});
  assert.equal(f.instance.sessions.size,4,'an old loading deadline cannot drop a player after intro starts');
  const response=await f.request('/api/heartbeat',{cookie:cookies[0],method:'POST'});assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*Max-Age=15/);
  assert.equal((await f.request('/api/session',{cookie:cookies[0]})).status,200);
  assert.equal((await f.request('/api/admin/accounts',{cookie:cookies[1]})).status,403);
  await f.request('/api/logout',{cookie:cookies[0],method:'POST'});
  assert.deepEqual(driver.disconnected,[accounts[0].username]);assert.equal((await f.request('/api/session',{cookie:cookies[0]})).status,401);
  const changed=await f.request('/api/change-password',{cookie:cookies[1],method:'POST',body:{username:accounts[1].username,oldPassword:accounts[1].password,newPassword:'next-private-fixture'}});
  assert.equal(changed.status,200);assert.deepEqual(driver.disconnected,[accounts[0].username,accounts[1].username]);
  assert.equal((await f.request('/api/session',{cookie:cookies[1]})).status,401);assert.equal(f.instance.sessions.size,2);
});

test('practice can enter matching after a heartbeat gap; the queue still rejects a later silent participant before a match starts',async t=>{
  const f=await fixture(t),cookie=await f.login(accounts[1]);
  await f.advance(90_000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,1);
  assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).status,200);
  await f.advance(20_000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,0);assert.equal(f.drivers.length,0);
  assert.equal((await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}})).status,401);
});

test('a truly idle lobby still expires at the authentication lifetime, while a live practice request renews its browser cookie',async t=>{
  const f=await fixture(t),cookie=await f.login(accounts[1]);
  await f.advance(1_900_000);const refreshed=await f.request('/api/heartbeat',{cookie,method:'POST'});
  assert.equal(refreshed.status,200);assert.match(refreshed.headers.get('set-cookie'),/Max-Age=3600/);
  await f.advance(1_900_000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,1);
  await f.advance(1_700_000);f.instance.expireSessions();assert.equal(f.instance.sessions.size,0);
  assert.equal((await f.request('/api/session',{cookie})).status,401);
});

test('the authoritative driver loading timeout removes a player and releases login without recursive duplicate disconnect', async t => {
  const f = await fixture(t), cookies = await f.loginFour();
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  await f.advance(11_000); const driver = f.drivers[0];
  driver.emit('player-timeout', {playerId: accounts[0].username, reason: 'loading-timeout'});
  driver.emit('player-timeout', {playerId: accounts[0].username, reason: 'loading-timeout'});
  assert.deepEqual(driver.disconnected, [accounts[0].username]);
  assert.equal((await f.request('/api/session', {cookie: cookies[0]})).status, 401);
  const fresh = await f.login(accounts[0]); assert.notEqual(fresh, cookies[0]);
  // A delayed timeout from the old match must not drop a newly authenticated session.
  driver.emit('player-timeout', {playerId: accounts[0].username, reason: 'loading-timeout'});
  assert.equal((await f.request('/api/session', {cookie: fresh})).status, 200);
  assert.deepEqual(driver.disconnected, [accounts[0].username]);
});

test('queue locks account skill and key preferences, freezes versions, and only driver results become history', async t => {
  const f = await fixture(t), cookies = await f.loginFour(), first = cookies[0];
  const keyConfig = structuredClone(DEFAULT_KEY_BINDINGS); [keyConfig.bindings.z, keyConfig.bindings.x] = [keyConfig.bindings.x, keyConfig.bindings.z];
  assert.equal((await f.request('/api/key-preferences', {cookie: first, method: 'PUT', body: keyConfig})).status, 200);
  const skills = {schemaVersion: 1, loadout: Array(8).fill(null), branchChoices: {}};
  assert.equal((await f.request('/api/skill-preferences', {cookie: first, method: 'PUT', body: skills})).status, 200);
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  for (const route of ['/api/key-preferences', '/api/skill-preferences']) {
    const response = await f.request(route, {cookie: first, method: 'PUT', body: route.includes('/key-') ? keyConfig : skills});
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'preferences-locked');
  }
  await f.advance(11_000); const driver = f.drivers[0], match = driver.match;
  assert.equal(match.players.find(player => player.id === accounts[0].username).keyBindings.bindings.z, 'KeyX');
  assert.equal(match.players.find(player => player.id === accounts[0].username).loadout.length, 8);
  assert.ok(match.players.filter(player => player.id !== accounts[0].username).every(player => player.loadout.length === 8));
  assert.ok(match.versions.program); assert.ok(match.versions.reference); assert.ok(match.versions.preset);
  assert.equal((await f.request('/api/online/ready', {cookie: first, method: 'POST', body: {matchId: match.id}})).status, 200);
  assert.equal(driver.readyIds[0], accounts[0].username);
  assert.equal((await f.request('/api/online/input', {cookie: first, method: 'POST', body: {matchId: match.id, sequence: 0, frames: [{held: ['Z'], frameSeq: 500}]}})).status, 200);
  const reconnectStatus = await (await f.request('/api/online/status', {cookie: first})).json();
  assert.equal(reconnectStatus.match.players.find(player => player.id === accounts[0].username).lastFrameSeq, 500);
  assert.equal((await f.request('/api/online/input', {cookie: first, method: 'POST', body: {matchId: match.id, sequence: 0, frames: [{held: ['Z']}]}})).status, 409);
  assert.equal((await f.request('/api/online/result', {cookie: first, method: 'POST', body: {winnerTeam: 0}})).status, 404);
  const result = {winnerTeam: 0, score: [4, 2], reason: 'score', players: match.players.map(player => ({id: player.id, kills: 2, assists: 1, deaths: 1}))};
  assert.equal(await driver.finish(result), true); assert.equal(await driver.finish(result), false);
  const history = (await (await f.request('/api/history', {cookie: first})).json()).history;
  assert.equal(history.games, 1); assert.equal(history.kda, 3); assert.equal(history.kills, 2);
  assert.equal((await f.request('/api/key-preferences', {cookie: first, method: 'PUT', body: keyConfig})).status, 200);
  assert.equal((await f.request('/api/history')).status, 401);
});

test('matches preserve the authoritative host program seal separately from the browser build and native manifest', async t => {
  let created;
  const driverFactory = args => {created = args; return {submitInput() {}, stop() {}};};
  driverFactory.versions = {program: 'host-program-sha', hostProgramSha256: 'host-program-sha',
    nativeProgram: 'native-seal-sha', nativeManifestSha256: 'native-manifest-sha', resourceSha256: 'resources-sha', coreVersion: 'core-v21'};
  const f = await fixture(t, {driverFactory}), cookies = await f.loginFour();
  const session = await (await f.request('/api/session', {cookie: cookies[0]})).json();
  assert.match(session.buildVersion, /^[a-f\d]{64}$/);
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  await f.advance(11_000);
  const frozen = created.match.versions;
  assert.equal(frozen.program, 'host-program-sha'); assert.equal(frozen.browserBuildVersion, session.buildVersion);
  assert.equal(frozen.nativeProgram, 'native-seal-sha'); assert.equal(frozen.nativeManifestSha256, 'native-manifest-sha');
  assert.equal(frozen.hostProgramSha256, 'host-program-sha'); assert.equal(frozen.resourceSha256, 'resources-sha');
  assert.equal(frozen.coreVersion, 'core-v21');
});

test('bad key writes keep last saved configuration; endpoint cannot impersonate another account', async t => {
  const f = await fixture(t), a = await f.login(accounts[0]), b = await f.login(accounts[1]);
  const good = structuredClone(DEFAULT_KEY_BINDINGS); [good.bindings.z, good.bindings.x] = [good.bindings.x, good.bindings.z];
  await f.request('/api/key-preferences', {cookie: a, method: 'PUT', body: good});
  const bad = structuredClone(good); bad.bindings.z = 'Tab';
  assert.equal((await f.request('/api/key-preferences', {cookie: a, method: 'PUT', body: bad})).status, 400);
  assert.equal((await f.request('/api/key-preferences', {cookie: a, method: 'PUT', body: {...good, username: accounts[1].username}})).status, 400);
  assert.deepEqual((await (await f.request('/api/key-preferences', {cookie: a})).json()).preferences, good);
  assert.deepEqual((await (await f.request('/api/key-preferences', {cookie: b})).json()).preferences, DEFAULT_KEY_BINDINGS);
});

test('queued SSE permits one stream per login; reconnect during grace keeps it and a persistent disconnect releases it', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  const firstAbort = new AbortController(), first = await f.request('/api/online/events', {cookie, signal: firstAbort.signal});
  t.after(() => firstAbort.abort());
  assert.equal(first.status, 200); assert.match(first.headers.get('content-type'), /text\/event-stream/);
  assert.equal((await f.request('/api/online/events', {cookie})).status, 409);
  const reader = first.body.getReader(), decoder = new TextDecoder(); let packet = '';
  // HTTP chunks need not coincide with SSE records; retry is sent before the initial status.
  const readDeadline = setTimeout(() => firstAbort.abort(), 5000);
  try {
    while (!packet.includes('event: status\n')) {
      const {done, value} = await reader.read(); assert.equal(done, false, 'initial status arrives before stream closure');
      packet += decoder.decode(value, {stream: true}); assert.ok(packet.length < 65536, 'initial event remains bounded');
    }
  } finally {clearTimeout(readDeadline);}
  assert.match(packet, /retry: 250\n\n/); assert.match(packet, /event: status\n/);
  firstAbort.abort(); await reader.cancel().catch(() => {});
  // Wait for the actual transport close. Expiry is controlled independently of machine CPU load.
  assert.equal((await disconnectTimers.waitScheduled()).delay, 2500);
  const nextAbort = new AbortController(), reconnect = await f.request('/api/online/events', {cookie, signal: nextAbort.signal});
  t.after(() => nextAbort.abort());
  assert.equal(reconnect.status, 200); assert.equal(disconnectTimers.pending.size, 0);
  disconnectTimers.fireAll();
  assert.equal((await f.request('/api/heartbeat', {cookie, method: 'POST'})).status, 200);
  nextAbort.abort(); await reconnect.body.cancel().catch(() => {}); await disconnectTimers.waitScheduled(); disconnectTimers.fireAll();
  assert.equal((await f.request('/api/session', {cookie})).status, 401); await f.login(accounts[0]);
});

test('lobby SSE close and page reload keep the authenticated local session without a disconnect deadline', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  const first = await openEvents(t, f, cookie); await first.close();
  assert.equal(disconnectTimers.pending.size, 0);
  assert.equal((await f.request('/api/session', {cookie})).status, 200); assert.equal(disconnectTimers.pending.size, 0);
  await f.advance(4000);
  const script = await f.request('/game/game.js', {cookie});
  assert.equal(script.status, 200,'delayed lobby imports keep authentication'); assert.equal(await script.text(), 'fixture browser build');
  assert.equal((await f.request('/api/heartbeat', {cookie, method: 'POST'})).status, 200);
  const replacement = await openEvents(t, f, cookie); await replacement.close();
  assert.equal(disconnectTimers.pending.size, 0); assert.equal(f.instance.sessions.size, 1);
  disconnectTimers.fireAll(); assert.equal((await f.request('/api/session', {cookie})).status, 200);
});

test('lobby page reload before the old SSE closes and its replacement disconnect both keep local play', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  const oldPage = await openEvents(t, f, cookie);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  await oldPage.close(); assert.equal(disconnectTimers.pending.size, 0);
  await f.advance(4000); const script = await f.request('/game/game.js', {cookie});
  assert.equal(script.status, 200); assert.equal(await script.text(), 'fixture browser build');
  const newPage = await openEvents(t, f, cookie); await newPage.close();
  assert.equal(disconnectTimers.pending.size, 0);
  disconnectTimers.fireAll(); assert.equal((await f.request('/api/session', {cookie})).status, 200);
});

test('lobby loading and local practice survive the twenty-second heartbeat bound', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  const oldPage = await openEvents(t, f, cookie); await oldPage.close(); assert.equal(disconnectTimers.pending.size,0);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  await f.advance(19_000); f.instance.expireSessions(); assert.equal(f.instance.sessions.size, 1);
  await f.advance(1000); f.instance.expireSessions(); assert.equal(f.instance.sessions.size, 1);
  assert.equal((await f.request('/game/game.js', {cookie})).status, 200);
  assert.equal((await f.request('/api/session',{cookie})).status,200);
});

for(const closedBefore of [false,true])test(`queued authenticated page handover ${closedBefore?'after':'before'} old SSE close survives resource loading and keeps accumulated wait`,async t=>{
  const disconnectTimers=controlledDisconnectTimers(),f=await fixture(t,{disconnectTimers}),cookie=await f.login(accounts[0]);
  const old=await openEvents(t,f,cookie);await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});await f.advance(14000);
  const original=f.instance.online.status(accounts[0].username);assert.equal(original.queue.elapsedSeconds,14);
  let stale;if(closedBefore){await old.close();stale=await disconnectTimers.waitScheduled();}
  const headers={'X-RF-Page-Init':'queued-reload-123'};
  const initialized=await (await f.request('/api/session',{cookie,headers})).json();assert.equal(initialized.online.queue.loading,true);
  assert.equal(initialized.online.queue.joinedAt,original.queue.joinedAt);assert.equal(initialized.online.queue.eligibleSize,0);
  assert.equal(disconnectTimers.pending.size,0);
  const generation=[...f.instance.sessions.values()][0].pageGeneration;
  await f.request('/api/session',{cookie,headers});await f.request('/api/session',{cookie});
  assert.equal([...f.instance.sessions.values()][0].pageGeneration,generation,'same-page initialization and ordinary reads are idempotent');
  if(stale)stale.callback();
  await f.advance(6000);assert.equal((await f.request('/api/heartbeat',{cookie,method:'POST'})).status,200);
  assert.equal((await f.request('/game/game.js',{cookie})).status,200);
  assert.equal((await f.request('/api/key-preferences',{cookie,method:'PUT',body:DEFAULT_KEY_BINDINGS})).status,409,'reload never unlocks frozen queue preferences');
  const replacement=await openEvents(t,f,cookie,headers['X-RF-Page-Init']);if(!closedBefore)await old.close();
  const restored=f.instance.online.status(accounts[0].username);assert.equal(restored.queue.loading,false);assert.equal(restored.queue.eligibleSize,1);
  assert.equal(restored.queue.elapsedSeconds,20);assert.equal(restored.queue.joinedAt,original.queue.joinedAt);
  await f.request('/api/session',{cookie,headers});assert.equal(f.instance.online.status(accounts[0].username).queue.loading,false,'same boot token cannot pause the now-active queue again');
  await replacement.close();const current=await disconnectTimers.waitScheduled();assert.equal(current.delay,2500);
  if(stale){stale.callback();assert.equal(disconnectTimers.pending.has(current),true);}
  disconnectTimers.fireAll();assert.equal((await f.request('/api/session',{cookie})).status,401);assert.equal(f.instance.online.status(accounts[0].username).queued,false);
});

test('queued page initialization still expires without heartbeat, and invalid initialization tokens cannot change lifecycle',async t=>{
  const disconnectTimers=controlledDisconnectTimers(),f=await fixture(t,{disconnectTimers}),cookie=await f.login(accounts[0]);
  const page=await openEvents(t,f,cookie);await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});
  for(const value of ['short','bad token', 'x'.repeat(101)])assert.equal((await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':value}})).status,400);
  assert.equal(f.instance.online.isPageLoading(accounts[0].username),false);
  await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':'queued-reload-timeout'}});await page.close();
  assert.equal(disconnectTimers.pending.size,0);await f.advance(20000);f.instance.expireSessions();
  assert.equal(f.instance.sessions.size,0);assert.equal(f.instance.online.status(accounts[0].username).queued,false);
});

test('retired page initialization and SSE opens cannot steal a newer queued page handover',async t=>{
  const disconnectTimers=controlledDisconnectTimers(),f=await fixture(t,{disconnectTimers}),cookie=await f.login(accounts[0]);
  const a='page-before-123',b='page-current-456';
  const initialize=token=>f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':token}});
  assert.equal((await initialize(a)).status,200);const old=await openEvents(t,f,cookie,a);
  await f.request('/api/online/queue',{cookie,method:'POST',body:{mode:'2v2'}});
  assert.equal((await initialize(b)).status,200);const user=[...f.instance.sessions.values()][0],generation=user.pageGeneration;
  const retired=await initialize(a);assert.equal(retired.status,409);assert.equal((await retired.json()).error,'page-initialization-retired');
  assert.equal(user.pageGeneration,generation);assert.equal(user.pageInitToken,b);assert.equal(f.instance.online.isPageLoading(accounts[0].username),true);
  for(const route of ['/api/online/events','/api/online/events?pageInitToken='+a]){
    const response=await f.request(route,{cookie});assert.equal(response.status,409);assert.equal((await response.json()).error,'page-generation-retired');
  }
  assert.equal(disconnectTimers.pending.size,0);const fresh=await openEvents(t,f,cookie,b);await old.close();
  assert.equal(f.instance.online.isPageLoading(accounts[0].username),false);
  assert.equal((await initialize(a)).status,409);assert.equal(f.instance.online.isPageLoading(accounts[0].username),false);
  await fresh.close();const deadline=await disconnectTimers.waitScheduled();assert.equal(deadline.delay,2500);
  assert.equal((await initialize(a)).status,409);assert.equal(disconnectTimers.pending.has(deadline),true);
  disconnectTimers.fireAll();assert.equal((await f.request('/api/session',{cookie})).status,401);
});

for (const mode of ['queue', 'match']) test(`${mode} session GET before or after SSE close never extends the combat disconnect deadline`, async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookies = mode === 'match' ? await f.loginFour() : [await f.login(accounts[0])];
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  if (mode === 'match') await f.advance(11_000);
  const cookie = cookies[0];let stream = await openEvents(t, f, cookie);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  if(mode==='match'){
    const pageInitToken='already-matched-new-page';
    assert.equal((await f.request('/api/session',{cookie,headers:{'X-RF-Page-Init':pageInitToken}})).status,200);
    // A fresh identified page now retires both old transports atomically.
    // Exercise the deadline on its admitted replacement, not the retired SSE.
    await stream.close();stream=await openEvents(t,f,cookie,pageInitToken);
  }
  await stream.close(); const timer = await disconnectTimers.waitScheduled(); assert.equal(timer.delay, 2500);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  assert.equal(disconnectTimers.pending.has(timer), true);
  await f.advance(2500); disconnectTimers.fireAll();
  assert.equal((await f.request('/api/session', {cookie})).status, 401);
  assert.equal(f.instance.online.isLocked(accounts[0].username), false);
  if (mode === 'match') assert.deepEqual(f.drivers[0].disconnected, [accounts[0].username]);
});

for (const mode of ['queue', 'match']) test(`lobby session GET followed by ${mode} on the same SSE retains the 2.5-second disconnect deadline`, async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookies = mode === 'match' ? await f.loginFour() : [await f.login(accounts[0])];
  const cookie = cookies[0], stream = await openEvents(t, f, cookie);
  assert.equal((await f.request('/api/session', {cookie})).status, 200);
  assert.equal(f.instance.online.isLocked(accounts[0].username), false);
  for (const current of cookies) await f.request('/api/online/queue', {cookie: current, method: 'POST', body: {mode: '2v2'}});
  if (mode === 'match') {await f.advance(11_000); assert.equal(f.drivers.length, 1);}
  assert.equal(f.instance.online.isLocked(accounts[0].username), true);
  await stream.close(); assert.equal(disconnectTimers.pending.size, 1,'locked close must schedule a deadline despite the earlier lobby GET');
  const timer = await disconnectTimers.waitScheduled(); assert.equal(timer.delay, 2500);
  await f.advance(2499);
  assert.equal((await f.request('/api/heartbeat', {cookie, method: 'POST'})).status, 200);
  await f.advance(1); disconnectTimers.fireAll();
  assert.equal((await f.request('/api/session', {cookie})).status, 401);
  assert.equal(f.instance.online.isLocked(accounts[0].username), false);
  if (mode === 'match') {
    assert.deepEqual(f.drivers[0].disconnected, [accounts[0].username]);
    assert.equal(f.instance.online.status(accounts[1].username).match.players.find(player => player.id === accounts[0].username).connected, false);
  }
});

test('an old login disconnect callback cannot release a new login or erase its current stream deadline', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  const oldStream = await openEvents(t, f, cookie); await oldStream.close(); const oldTimer = await disconnectTimers.waitScheduled();
  await f.request('/api/logout', {cookie, method: 'POST'});
  const fresh = await f.login(accounts[0]); assert.notEqual(fresh, cookie);
  await f.request('/api/online/queue', {cookie:fresh, method: 'POST', body: {mode: '2v2'}});
  const freshStream = await openEvents(t, f, fresh); await freshStream.close();
  const freshTimer = await disconnectTimers.waitScheduled();
  oldTimer.callback(); assert.equal(f.instance.sessions.size, 1); assert.equal(disconnectTimers.pending.has(freshTimer), true);
  disconnectTimers.fireAll(); assert.equal((await f.request('/api/session', {cookie: fresh})).status, 401);
});

test('HTTP server shutdown releases all login state and cancels pending stream disconnect timers', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookies = await f.loginFour();
  for (const cookie of cookies) await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  const abort = new AbortController(), response = await f.request('/api/online/events', {cookie: cookies[0], signal: abort.signal});
  t.after(() => abort.abort());
  assert.equal(response.status, 200);
  abort.abort(); await response.body.cancel().catch(() => {});
  const pendingTimer = await disconnectTimers.waitScheduled();
  assert.equal(disconnectTimers.pending.size, 1); assert.equal(f.instance.sessions.size, 4);
  f.instance.closeStreams(); await new Promise(resolve => f.instance.server.close(resolve));
  assert.equal(disconnectTimers.pending.size, 0); assert.equal(f.instance.sessions.size, 0);
  const status = f.instance.online.status(accounts[0].username);
  assert.equal(status.available, false); assert.equal(status.locked, false); assert.equal(status.queue.size, 0);
  // Even an already dispatched callback cannot restore login state after shutdown.
  pendingTimer.callback(); assert.equal(f.instance.sessions.size, 0);
  assert.equal(f.instance.online.status(accounts[0].username).locked, false);
});

test('gzip SSE flushes every named event without ending the stream, preserves its single-login gate and disconnect cleanup', async t => {
  const disconnectTimers = controlledDisconnectTimers();
  const f = await fixture(t, {disconnectTimers}), cookie = await f.login(accounts[0]);
  const response = await new Promise((resolve, reject) => {
    const request = http.get(f.base + '/api/online/events', {headers: {cookie, 'Accept-Encoding': 'gzip'}}, resolve); request.on('error', reject);
  });
  t.after(() => response.destroy());
  assert.equal(response.headers['content-encoding'], 'gzip'); assert.equal(response.headers.vary, 'Accept-Encoding');
  const decoder = createGunzip(); t.after(() => decoder.destroy()); let decoded = ''; decoder.on('data', chunk => {decoded += chunk.toString('utf8');}); decoder.on('error', () => {}); response.pipe(decoder);
  const visible = async predicate => {
    const started = Date.now();
    while (!predicate(decoded)) {if (Date.now() - started > 1500) throw Error('SSE event was buffered instead of flushed'); await new Promise(resolve => setTimeout(resolve, 5));}
  };
  try {
    await visible(text => text.includes('event: status') && text.includes('\n\n'));
    assert.equal(response.complete, false); // The gzip trailer is not needed to decode an event.
    assert.equal((await f.request('/api/online/events', {cookie})).status, 409);
    const oldLength = decoded.length;
    assert.equal((await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}})).status, 200);
    await visible(text => text.length > oldLength && text.slice(oldLength).includes('"queued":true'));
    assert.equal(response.complete, false);
  } finally {response.destroy(); decoder.destroy();}
  assert.equal((await disconnectTimers.waitScheduled()).delay, 2500); disconnectTimers.fireAll();
  assert.equal((await f.request('/api/session', {cookie})).status, 401); await f.login(accounts[0]);
});

test('SSE gzip refusal keeps named events plain and explicit logout ends the writer', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]);
  const response = await new Promise((resolve, reject) => {const request = http.get(f.base + '/api/online/events',
    {headers: {cookie, 'Accept-Encoding': 'gzip;q=0, deflate'}}, resolve); request.on('error', reject);});
  assert.equal(response.headers['content-encoding'], undefined);
  let decoded = ''; response.on('data', chunk => {decoded += chunk.toString('utf8');});
  const ended = new Promise(resolve => response.once('end', resolve));
  await f.request('/api/logout', {cookie, method: 'POST'}); await ended;
  assert.match(decoded, /event: status/); assert.match(decoded, /data: \{/); assert.equal(response.complete, true);
});

test('explicit logout finalizes the gzip SSE stream and decoder without a dangling response', async t => {
  const f = await fixture(t), cookie = await f.login(accounts[0]);
  const response = await new Promise((resolve, reject) => {const request = http.get(f.base + '/api/online/events',
    {headers: {cookie, 'Accept-Encoding': 'gzip'}}, resolve); request.on('error', reject);});
  const decoder = createGunzip(); let decoded = ''; decoder.on('data', chunk => {decoded += chunk.toString('utf8');}); response.pipe(decoder);
  const ended = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('gzip SSE did not terminate')), 1500);
    decoder.once('end', () => {clearTimeout(timeout); resolve();}); decoder.once('error', error => {clearTimeout(timeout); reject(error);});
  });
  assert.equal((await f.request('/api/logout', {cookie, method: 'POST'})).status, 200);
  await ended; assert.match(decoded, /event: status/); assert.equal(response.complete, true);
});

test('first normal startup creates a private ordinary account and roles without rewriting existing credentials', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-role-migration-')); await mkdir(path.join(root, 'runtime'));
  const original = JSON.stringify(accounts[0]), extras = JSON.stringify({schemaVersion: 1, accounts: accounts.slice(2)});
  await writeFile(path.join(root, 'runtime/dev-account.json'), original); await writeFile(path.join(root, 'runtime/dev-accounts.json'), extras);
  const instance = await createDevServer({root, driverFactory: null});
  t.after(async () => {instance.online.close(); instance.server.emit('close'); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await rm(root, {recursive: true, force: true});});
  assert.equal(instance.playerAccount.role, 'player'); assert.equal(instance.accountCount, 4);
  assert.equal(await readFile(path.join(root, 'runtime/dev-account.json'), 'utf8'), original);
  assert.equal(await readFile(path.join(root, 'runtime/dev-accounts.json'), 'utf8'), extras);
  const roles = JSON.parse(await readFile(path.join(root, 'runtime/account-roles.json'), 'utf8')).accounts;
  assert.equal(roles[accounts[0].username], 'gm'); assert.equal(roles[instance.playerAccount.username], 'player');
  const privateAccount = JSON.parse(await readFile(path.join(root, 'runtime/dev-player-account.json'), 'utf8'));
  assert.equal(privateAccount.username, instance.playerAccount.username); assert.ok(privateAccount.password.length >= 12);
});

test('missing authoritative driver cannot silently start a peer-decided or fake match', async t => {
  const f = await fixture(t, {driverFactory: null}), cookie = await f.login(accounts[0]);
  const response = await f.request('/api/online/queue', {cookie, method: 'POST', body: {mode: '2v2'}});
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'online-driver-unavailable');
  assert.equal((await (await f.request('/api/online/status', {cookie})).json()).queued, false);
});
