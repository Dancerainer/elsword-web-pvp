/** Release identity tests against explicit byte/framing rules. These do not
 * manufacture or claim an original-client combat trajectory expectation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createFingerprintInventory,fingerprintHostProgram,HOST_FINGERPRINT_DOMAIN,
  RESOURCE_FINGERPRINT_DOMAIN,HOST_PROGRAM_FILES} from '../../packages/combat-assets/program-fingerprint.mjs';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {CORE_VERSION} from '../../packages/combat-core/index.mjs';
import {FEEDBACK_FIXTURE_REFERENCE,FEEDBACK_FIXTURE_POSE_PATHS,writeFeedbackVisualFixture} from '../helpers/player-feedback-visual-fixture-v45.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(value,'utf8');

test('inventory has explicit JSON framing and path sorting independent of collection order',()=>{
  const first=createFingerprintInventory(HOST_FINGERPRINT_DOMAIN),second=createFingerprintInventory(HOST_FINGERPRINT_DOMAIN);
  first.add('z/core.mjs',bytes('export const n=1;\n'));first.add('a/catalog.json',bytes('{"id":57}\n'));
  second.add('a/catalog.json',bytes('{"id":57}\n'));second.add('z/core.mjs',bytes('export const n=1;\n'));
  const expectedFiles=[
    {file:'a/catalog.json',bytes:10,sha256:sha(bytes('{"id":57}\n'))},
    {file:'z/core.mjs',bytes:18,sha256:sha(bytes('export const n=1;\n'))},
  ];
  // The documented UTF-8 JSON schema is checked independently of collection.
  assert.deepEqual(first.snapshot().files,expectedFiles);
  assert.equal(first.snapshot().sha256,sha(JSON.stringify({schemaVersion:1,domain:HOST_FINGERPRINT_DOMAIN,files:expectedFiles})));
  assert.deepEqual(first.snapshot(),second.snapshot());
  assert.equal(Object.isFrozen(first.snapshot().files),true);
});

test('one changed byte, newline encoding, file identity and domain each change the digest',()=>{
  const digest=(value,file='core.mjs',domain=HOST_FINGERPRINT_DOMAIN)=>{
    const inventory=createFingerprintInventory(domain);inventory.add(file,value);return inventory.snapshot().sha256;
  };
  const original=Buffer.from([0,1,2,255]);
  assert.notEqual(digest(original),digest(Buffer.from([0,1,3,255])));
  assert.notEqual(digest(bytes('x\n')),digest(bytes('x\r\n')),'raw bytes are not newline-normalized');
  assert.notEqual(digest(original),digest(original,'different.mjs'));
  assert.notEqual(digest(original),digest(original,'core.mjs',RESOURCE_FINGERPRINT_DOMAIN));
});

test('repeated read agrees or rejects an input changed during loading, with relative paths only',()=>{
  const inventory=createFingerprintInventory(RESOURCE_FINGERPRINT_DOMAIN);
  inventory.add('rf/index.json',bytes('{}'));inventory.add('rf\\index.json',bytes('{}'));
  assert.equal(inventory.snapshot().files.length,1);
  assert.throws(()=>inventory.add('rf/index.json',bytes('{ }')),/Input changed during fingerprint/);
  for(const file of ['','../core.mjs','core/../x.json','/absolute','C:/outside','core//x.json','./core.mjs'])
    assert.throws(()=>inventory.add(file,bytes('x')),/path|root/);
  assert.throws(()=>inventory.add('core.mjs','not raw bytes'),/raw bytes/);
  assert.throws(()=>createFingerprintInventory(''),/domain/);
});

test('host discovery automatically seals a JSON guild catalog and added core module in a small temp tree',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'rf-host-fingerprint-'));
  t.after(async()=>{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(root,{recursive:true,force:true});
  });
  await mkdir(path.join(root,'packages/combat-core'),{recursive:true});
  await mkdir(path.join(root,'packages/input'),{recursive:true});
  await writeFile(path.join(root,'packages/combat-core/index.mjs'),'export const CORE_VERSION="fixture";\n');
  await writeFile(path.join(root,'packages/combat-core/guild-catalog.json'),'{"skills":[{"id":509,"level":5}]}\n');
  await writeFile(path.join(root,'packages/combat-core/README.md'),'not runtime source');
  await writeFile(path.join(root,'packages/input/keys.mjs'),'export const keys=[];\n');
  const options={root,directories:['packages/input','packages/combat-core'],files:[]};
  const initial=await fingerprintHostProgram(options);
  assert.deepEqual(initial.files.map(row=>row.file),[
    'packages/combat-core/guild-catalog.json','packages/combat-core/index.mjs','packages/input/keys.mjs',
  ]);
  assert.deepEqual(await fingerprintHostProgram({...options,directories:[...options.directories].reverse()}),initial);
  await writeFile(path.join(root,'packages/combat-core/guild-catalog.json'),'{"skills":[{"id":509,"level":4}]}\n');
  const modified=await fingerprintHostProgram(options);assert.notEqual(modified.sha256,initial.sha256);
  assert.notEqual(modified.files[0].sha256,initial.files[0].sha256);
  await writeFile(path.join(root,'packages/combat-core/guild-skills.mjs'),'export const enabled=true;\n');
  const extended=await fingerprintHostProgram(options);assert.notEqual(extended.sha256,modified.sha256);
  assert.ok(extended.files.some(row=>row.file==='packages/combat-core/guild-skills.mjs'));
});

test('production inventory includes the actual sampler, imported contracts, keyboard and host JSON closure',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url)),manifest=await fingerprintHostProgram({root});
  const paths=manifest.files.map(row=>row.file);
  for(const file of [...HOST_PROGRAM_FILES,'packages/combat-core/rf-profile.json',
    'packages/combat-core/index.mjs','packages/combat-assets/server-assets.mjs',
    'packages/combat-assets/program-fingerprint.mjs','packages/native-source/runtime.mjs',
    'packages/pvp/index.mjs','packages/input/key-bindings.mjs','packages/effect-runtime/index.mjs',
    'packages/online/service.mjs','packages/online/account-store.mjs',
    'apps/web/input-prediction.mjs','apps/web/online-client.mjs','apps/web/owned-actions.mjs',
    'apps/web/owned-presentation.mjs','apps/web/pvp-practice.mjs','apps/web/game.mjs','apps/web/login.mjs',
    'apps/web/effect-state-lookup.mjs','apps/web/native-quad-materials.mjs',
    'apps/web/actor-presentation.mjs','apps/web/add-formation-effects.mjs',
  'apps/web/destruction-rage-effects.mjs',
    'contracts/command-presentation-bindings-v29.json',
  'contracts/structural-mesh-source-clocks-v29.json',
    'apps/web/hit-lighting.mjs','apps/web/effect-prewarm.mjs','apps/web/render-preparation.mjs',
    'apps/web/lighting.mjs','apps/web/character-toon-material.mjs','contracts/character-toon-source-v27.json',
    'apps/server/dev-server.mjs','apps/server/key-preferences.mjs','apps/server/sse-stream.mjs',
    'apps/server/online-poll-channel.mjs'])
    assert.ok(paths.includes(file),'actual host dependency missing: '+file);
  assert.equal(new Set(paths).size,paths.length);assert.match(manifest.sha256,/^[0-9a-f]{64}$/);
});

test('loader seals its actual JSON/pose/WASM bytes separately from native seal and never seals unused assets',async t=>{
  // Deliberately tiny loader fixture, not an executable/native combat fixture.
  // No client bundles are copied, and createRuntime is not invoked on these bytes.
  const root=fileURLToPath(new URL('../../',import.meta.url)),assetRoot=await mkdtemp(path.join(os.tmpdir(),'rf-resource-fingerprint-'));
  t.after(async()=>{
    assert.ok(path.resolve(assetRoot).startsWith(path.resolve(os.tmpdir())+path.sep));
    await rm(assetRoot,{recursive:true,force:true});
  });
  const write=async(file,value)=>{await mkdir(path.dirname(path.join(assetRoot,file)),{recursive:true});await writeFile(path.join(assetRoot,file),value);};
  const json=async(file,value)=>write(file,JSON.stringify(value)+'\n');
  await json('scene/sander-garpai-rock-pvp/manifest.json',{sceneId:'loader-fixture'});
  await json('scene/sander-garpai-rock-pvp/collision.json',{lines:[]});
  await json('rf/manifest.json',{referenceVersion:FEEDBACK_FIXTURE_REFERENCE,effectAssetIndex:'collision-effects.json',runtimePose:'character.pose.json',syntheticFixture:'loader-only'});
  const nativeManifest={modules:{geometry:{file:'geometry.wasm'}},seal:{manifestContentSha256:'a'.repeat(64)}};
  await json('native/manifest.json',nativeManifest);await write('native/geometry.wasm',Buffer.from([0,1,2,3]));
  const folders=['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'];
  for(const folder of folders)await json('rf/'+folder+'/index.json',{schemaVersion:1,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,templates:{}});
  await writeFeedbackVisualFixture(write);
  await json('rf/collision-effects.json',{templates:{fixture:{kind:'mesh',poseData:'loaded-effect.pose.json',events:[]}}});
  await json('rf/character.pose.json',{});await json('rf/loaded-effect.pose.json',{});
  await write('rf/unloaded.png',Buffer.from([42]));
  const first=await loadServerCombatAssets({root,assetRoot});
  const expectedPaths=['config/rf-preset.json','packages/combat-core/rf-profile.json',
    'assets/scene/sander-garpai-rock-pvp/manifest.json','assets/scene/sander-garpai-rock-pvp/collision.json',
    'assets/rf/manifest.json','assets/native/manifest.json','assets/native/geometry.wasm',
    'assets/rf/collision-effects.json','assets/rf/character.pose.json','assets/rf/loaded-effect.pose.json',
    ...folders.map(folder=>'assets/rf/'+folder+'/index.json'),...FEEDBACK_FIXTURE_POSE_PATHS.map(file=>'assets/'+file)].sort();
  assert.deepEqual(first.fingerprints.resources.files.map(row=>row.file),expectedPaths);
  assert.equal(first.versions.program,first.versions.hostProgramSha256);
  assert.equal(first.versions.hostProgramSha256,first.fingerprints.hostProgram.sha256);
  assert.equal(first.versions.resourceSha256,first.fingerprints.resources.sha256);
  assert.equal(first.versions.coreVersion,CORE_VERSION);
  assert.equal(first.versions.nativeProgram,nativeManifest.seal.manifestContentSha256);
  assert.equal(first.versions.nativeManifestSha256,sha(JSON.stringify(nativeManifest)));
  assert.equal(Object.isFrozen(first.versions),true);
  assert.equal('fingerprints' in first.versions,false,'per-snapshot versions carry no large inventory');
  await write('rf/unloaded.png',Buffer.from([43]));
  const unusedChanged=await loadServerCombatAssets({root,assetRoot});
  assert.equal(unusedChanged.versions.resourceSha256,first.versions.resourceSha256);
  await write('rf/loaded-effect.pose.json','{ }\n'); // Same parsed pose, different raw bytes.
  const poseChanged=await loadServerCombatAssets({root,assetRoot});
  assert.notEqual(poseChanged.versions.resourceSha256,first.versions.resourceSha256);
  await write('native/geometry.wasm',Buffer.from([0,1,2,4]));
  const binaryChanged=await loadServerCombatAssets({root,assetRoot});
  assert.notEqual(binaryChanged.versions.resourceSha256,poseChanged.versions.resourceSha256);
  assert.equal(binaryChanged.versions.nativeProgram,first.versions.nativeProgram,'native provenance is preserved, not forged to match changed bytes');
  const unsealedManifest={modules:nativeManifest.modules};await json('native/manifest.json',unsealedManifest);
  const unsealed=await loadServerCombatAssets({root,assetRoot});
  assert.equal(unsealed.versions.nativeProgram,null,'missing native program seal stays unknown');
  assert.equal(unsealed.versions.nativeManifestSha256,sha(JSON.stringify(unsealedManifest)));
});
