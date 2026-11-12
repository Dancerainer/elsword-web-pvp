/** Current six-player simulation acceptance. Original coordinates/hashes are
 * checked separately against 2016 declarations; these are not client traces. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {createNativeRuntime} from '../../packages/native-source/runtime.mjs';
import {chooseTeamSpawns} from '../../packages/pvp/index.mjs';
import {MODE_CONFIG,ONLINE_MODES} from '../../packages/online/modes.mjs';
const root=new URL('../../',import.meta.url),bytes=file=>readFileSync(new URL(file,root)),read=file=>JSON.parse(bytes(file));
const catalog=read('artifacts/scene/catalog.json'),nativeManifest=read('artifacts/native/manifest.json');
const profile=read('packages/combat-core/rf-profile.json'),preset=read('config/rf-preset.json');
const frozen=value=>JSON.parse(JSON.stringify(value));

for(const entry of catalog.maps)test(entry.sceneId+': GLB, authored 1/2/3v3 starts, six-player deterministic continuation',async()=>{
  const prefix='artifacts/scene/'+entry.sceneId+'/';
  const manifest=read(prefix+'manifest.json'),collision=read(prefix+'collision.json'),map={...manifest,...collision};
  assert.equal(createHash('sha256').update(bytes(prefix+'manifest.json')).digest('hex'),entry.manifestSha256);
  for(const asset of [manifest.geometry,manifest.collision])assert.equal(createHash('sha256').update(bytes(prefix+asset.url)).digest('hex'),asset.sha256);
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{const container=await loadPoseContainer(scene,new URL(prefix+manifest.geometry.url,root));assert.ok(container.meshes.length>0);container.dispose();}
  finally{scene.dispose();engine.dispose();}
  for(const mode of ONLINE_MODES){
    const players=Array.from({length:MODE_CONFIG[mode].playerCount},(_,i)=>({id:String(i),team:i<MODE_CONFIG[mode].teamSize?0:1}));
    const selected=chooseTeamSpawns(map,players);assert.equal(selected.length,players.length);
    for(const spawn of selected){
      const original=map.spawns.find(row=>row.index===spawn.sourceSpawnIndex&&row.kind==='SetTeamStartPos');
      assert.deepEqual(spawn.position,original.position);assert.equal(spawn.team===0,original.teamFlag);
      assert.equal(spawn.facing,original.facingRight?1:-1);assert.equal(spawn.lineId,original.lineId);
    }
  }
  const players=Array.from({length:6},(_,i)=>({id:'player-'+i,team:i<3?0:1}));
  const spawns=chooseTeamSpawns(map,players),actors=players.map((row,i)=>({...row,...spawns[i]}));
  const make=async()=>{
    const native=await createNativeRuntime({manifest:nativeManifest,map,loadBinary:file=>bytes('artifacts/native/'+file)});
    return createSimulation({profile,preset,map,actors,seed:2016,nativeGeometry:native.geometry,nativeCommands:native.commands,
      nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,nativeCritical:native.critical,
      nativeManaBreak:native.manaBreak,versions:{...native.versions,sceneId:entry.sceneId,mapCollisionSha256:manifest.collision.sha256,mapGeometrySha256:manifest.geometry.sha256}});
  };
  const first=await make(),second=await make();
  for(let step=0;step<120;step++){
    const inputs={'player-0':step<40?{held:['RIGHT']}:step===40?{pressed:['UP']}:step<80?{held:['LEFT']}: {},'player-3':step===80?{pressed:['DOWN']}:{}};
    first.step(1/60,inputs);second.step(1/60,inputs);first.drainEvents();second.drainEvents();
    assert.deepEqual(frozen(first.snapshot()),frozen(second.snapshot()));assert.ok(first.snapshot().actors.every(actor=>[actor.x,actor.y,actor.z].every(Number.isFinite)));
  }
  const third=await make();third.restore(frozen(first.snapshot()));third.drainEvents();
  for(let step=0;step<60;step++){
    first.step(1/60,{});third.step(1/60,{});first.drainEvents();third.drainEvents();assert.deepEqual(frozen(first.snapshot()),frozen(third.snapshot()));
  }
});
