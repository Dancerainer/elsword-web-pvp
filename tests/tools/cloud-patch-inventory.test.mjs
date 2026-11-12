import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotAssets,changedAssetFiles,removedAssetFiles,isProgramSource,requiredProfessionManifests,RELEASE_PROFESSION_IDS} from '../../tools/cloud-patch-inventory.mjs';
const oldBuild='a'.repeat(64),newBuild='b'.repeat(64),same='c'.repeat(64),old='d'.repeat(64),fresh='e'.repeat(64);

test('all twelve known professions are validated only when their sealed manifests exist',()=>{
  const ids=['RF','LK','VC','RS','BM','IS','GM','BH','CA','LP','MM','DE'];
  assert.deepEqual(RELEASE_PROFESSION_IDS,ids);
  const assets=ids.map(id=>({path:'artifacts/'+id.toLowerCase()+'/manifest.json',sha256:fresh}));
  assert.deepEqual(requiredProfessionManifests(assets),ids);
  assert.deepEqual(requiredProfessionManifests(assets.slice(0,9)),ids.slice(0,9));
  assert.throws(()=>requiredProfessionManifests(assets.slice(1)),/manifest/);
  assert.throws(()=>requiredProfessionManifests([...assets.slice(0,-1),{path:'artifacts/de/runtime-pose.json',sha256:fresh}]),/manifest/);
});
test('snapshot inventory freezes complete target and only changed/new assets become writes',()=>{
  const before=snapshotAssets({bundleSha256:oldBuild,files:{'native/manifest.json':same,'bm/storm.json':old}},oldBuild);
  const after=snapshotAssets({bundleSha256:newBuild,files:{'bm/storm.glb':fresh,'native/manifest.json':same,'bm/storm.json':fresh}},newBuild);
  assert.deepEqual(changedAssetFiles(before,after),[
    {path:'artifacts/bm/storm.glb',sha256:fresh,baselineSha256:null,baselineCanonicalSha256:null},
    {path:'artifacts/bm/storm.json',sha256:fresh,baselineSha256:old,baselineCanonicalSha256:null},
  ]);
});
test('snapshot rejects wrong bundle, traversal, links syntax, proof entries and bad digests',()=>{
  assert.throws(()=>snapshotAssets({bundleSha256:oldBuild,files:{'native/manifest.json':same}},newBuild));
  for(const file of ['../accounts','/etc/passwd','C:/escape','bm\\effect.json','bm//effect.json','bm/source-proof/index.json','bm/evidence/index.json'])
    assert.throws(()=>snapshotAssets({bundleSha256:newBuild,files:{[file]:same}},newBuild));
  assert.throws(()=>snapshotAssets({bundleSha256:newBuild,files:{'bm/index.json':'invalid'}},newBuild));
});
test('committed JSON contracts and presets qualify as program sources, reports and proofs do not',()=>{
  for(const file of ['packages/combat-core/bm-profile.json','contracts/bm-air-commands-source-v3.json','contracts/all-profession-cancel-source-v1.json','config/professions/bm.json','apps/web/game.mjs'])
    assert.equal(isProgramSource(file),true,file);
  for(const file of ['reports/bm-validation.json','tests/tools/sample.json','artifacts/bm/source-proof/index.json','contracts/../account.json','runtime/accounts.json'])
    assert.equal(isProgramSource(file),false,file);
});
test('retired texture deletion is frozen to the old snapshot SHA',()=>{
  const before=[{path:'artifacts/native/manifest.json',sha256:same},{path:'artifacts/bm/Armor_break.png',sha256:old}];
  assert.deepEqual(removedAssetFiles(before,before.slice(0,1)),[before[1]]);
});

test('only the real login HTML qualifies for committed patch source and explicit inclusion',()=>{
  assert.equal(isProgramSource('apps/web/index.html'),true);
  for(const file of ['apps/web/other.html','apps/server/index.html','packages/index.html','reports/index.html',
    'runtime/index.html','apps/web/../index.html','apps/web/index.html.bak'])assert.equal(isProgramSource(file),false,file);
});

test('baseline compatibility keeps the full deployed program domain and excludes unshipped source notes',()=>{
  const deployed=['apps/web/index.html','apps/web/game.mjs','apps/web/login.css','apps/web/browser.js',
    'packages/online/owned-state.mjs','packages/combat-core/rf-profile.json','config/professions/rf.json',
    'contracts/add-analysis-v53/add-pulse-cannon-contract-2016.json','package.json','package-lock.json',
    'tools/assets/character/sample_pose.mjs'];
  const unshipped=['contracts/add-analysis-v53/COMBAT_TRANSPORT_2016.md','contracts/add-analysis-v53/source.csv',
    'packages/combat-core/README.md','apps/web/other.html','tools/validation/report.json'];
  assert.deepEqual([...deployed,...unshipped].filter(isProgramSource),deployed);
});
