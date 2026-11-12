/** Copy the complete plain-data observation graph without serializing it through
 * the platform clone bridge on every remote contact. Combat state is composed
 * of records and arrays; preserve aliases, cycles, sparse slots and primitive
 * values. An extension containing another object type uses the original whole-
 * graph structured clone instead, including its original cloning exceptions.
 * This is internal simulation data, not a general clone API for accessors or
 * proxies supplied by application code.
 */
const unsupported = Symbol('non-plain observation data');

export function copyObservationState(value) {
  const copies = new Map();
  function copy(source) {
    if (source === null) return null;
    const type = typeof source;
    if (type !== 'object') {
      if (type === 'function' || type === 'symbol') throw unsupported;
      return source;
    }
    const previous = copies.get(source);
    if (previous !== undefined) return previous;
    let target;
    if (Array.isArray(source)) target = new Array(source.length);
    else {
      const prototype = Object.getPrototypeOf(source);
      if (prototype !== Object.prototype && prototype !== null) throw unsupported;
      target = {};
    }
    copies.set(source, target);
    for (const key of Object.keys(source)) {
      const next = copy(source[key]);
      if (key === '__proto__') Object.defineProperty(target, key, {
        value: next, enumerable: true, writable: true, configurable: true,
      });
      else target[key] = next;
    }
    return target;
  }
  try { return copy(value); }
  catch (error) {
    if (error !== unsupported) throw error;
    return structuredClone(value);
  }
}
