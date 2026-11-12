import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const wasmPath = process.argv[2];
if (!wasmPath) throw new Error('Usage: node tools/native/run_camera_wasi.mjs <camera-harness.wasm>');
const wasi = new WASI({ version: 'preview1', args: ['camera-source-harness'], env: {},
  preopens: {}, returnOnExit: true });
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {
  wasi_snapshot_preview1: wasi.wasiImport,
});
process.exitCode = wasi.start(instance);
