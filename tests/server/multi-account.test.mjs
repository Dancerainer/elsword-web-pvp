import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDevServer } from '../../apps/server/dev-server.mjs';

test('persistent extra test accounts retain the original account and independent sessions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-accounts-'));
  await mkdir(path.join(root, 'runtime'));
  await mkdir(path.join(root, 'artifacts'));
  await writeFile(path.join(root, 'artifacts/sample.glb'), 'MODEL');
  const credentials = { username: 'original', password: 'original-secret' };
  const extra = [
    { username: 'fixture-a', password: 'secret-a' },
    { username: 'fixture-b', password: 'secret-b' },
    { username: 'fixture-c', password: 'secret-c' },
    { username: 'fixture-d', password: 'secret-d' },
  ];
  await writeFile(path.join(root, 'runtime/dev-accounts.json'), '\uFEFF' + JSON.stringify({ schemaVersion: 1, accounts: extra }));
  const { server, accountCount } = await createDevServer({ root, credentials, accountRoot: path.join(root, 'runtime'), publicOrigin: 'https://fixture.invalid' });
  assert.equal(accountCount, 5);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = account => fetch(base + '/api/login', { method: 'POST', headers: { origin: 'https://fixture.invalid' }, body: JSON.stringify(account) });
  const cookies = [];
  for (const account of [credentials, ...extra]) {
    const response = await login(account);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).username, account.username);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    cookies.push(cookie);
    assert.equal((await (await fetch(base + '/api/session', { headers: { cookie } })).json()).username, account.username);
    assert.equal((await fetch(base + '/assets/sample.glb', { headers: { cookie } })).status, 200);
  }
  assert.equal(new Set(cookies).size, 5);
  assert.equal((await login({ username: 'fixture-a', password: 'secret-b' })).status, 401);
  assert.equal((await login({ username: 'unknown', password: 'secret-a' })).status, 401);
  await fetch(base + '/api/logout', { method: 'POST', headers: { origin: 'https://fixture.invalid', cookie: cookies[1] } });
  assert.equal((await fetch(base + '/api/session', { headers: { cookie: cookies[1] } })).status, 401);
  assert.equal((await fetch(base + '/api/session', { headers: { cookie: cookies[2] } })).status, 200);
});

test('invalid and duplicate account configuration cannot silently replace existing users', async () => {
  const credentials = { username: 'fixture', password: 'secret' };
  await assert.rejects(createDevServer({ credentials, additionalCredentials: [{ username: 'fixture', password: 'other' }] }), /duplicate-test-account/);
  await assert.rejects(createDevServer({ credentials, additionalCredentials: [{ username: 'new', password: '' }] }), /invalid-test-account/);
  await assert.rejects(createDevServer({ credentials, additionalCredentials: {} }), /invalid-test-accounts/);
});
