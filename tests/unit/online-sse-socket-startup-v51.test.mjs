import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnlineClient} from '../../apps/web/online-client.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
const response = value => ({ok: true, status: 200, json: async () => value});
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture(t, {eventTransport = 'sse'} = {}) {
  t.mock.method(globalThis, 'setInterval', () => 1); t.mock.method(globalThis, 'clearInterval', () => {});
  const sources = [], sockets = [], statuses = [], polls = [], opens = [], events = [];
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); sources.push(this); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, data = {}) { this.listeners.get(type)?.({type, data: JSON.stringify(data)}); }
    close() { this.closed = true; }
  }
  class Socket {
    constructor(url) { this.url = url; this.bufferedAmount = 0; sockets.push(this); }
    close() { this.closed = true; }
  }
  const client = createOnlineClient({EventSource: Source, WebSocket: Socket, RTCPeerConnection: null, eventTransport,
    pageInitToken: 'first-page-identity', timers: {setTimeout() { return 1; }, clearTimeout() {}},
    onEvent(type, value) { events.push({type, value}); }, fetch: async url => {
      if (url === '/api/online/status' || url === '/api/online/poll/open' || url.startsWith('/api/online/poll?')) {
        const gate = deferred(); (url.endsWith('/status') ? statuses : url.endsWith('/open') ? opens : polls).push(gate); return gate.promise;
      }
      return response({ok: true});
    }});
  t.after(() => client.close());
  return {client, sources, sockets, statuses, opens, polls, events};
}

test('a fast status response cannot start WS before the authenticated SSE lease opens', async t => {
  const f = fixture(t), opening = f.client.open();
  f.statuses[0].resolve(response({available: true})); await opening;
  assert.equal(f.sockets.length, 0, 'status is not evidence that the server installed the SSE lease');
  f.sources[0].emit('open'); assert.equal(f.sockets.length, 1);
  assert.ok(f.sockets[0].url.includes('pageInitToken=first-page-identity'));
});

test('an opened SSE lease starts WS immediately even while the independent status request is pending', async t => {
  const f = fixture(t), opening = f.client.open();
  f.sources[0].emit('open'); assert.equal(f.sockets.length, 1);
  f.statuses[0].resolve(response({available: true})); await opening;
  assert.equal(f.sockets.length, 1);
});

test('retired SSE open and late status completion cannot open WS for a replacement page identity', async t => {
  const f = fixture(t), first = f.client.open(), old = f.sources[0];
  f.client.close(); f.client.setPageInitToken('replacement-page-identity');
  const second = f.client.open(); old.emit('open');
  f.statuses[0].resolve(response({available: true})); await first;
  assert.equal(f.sockets.length, 0);
  f.sources[1].emit('open'); assert.equal(f.sockets.length, 1);
  assert.ok(f.sockets[0].url.includes('pageInitToken=replacement-page-identity'));
  f.statuses[1].resolve(response({available: true})); await second;
  old.emit('open'); assert.equal(f.sockets.length, 1);
});

test('duplicate SSE open/reconnect notifications keep one WS and a closed page cannot resurrect it', async t => {
  const f = fixture(t), opening = f.client.open();
  f.sources[0].emit('open'); f.sources[0].emit('open');
  f.statuses[0].resolve(response({available: true})); await opening;
  f.sources[0].emit('open'); assert.equal(f.sockets.length, 1);
  f.client.close(); f.sources[0].emit('open'); assert.equal(f.sockets.length, 1); assert.equal(f.sockets[0].closed, true);
});

test('poll transport still starts WS only after its authenticated lease is acknowledged', async t => {
  const f = fixture(t, {eventTransport: 'poll'}), opening = f.client.open();
  assert.equal(f.sources.length, 0); assert.equal(f.sockets.length, 0);
  f.opens[0].resolve(response({connectionId: 'authenticated-poll-lease', cursor: 0})); await opening; await settle();
  assert.equal(f.sockets.length, 1); assert.equal(f.polls.length, 1);
});
