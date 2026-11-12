import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {gzipSync} from 'node:zlib';
import {createCapacityTcpProxy} from '../../tools/validation/network-capacity-proxy-v51.mjs';

async function fixture(handler, options = {}) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); handler(socket);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = await createCapacityTcpProxy({upstreamPort: server.address().port, players: 1, oneWayMs: 5, ...options});
  return {proxy, async close() { await proxy.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }};
}

function exchange(port, parts, {halfClose = false} = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [], client = net.connect({host: '127.0.0.1', port});
    client.on('error', reject); client.on('data', chunk => chunks.push(chunk));
    client.once('connect', async () => {
      for (const part of parts) { client.write(part); await new Promise(resolve => setImmediate(resolve)); }
      if (halfClose) client.end();
    });
    client.on('end', () => client.end()); client.once('close', () => resolve(Buffer.concat(chunks)));
  });
}

test('capacity frontiers preserve raw gzip/HTTP bytes and expose only the first pathname', {timeout: 5000}, async () => {
  const compressed = gzipSync(Buffer.from('event: owned-state\ndata: {"actionId":641}\n\n'.repeat(80)));
  const response = Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: ${compressed.length}\r\nConnection: close\r\n\r\n`), compressed]);
  const parts = ['GET /api/events?token=query-secret#fragment-secret HT', 'TP/1.1\r\nCookie: private-cookie\r\nAuthorization: Bearer private-auth\r\n\r\n'];
  const receivedRequests = [];
  const f = await fixture(socket => {
    let request = '';
    socket.on('data', chunk => { receivedRequests.push(chunk); request += chunk.toString(); if (request.includes('\r\n\r\n')) socket.end(response); });
  });
  try {
    assert.deepEqual(await exchange(f.proxy.ports[0], parts), response);
    assert.equal(Buffer.concat(receivedRequests).toString(), parts.join(''));
    const snapshot = f.proxy.snapshot(), up = snapshot.flows.find(row => row.direction === 'up'), down = snapshot.flows.find(row => row.direction === 'down');
    assert.equal(up.connectionId, down.connectionId);
    for (const [flow, bytes] of [[up, Buffer.byteLength(parts.join(''))], [down, response.length]]) {
      assert.equal(flow.firstRequestPath, '/api/events');
      assert.equal(flow.sourceBytes, bytes); assert.equal(flow.writeBytes, bytes); assert.equal(flow.bytes, bytes);
      assert.equal(flow.writeCallbackBytes, bytes); assert.equal(flow.writeCallbackErrorBytes, 0);
      assert.equal(flow.pendingWriteCallbackBytes, 0); assert.equal(flow.writeCallbackCalls, flow.writeCalls);
      assert.equal(flow.socketBytesWritten, bytes);
      assert.ok(flow.maxWriteCallbackWaitMs >= 0); assert.ok(flow.maxWritableLength >= flow.writableLength);
      assert.equal(typeof flow.writableNeedDrain, 'boolean');
    }
    const json = JSON.stringify(snapshot);
    for (const secret of ['query-secret', 'fragment-secret', 'private-cookie', 'private-auth']) assert.equal(json.includes(secret), false);
    assert.match(snapshot.diagnostics.byteSemantics, /NOT receiver receipt/);
  } finally { await f.close(); }
});

test('100ms frontier sampling is bounded and explicit about dropped samples while a half-close tail drains', {timeout: 5000}, async () => {
  const payload = Buffer.alloc(40 * 1024, 0x51);
  const f = await fixture(socket => socket.once('data', () => socket.end(payload)),
    {egressBytesPerSecond: 64000, maxDiagnosticSamples: 3, queueHighWater: 4096, jitterMs: 2, jitterSeed: 17});
  try {
    assert.deepEqual(await exchange(f.proxy.ports[0], ['GET /tail HTTP/1.1\r\n\r\n'], {halfClose: true}), payload);
    const snapshot = f.proxy.snapshot(), diagnostics = snapshot.diagnostics;
    assert.equal(diagnostics.sampleIntervalMs, 100); assert.equal(diagnostics.maxSamples, 3);
    assert.equal(diagnostics.samples.length, 3); assert.ok(diagnostics.droppedSamples > 0);
    assert.deepEqual(diagnostics.samples.map(row => row.atMonoMs), diagnostics.samples.map(row => row.atMonoMs).sort((a, b) => a - b));
    for (const sample of diagnostics.samples) {
      assert.ok(sample.sourceBytes >= sample.writeBytes);
      assert.ok(sample.writeBytes >= sample.writeCallbackBytes + sample.writeCallbackErrorBytes);
      assert.equal(sample.pendingWriteCallbackBytes, sample.writeBytes - sample.writeCallbackBytes - sample.writeCallbackErrorBytes);
    }
    const down = snapshot.flows.find(row => row.direction === 'down');
    assert.equal(down.writeCallbackBytes, payload.length); assert.equal(down.abortedQueuedBytes, 0);
    assert.ok(down.maxQueueBytes > 0); assert.equal(down.queuedBytes, 0);
  } finally { await f.close(); }
});

test('oversized request identification stops without changing or logging its stream bytes', {timeout: 5000}, async () => {
  const request = 'GET /' + 'private-query'.repeat(200) + '?hidden=yes HTTP/1.1\r\nCookie: hidden-cookie\r\n\r\n';
  const received = [];
  const f = await fixture(socket => {
    let size = 0;
    socket.on('data', chunk => { received.push(chunk); size += chunk.length; if (size === Buffer.byteLength(request)) socket.end('ok'); });
  });
  try {
    assert.equal((await exchange(f.proxy.ports[0], [request.slice(0, 1000), request.slice(1000)])).toString(), 'ok');
    assert.equal(Buffer.concat(received).toString(), request);
    const snapshot = f.proxy.snapshot();
    for (const flow of snapshot.flows) { assert.equal(flow.firstRequestPath, null); assert.equal(flow.pathStatus, 'request-line-limit'); }
    assert.equal(JSON.stringify(snapshot).includes('private-query'), false);
    assert.equal(JSON.stringify(snapshot).includes('hidden-cookie'), false);
  } finally { await f.close(); }
});

test('invalid diagnostic bounds are rejected before listening or scheduling work', async () => {
  for (const maxDiagnosticSamples of [0, -1, 1.5, Infinity, 131073]) {
    await assert.rejects(createCapacityTcpProxy({maxDiagnosticSamples}), /maxDiagnosticSamples/);
  }
});
