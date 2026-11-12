import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { instantiateNativeCamera, createNativeCameraBridge } from '../../packages/native-source/camera.mjs';

const bytes = await readFile(process.argv[2]);
const native = await WebAssembly.instantiate(bytes, {});
const exports = native.instance.exports;
const camera = createNativeCameraBridge(native.instance);
let cases = 0;
const reset = () => camera.init({ eye: [0, 0, 1500], target: [0, 100, 0] });
const track = (eyeSeconds, targetSeconds = 0) => camera.setTracking({
  eye: [100, 0, 1500], target: [100, 100, 0], eyeSeconds, targetSeconds,
});
function check(name, state, eyeX, targetX, eyeSeconds, targetSeconds, upY = 1) {
  assert.equal(state.eye[0], eyeX, `${name}: eye`);
  assert.equal(state.target[0], targetX, `${name}: target`);
  assert.equal(state.eyeSeconds, eyeSeconds, `${name}: eye timer`);
  assert.equal(state.targetSeconds, targetSeconds, `${name}: target timer`);
  assert.equal(state.up[1], upY, `${name}: up vector`);
  ++cases;
  console.log(JSON.stringify({ case: name, passed: true, state }));
}
reset(); track(.5);
check('shared-tracking-half', camera.advance(.25), 50, 50, .25, 0);
check('shared-tracking-end', camera.advance(.25), 100, 100, 0, 0);
reset(); track(1, .5);
check('separate-target-timer', camera.advance(.25), 25, 25, .75, .25);
check('target-timer-ended', camera.advance(.25), 50, 50, .5, 0);
check('target-resumes-shared-eye-timer', camera.advance(.25), 75, 75, .25, 0);
reset(); track(0);
check('zero-tracking-does-not-point', camera.advance(.25), 0, 0, 0, 0);
reset(); track(.125);
check('elapsed-overrun-is-not-clamped', camera.advance(.25), 200, 200, 0, 0);
reset(); track(2 ** -24);
check('original-IsSamef-epsilon-gate', camera.advance(.125), 0, 0, 2 ** -24, 0);
reset(); track(.5);
check('zero-elapsed-state', camera.advance(0), 0, 0, .5, 0);
reset(); exports.camera_test_upside_down(.25);
check('original-upside-down-timer', camera.advance(.125), 0, 0, 0, 0, -1);
check('original-upside-down-expiry', camera.advance(.125), 0, 0, 0, 0);

camera.point({ eye: [9, 8, 7], target: [6, 5, 4] });
assert.deepEqual(camera.snapshot().eye, [9, 8, 7]);
assert.equal(camera.snapshot().eyeSeconds, 0);
const isolated = await instantiateNativeCamera(bytes);
isolated.init({ eye: [1, 2, 3], target: [4, 5, 6] });
assert.deepEqual(camera.snapshot().eye, [9, 8, 7]);
assert.deepEqual(isolated.snapshot().eye, [1, 2, 3]);
const copy = camera.snapshot(); copy.eye[0] = 999;
assert.deepEqual(camera.snapshot().eye, [9, 8, 7]);
assert.throws(() => camera.advance(-1), RangeError);
assert.throws(() => camera.advance(Infinity), TypeError);
assert.throws(() => camera.advance(1e300), TypeError);
assert.throws(() => camera.point({ eye: [1], target: [1, 2, 3] }), TypeError);
assert.throws(() => createNativeCameraBridge({}), /Missing native camera export/);
console.log(JSON.stringify({ success: true, sourceCases: cases, bridgeChecks: 10,
  imports: WebAssembly.Module.imports(native.module),
  exports: WebAssembly.Module.exports(native.module) }));
