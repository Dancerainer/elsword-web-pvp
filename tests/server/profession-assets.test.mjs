/** Small loader fixtures check availability and failure isolation only.
 * Placeholder binary bytes are never initialized or treated as combat data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {loadServerCombatAssets} from '../../packages/combat-assets/server-assets.mjs';
import {createBattleDriverFactory} from '../../apps/server/battle-driver.mjs';
import {createOnlineService} from '../../packages/online/service.mjs';
import {FEEDBACK_FIXTURE_REFERENCE,writeFeedbackVisualFixture} from '../helpers/player-feedback-visual-fixture-v45.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(t){
  const assetRoot=await mkdtemp(path.join(os.tmpdir(),'profession-loader-'));
  t.after(async()=>{assert.ok(path.resolve(assetRoot).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(assetRoot,{recursive:true,force:true});});
  const write=async(file,bytes)=>{const target=path.join(assetRoot,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);};
  const json=(file,value)=>write(file,JSON.stringify(value));
  const index={schemaVersion:1,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,templates:{}};
  await writeFeedbackVisualFixture(write);
  await json('scene/sander-garpai-rock-pvp/manifest.json',{sceneId:'loader-fixture'});
  await json('scene/sander-garpai-rock-pvp/collision.json',{lines:[]});
  await json('rf/manifest.json',{referenceVersion:FEEDBACK_FIXTURE_REFERENCE,effectAssetIndex:'effects.json',runtimePose:'character.pose.json',syntheticFixture:'loader-only'});
  await json('native/manifest.json',{modules:{geometry:{file:'geometry.wasm'}}});await write('native/geometry.wasm',Buffer.from([0,1,2,3]));
  for(const folder of ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'])await json('rf/'+folder+'/index.json',index);
  await json('rf/effects.json',{templates:{}});await json('rf/character.pose.json',{});
  const manifest={schemaVersion:1,unitClass:100,referenceVersion:FEEDBACK_FIXTURE_REFERENCE,runtimeGlb:'character.glb',runtimePose:'character.pose.json',syntheticFixture:'loader-only',
    effectAssetIndex:'effects.json',visualEffectIndexes:['fx/index.json'],audioManifest:'audio/manifest.json',portraits:{state:{file:'ui/state.png'}}};
  const complete=async()=>{
    await json('lk/manifest.json',manifest);await json('lk/fx/index.json',{...index,templates:{visual:{kind:'mesh',glb:'fx/visual.glb',textures:{main:{file:'fx/visual.png'}}}}});
    await json('lk/effects.json',{templates:{}});await json('lk/character.pose.json',{});
    await write('lk/character.glb',Buffer.from([42]));await write('lk/fx/visual.glb',Buffer.from([43]));await write('lk/fx/visual.png',Buffer.from([44]));
    await json('ui/skills/lk/catalog.json',{schemaVersion:1,classId:100,skills:[]});await write('lk/ui/state.png',Buffer.from([45]));
    await json('lk/audio/manifest.json',{files:{cue:{file:'../lk/audio/cue.ogg'}}});await write('lk/audio/cue.ogg',Buffer.from([46]));
  };
  return {assetRoot,write,json,index,manifest,complete,load:()=>loadServerCombatAssets({root,assetRoot})};
}

test('a prepared RF-only deployment remains available and reports the missing LK manifest',async t=>{
  const f=await fixture(t),assets=await f.load();assert.deepEqual(assets.professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.deepEqual(assets.assetDiagnostics,[{professionId:'LK',reason:'missing-profession-asset',file:'lk/manifest.json'},{professionId:'VC',reason:'missing-profession-asset',file:'vc/manifest.json'},{professionId:'RS',reason:'missing-profession-asset',file:'rs/manifest.json'},{professionId:'BM',reason:'missing-profession-asset',file:'bm/manifest.json'},{professionId:'IS',reason:'missing-profession-asset',file:'is/manifest.json'},...['GM','BH','CA','LP','MM','DE'].map(professionId=>({professionId,reason:'missing-profession-asset',file:professionId.toLowerCase()+'/manifest.json'}))]);
  assert.deepEqual(Object.keys(assets.profiles),['RF']);assert.deepEqual(Object.keys(assets.versions.professions),['RF']);
  const factory=await createBattleDriverFactory({root,assetRoot:f.assetRoot});assert.equal(typeof factory,'function');
  assert.deepEqual(factory.professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.deepEqual(factory.assetDiagnostics,assets.assetDiagnostics);
  const online=createOnlineService({driverFactory:factory,accountStore:{selectedProfession:()=> 'LK'}});t.after(()=>online.close());
  const status=online.status('saved-lk');assert.equal(status.available,true);assert.equal(status.professionId,'RF');
  assert.equal(status.selectedProfessionId,'LK');assert.deepEqual(status.professionDiagnostics,assets.assetDiagnostics);
});

test('partial LK JSON, model, effect, catalog, portrait and audio closures fall back to RF without sealing partial inputs',async t=>{
  const f=await fixture(t),baseline=await f.load();
  for(const missing of ['lk/fx/index.json','lk/effects.json','lk/character.pose.json','lk/character.glb','lk/fx/visual.glb',
    'lk/fx/visual.png','ui/skills/lk/catalog.json','lk/ui/state.png','lk/audio/manifest.json','lk/audio/cue.ogg']){
    await f.complete();await rm(path.join(f.assetRoot,missing));const partial=await f.load();
    assert.deepEqual(partial.professions,{RF:true,LK:false,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false},missing);assert.deepEqual(Object.keys(partial.profiles),['RF']);
    assert.equal(partial.assetDiagnostics[0].file,missing);assert.equal(partial.versions.resourceSha256,baseline.versions.resourceSha256,missing);
    assert.ok(!partial.fingerprints.resources.files.some(row=>row.file.startsWith('assets/lk/')||row.file==='packages/combat-core/lk-profile.json'));
  }
  await f.complete();const ready=await f.load();assert.deepEqual(ready.professions,{RF:true,LK:true,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});assert.deepEqual(ready.assetDiagnostics,[{professionId:'VC',reason:'missing-profession-asset',file:'vc/manifest.json'},{professionId:'RS',reason:'missing-profession-asset',file:'rs/manifest.json'},{professionId:'BM',reason:'missing-profession-asset',file:'bm/manifest.json'},{professionId:'IS',reason:'missing-profession-asset',file:'is/manifest.json'},...['GM','BH','CA','LP','MM','DE'].map(professionId=>({professionId,reason:'missing-profession-asset',file:professionId.toLowerCase()+'/manifest.json'}))]);
  assert.ok(ready.versions.professions.LK);assert.ok(ready.fingerprints.resources.files.some(row=>row.file==='assets/ui/skills/lk/catalog.json'));
});

test('malformed LK data, wrong source class, declaration conflicts and escaping file paths reject instead of hiding behind availability',async t=>{
  const f=await fixture(t);await f.complete();await f.write('lk/fx/index.json','{');await assert.rejects(f.load(),SyntaxError);
  await f.complete();await f.json('lk/manifest.json',{...f.manifest,unitClass:107});await assert.rejects(f.load(),/lk-source-class-mismatch/);
  await f.complete();await f.json('lk/manifest.json',{...f.manifest,runtimeGlb:undefined});await assert.rejects(f.load(),/invalid-lk-runtime-manifest/);
  await f.complete();await f.json('ui/skills/lk/catalog.json',{classId:107});await assert.rejects(f.load(),/lk-skill-catalog-class-mismatch/);
  await f.complete();await f.json('lk/manifest.json',{...f.manifest,runtimeGlb:'../../outside.glb'});await assert.rejects(f.load(),/invalid-lk-runtime-asset-path/);
  await f.complete();await f.json('lk/manifest.json',{...f.manifest,visualEffectIndexes:['fx/index.json','other/index.json']});
  await f.json('lk/other/index.json',{...f.index,templates:{visual:{kind:'different'}}});await assert.rejects(f.load(),/Conflicting original effect declaration/);
  assert.equal(JSON.parse(await readFile(path.join(f.assetRoot,'rf/manifest.json'),'utf8')).referenceVersion,FEEDBACK_FIXTURE_REFERENCE);
});

test('synthetic loader still rejects a foreign target identity before accepting overlay poses',async t=>{
  const f=await fixture(t);assert.equal((await f.load()).professions.RF,true);
  for(const folder of ['fx','buff-fx','shadow-weapon-fx','awakening-fx','critical-fx','core-shield-fx','skill-fx-v11','xx2x-fx','xxx-fx','archenemy-fx-v17'])
    await f.json('rf/'+folder+'/index.json',{...f.index,referenceVersion:'foreign-source-fixture'});
  await assert.rejects(f.load(),/Player feedback visual target version mismatch/);
});

test('IS discovery seals its own class112 inputs atomically and incomplete IS never disables existing LK',async t=>{
  const f=await fixture(t);await f.complete();const baseline=await f.load();
  const complete=async()=>{
    await f.json('is/manifest.json',{...f.manifest,unitClass:112,portraits:{state:{file:'ui/portrait-state.png'},party:{file:'ui/portrait-party.png'}}});
    await f.json('is/fx/index.json',{...f.index,templates:{visual:{kind:'mesh',glb:'../lk/fx/visual.glb',textures:{main:{file:'../lk/fx/visual.png'}}}}});
    await f.json('is/effects.json',{templates:{}});await f.json('is/character.pose.json',{});
    await f.write('is/character.glb',Buffer.from([50]));
    await f.json('ui/skills/is/catalog.json',{schemaVersion:1,classId:112,skills:[]});
    for(const name of ['portrait-state','portrait-party'])await f.write('is/ui/'+name+'.png',Buffer.from([51]));
    await f.json('is/audio/manifest.json',{files:{cue:{file:'../lk/audio/cue.ogg'}}});
  };
  for(const missing of ['is/fx/index.json','is/character.glb','is/ui/portrait-party.png','is/ui/portrait-state.png','ui/skills/is/catalog.json']){
    await complete();await rm(path.join(f.assetRoot,missing));const partial=await f.load();
    assert.deepEqual(partial.professions,{RF:true,LK:true,VC:false,RS:false,BM:false,IS:false,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
    assert.equal(partial.assetDiagnostics.find(row=>row.professionId==='IS').file,missing);
    assert.equal(partial.versions.resourceSha256,baseline.versions.resourceSha256);
    assert.ok(!partial.fingerprints.resources.files.some(row=>row.file==='packages/combat-core/is-profile.json'));
  }
  await complete();const ready=await f.load();assert.deepEqual(ready.professions,{RF:true,LK:true,VC:false,RS:false,BM:false,IS:true,GM:false,BH:false,CA:false,LP:false,MM:false,DE:false});
  assert.equal(ready.profiles.IS.target.unitClass,112);assert.match(ready.versions.professions.IS.profile,/^[a-f0-9]{64}$/);
  assert.notEqual(ready.versions.professions.IS.profile,ready.versions.professions.LK.profile);
  assert.ok(ready.fingerprints.resources.files.some(row=>row.file==='assets/ui/skills/is/catalog.json'));
  await f.json('ui/skills/is/catalog.json',{classId:100});await assert.rejects(f.load(),/source-class-mismatch|catalog-class-mismatch/);
});

test('BM publishes its independent class and version only after its model, UI and audio closure is complete',async t=>{
  const f=await fixture(t),manifest={...f.manifest,unitClass:106};
  const complete=async()=>{
    await f.json('bm/manifest.json',manifest);await f.json('bm/fx/index.json',f.index);
    await f.json('bm/effects.json',{templates:{}});await f.json('bm/character.pose.json',{});
    await f.write('bm/character.glb',Buffer.from([42]));await f.write('bm/ui/state.png',Buffer.from([45]));
    await f.json('ui/skills/bm/catalog.json',{schemaVersion:1,classId:106,skills:[]});
    await f.json('bm/audio/manifest.json',{files:{cue:{file:'../bm/audio/cue.ogg'}}});await f.write('bm/audio/cue.ogg',Buffer.from([46]));
  };
  const baseline=await f.load();
  for(const missing of ['bm/character.glb','bm/character.pose.json','bm/ui/state.png','ui/skills/bm/catalog.json','bm/audio/cue.ogg']){
    await complete();await rm(path.join(f.assetRoot,missing));const result=await f.load();
    assert.equal(result.professions.BM,false,missing);assert.equal(result.professions.RF,true);
    assert.equal(result.versions.resourceSha256,baseline.versions.resourceSha256);
    assert.equal(result.versions.professions.BM,undefined);
    assert.equal(result.assetDiagnostics.find(row=>row.professionId==='BM').file,missing);
  }
  await complete();const result=await f.load();assert.equal(result.professions.BM,true);assert.equal(result.profiles.BM.target.unitClass,106);
  assert.notEqual(result.versions.professions.BM.profile,result.versions.professions.RF.profile);
  await f.json('ui/skills/bm/catalog.json',{schemaVersion:1,classId:107,skills:[]});await assert.rejects(f.load(),/class-mismatch/);
});
