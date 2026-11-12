/** Browser-shaped JSON trace through the actual local replay CLI; this is a
 * Web simulation regression, not an original client input trajectory. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {practiceActors} from '../../apps/web/map-runtime.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
test('alternate-map browser-shaped export replays complete JSON and continues with original frozen native modules',async t=>{
  const output=await mkdtemp(path.join(os.tmpdir(),'rf-replay-multimap-'));
  t.after(async()=>{assert.ok(path.resolve(output).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(output,{recursive:true,force:true});});
  const assets=await loadServerCombatAssets({root,assetRoot:path.join(root,'artifacts')}),selected=assets.forScene('peita-offerings-stage-pvp');
  const {native,samplers}=await selected.createRuntime();
  const simulation=createSimulation({profile:assets.profile,map:selected.map,preset:assets.preset,actors:practiceActors(selected.map),seed:2016,...samplers,
    nativeGeometry:native.geometry,nativeCommands:native.commands,nativeSkills:native.skills,nativeSkillValues:native.skillValues,nativeNasod:native.nasod,
    nativeCritical:native.critical,nativeManaBreak:native.manaBreak,versions:{...native.versions,sceneId:selected.map.sceneId,
      referenceVersion:assets.versions.referenceVersion,presetVersion:assets.preset.presetVersion,programVersion:'rf-effects-maps-v1',
      mapManifestSha256:selected.versions.mapManifestSha256,mapGeometrySha256:selected.versions.mapGeometrySha256,mapCollisionSha256:selected.versions.mapCollisionSha256}});
  const initial=simulation.snapshot(),inputs=[];simulation.drainEvents();
  for(let i=0;i<40;i++){const input={dt:1/60,inputs:{'player-1':i<20?{held:['RIGHT'],pressed:i===0?['RIGHT']:[]}:{held:[]}}};inputs.push(input);simulation.step(input.dt,input.inputs);simulation.drainEvents();}
  const trace={schemaVersion:1,purpose:'current-simulation-trace-not-native-ground-truth',recordingReason:'labeled alternate-map regression fixture',versions:simulation.versions,initial,inputs,final:simulation.snapshot()};
  const filename=path.join(output,'trace.json');await writeFile(filename,JSON.stringify(trace));
  const result=await execute(process.execPath,['tools/replay-trace.mjs',filename],{cwd:root,timeout:30_000});
  const proof=JSON.parse(result.stdout.trim());assert.equal(proof.sceneId,'peita-offerings-stage-pvp');assert.equal(proof.completeSerializedSnapshotEqual,true);
  assert.equal(proof.jsonRestoredContinuationSteps,120);assert.equal(proof.originalClientMeasured,false);
});
