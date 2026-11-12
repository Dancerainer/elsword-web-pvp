import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {selectMap,mapAssetRoot,mapNavigationUrl,mapFixtureActors,validateMapId} from '../../apps/web/map-selection.mjs';

const root=new URL('../../',import.meta.url);
const bytes=path=>readFileSync(new URL(path,root));
const read=path=>JSON.parse(bytes(path));
const catalog=read('artifacts/scene/catalog.json');
const nativeManifest=read('artifacts/native/manifest.json');
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const frozen=value=>JSON.parse(JSON.stringify(value));

test('map selection rejects unknown/path IDs and incomplete pools; URL retains other parameters',()=>{
  assert.equal(selectMap(catalog).sceneId,'sander-garpai-rock-pvp');
  assert.throws(()=>selectMap(catalog,'unavailable-map'),/asset catalog/);
  for(const id of ['../rf','garpai/rock','',null,'x?map=y'])assert.throws(()=>validateMapId(id),/Invalid scene/);
  assert.throws(()=>selectMap({...catalog,maps:[]}),/Map catalog/);
  assert.throws(()=>selectMap({...catalog,failures:[{}]}),/Map catalog/);
  assert.equal(mapAssetRoot('eltreedown'),'/assets/scene/eltreedown/');
  const url=new URL(mapNavigationUrl('http://127.0.0.1:4196/?view=a#x','eltreedown'));
  assert.equal(url.searchParams.get('view'),'a');assert.equal(url.searchParams.get('map'),'eltreedown');assert.equal(url.hash,'#x');
});

for(const entry of catalog.maps)test(entry.sceneId+': actual geometry loads, original four-player spawns simulate and restore deterministically',async()=>{
  const prefix='artifacts/scene/'+entry.sceneId+'/';
  const manifest=read(prefix+'manifest.json'),collision=read(prefix+'collision.json');
  const map={...manifest,...collision,renderWorldSettings:manifest.worldSettings};
  for(const asset of [manifest.geometry,manifest.collision])assert.equal(createHash('sha256').update(bytes(prefix+asset.url)).digest('hex'),asset.sha256);
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    const container=await loadPoseContainer(scene,new URL(prefix+manifest.geometry.url,root));
    assert.ok(container.meshes.length>0);container.dispose();
  }finally{scene.dispose();engine.dispose();}
  assert.equal(mapFixtureActors(map).length,2);
  const starts=map.spawns.filter(s=>s.kind==='SetTeamStartPos');
  // First two authored slots per declared flag, rather than inventing a layout.
  const actors=[false,true].flatMap((flag,team)=>starts.filter(s=>s.teamFlag===flag).slice(0,2)
    .map((s,i)=>({id:`team-${team}-${i}`,team,position:s.position,lineId:s.lineId,facing:s.facingRight?1:-1})));
  assert.equal(actors.length,4);
  const make=async()=>{
    const native=await createNativeRuntime({manifest:nativeManifest,map,loadBinary:file=>bytes('artifacts/native/'+file)});
    return createSimulation({profile,preset,map,actors,seed:2016,nativeGeometry:native.geometry,nativeCommands:native.commands,
      nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,
      nativeManaBreak:native.manaBreak,versions:{...native.versions,mapCollision:manifest.collision.sha256,mapGeometry:manifest.geometry.sha256}});
  };
  const first=await make(),second=await make();
  for(let step=0;step<180;step++){
    const inputs={'team-0-0':step<40?{held:['RIGHT']}:step===40?{pressed:['UP']}:step<80?{held:['LEFT']}: {},
      'team-1-0':step===80?{pressed:['DOWN']}:{}};
    first.step(1/60,inputs);second.step(1/60,inputs);first.drainEvents();second.drainEvents();
    assert.deepEqual(frozen(first.snapshot()),frozen(second.snapshot()));
    assert.ok(first.snapshot().actors.every(a=>[a.x,a.y,a.z].every(Number.isFinite)));
  }
  const third=await make();third.restore(frozen(first.snapshot()));third.drainEvents();
  for(let step=0;step<120;step++){
    first.step(1/60,{});third.step(1/60,{});first.drainEvents();third.drainEvents();
    assert.deepEqual(frozen(first.snapshot()),frozen(third.snapshot()));
  }
});
