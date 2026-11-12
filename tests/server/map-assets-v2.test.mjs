import test from 'node:test';
import {FEEDBACK_FIXTURE_REFERENCE,writeFeedbackVisualFixture} from '../helpers/player-feedback-visual-fixture-v45.mjs';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),assetRoot=path.join(root,'artifacts');

test('actual sixteen map resource seals differ while character poses and native provenance stay shared',async()=>{
  const assets=await loadServerCombatAssets({root,assetRoot});assert.equal(assets.maps.length,16);
  const resourceSeals=new Set();
  for(const row of assets.maps){
    assert.deepEqual(row.modes,['1v1','2v2','3v3']);const selected=assets.forScene(row.id);
    assert.equal(selected.map.sceneId,row.id);assert.equal(selected.profile,assets.profile);assert.equal(selected.preset,assets.preset);
    assert.equal(selected.versions.sceneId,row.id);assert.equal(selected.versions.mapManifestSha256,row.manifestSha256);
    assert.equal(selected.versions.mapCollisionSha256,row.collisionSha256);assert.equal(selected.versions.mapGeometrySha256,row.geometrySha256);
    assert.equal(selected.versions.nativeProgram,assets.versions.nativeProgram);
    assert.ok(selected.fingerprints.resources.files.filter(file=>file.file.startsWith('assets/scene/')).every(file=>file.file.startsWith('assets/scene/'+row.id+'/')));
    resourceSeals.add(selected.versions.resourceSha256);
  }
  assert.equal(resourceSeals.size,16);assert.throws(()=>assets.forScene('../missing'),/unknown-pvp-scene/);
});
test('actual native battle factory creates the assigned alternate map and refuses forged map resource versions',async()=>{
  const factory=await createBattleDriverFactory({root,assetRoot});const sceneId='elder-wally-castle-roof-stage4';
  const versions=factory.mapVersions(sceneId),players=Array.from({length:6},(_,i)=>({id:String(i),username:String(i),team:i<3?0:1,loadout:Array(8).fill(null)}));
  const match={id:'local-map-integration',mode:'3v3',sceneId,players,seed:2016,versions};
  const driver=await factory({match,emit(){},finish(){}});
  try{const state=driver.snapshot();assert.equal(state.snapshot.versions.sceneId,sceneId);
    assert.deepEqual(state.snapshot.actors.map(actor=>[actor.x,actor.y,actor.z]),[[ -861.259,480,0],[-1352.7,240,0],[-1132.3,480,0],[879.471,480,0],[1351.22,240,0],[1152.35,480,0]].map(point=>point.map(Math.fround)));
  }finally{driver.stop();}
  await assert.rejects(factory({match:{...match,versions:{...versions,mapGeometrySha256:'0'.repeat(64)}},emit(){},finish(){}}),/match-map-version-mismatch/);
  await assert.rejects(factory({match:{...match,sceneId:'map-unavailable'},emit(){},finish(){}}),/unknown-pvp-scene/);
});
test('catalogue loader rejects unsafe IDs, changed manifest/collision, failed partial catalogue and duplicate maps before runtime creation',async t=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),'rf-map-catalogue-fixture-'));
  t.after(async()=>{assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(temporary,{recursive:true,force:true});});
  const put=async(file,value)=>{const filename=path.join(temporary,file);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,JSON.stringify(value)+'\n');};
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),id='sander-garpai-rock-pvp';
  await put('rf/manifest.json',{referenceVersion:FEEDBACK_FIXTURE_REFERENCE,effectAssetIndex:'collision-effects.json',runtimePose:'pose.json',syntheticFixture:'map-loader-only'});
  await put('rf/collision-effects.json',{templates:{}});await put('rf/pose.json',{});await put('native/manifest.json',{modules:{}});
  for(const folder of ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'])await put('rf/'+folder+'/index.json',{schemaVersion:1,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,templates:{}});
  await writeFeedbackVisualFixture(async(file,bytes)=>{const filename=path.join(temporary,file);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,bytes);});
  const collision={sceneId:id,lines:[{lineId:1,start:[0,0,0],end:[100,0,0]}],spawns:[true,false].flatMap(flag=>Array.from({length:3},(_,i)=>({kind:'SetTeamStartPos',teamFlag:flag,position:[i*10,0,0],lineId:1})))};
  await put('scene/'+id+'/collision.json',collision);
  const manifest={sceneId:id,collision:{url:'collision.json',sha256:hash(await readFile(path.join(temporary,'scene/'+id+'/collision.json')))},geometry:{url:'scene.glb',sha256:'c'.repeat(64)}};
  await put('scene/'+id+'/manifest.json',manifest);
  await writeFile(path.join(temporary,'scene/'+id+'/scene.glb'),'labeled fixture; not executable geometry');
  const row={sceneId:id,manifestUrl:id+'/manifest.json',manifestSha256:hash(await readFile(path.join(temporary,'scene/'+id+'/manifest.json'))),collision:manifest.collision,geometry:manifest.geometry};
  const catalog={schemaVersion:1,maps:[row],failures:[]};
  await put('scene/catalog.json',catalog);assert.equal((await loadServerCombatAssets({root,assetRoot:temporary})).maps.length,1);
  for(const change of [value=>{value.maps[0].sceneId='../outside';},value=>{value.maps.push(structuredClone(value.maps[0]));},value=>{value.failures.push({error:'failed-map'});},value=>{value.maps[0].manifestSha256='0'.repeat(64);},value=>{value.maps[0].collision.sha256='0'.repeat(64);}]){
    const damaged=structuredClone(catalog);change(damaged);await put('scene/catalog.json',damaged);
    await assert.rejects(loadServerCombatAssets({root,assetRoot:temporary}),/invalid-pvp-scene|pvp-scene-catalogue-mismatch/);
  }
  await put('scene/catalog.json',catalog);await put('scene/'+id+'/collision.json',{...collision,unexpected:'different raw bytes'});
  await assert.rejects(loadServerCombatAssets({root,assetRoot:temporary}),/pvp-scene-collision-mismatch/);
});
