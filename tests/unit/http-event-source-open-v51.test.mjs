import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpEventSourceClass as peerSource} from '../../tools/http-event-source-peer.mjs';
import {createHttpEventSourceClass as roomSource} from '../../tools/http-event-source-room-v5.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return {promise, resolve}; };
for (const [name, factory] of [['peer', peerSource], ['room-v5', roomSource]]) {
  test(`${name} EventSource emits real open before payload on each successful connection`, async () => {
    let attempts = 0, propertyOpens = 0, listenerOpens = 0;
    const order = [], Source = factory({request: async () => {
      const id = ++attempts; let sent = false;
      return {ok: true, status: 200, body: {getReader: () => ({
        read: async () => sent ? {done: true} : (sent = true, {done: false, value: Buffer.from(`retry: 0\ndata: ${id}\n\n`)}),
        cancel: async () => {},
      })}};
    }});
    const source = new Source('/events');
    source.onopen = event => { assert.equal(event.type, 'open'); assert.equal(source.readyState, 1); propertyOpens++; order.push('property-open'); };
    source.addEventListener('open', event => { assert.equal(event.type, 'open'); listenerOpens++; order.push('listener-open'); });
    source.addEventListener('message', event => { order.push(event.data); if (event.data === '2') source.close(); });
    await source.task;
    assert.equal(propertyOpens, 2); assert.equal(listenerOpens, 2);
    assert.deepEqual(order, ['property-open', 'listener-open', '1', 'property-open', 'listener-open', '2']);
    assert.equal(source.metrics.events, 2, 'open is a transport event, not a decoded SSE payload');
  });

  test(`${name} EventSource ignores a successful response after local close`, async () => {
    const gate = deferred(); let opened = 0, cancelled = 0, read = 0;
    const Source = factory({request: () => gate.promise}), source = new Source('/events');
    source.addEventListener('open', () => opened++); source.close();
    gate.resolve({ok: true, status: 200, body: {cancel: async () => { cancelled++; }, getReader() { read++; throw Error('retired-reader'); }}});
    await source.task;
    assert.equal(opened, 0); assert.equal(read, 0); assert.equal(cancelled, 1); assert.equal(source.readyState, 2);
  });

  test(`${name} EventSource does not announce a lease for HTTP 204`, async () => {
    let opened = 0;
    const Source = factory({request: async () => ({ok: true, status: 204})}), source = new Source('/events');
    source.addEventListener('open', () => opened++); await source.task;
    assert.equal(opened, 0); assert.equal(source.readyState, 2);
  });
}
