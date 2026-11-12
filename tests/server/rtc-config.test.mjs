import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIceServers} from '../../packages/online/rtc-config.mjs';

test('ICE defaults are empty; configured STUN and authenticated TURN are validated and cloned', () => {
  assert.deepEqual(normalizeIceServers(), []);
  const input = [{urls: 'stun:stun.example.invalid:3478'}, {urls: ['turn:turn.example.invalid:3478?transport=udp', 'turns:[::1]:5349?transport=tcp'], username: 'fixture', credential: 'fixture-secret'}];
  const output = normalizeIceServers(input); assert.equal(output[0].urls[0], input[0].urls);
  output[1].urls[0] = 'changed'; assert.equal(input[1].urls[0], 'turn:turn.example.invalid:3478?transport=udp');
});
test('ICE rejects HTTP endpoints, credentials in URLs, invalid ports, unknown fields and oversized policy', () => {
  for (const value of [null, {}, [{urls: 'https://example.invalid'}], [{urls: 'turn:user:secret@host.invalid'}],
    [{urls: 'stun:host.invalid:65536'}], [{urls: 'stun:host.invalid:0'}], [{urls: []}],
    [{urls: 'stun:host.invalid', credential: {}}], [{urls: 'stun:host.invalid', hidden: true}], Array(9).fill({urls: 'stun:host.invalid'})]) {
    assert.throws(() => normalizeIceServers(value), /invalid-rtc-ice-servers/);
  }
});
