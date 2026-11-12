import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createCredentialsStore, validNewPassword} from '../../apps/server/credentials-store.mjs';
import {DEFAULT_KEY_BINDINGS} from '../../packages/input/key-bindings.mjs';

const accounts = [{username: 'password-fixture', password: 'old-fixture-password'}, {username: 'other-fixture', password: 'other-fixture-password'}];
const key = username => createHash('sha256').update(username).digest('hex');
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-password-'));
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  return root;
}
function request(base, route, {method = 'POST', body, rawBody, headers = {}} = {}) {
  return new Promise((resolve, reject) => {
    const data = rawBody ?? (body === undefined ? '' : JSON.stringify(body));
    const req = http.request(base + route, {method, headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers}}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => {
        try { resolve({status: res.statusCode, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8'))}); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(data);
  });
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-password-')), accountRoot = path.join(root, 'accounts');
  let instance = null, base;
  const stop = async () => {
    if (!instance) return;
    const old = instance; instance = null; old.closeStreams(); await new Promise(resolve => old.server.close(resolve));
  };
  t.after(async () => {
    await stop();
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  const start = async () => {
    instance = await createDevServer({root, accountRoot, credentials: accounts[0], additionalCredentials: accounts.slice(1),
      driverFactory: () => ({submitInput() {}, ready() {}, disconnect() {}, stop() {}, snapshot: () => null}), ...options});
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${instance.server.address().port}`;
  };
  await start();
  return {root, accountRoot, start, stop, get instance() { return instance; },
    call: (route, options) => request(base, route, options),
    change: (username, oldPassword, newPassword, headers) => request(base, '/api/change-password', {body: {username, oldPassword, newPassword}, headers}),
    login: (username, password, headers) => request(base, '/api/login', {body: {username, password}, headers})};
}
const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];

test('password change needs only account and old/new passwords; unknown account and wrong password have the same response', async t => {
  const f = await fixture(t);
  const wrong = await f.change(accounts[0].username, 'wrong', 'new-fixture-password');
  const unknown = await f.change('unknown-fixture', 'wrong', 'new-fixture-password');
  assert.deepEqual({status: wrong.status, json: wrong.json}, {status: unknown.status, json: unknown.json});
  assert.equal(wrong.status, 401); assert.equal(wrong.json.error, 'invalid-credentials');
  assert.equal((await f.login(accounts[0].username, accounts[0].password)).status, 200);
  const success = await f.change(accounts[0].username, accounts[0].password, '  \uac25 password  ');
  assert.equal(success.status, 200); assert.deepEqual(success.json, {ok: true});
  assert.equal(success.headers['set-cookie'], undefined, 'an unauthenticated password change creates no session');
  assert.equal((await f.login(accounts[0].username, accounts[0].password)).status, 401);
  assert.equal((await f.login(accounts[0].username, '\uac25 password')).status, 401, 'password spaces are not trimmed');
  assert.equal((await f.login(accounts[0].username, '  \uac25 password  ')).status, 200);
});

test('password validation and same-origin checks reject invalid requests without changing credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/change-password', {method: 'GET'})).status, 405);
  const foreign = await f.change(accounts[0].username, accounts[0].password, 'new-fixture-password', {origin: 'http://foreign.invalid'});
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error, 'origin-denied');
  for (const newPassword of [null, 12, '', '12345', 'x'.repeat(129)]) {
    const response = await f.change(accounts[0].username, accounts[0].password, newPassword);
    assert.equal(response.status, 400); assert.equal(response.json.error, 'invalid-new-password');
  }
  for (const body of [null, [], {}, {username: 1, oldPassword: 'x', newPassword: '123456'},
    {username: accounts[0].username, oldPassword: [], newPassword: '123456'},
    {username: accounts[0].username, oldPassword: accounts[0].password, newPassword: '123456', role: 'gm'}]) {
    const response = await f.call('/api/change-password', {body});
    assert.equal(response.status, 400); assert.equal(response.json.error, 'invalid-password-change');
  }
  assert.equal((await f.call('/api/change-password', {rawBody: '{'})).status, 400);
  assert.equal((await f.login(accounts[0].username, accounts[0].password)).status, 200);
  assert.equal(validNewPassword('      '), true);
  assert.equal(validNewPassword('x'.repeat(128)), true);
});

test('password change invalidates only that account session and clears its cookie when used in the request', async t => {
  const f = await fixture(t), login = await f.login(accounts[0].username, accounts[0].password), firstCookie = cookieOf(login);
  const otherCookie = cookieOf(await f.login(accounts[1].username, accounts[1].password));
  assert.equal((await f.call('/api/online/queue', {body: {mode: '2v2'}, headers: {cookie: firstCookie}})).status, 200);
  const response = await f.change(accounts[0].username, accounts[0].password, 'next-fixture-password', {cookie: firstCookie});
  assert.equal(response.status, 200); assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await f.call('/api/session', {method: 'GET', headers: {cookie: firstCookie}})).status, 401);
  assert.equal((await f.call('/api/heartbeat', {headers: {cookie: firstCookie}})).status, 401);
  assert.equal(f.instance.sessions.size, 1);
  assert.equal(f.instance.online.status(accounts[0].username).queue.joinedAt, null);
  assert.equal((await f.call('/api/session', {method: 'GET', headers: {cookie: otherCookie}})).status, 200);
  assert.equal((await f.login(accounts[0].username, 'next-fixture-password')).status, 200);
});

test('concurrent changes using the same old password commit once, and chained changes use the committed value', async t => {
  const f = await fixture(t);
  const results = await Promise.all(['concurrent-fixture-a', 'concurrent-fixture-b'].map(password => f.change(accounts[0].username, accounts[0].password, password)));
  assert.deepEqual(results.map(response => response.status).sort(), [200, 401]);
  const winner = results[0].status === 200 ? 'concurrent-fixture-a' : 'concurrent-fixture-b';
  const cookie = cookieOf(await f.login(accounts[0].username, winner));
  await f.call('/api/logout', {headers: {cookie}});
  const chained = [await f.change(accounts[0].username, winner, 'chained-fixture-a'),
    await f.change(accounts[0].username, 'chained-fixture-a', 'chained-fixture-b')];
  assert.deepEqual(chained.map(response => response.status), [200, 200]);
  assert.equal((await f.login(accounts[0].username, 'chained-fixture-a')).status, 401);
  assert.equal((await f.login(accounts[0].username, 'chained-fixture-b')).status, 200);
  assert.equal((await fs.readdir(path.join(f.accountRoot, 'credentials'))).length, 1, 'no temporary archives remain');
});

test('login waits for an in-flight change and observes its committed password', async t => {
  let releaseRename, renameEntered;
  const entered = new Promise(resolve => { renameEntered = resolve; }), blocked = new Promise(resolve => { releaseRename = resolve; });
  const fileSystem = {...fs, rename: async (source, target) => { renameEntered(); await blocked; return fs.rename(source, target); }};
  const f = await fixture(t, {credentialsFileSystem: fileSystem});
  const changing = f.change(accounts[0].username, accounts[0].password, 'waiting-fixture-password');
  await entered;
  let oldFinished = false, nextFinished = false;
  const old = f.login(accounts[0].username, accounts[0].password).then(response => { oldFinished = true; return response; });
  const next = f.login(accounts[0].username, 'waiting-fixture-password').then(response => { nextFinished = true; return response; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(oldFinished, false); assert.equal(nextFinished, false);
  releaseRename();
  assert.equal((await changing).status, 200); assert.equal((await old).status, 401); assert.equal((await next).status, 200);
});

test('failed archive write preserves memory, prior disk value and the active session, then recovers', async t => {
  let fail = false;
  const fileSystem = {...fs, rename: async (source, target) => {
    if (fail) throw Object.assign(Error('fixture disk failure contains no client detail'), {code: 'EIO'});
    return fs.rename(source, target);
  }};
  const f = await fixture(t, {credentialsFileSystem: fileSystem});
  assert.equal((await f.change(accounts[0].username, accounts[0].password, 'saved-fixture-password')).status, 200);
  const archive = path.join(f.accountRoot, 'credentials', `${key(accounts[0].username)}.json`), saved = await fs.readFile(archive, 'utf8');
  const cookie = cookieOf(await f.login(accounts[0].username, 'saved-fixture-password'));
  fail = true;
  const response = await f.change(accounts[0].username, 'saved-fixture-password', 'unsaved-fixture-password');
  assert.equal(response.status, 503); assert.deepEqual(response.json, {error: 'password-save-failed'});
  assert.equal(await fs.readFile(archive, 'utf8'), saved);
  assert.equal((await f.call('/api/session', {method: 'GET', headers: {cookie}})).status, 200);
  assert.equal((await f.login(accounts[0].username, 'unsaved-fixture-password')).status, 401);
  assert.equal((await f.call('/api/session', {method:'GET',headers:{cookie}})).status,200,'the failed password/login attempt keeps the active session');
  assert.equal((await fs.readdir(path.join(f.accountRoot, 'credentials'))).length, 1);
  await f.stop(); await f.start();
  assert.equal((await f.login(accounts[0].username, 'saved-fixture-password')).status, 200);
  fail = false;
  assert.equal((await f.change(accounts[0].username, 'saved-fixture-password', 'recovered-fixture-password')).status, 200);
});

test('restart prefers credential hashes and preserves bootstrap, nickname, role, history, skills and keys', async t => {
  const f = await fixture(t), cookie = cookieOf(await f.login(accounts[0].username, accounts[0].password));
  assert.equal((await f.call('/api/nickname-preferences', {method: 'PUT', body: {nickname: '\uac20\uac02\uac28\uac32'}, headers: {cookie}})).status, 200);
  const bindings = structuredClone(DEFAULT_KEY_BINDINGS); bindings.bindings.special = 'ControlRight';
  assert.equal((await f.call('/api/key-preferences', {method: 'PUT', body: bindings, headers: {cookie}})).status, 200);
  const skillConfig = {schemaVersion: 1, loadout: [{skillId: 24203, branchId: 'none'}, ...Array(7).fill(null)], branchChoices: {'24203': 'none'}};
  const savedSkills = await f.call('/api/skill-preferences', {method: 'PUT', body: skillConfig, headers: {cookie}});
  assert.equal(savedSkills.status, 200); const skills = savedSkills.json.preferences;
  const match = {id: 'password-history-fixture', players: accounts.map((a, team) => ({id: a.username, username: a.username, team})), versions: {program: 'password-fixture'}};
  await f.instance.accountStore.recordMatch(match, {winnerTeam: 0, score: [4, 1], players: accounts.map((a, index) => ({id: a.username, kills: index ? 1 : 4, assists: 0, deaths: index ? 4 : 1}))});
  const summary = await f.instance.accountStore.summary(accounts[0].username);
  const markers = ['dev-account.json', 'dev-accounts.json', 'dev-player-account.json'];
  for (const name of markers) await fs.writeFile(path.join(f.accountRoot, name), 'bootstrap fixture untouched: ' + name);
  const files = ['account-roles.json', 'account-profiles.json', 'match-history.json', `key-preferences/${key(accounts[0].username)}.json`,
    `skill-preferences/${key(accounts[0].username)}.json`, ...markers];
  const before = new Map(await Promise.all(files.map(async file => [file, await fs.readFile(path.join(f.accountRoot, file), 'utf8')])));
  assert.equal((await f.change(accounts[0].username, accounts[0].password, 'restart-fixture-password')).status, 200);
  for (const [file, contents] of before) assert.equal(await fs.readFile(path.join(f.accountRoot, file), 'utf8'), contents, file);
  const archiveText = await fs.readFile(path.join(f.accountRoot, 'credentials', `${key(accounts[0].username)}.json`), 'utf8');
  const archive = JSON.parse(archiveText);
  assert.deepEqual(Object.keys(archive).sort(), ['algorithm', 'passwordHash', 'salt', 'schemaVersion']);
  assert.match(archive.passwordHash, /^[0-9a-f]{64}$/); assert.match(archive.salt, /^[0-9a-f]{32}$/);
  for (const secret of [accounts[0].password, 'restart-fixture-password', accounts[0].username]) assert.equal(archiveText.includes(secret), false);
  await f.stop(); await f.start();
  assert.equal((await f.login(accounts[0].username, accounts[0].password)).status, 401);
  const renewed = await f.login(accounts[0].username, 'restart-fixture-password'); assert.equal(renewed.status, 200);
  const renewedCookie = cookieOf(renewed);
  assert.equal((await f.call('/api/session', {method: 'GET', headers: {cookie: renewedCookie}})).json.nickname, '\uac20\uac02\uac28\uac32');
  assert.equal(renewed.json.role, 'player'); assert.deepEqual(await f.instance.accountStore.summary(accounts[0].username), summary);
  assert.deepEqual((await f.call('/api/key-preferences', {method: 'GET', headers: {cookie: renewedCookie}})).json.preferences, bindings);
  assert.deepEqual((await f.call('/api/skill-preferences', {method: 'GET', headers: {cookie: renewedCookie}})).json.preferences, skills);
  for (const route of [`/credentials/${key(accounts[0].username)}.json`, `/accounts/credentials/${key(accounts[0].username)}.json`, '/dev-account.json']) {
    const inaccessible = await f.call(route, {method: 'GET', headers: {cookie: renewedCookie}});
    assert.equal(inaccessible.status, 404); assert.deepEqual(inaccessible.json, {error: 'not-found'});
  }
});

test('all three bootstrap account sources keep their exact files and reload independent password overrides', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-password-bootstrap-')), accountRoot = path.join(root, 'accounts');
  await fs.mkdir(accountRoot);
  const primary = {username: 'fixture-gm', role:'gm', password: 'temporary-admin-fixture-password'},
    extra = {username: 'list-fixture', password: 'temporary-list-fixture-password', role: 'player'},
    player = {username: 'player-fixture', password: 'temporary-player-fixture-password', role: 'player'};
  const files = new Map([
    ['dev-account.json', JSON.stringify(primary)],
    ['dev-accounts.json', '\uFEFF' + JSON.stringify({schemaVersion: 1, accounts: [extra]})],
    ['dev-player-account.json', JSON.stringify(player)],
  ]);
  for (const [file, contents] of files) await fs.writeFile(path.join(accountRoot, file), contents);
  let instance, base;
  const stop = async () => { if (instance) { const old = instance; instance = null; old.closeStreams(); await new Promise(resolve => old.server.close(resolve)); } };
  t.after(async () => { await stop(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, {recursive: true, force: true}); });
  const start = async () => {
    instance = await createDevServer({root, accountRoot, driverFactory: null});
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${instance.server.address().port}`;
  };
  await start(); assert.equal(instance.accountCount, 3);
  const bootstrap = [primary, extra, player];
  const changed = await Promise.all(bootstrap.map((account, index) => request(base, '/api/change-password',
    {body: {username: account.username, oldPassword: account.password, newPassword: `source-fixture-password-${index}`}})));
  assert.deepEqual(changed.map(response => response.status), [200, 200, 200]);
  for (const [file, contents] of files) assert.equal(await fs.readFile(path.join(accountRoot, file), 'utf8'), contents);
  assert.equal((await fs.readdir(path.join(accountRoot, 'credentials'))).length, 3);
  await stop(); await start();
  for (let index = 0; index < bootstrap.length; index++) {
    const account = bootstrap[index];
    assert.equal((await request(base, '/api/login', {body: account})).status, 401);
    const loggedIn = await request(base, '/api/login', {body: {username: account.username, password: `source-fixture-password-${index}`}});
    assert.equal(loggedIn.status, 200); assert.equal(loggedIn.json.role, index === 0 ? 'gm' : 'player');
  }
});

test('password changes and login share failed-attempt limits and ignore untrusted forwarding headers', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.change(accounts[0].username, 'wrong', 'new-fixture-password', {'X-Real-IP': `203.0.113.${i}`})).status, 401);
    assert.equal((await f.login(accounts[0].username, 'wrong', {'CF-Connecting-IP': `203.0.113.${i}`})).status, 401);
  }
  assert.equal((await f.change(accounts[0].username, accounts[0].password, 'new-fixture-password')).status, 429);
  assert.equal((await f.login(accounts[0].username, accounts[0].password)).status, 429);
});

test('invalid credential archives fail closed instead of restoring a bootstrap password', async t => {
  const accountRoot = await temporary(t), directory = path.join(accountRoot, 'credentials'); await fs.mkdir(directory);
  const file = path.join(directory, `${key(accounts[0].username)}.json`);
  for (const archive of [{}, {schemaVersion: 1, algorithm: 'scrypt', salt: '00'.repeat(16), passwordHash: '00'.repeat(32), password: 'plaintext'},
    {schemaVersion: 1, algorithm: 'scrypt', salt: ['00'.repeat(16)], passwordHash: '00'.repeat(32)}]) {
    await fs.writeFile(file, JSON.stringify(archive));
    await assert.rejects(createCredentialsStore({accountRoot}).initialize(accounts), /invalid-credential-archive/);
  }
});
