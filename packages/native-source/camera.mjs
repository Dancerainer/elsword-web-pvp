/** Browser/Node bridge to unchanged V5 C++ functions; no tracking math in JS. */
export const nativeCameraContract = Object.freeze({
  schema: 1,
  referenceCommit: 'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
  evidenceClass: 'reference-V5-not2016',
  targetClientMeasured: false,
  outputFloats: 22,
  rendererBoundary: 'D3DXMatrixLookAtLH and SetViewTransform are disabled sinks',
});

function number(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new TypeError(`${label} must be a finite binary32 number`);
  return value;
}

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${label} requires 3 numbers`);
  return value.map((v, i) => number(v, `${label}[${i}]`));
}

export function createNativeCameraBridge(instanceOrExports) {
  const exports = instanceOrExports.exports ?? instanceOrExports;
  for (const name of ['camera_init', 'camera_point', 'camera_set_tracking', 'camera_advance',
    'camera_output_ptr', 'camera_output_count']) {
    if (typeof exports[name] !== 'function') throw new TypeError(`Missing native camera export ${name}`);
  }
  if (!(exports.memory instanceof WebAssembly.Memory)) throw new TypeError('Native camera requires exported memory');
  if (exports.camera_output_count() !== nativeCameraContract.outputFloats)
    throw new TypeError('Native camera output ABI mismatch');

  function snapshot() {
    const ptr = exports.camera_output_ptr();
    if (!Number.isInteger(ptr) || ptr < 0 || ptr % 4 !== 0 ||
        ptr + nativeCameraContract.outputFloats * 4 > exports.memory.buffer.byteLength)
      throw new RangeError('Native camera output pointer is out of bounds');
    const values = Array.from(new Float32Array(exports.memory.buffer, ptr, nativeCameraContract.outputFloats));
    return {
      eye: values.slice(0, 3), target: values.slice(3, 6), up: values.slice(6, 9),
      eyeVelocity: values.slice(9, 12), targetVelocity: values.slice(12, 15),
      eyeSeconds: values[15], targetSeconds: values[16], upsideDownSeconds: values[17],
      boundaryCalls: { matrix: values[18], view: values[19], shake: values[20], impact: values[21] },
    };
  }
  function pointArgs({ eye, target, up = [0, 1, 0] }) {
    return [...vector(eye, 'eye'), ...vector(target, 'target'), ...vector(up, 'up')];
  }
  return Object.freeze({
    contract: nativeCameraContract,
    init(state) { exports.camera_init(...pointArgs(state)); return snapshot(); },
    point(state) { exports.camera_point(...pointArgs(state)); return snapshot(); },
    setTracking({ eye, target, eyeSeconds, targetSeconds = 0 }) {
      exports.camera_set_tracking(...vector(eye, 'eye'), ...vector(target, 'target'),
        number(eyeSeconds, 'eyeSeconds'), number(targetSeconds, 'targetSeconds'));
      return snapshot();
    },
    advance(seconds) {
      number(seconds, 'seconds');
      if (seconds < 0) throw new RangeError('Elapsed seconds must be nonnegative');
      exports.camera_advance(seconds);
      return snapshot();
    },
    snapshot,
    translate(offset){
      if(typeof exports.camera_translate!=='function')throw new TypeError('Native camera translation bridge missing');
      exports.camera_translate(...vector(offset,'camera offset'));return snapshot();
    },
  });
}

export async function instantiateNativeCamera(bytesOrModule) {
  const result = await WebAssembly.instantiate(bytesOrModule, {});
  return createNativeCameraBridge(result.instance ?? result);
}
