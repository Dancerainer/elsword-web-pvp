/** Small generated legal fixtures exercise publication policy, not native
 * source/client fidelity. Actual CLI verification uses the sealed runtime. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {preparePublicDeployment} from '../../tools/prepare-public-deployment.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const moduleNames = ['geometry','camera','commands','skills','skill-values','effect-random','commands-recovery','nasod','critical','mana-break'];
const wasm = Buffer.from([0,97,115,109,1,0,0,0]); // Valid empty WASM, with no original functions.
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(),'rf-public-snapshot-')), source = path.join(root,'inputs');
  const put = async (relative,bytes) => {const file = path.join(source,relative); await mkdir(path.dirname(file),{recursive:true}); await writeFile(file,bytes);};
  await mkdir(path.join(root,'dist')); await writeFile(path.join(root,'dist/game.js'),'fixture browser bundle');
  for (const directory of ['rf','ui','scene','audio','native']) await mkdir(path.join(source,directory),{recursive:true});
  const manifest = {schemaVersion:1,runtimeVersion:'fixture-not-original-client-golden',modules:Object.fromEntries(moduleNames.map(name => [name,{file:name+'.wasm',sha256:hash(wasm)}]))};
  for (const name of moduleNames) await put(`native/${name}.wasm`,wasm);
  await put('native/manifest.json',JSON.stringify(manifest));
  await put('rf/manifest.json','{"fixture":true}'); await put('rf/textures/a.png','fixture texture');
  await put('rf/pose.json.gz','fixture gzip extension'); await put('ui/fonts/a.ttf','fixture font');
  await put('ui/pvp-hud/manifest.json','{"fixture":true,"pieces":{"PVP_SCORE_BG":{"file":"score.png"}}}');
  await put('ui/pvp-hud/score.png','fixture HUD pixel bytes');
  await put('scene/fixture/map.glb','fixture mesh'); await put('audio/pvp/a.ogg','fixture audio');
  const calls = [];
  const verifier = async load => {calls.push('fixture-verifier');
    const copied = JSON.parse((await load('native/manifest.json')).toString());
    for (const name of moduleNames) {const bytes = await load('native/'+copied.modules[name].file);
      assert.equal(hash(bytes),copied.modules[name].sha256); await WebAssembly.compile(bytes);}
    return {runtimeVersion:'fixture-not-original-client-golden',modules:moduleNames,versions:{fixture:true}};
  };
  const destination = path.join(root,'snapshots','candidate');
  t.after(async () => {assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep)); await rm(root,{recursive:true,force:true});});
  return {root,source,destination,manifest,put,calls,verifier,prepare: extras => preparePublicDeployment({root,source,destination,verifier,...extras})};
}
async function files(root,relative='') {
  const rows = [];
  for (const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    const file = relative ? relative+'/'+entry.name : entry.name;
    if (entry.isDirectory()) rows.push(...await files(root,file)); else rows.push(file);
  }
  return rows.sort();
}
async function missing(file) {await assert.rejects(readFile(file),error => error.code === 'ENOENT');}

test('public snapshot contains only runtime resource extensions and the ten unique manifest WASMs, with hashes and labeled fixture verification', async t => {
  const f = await fixture(t);
  for (const file of ['native/generated.cpp','native/a.h','native/geometry-native.exe','native/superseded/old.wasm',
    'native/commands/commands.wasm','native/commands/source-contract.json','native-d3dx/a.dll',
    'rf/proofs/safe-looking.json','rf/source-contracts/proof.png','rf/evidence/evidence.json',
    'rf/superseded/old.glb','rf/generated/generated.json','ui/a.pdb','ui/raw.zip','scene/map.cpp',
    'audio/music.exe','rf/arbitrary.gz','rf/.private.json','raw/client.json']) await f.put(file,'excluded fixture');
  const result = await f.prepare(), expected = ['rf/manifest.json','rf/textures/a.png','rf/pose.json.gz',
    'ui/fonts/a.ttf','ui/pvp-hud/manifest.json','ui/pvp-hud/score.png','scene/fixture/map.glb','audio/pvp/a.ogg','native/manifest.json',...moduleNames.map(name => `native/${name}.wasm`)].sort();
  assert.deepEqual(await files(f.destination),expected); assert.deepEqual(Object.keys(result.files).sort(),expected);
  assert.equal(f.calls.length,1); assert.equal(result.native.runtimeVersion,'fixture-not-original-client-golden');
  assert.deepEqual(result.assetPolicy.runtimeRoots,['rf','ui','scene','audio']); assert.equal(result.assetPolicy.nativeFiles.length,11);
  for (const file of expected) {assert.equal(hash(await readFile(path.join(f.destination,file))),result.files[file]);
    assert.equal(hash(await readFile(path.join(f.source,file))),result.files[file]);}
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'dist/deployment.json'),'utf8')),result);
});

test('snapshot destination is independent and an existing snapshot is never overwritten', async t => {
  const f = await fixture(t); await f.prepare(); const before = await readFile(path.join(f.destination,'rf/manifest.json'));
  await f.put('rf/manifest.json','{"changed":true}');
  await assert.rejects(f.prepare(),error => error.code === 'EEXIST');
  assert.deepEqual(await readFile(path.join(f.destination,'rf/manifest.json')),before);
  await assert.rejects(f.prepare({destination:path.join(f.source,'rf/public')}),/separate from its source/);
  await assert.rejects(f.prepare({destination:path.dirname(f.source)}),/separate from its source/);
});

test('optional LK, VC, RS, IS, costumes and common buff runtime closures survive filtered release preparation with their exact bytes',async t=>{
  const f=await fixture(t);
  const included=['lk/manifest.json','lk/lk-runtime.glb','lk/fx/poses/a.json','lk/audio/a.ogg','vc/manifest.json','vc/poses/air.json','vc/fx/textures/fire.png','rs/manifest.json','rs/rs-runtime.glb','rs/runtime-pose.json','costumes/manifest.json','costumes/elsword/solace/body.glb','costumes/elsword/solace/effects/Hyper_Back.pose.json','costumes/raven/officer/textures/cape.png','common-buffs/catalog.json','common-buffs/fx/meshes/a.glb','common-buffs/fx/textures/a.png'];
  included.push('is/manifest.json','is/is-runtime.glb','is/runtime-pose.json','is/audio/blade.ogg',
    'is/fx/index.json','is/ui/portrait-state.png','is/ui/portrait-party.png','ui/skills/is/catalog.json');
  for(const file of included)await f.put(file,'bounded class display fixture');
  for(const file of ['is/source-proof/clips.json','is/generated/tool.exe'])await f.put(file,'excluded IS proof');
  for(const file of ['lk/proofs/source.json','vc/proofs/source.json','common-buffs/sources/decl.json','lk/raw.cpp','vc/raw.cpp','common-buffs/tool.exe'])await f.put(file,'excluded source fixture');
  const result=await f.prepare();
  assert.deepEqual(result.assetPolicy.runtimeRoots,['rf','ui','scene','audio','lk','vc','rs','is','common-buffs','costumes']);
  for(const file of ['is/source-proof/clips.json','is/generated/tool.exe'])assert.equal(Object.hasOwn(result.files,file),false);
  for(const file of included)assert.equal(hash(await readFile(path.join(f.destination,file))),result.files[file]);
  for(const file of ['lk/proofs/source.json','vc/proofs/source.json','common-buffs/sources/decl.json','lk/raw.cpp','vc/raw.cpp','common-buffs/tool.exe'])assert.equal(Object.hasOwn(result.files,file),false);
});

test('optional map mechanics publishes its index, mesh, pose, texture and audio bytes while excluding native D3DX proofs',async t=>{
  const f=await fixture(t),index={schemaVersion:1,version:'fixture-map-not-client-golden',templates:{portal:{
    glb:'meshes/portal.glb',poseData:'meshes/portal.pose.json',textures:{portal:{file:'textures/portal.png'}}}},
    audio:{jump:{file:'audio/jump.ogg'},return:{file:'audio/return.wav'}}};
  const included={
    'map-mechanics/index.json':JSON.stringify(index),
    'map-mechanics/meshes/portal.glb':'fixture map GLB bytes',
    'map-mechanics/meshes/portal.pose.json':JSON.stringify({clips:[],helpers:{RETURN_POINT:'retained'}}),
    'map-mechanics/textures/portal.png':'fixture map texture bytes',
    'map-mechanics/audio/jump.ogg':'fixture map OGG bytes',
    'map-mechanics/audio/return.wav':'fixture map WAV bytes'
  };
  const excluded=['native-d3dx/pvp-map-keyframes.json','native-d3dx/a.dll','map-mechanics/proofs/native-keyframes.json',
    'map-mechanics/source-contracts/reference.json','map-mechanics/raw.zip','map-mechanics/raw.cpp'];
  for(const [file,bytes]of Object.entries(included))await f.put(file,bytes);
  for(const file of excluded)await f.put(file,'excluded map evidence fixture');
  const result=await f.prepare();
  assert.deepEqual(result.assetPolicy.runtimeRoots,['rf','ui','scene','audio','map-mechanics']);
  for(const [file,bytes]of Object.entries(included)){
    assert.deepEqual(await readFile(path.join(f.destination,file)),Buffer.from(bytes));
    assert.equal(result.files[file],hash(Buffer.from(bytes)));
  }
  for(const file of excluded){assert.equal(Object.hasOwn(result.files,file),false);await missing(path.join(f.destination,file));}
});

test('battle-life revival and guild display resources survive publication without native probe or raw source files',async t=>{
  const f=await fixture(t);
  const included=['battle-life/manifest.json','battle-life/fx/index.json','battle-life/fx/meshes/respawn.glb',
    'battle-life/fx/meshes/respawn.pose.json','battle-life/fx/textures/lightning.png'];
  const excluded=['native-d3dx/battle-life-fx-keyframes-v1.json','battle-life/proofs/dll.json','battle-life/raw/source.cpp'];
  for(const file of included)await f.put(file,'bounded battle-life resource fixture');
  for(const file of excluded)await f.put(file,'excluded native/source fixture');
  const result=await f.prepare();
  assert.ok(result.assetPolicy.runtimeRoots.includes('battle-life'));
  for(const file of included)assert.equal(hash(await readFile(path.join(f.destination,file))),result.files[file]);
  for(const file of excluded){assert.equal(Object.hasOwn(result.files,file),false);await missing(path.join(f.destination,file));}
});

test('publication prunes only proven generator outputs while retaining fallback, complete pose and different animation tracks',async t=>{
  const f=await fixture(t);
  await f.put('rf/manifest.json',JSON.stringify({runtimeGlb:'rf-runtime.glb'}));
  await f.put('rf/rf.glb','legacy GLB');await f.put('rf/rf-runtime.glb','selected runtime GLB');
  for(const file of ['rf/rf_preview.png','rf/outputs.json','rf/native-motion.json.gz'])await f.put(file,'unused generator bytes');
  await f.put('rf/pose-tracks.json.gz','GM inspection');
  const animation=[{name:'native',ticks_per_second:4800,tracks:[{values:[1,2,3]}]}];
  await f.put('rf/effects/attack.animation.json',JSON.stringify(animation));
  await f.put('rf/effects/attack.pose.json',JSON.stringify({clips:animation,helpers:{ATTACK_SPHERE1:'retained'}}));
  await f.put('rf/effects/different.animation.json',JSON.stringify(animation));
  await f.put('rf/effects/different.pose.json',JSON.stringify({clips:[{...animation[0],tracks:[{values:[3,2,1]}]}]}));
  const result=await f.prepare();
  assert.equal(result.assetPolicy.exclusions.length,5);
  for(const file of result.assetPolicy.exclusions){assert.ok(!Object.hasOwn(result.files,file.file));await missing(path.join(f.destination,file.file));assert.equal(hash(await readFile(path.join(f.source,file.file))),file.sha256);}
  for(const file of ['rf/rf-runtime.glb','rf/pose-tracks.json.gz','rf/effects/attack.pose.json','rf/effects/different.pose.json','rf/effects/different.animation.json'])assert.ok(Object.hasOwn(result.files,file));
  await rm(path.join(f.source,'rf/rf-runtime.glb'));
  const fallback=await f.prepare({destination:path.join(f.root,'snapshots/fallback')});assert.ok(Object.hasOwn(fallback.files,'rf/rf.glb'));
});

test('pruning evidence cannot change between comparison and final seal',async t=>{
  const f=await fixture(t),animation=[{name:'native',ticks_per_second:4800,tracks:[]}];
  await f.put('rf/effects/attack.animation.json',JSON.stringify(animation));await f.put('rf/effects/attack.pose.json',JSON.stringify({clips:animation}));
  await assert.rejects(f.prepare({verifier:async load=>{const result=await f.verifier(load);await f.put('rf/effects/attack.animation.json','changed');return result;}}),/exclusion evidence changed/);
  await missing(path.join(f.root,'dist/deployment.json'));
});

test('damaged manifests and non-top-level, duplicate or malformed module paths fail before invoking a verifier', async t => {
  const f = await fixture(t);
  for (const content of ['{', 'null', JSON.stringify({schemaVersion:1,modules:[]}), JSON.stringify({schemaVersion:1,modules:{}})]) {
    await f.put('native/manifest.json',content); await assert.rejects(f.prepare(),/Invalid native/);
  }
  for (const file of ['../outside.wasm','sub/module.wasm','sub\\module.wasm','C:/escape.wasm','/absolute.wasm','a.exe','a.wasm?x','a%2f.wasm',['geometry.wasm']]) {
    const manifest = structuredClone(f.manifest); manifest.modules.geometry.file = file;
    await f.put('native/manifest.json',JSON.stringify(manifest)); await assert.rejects(f.prepare(),/Invalid top-level/);
  }
  const duplicate = structuredClone(f.manifest); duplicate.modules.camera.file = duplicate.modules.geometry.file;
  await f.put('native/manifest.json',JSON.stringify(duplicate)); await assert.rejects(f.prepare(),/Duplicate native/);
  const invalidHash = structuredClone(f.manifest); invalidHash.modules.geometry.sha256 = 'invalid';
  await f.put('native/manifest.json',JSON.stringify(invalidHash)); await assert.rejects(f.prepare(),/Invalid top-level/);
  assert.equal(f.calls.length,0); await missing(path.join(f.root,'dist/deployment.json'));
});

test('required missing module or runtime root and rejected native initialization never publish metadata', async t => {
  const f = await fixture(t); await rm(path.join(f.source,'native/camera.wasm'));
  await assert.rejects(f.prepare(),error => error.code === 'ENOENT'); assert.equal(f.calls.length,0);
  await missing(path.join(f.root,'dist/deployment.json'));
  await f.put('native/camera.wasm',wasm);
  await assert.rejects(f.prepare({destination:path.join(f.root,'snapshots/native-rejected'),verifier:async () => {throw Error('fixture native seal rejected');}}),/fixture native seal rejected/);
  await missing(path.join(f.root,'dist/deployment.json'));
  await rm(path.join(f.source,'audio'),{recursive:true});
  await assert.rejects(f.prepare({destination:path.join(f.root,'snapshots/missing-root')}),error => error.code === 'ENOENT');
});

test('default verifier rejects a labeled empty-WASM fixture and cannot bless it as the sealed native runtime', async t => {
  const f = await fixture(t);
  await f.put('scene/sander-garpai-rock-pvp/manifest.json','{"collision":{"url":"collision.json"}}');
  await f.put('scene/sander-garpai-rock-pvp/collision.json','{"lines":[]}');
  await assert.rejects(f.prepare({verifier:undefined}),/Unsupported native source runtime manifest/);
  assert.equal(f.calls.length,0); await missing(path.join(f.root,'dist/deployment.json'));
});

test('post-copy source, snapshot, or browser bundle changes are detected and preserve the previous deployment metadata', async t => {
  for (const target of ['source','snapshot','bundle']) {
    const f = await fixture(t), metadataFile = path.join(f.root,'dist/deployment.json'); await writeFile(metadataFile,'previous deployment');
    await assert.rejects(f.prepare({verifier:async load => {
      const result = await f.verifier(load);
      const changed = target === 'source' ? path.join(f.source,'rf/manifest.json') : target === 'snapshot'
        ? path.join(f.destination,'rf/manifest.json') : path.join(f.root,'dist/game.js');
      await writeFile(changed,'changed fixture'); return result;
    }}),/changed during preparation/);
    assert.equal(await readFile(metadataFile,'utf8'),'previous deployment');
  }
});

test('fixture verifier cannot read outside the selected snapshot inventory', async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare({verifier:async load => load('../outside.json')}),/non-snapshot asset/);
  await missing(path.join(f.root,'dist/deployment.json'));
});

test('runtime directory junctions/symlinks and linked destination ancestors are rejected before copying through them', async t => {
  for (const linkedInput of [true,false]) {
    const f = await fixture(t), external = path.join(f.root,'external'); await mkdir(external); await writeFile(path.join(external,'safe.json'),'external fixture');
    const link = linkedInput ? path.join(f.source,'rf/link') : path.join(f.root,'snapshots-link');
    await symlink(external,link,process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.prepare(linkedInput ? {} : {destination:path.join(link,'nested','candidate')}),/cannot contain links/);
    assert.deepEqual(await files(external),['safe.json']); await missing(path.join(f.root,'dist/deployment.json'));
  }
});

test('native manifest and native directory links are rejected instead of following a source outside the asset root', async t => {
  for (const entireDirectory of [true,false]) {
    const f = await fixture(t), external = path.join(f.root,'external-native'); await mkdir(external);
    await writeFile(path.join(external,'manifest.json'),JSON.stringify(f.manifest));
    const link = path.join(f.source,entireDirectory ? 'native' : 'native/manifest.json');
    await rm(link,{recursive:entireDirectory});
    await symlink(external,link,process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(f.prepare(),/cannot contain links/); assert.equal(f.calls.length,0);
  }
});
