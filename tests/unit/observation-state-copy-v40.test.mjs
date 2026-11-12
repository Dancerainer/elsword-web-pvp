import test from 'node:test';
import assert from 'node:assert/strict';
import {copyObservationState} from '../../packages/combat-core/observation-state-copy.mjs';

test('observation copies preserve the complete plain graph, sparse arrays and primitive values', () => {
  const shared = {value: 3, nested: [NaN, Infinity, -Infinity, -0, undefined, 12n]};
  const sparse = new Array(5); sparse[2] = shared; sparse.extra = shared;
  const source = {actors: [shared, shared], effects: sparse, nil: null, omitted: undefined};
  source.self = source;
  const copy = copyObservationState(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.equal(copy.self, copy);
  assert.equal(copy.actors[0], copy.effects[2]);
  assert.equal(copy.actors[0], copy.effects.extra);
  assert.equal(0 in copy.effects, false);
  assert.equal(Object.is(copy.actors[0].nested[3], -0), true);
  copy.effects[2].nested[0] = 7;
  assert.equal(Number.isNaN(source.actors[0].nested[0]), true);
});

test('null prototypes and own __proto__ fields match the platform clone without prototype mutation', () => {
  const source = Object.create(null);
  source.__proto__ = {polluted: true}; source.a = 1;
  const copy = copyObservationState(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
  assert.equal(Object.hasOwn(copy, '__proto__'), true);
  assert.equal(copy.polluted, undefined);
});

test('extended state falls back as one graph, retaining typed-array and map aliases', () => {
  const buffer = new ArrayBuffer(8), vector = new Float32Array(buffer);
  vector[0] = 2;
  const source = {vector, buffer, same: vector, date: new Date(100), map: new Map()};
  source.map.set(source, new Set([vector]));
  const copy = copyObservationState(source);
  assert.deepEqual(copy, structuredClone(source));
  assert.equal(copy.vector.buffer, copy.buffer);
  assert.equal(copy.vector, copy.same);
  assert.equal(copy.map.get(copy).has(copy.vector), true);
  copy.vector[0] = 9; assert.equal(vector[0], 2);
});

for (const value of [() => {}, Symbol('unsupported')]) test('non-cloneable state retains DataCloneError for '+typeof value, () => {
  assert.throws(() => copyObservationState({value}), {name: 'DataCloneError'});
});

test('copy exceptions propagate without hiding the fault', () => {
  const error = new Error('fixture getter fault');
  assert.throws(() => copyObservationState({get field() {throw error;}}), value => value === error);
});
