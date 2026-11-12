import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createDevServer} from '../../apps/server/dev-server.mjs';
import {createCredentialsStore} from '../../apps/server/credentials-store.mjs';

const gm = {username: 'fixture-gm', role: 'gm', password: 'admin-fixture-password'};
const player = {username: 'existing-player', password: 'player-fixture-password'};
const key = username => createHash('sha256').update(username).digest('hex');
const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-admin-create-')), accountRoot = path.join(root, 'accounts');
  let instance, base, gmCookie;
  const stop = async () => {
    if (!instance) return;
    const old = instance; instance = null; old.closeStreams(); await new Promise(resolve => old.server.close(resolve));
  };
  t.after(async () => {
    await stop(); assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, {recursive: true, force: true});
  });
  const start = async () => {
    instance = await createDevServer({root, accountRoot, credentials: gm, additionalCredentials: [player], driverFactory: null, ...options});
    await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${instance.server.address().port}`;
    const login = await request(base, '/api/login', {body: gm}); assert.equal(login.status, 200); gmCookie = cookieOf(login);
  };
  await start();
  return {root, accountRoot, start, stop, get instance() {return instance;}, get gmCookie() {return gmCookie;},
    call: (route, value) => request(base, route, value),
    create: (username, password, headers = {}) => request(base, '/api/admin/accounts', {body: {username, password}, headers: {cookie: gmCookie, ...headers}}),
    list: () => request(base, '/api/admin/accounts', {method: 'GET', headers: {cookie: gmCookie}}),
    login: (username, password) => request(base, '/api/login', {body: {username, password}})};
}

test('only an authenticated same-origin GM can create accounts; request role injection cannot grant GM', async t => {
  const f = await fixture(t);
  const body = {username: 'new-fixture-player', password: 'new-fixture-password'};
  assert.deepEqual((await f.call('/api/admin/accounts', {body})).json, {error: 'login-required'});
  assert.equal((await f.call('/api/admin/accounts', {body})).status, 401);
  const playerCookie = cookieOf(await f.login(player.username, player.password));
  const forbidden = await f.call('/api/admin/accounts', {body, headers: {cookie: playerCookie}});
  assert.equal(forbidden.status, 403); assert.equal(forbidden.json.error, 'gm-required');
  const foreign = await f.create(body.username, body.password, {origin: 'http://foreign.invalid'});
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error, 'origin-denied');
  const injected = await f.call('/api/admin/accounts', {body: {...body, role: 'gm'}, headers: {cookie: f.gmCookie}});
  assert.equal(injected.status, 400); assert.equal(injected.json.error, 'invalid-account');
  assert.equal(f.instance.accountCount, 2);
  assert.equal((await f.create(body.username, body.password)).status, 201);
  const login = await f.login(body.username, body.password); assert.equal(login.status, 200); assert.equal(login.json.role, 'player');
  assert.equal((await f.call('/api/admin/accounts', {method: 'GET', headers: {cookie: cookieOf(login)}})).status, 403);
});

test('new accounts trim their identity once, keep exact passwords, appear in the GM list and support nickname storage', async t => {
  const f = await fixture(t), username = '\uac25\uac1f-fixture', password = '  exact fixture password  ';
  const created = await f.create(`  ${username}  `, password);
  assert.equal(created.status, 201); assert.deepEqual(created.json, {ok: true, username, role: 'player'});
  assert.equal(created.headers['set-cookie'], undefined, 'creating a player does not replace the GM session');
  assert.equal(f.instance.accountCount, 3);
  assert.deepEqual((await f.list()).json.accounts.find(a => a.username === username), {username, role: 'player', online: false});
  assert.equal((await f.login(username, password.trim())).status, 401);
  const login = await f.login(username, password); assert.equal(login.status, 200);
  const cookie = cookieOf(login);
  const nickname = await f.call('/api/nickname-preferences', {method: 'PUT', body: {nickname: '\uac25\uac30\uac1d\uac28\uac32'}, headers: {cookie}});
  assert.equal(nickname.status, 200); assert.equal(nickname.json.nickname, '\uac25\uac30\uac1d\uac28\uac32');
  assert.equal((await f.call('/api/history', {method: 'GET', headers: {cookie}})).json.history.games, 0);
  assert.equal((await f.list()).json.accounts.find(a => a.username === username).online, true);
  assert.equal((await f.call('/api/session', {method: 'GET', headers: {cookie: f.gmCookie}})).json.role, 'gm');
});

test('creation rejects malformed, empty, control-character, overlong and duplicate identities/passwords', async t => {
  const f = await fixture(t);
  for (const body of [null, [], {}, {username: 'x'}, {username: 'x', password: '123456', extra: true}]) {
    const res = await f.call('/api/admin/accounts', {body, headers: {cookie: f.gmCookie}});
    assert.equal(res.status, 400); assert.equal(res.json.error, 'invalid-account');
  }
  for (const username of [null, 123, '', '   ', 'x'.repeat(65), 'name\ninside', 'nul\0inside']) {
    const res = await f.create(username, '123456'); assert.equal(res.status, 400); assert.equal(res.json.error, 'invalid-username');
  }
  for (const password of [null, 123, '', '12345', 'x'.repeat(129)]) {
    const res = await f.create('validation-fixture', password); assert.equal(res.status, 400); assert.equal(res.json.error, 'invalid-password');
  }
  for (const username of [gm.username, player.username, ` ${player.username} `]) {
    const res = await f.create(username, '123456'); assert.equal(res.status, 409); assert.equal(res.json.error, 'account-exists');
  }
  assert.equal((await f.call('/api/admin/accounts', {rawBody: '{', headers: {cookie: f.gmCookie}})).status, 400);
  assert.equal((await f.call('/api/admin/accounts', {method: 'PUT', headers: {cookie: f.gmCookie}})).status, 405);
  const boundary = await f.create('x'.repeat(64), 'x'.repeat(128)); assert.equal(boundary.status, 201);
  const minimum = await f.create('m', '      '); assert.equal(minimum.status, 201);
  assert.equal((await f.login('m', '      ')).status, 200);
});

test('prototype-property usernames are ordinary identities and retain their player role after restart', async t => {
  const f = await fixture(t), usernames = ['__proto__', 'constructor', 'toString'];
  for (const username of usernames) {
    assert.equal(f.instance.accountStore.role(username), null, 'unregistered object keys are not roles');
    const created = await f.create(username, 'prototype-fixture-password');
    assert.equal(created.status, 201); assert.equal(created.json.role, 'player');
    const login = await f.login(username, 'prototype-fixture-password');
    assert.equal(login.status, 200); assert.equal(login.json.role, 'player');
    assert.equal((await f.call('/api/admin/accounts', {method: 'GET', headers: {cookie: cookieOf(login)}})).status, 403);
  }
  assert.equal(f.instance.accountStore.role(gm.username), 'gm');
  await f.stop(); await f.start();
  for (const username of usernames) {
    const login = await f.login(username, 'prototype-fixture-password');
    assert.equal(login.status, 200); assert.equal(login.json.role, 'player');
    assert.deepEqual((await f.list()).json.accounts.find(a => a.username === username), {username, role: 'player', online: true});
  }
  assert.equal(f.instance.accountStore.role(gm.username), 'gm');
});

test('one archive atomically persists player identity and salted scrypt credentials, then change-password overrides survive restart', async t => {
  const f = await fixture(t), username = 'restart-fixture', password = 'create-fixture-password', next = 'changed-fixture-password';
  const marker = path.join(f.accountRoot, 'dev-account.json'); await fs.writeFile(marker, 'bootstrap untouched fixture');
  const existingCredentialDirectory = path.join(f.accountRoot, 'credentials'); await fs.mkdir(existingCredentialDirectory);
  const bootstrapOverride = path.join(existingCredentialDirectory, `${key(player.username)}.json`);
  const bootstrapChanged = await f.call('/api/change-password', {body: {username: player.username, oldPassword: player.password, newPassword: 'existing-override-password'}});
  assert.equal(bootstrapChanged.status, 200); const overrideBytes = await fs.readFile(bootstrapOverride, 'utf8');
  assert.equal((await f.create(username, password)).status, 201);
  const archivedPath = path.join(f.accountRoot, 'created-accounts', `${key(username)}.json`), text = await fs.readFile(archivedPath, 'utf8');
  const archived = JSON.parse(text);
  assert.deepEqual(Object.keys(archived).sort(), ['algorithm', 'passwordHash', 'role', 'salt', 'schemaVersion', 'username']);
  assert.equal(archived.role, 'player'); assert.equal(archived.algorithm, 'scrypt'); assert.equal(archived.schemaVersion, 1);
  assert.match(archived.salt, /^[a-f0-9]{32}$/); assert.match(archived.passwordHash, /^[a-f0-9]{64}$/); assert.equal(text.includes(password), false);
  const changed = await f.call('/api/change-password', {body: {username, oldPassword: password, newPassword: next}});
  assert.equal(changed.status, 200); assert.equal(await fs.readFile(archivedPath, 'utf8'), text, 'override does not rewrite player identity');
  assert.equal(await fs.readFile(bootstrapOverride, 'utf8'), overrideBytes, 'other account hashes stay byte-identical');
  assert.equal(await fs.readFile(marker, 'utf8'), 'bootstrap untouched fixture');
  const newOverrideText = await fs.readFile(path.join(f.accountRoot, 'credentials', `${key(username)}.json`), 'utf8');
  assert.equal(newOverrideText.includes(next), false);
  await f.stop(); await f.start();
  assert.equal((await f.login(username, password)).status, 401);
  const login = await f.login(username, next); assert.equal(login.status, 200); assert.equal(login.json.role, 'player');
  assert.equal((await f.login(player.username, 'existing-override-password')).status, 200);
  assert.equal((await f.create(username, password)).status, 409);
  assert.equal((await fs.readdir(path.dirname(archivedPath))).length, 1);
  assert.equal((await f.call(`/created-accounts/${key(username)}.json`, {method: 'GET', headers: {cookie: f.gmCookie}})).status, 404);
});

test('concurrent duplicate creation commits exactly one identity and password', async t => {
  const f = await fixture(t), username = 'concurrent-fixture';
  const passwords = ['concurrent-password-a', 'concurrent-password-b'];
  const results = await Promise.all(passwords.map(password => f.create(username, password)));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const winner = results.findIndex(r => r.status === 201);
  assert.equal((await f.login(username, passwords[1 - winner])).status, 401);
  assert.equal((await f.login(username, passwords[winner])).status, 200);
  assert.equal(f.instance.accountCount, 3);
  assert.equal((await fs.readdir(path.join(f.accountRoot, 'created-accounts'))).length, 1);
});

test('failed creation publishes no identity, password or role; restart does not resurrect the failed account', async t => {
  let fail = true;
  const fileSystem = {...fs, rename: async (from, to) => {
    if (fail && path.basename(path.dirname(to)) === 'created-accounts') throw Object.assign(Error('fixture persistence failure'), {code: 'EIO'});
    return fs.rename(from, to);
  }};
  const f = await fixture(t, {credentialsFileSystem: fileSystem}), username = 'failed-fixture', password = 'failed-fixture-password';
  const res = await f.create(username, password); assert.equal(res.status, 503); assert.equal(res.json.error, 'account-save-failed');
  assert.equal(f.instance.accountCount, 2); assert.equal(f.instance.accountStore.role(username), null);
  assert.equal((await f.list()).json.accounts.some(a => a.username === username), false);
  assert.equal((await f.login(username, password)).status, 401);
  assert.deepEqual(await fs.readdir(path.join(f.accountRoot, 'created-accounts')), []);
  await f.stop(); await f.start(); assert.equal(f.instance.accountCount, 2); assert.equal((await f.login(username, password)).status, 401);
  fail = false; assert.equal((await f.create(username, password)).status, 201); assert.equal((await f.login(username, password)).status, 200);
});

test('login waits for an in-flight creation and sees the role only after the archive commits', async t => {
  let entered, unblock;
  const enteredPromise = new Promise(resolve => {entered = resolve;}), gate = new Promise(resolve => {unblock = resolve;});
  const fileSystem = {...fs, rename: async (from, to) => {
    if (path.basename(path.dirname(to)) === 'created-accounts') {entered(); await gate;}
    return fs.rename(from, to);
  }};
  const f = await fixture(t, {credentialsFileSystem: fileSystem}), username = 'waiting-fixture', password = 'waiting-fixture-password';
  const creating = f.create(username, password); await enteredPromise;
  assert.equal(f.instance.accountStore.role(username), null); assert.equal(f.instance.accountCount, 2);
  let finished = false; const loggingIn = f.login(username, password).then(r => {finished = true; return r;});
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(finished, false);
  unblock(); assert.equal((await creating).status, 201);
  const login = await loggingIn; assert.equal(login.status, 200); assert.equal(login.json.role, 'player');
});

test('corrupt, mismatched or privileged created archives fail closed and uncommitted temporaries stay invisible', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rf-created-corrupt-')), directory = path.join(root, 'created-accounts');
  t.after(async () => {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(root, {recursive: true, force: true});});
  const store = createCredentialsStore({accountRoot: root}); await store.initialize([gm, player]);
  await store.createPlayer('archive-fixture', 'archive-fixture-password');
  const filename = path.join(directory, `${key('archive-fixture')}.json`), good = JSON.parse(await fs.readFile(filename, 'utf8'));
  for (const bad of [{...good, role: 'gm'}, {...good, username: 'different-fixture'}, {...good, passwordHash: 'invalid'}, {...good, password: 'plaintext'}]) {
    await fs.writeFile(filename, JSON.stringify(bad));
    await assert.rejects(createCredentialsStore({accountRoot: root}).initialize([gm, player]));
  }
  await fs.rm(filename); await fs.writeFile(filename + '.uncommitted.tmp', JSON.stringify(good));
  const recovered = createCredentialsStore({accountRoot: root}); await recovered.initialize([gm, player]);
  assert.equal(recovered.size, 2); assert.equal(await recovered.verify('archive-fixture', 'archive-fixture-password'), false);
});
