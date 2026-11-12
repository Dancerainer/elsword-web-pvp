import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {NATIVE_RUNTIME_VERSION} from '../../packages/native-source/runtime-version.mjs';

const directory=process.env.RF_NATIVE_RUNTIME_DIR??fileURLToPath(new URL('../../artifacts/native/',import.meta.url));
const manifest=JSON.parse(readFileSync(resolve(directory,'manifest.json'),'utf8'));
const map={sceneId:'source-runtime-boundary-fixture',lines:[{lineId:0,start:[-500,0,0],end:[500,0,0],type:'LT_NORMAL',nativeFields:{CAN_DOWN:false}}]};
const loadBinary=file=>readFileSync(resolve(directory,file));
const options={manifest,map,loadBinary};
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
// These deliberately owned negative fixtures need a consistent seal to reach
// the later binary/import checks. They are never published as source evidence.
function fixtureSeal(m){if(m.runtimeVersion===NATIVE_RUNTIME_VERSION){const content={...m};delete content.seal;
  m.seal.manifestContentSha256=createHash('sha256').update(canonical(content)).digest('hex');}return m;}

test('runtime loads the frozen real modules and freezes each source binary hash',async()=>{
  const loaded=[];const r=await createNativeRuntime({...options,loadBinary:file=>{loaded.push(file);return loadBinary(file);}});
  assert.deepEqual(loaded,['geometry.wasm','camera.wasm','commands.wasm','skills.wasm','skill-values.wasm','effect-random.wasm','commands-recovery.wasm','nasod.wasm','critical.wasm',
    ...(manifest.runtimeVersion===NATIVE_RUNTIME_VERSION?['mana-break.wasm']:[])]);
  assert.equal(r.versions.nativeEffectRandom,manifest.modules['effect-random'].sha256);
  for(const [key,name] of [['nativeGeometry','geometry'],['nativeCamera','camera'],['nativeCommands','commands'],['nativeSkills','skills'],['nativeSkillValues','skill-values'],['nativeCommandsRecovery','commands-recovery'],['nativeNasod','nasod'],['nativeCritical','critical']])
    assert.equal(r.versions[key],manifest.modules[name].sha256);
  if(r.manaBreak)assert.equal(r.versions.nativeManaBreak,manifest.modules['mana-break'].sha256);
  assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.versions));
  assert.equal(r.effectRandom.contract.targetClientMeasured,false);
  assert.equal(r.effectRandom.randomFloat(.7,.5,32767),Math.fround(.9),'source descending-range formula retains first bound');
});

test('HTTP without crypto.subtle loads all sealed native modules and still rejects changed manifests and binary bytes',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{}});
  try{
    const loaded=await createNativeRuntime(options);assert.equal(loaded.versions.nativeSkills,manifest.modules.skills.sha256);assert.ok(loaded.manaBreak);
    const badManifest=structuredClone(manifest);badManifest.referenceBuild='unsealed modification';
    await assert.rejects(createNativeRuntime({...options,manifest:badManifest}),/manifest seal mismatch/);
    await assert.rejects(createNativeRuntime({...options,loadBinary:file=>{const bytes=Buffer.from(loadBinary(file));if(file==='geometry.wasm')bytes[bytes.length-1]^=1;return bytes;}}),/geometry binary hash mismatch/);
  }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});

test('sixth module rejects missing record, path traversal, changed bytes and hash substitution',async()=>{
  const copy=()=>structuredClone(manifest);
  let bad=copy();delete bad.modules['effect-random'];
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad)}),/effect-random provenance|module seal inventory mismatch/);
  bad=copy();bad.modules['effect-random'].file='../effect-random.wasm';
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad)}),/effect-random provenance/);
  bad=copy();bad.modules['effect-random'].sha256='0'.repeat(64);
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad)}),/effect-random binary hash mismatch/);
  await assert.rejects(createNativeRuntime({...options,loadBinary:file=>{
    const bytes=Buffer.from(loadBinary(file));if(file==='effect-random.wasm')bytes[bytes.length-1]^=1;return bytes;
  }}),/effect-random binary hash mismatch/);
  await assert.rejects(createNativeRuntime({...options,manifest:{...manifest,runtimeVersion:'original-source-functions-v3'}}),/Unsupported/);
});

test('hash-accepted fixture with a host import is rejected before native bridge construction',async()=>{
  // Minimal import-only module: (import "env" "x" (func)); no combat oracle.
  const imported=Uint8Array.from([0,97,115,109,1,0,0,0,1,4,1,96,0,0,2,9,1,3,101,110,118,1,120,0,0]);
  const bad=structuredClone(manifest);bad.modules['effect-random'].sha256=createHash('sha256').update(imported).digest('hex');
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad),loadBinary:file=>file==='effect-random.wasm'?imported:loadBinary(file)}),/effect-random has unsupported host imports/);
});

