import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { createDevServer } from '../../apps/server/dev-server.mjs';

const publicOrigin = 'https://fixture.trycloudflare.com';
const credentials = { username: 'fixture', password: 'fixture-secret' };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-public-'));
  const assetRoot = path.join(root, 'readonly-input');
  await mkdir(assetRoot);
  await writeFile(path.join(assetRoot, 'sample.glb'), 'MODEL');
  const { server } = await createDevServer({ root, assetRoot, publicOrigin, credentials });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = headers => fetch(url + '/api/login', {
    method: 'POST', headers, body: JSON.stringify(credentials),
  });
  return { url, login };
}

test('public sharing pins HTTPS origin, rejects missing/foreign/spoofed origins, and sets Secure cookies', async t => {
  const { url, login } = await fixture(t);
  assert.equal((await login({})).status, 403);
  assert.equal((await login({ origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await login({ origin: 'https://foreign.invalid', host: 'foreign.invalid', 'x-forwarded-proto': 'https' })).status, 403);
  assert.equal((await fetch(url + '/assets/sample.glb')).status, 401);
  const response = await login({ origin: publicOrigin });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal(await (await fetch(url + '/assets/sample.glb', { headers: { cookie } })).text(), 'MODEL');
  assert.equal((await (await fetch(url + '/api/session', { headers: { cookie } })).json()).traceExport, 'download');
  assert.equal((await fetch(url + '/api/traces', { method: 'POST', headers: { cookie, origin: publicOrigin }, body: '{}' })).status, 403);
  const logout = await fetch(url + '/api/logout', { method: 'POST', headers: { cookie, origin: publicOrigin } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /; Secure/);
  assert.equal((await fetch(url + '/assets/sample.glb', { headers: { cookie } })).status, 401);
});

test('login throttling behind cloudflared separates visitor IPs', async t => {
  const { url, login } = await fixture(t);
  const headers = { origin: publicOrigin, 'cf-connecting-ip': '192.0.2.1' };
  for (let i = 0; i < 10; i++) {
    assert.equal((await fetch(url + '/api/login', { method: 'POST', headers, body: '{}' })).status, 401);
  }
  assert.equal((await login(headers)).status, 429);
  assert.equal((await login({ origin: publicOrigin, 'cf-connecting-ip': '192.0.2.2' })).status, 200);
});

test('public origin configuration requires an exact HTTPS origin', async () => {
  for (const value of ['http://fixture.invalid', 'https://fixture.invalid/path', 'https://fixture.invalid/']) {
    await assert.rejects(createDevServer({ publicOrigin: value, credentials }), /invalid-public-origin/);
  }
});

test('public compression preserves resource bytes, respects gzip refusal, and retains authentication', async t => {
  // Independent literal fixture: compression must round-trip exactly, including Unicode.
  const text = JSON.stringify({ message: '\uac11\uac19\uac0e\uac04\uac23\uac21'.repeat(1000) });
  const root = await mkdtemp(path.join(os.tmpdir(), 'rf-gzip-'));
  const { server } = await createDevServer({ root, publicOrigin, credentials });
  await mkdir(path.join(root, 'artifacts'));
  await writeFile(path.join(root, 'artifacts/sample.json'), text);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/login', { method: 'POST', headers: { origin: publicOrigin }, body: JSON.stringify(credentials) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const raw = encoding => new Promise((resolve, reject) => {
    http.get(base + '/assets/sample.json', { headers: { cookie, 'accept-encoding': encoding } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, data: Buffer.concat(chunks) }));
      res.on('error', reject);
    }).on('error', reject);
  });
  const zipped = await raw('gzip');
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.headers.vary, 'Accept-Encoding');
  assert.equal(zipped.headers['content-length'], undefined);
  assert.equal(gunzipSync(zipped.data).toString('utf8'), text);
  assert.ok(zipped.data.length < Buffer.byteLength(text));
  const plain = await raw('gzip;q=0');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.data.toString('utf8'), text);
  assert.equal((await fetch(base + '/assets/sample.json', { headers: { 'accept-encoding': 'gzip' } })).status, 401);
});
