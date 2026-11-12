import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {createRenderPreparationCache,updateControlledEffectLookup} from '../../apps/web/render-preparation.mjs';
import {createEffectPrewarmPlanner,collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));

test('shader preparation shares pending work and retries rejected/synchronously thrown variants',async()=>{
  const prepare=createRenderPreparationCache();let calls=0,release;
  const mesh={material:{forceCompilationAsync(){calls++;return new Promise(resolve=>{release=resolve;});}}};
  const first=prepare(mesh,{useInstances:true}),second=prepare(mesh,{useInstances:true});
  assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);release();await first;
  assert.equal(prepare(mesh,{useInstances:true}),first);assert.equal(calls,1);
  mesh.material.forceCompilationAsync=()=>{calls++;throw Error('compile failure');};
  await assert.rejects(prepare(mesh),/compile failure/);assert.equal(calls,2);
  mesh.material.forceCompilationAsync=async()=>{calls++;};await prepare(mesh);assert.equal(calls,3);
  await prepare(mesh);assert.equal(calls,3);
});

test('reused controlled-effect lookup preserves inclusion, duplicate IDs, ordering and packet identity',()=>{
  const lookup=new Map([['obsolete',{}]]),effects=[{id:'plain'},
    {id:'anchor',sourcePosedAnchor:{}},{id:'arc',sourceArcHandle:1},{id:'negative',sourceArcHandle:-1},
    {id:'skill',sourceSkillMeshControl:true},{id:'crash',sourceXCrashMeshClock:{}},
    {id:'arc',sourceArcHandle:2}];
  const original=structuredClone(effects),expected=new Map(effects.filter(e=>e.sourcePosedAnchor||e.sourceArcHandle>0||e.sourceSkillMeshControl||e.sourceXCrashMeshClock).map(e=>[e.id,e]));
  assert.equal(updateControlledEffectLookup(lookup,effects),lookup);assert.deepEqual([...lookup],[...expected]);
  assert.equal(lookup.get('arc'),effects.at(-1));assert.deepEqual(effects,original);
  updateControlledEffectLookup(lookup,[{id:'plain'}]);assert.equal(lookup.size,0);
  updateControlledEffectLookup(lookup,undefined);assert.equal(lookup.size,0);
});

test('one-entry preparation plan matches actual source closures and trait changes reuse it',()=>{
  const profile=read('packages/combat-core/rf-profile.json'),index=read('contracts/rf-fx-index.json');
  const planner=createEffectPrewarmPlanner(profile,index),slots=[{skillId:24032,branchId:'none'},null];
  const before=structuredClone(slots),plan=planner(slots);
  assert.deepEqual(plan,collectEffectMeshBudget(profile,index,slots));
  assert.equal(planner([{skillId:24032,branchId:'memo-11'},null]),plan);
  const other=planner([{skillId:24203},null]);assert.notEqual(other,plan);
  assert.deepEqual(other,collectEffectMeshBudget(profile,index,[{skillId:24203},null]));
  assert.notEqual(planner(slots),plan,'only the last loadout plan is retained');assert.deepEqual(slots,before);
});

test('production particle prewarm failure is retried without a duplicate batch or lost material',async t=>{
  const index=read('contracts/rf-buff-display-fx-index.json'),selected={...index,templates:{UnitStunB:index.templates.UnitStunB}};
  const full=read('packages/combat-core/rf-profile.json'),profile={...full,states:{skill:{raw:'UnitStunB'}},
    skillCatalog:[{skillId:10,states:['skill']}],effectSets:{},damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('prewarm',new Vector3(0,0,10),scene);
  const view=await createEffectsView({scene,engine,index:selected,profile,samplers:{}});
  t.after(()=>{view.clear();scene.dispose();engine.dispose();});
  let calls=0;t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async function(){if(++calls===1)throw Error('injected shader failure');});
  const slots=[{skillId:10}];await assert.rejects(view.prewarm(slots),/injected shader failure/);
  assert.equal(view.proof().prewarmedTemplates,0);assert.equal(view.proof().batchedQuadMaterials,1);
  const batch=scene.meshes.find(m=>m.name.startsWith('native-particle:UnitStunB|'));assert.ok(batch);
  await Promise.all([view.prewarm(slots),view.prewarm(slots)]);assert.equal(calls,2);
  assert.equal(view.proof().prewarmedTemplates,1);assert.equal(view.proof().batchedQuadMaterials,1);
  assert.equal(scene.meshes.find(m=>m.name.startsWith('native-particle:UnitStunB|')),batch);
  await view.prewarm(slots);assert.equal(calls,2);
});
