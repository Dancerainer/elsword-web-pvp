import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadMapDeclarations,practiceActors,mapProjection} from '../../apps/web/map-runtime.mjs';
const assets=new URL('../../artifacts/',import.meta.url);
const request=async url=>new Response(await readFile(new URL(url.slice(8).split('?')[0],assets)));
test('all sixteen production maps load through the browser declaration adapter and preserve original practice starts',async()=>{
  const catalog=JSON.parse(await readFile(new URL('scene/catalog.json',assets)));
  assert.equal(catalog.maps.length,16);
  for(const record of catalog.maps){
    const {map}=await loadMapDeclarations(record.sceneId,{},request);
    const actors=practiceActors(map),spawns=map.spawns.filter(s=>s.kind==='SetTeamStartPos');
    assert.equal(actors.length,2);assert.deepEqual(actors[0].position,spawns[0].position);assert.deepEqual(actors[1].position,spawns[1].position);
    const projection=mapProjection(map,.7);assert.ok(projection.minZ>0&&projection.maxZ>projection.minZ&&Number.isFinite(projection.fov));
  }
});
test('browser rejects mismatched selected map, corrupted declarations and mismatched geometry before scene publication',async()=>{
  const sceneId='sander-garpai-rock-pvp';
  await assert.rejects(loadMapDeclarations('../private',{},request),/invalid-scene-id/);
  await assert.rejects(loadMapDeclarations(sceneId,{sceneId:'eltreedown'},request),/scene-version/);
  await assert.rejects(loadMapDeclarations(sceneId,{mapManifestSha256:'0'.repeat(64)},request),/declaration-version/);
  await assert.rejects(loadMapDeclarations(sceneId,{mapGeometrySha256:'0'.repeat(64)},request),/geometry-version/);
});