test('two runtime instances isolate draw-count diagnostics and replay an explicit rand sequence identically',async()=>{
  const first=await createNativeRuntime(options),second=await createNativeRuntime(options);
  for(const name of ['geometry','camera','commands','skills','skillValues','effectRandom','nasod','critical',...(first.manaBreak?['manaBreak']:[])])assert.notEqual(first[name],second[name]);
  const sequence=[0,1,1234,16384,32766,32767];
  const draws=sequence.map(rand=>first.effectRandom.randomFloat(-2,3,rand));
  assert.equal(first.effectRandom.drawsUsed,1);
  assert.equal(second.effectRandom.randomFloat(.5,.5,32767),.5);assert.equal(second.effectRandom.drawsUsed,0);
  assert.equal(first.effectRandom.drawsUsed,1,'another WASM memory cannot reset this diagnostic');
  assert.deepEqual(sequence.map(rand=>second.effectRandom.randomFloat(-2,3,rand)),draws);
  assert.equal(first.effectRandom.randomInt(7,2,5),12,'original integer overload keeps descending first bound');
  assert.equal(first.effectRandom.contract.referenceCommit,manifest.referenceCommit);
});
test('current runtime rejects missing Mana, unsafe paths and drift of source/CPP/seal metadata before fetching binaries',{skip:manifest.runtimeVersion!==NATIVE_RUNTIME_VERSION},async()=>{
  const mutations=[m=>delete m.modules['mana-break'],m=>m.modules['mana-break'].file='../mana-break.wasm',
    m=>m.modules['mana-break'].sha256='0'.repeat(64),m=>m.modules['mana-break'].sourceContract='contracts/tampered.json',
    m=>m.modules['mana-break'].compilationStatus='not-compiled',
    m=>m.modules['mana-break'].compilation.translationUnitSha256='0'.repeat(64),m=>m.seal.manifestContentSha256='0'.repeat(64)];
  for(const mutate of mutations){const bad=structuredClone(manifest);mutate(bad);let calls=0;
    await assert.rejects(createNativeRuntime({...options,manifest:bad,loadBinary:f=>{calls++;return loadBinary(f);}}),/seal mismatch/);
    assert.equal(calls,0);}
  const bad=structuredClone(manifest);delete bad.seal.sourceContracts['contracts/rf-mana-break-source-v12.json'];
  await assert.rejects(createNativeRuntime({...options,manifest:bad}),/inventory mismatch/);
  for(const version of ['original-source-functions-v7','original-source-functions-v8','original-source-functions-v9','original-source-functions-v10']){
    const downgraded=structuredClone(manifest);downgraded.runtimeVersion=version;
    await assert.rejects(createNativeRuntime({...options,manifest:downgraded}),/legacy version downgrade/);
  }
  const path=structuredClone(manifest);path.modules['mana-break'].file='../mana-break.wasm';
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(path)}),/mana-break provenance/);
  const bytes=Buffer.from(loadBinary('mana-break.wasm'));bytes[bytes.length-1]^=1;
  await assert.rejects(createNativeRuntime({...options,loadBinary:f=>f==='mana-break.wasm'?bytes:loadBinary(f)}),/mana-break binary hash mismatch/);
});

test('current runtime rejects the hash-consistent retained v9 skills binary without the Hyper command ABI',async()=>{
  assert.equal(manifest.runtimeVersion,NATIVE_RUNTIME_VERSION);
  const oldHash='38dc6c5d84bb100782c26d0027d4a459d01fe6730efc5800150fdcb298c52ba3';
  const oldBytes=readFileSync(resolve(directory,'superseded',oldHash+'.wasm'));
  assert.equal(createHash('sha256').update(oldBytes).digest('hex'),oldHash);
  const oldModule=await WebAssembly.compile(oldBytes);
  assert.equal(WebAssembly.Module.exports(oldModule).some(e=>e.name==='skills_effect_hyper_mask'),false);
  const bad=structuredClone(manifest);bad.modules.skills.sha256=oldHash;bad.modules.skills.bytes=oldBytes.length;
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad),
    loadBinary:file=>file==='skills.wasm'?oldBytes:loadBinary(file)}),/Native skills Hyper command ABI missing/);
});

test('v11 rejects retained v10 skills even when its bytes and substituted manifest hash agree',async()=>{
  assert.equal(manifest.runtimeVersion,'original-source-functions-v11');
  const oldHash='60f604ff17f81008cbf4cca1efdad7e171967d0d61005dd7cf92dafa6ea32d95';
  const oldBytes=readFileSync(resolve(directory,'superseded',oldHash+'.wasm'));
  assert.equal(createHash('sha256').update(oldBytes).digest('hex'),oldHash);
  const oldModule=await WebAssembly.compile(oldBytes);
  assert.equal(WebAssembly.Module.exports(oldModule).some(e=>e.name==='skills_effect_hyper_mask'),true);
  assert.equal(WebAssembly.Module.exports(oldModule).some(e=>e.name==='skills_callback_group_count'),false);
  const bad=structuredClone(manifest);bad.modules.skills.sha256=oldHash;bad.modules.skills.bytes=oldBytes.length;
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad),
    loadBinary:file=>file==='skills.wasm'?oldBytes:loadBinary(file)}),/Native skills awakened Arc callback ABI missing/);
});

test('v11 rejects a legal hash-consistent module whose callback count is incorrect',async()=>{
  const section=(id,bytes)=>[id,bytes.length,...bytes];
  const named=(name,index)=>{const bytes=[...new TextEncoder().encode(name)];return [bytes.length,...bytes,0,index];};
  // Small authored module: two exported i32 functions return1 and0. This is
  // an ABI rejection fixture, never a source implementation or fidelity gold.
  const bytes=Uint8Array.from([0,97,115,109,1,0,0,0,
    ...section(1,[1,96,0,1,127]),...section(3,[2,0,0]),
    ...section(7,[2,...named('skills_callback_group_count',0),...named('skills_effect_hyper_mask',1)]),
    ...section(10,[2,4,0,65,1,11,4,0,65,0,11])]);
  const bad=structuredClone(manifest);bad.modules.skills.sha256=createHash('sha256').update(bytes).digest('hex');bad.modules.skills.bytes=bytes.length;
  await assert.rejects(createNativeRuntime({...options,manifest:fixtureSeal(bad),
    loadBinary:file=>file==='skills.wasm'?bytes:loadBinary(file)}),/Native skills awakened Arc callback group mismatch/);
});
