import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {NullEngine,Scene} from '@babylonjs/core';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';
import {createAddSummonView} from '../../apps/web/add-summon-view.mjs';
import {createAddSummonSamplers} from '../../packages/combat-assets/add-summon-samplers.mjs';
const root=process.env.PROFESSION_ASSET_FIXTURE_ROOT??resolve(import.meta.dirname,'../..'),dir='mm/summons/apocalypse/';
const json=file=>JSON.parse(readFileSync(resolve(root,'artifacts',file)));
const manifest=json(dir+'manifest.json'),pose=json(dir+manifest.poseData);
const npc=(serial=1,overrides={})=>({kind:'apocalypse',serial,state:'APOCALYPSE_ATTACK_C',animationTime:.75,position:[101,203,307],facing:1,yaw:37,aimZ:-24,...overrides});
function counts(scene){return Object.fromEntries(['meshes','materials','multiMaterials','textures','skeletons','animationGroups','transformNodes'].map(name=>[name,scene[name].length]));}
async function fixture(t,style=()=>{}){
 const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
 const container=await loadPoseContainer(scene,resolve(root,'artifacts',dir,manifest.runtimeGlb),{materials:true});
 const before=counts(scene),views=[];
 const view=createAddSummonView({scene,assets:{manifest,pose,bodyContainer:container},styleView:v=>{views.push(v);style(v);}});
 t.after(()=>{view.dispose();container.dispose();scene.dispose();engine.dispose();});
 return {scene,view,views,before};
}
function closePoint(actual,expected){for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<.002,`${actual} vs ${expected}`);}
function point(view){const matrix=view.nodesBySourceName.get('Dummy_B15').computeWorldMatrix(true).asArray();return [matrix[12]*100,matrix[13]*100,-matrix[14]*100];}
test('actual MM roster is prepared once; repeated expiry and serial changes preserve original poses without more clones',async t=>{
 const f=await fixture(t),sampler=createAddSummonSamplers({manifest,pose});
 const actors=[{id:'one',professionId:'MM'},{id:'two',professionId:'MM'},{id:'other',professionId:'RF'}];
 await f.view.prewarmActors(actors);
 assert.equal(f.views.length,2);assert.deepEqual(f.view.proof().preparation.ready,['one','two']);
 assert.equal(f.views.every(v=>!v.root.isEnabled()),true);const resident=counts(f.scene);
 for(let i=0;i<24;i++){
  actors[0].sourceAddSummon=npc(i+1,{state:i%2?'APOCALYPSE_WAIT':'APOCALYPSE_ATTACK_C',animationTime:i*.17,yaw:i*7,aimZ:i%3*11});
  f.view.update(actors);
  closePoint(point(f.views[0]),sampler.summonPoseSampler(actors[0].sourceAddSummon,{BONE_NAME:'Dummy_B15'}).position);
  assert.equal(f.view.proof().instances,1);assert.equal(f.views[0].root.isEnabled(),true);
  if(i%2){actors[0].sourceAddSummon=null;f.view.update(actors);assert.equal(f.view.proof().instances,0);assert.equal(f.views[0].root.isEnabled(),false);}
  assert.deepEqual(counts(f.scene),resident);
 }
 assert.equal(f.view.proof().preparation.runtimeCreates,0);assert.equal(f.view.proof().preparation.unpreparedActivations,0);
 assert.equal(f.views.length,2);
 f.view.reset();assert.equal(f.view.proof().instances,0);assert.equal(f.view.proof().preparation.residentViews,2);
 assert.equal(f.views.every(v=>!v.root.isEnabled()),true);
 f.view.clear();assert.deepEqual(counts(f.scene),f.before);assert.equal(f.view.proof().preparation.residentViews,0);
});
test('simultaneous owners retain independent nodes, material state and changing original yaw/aim',async t=>{
 const f=await fixture(t),sampler=createAddSummonSamplers({manifest,pose}),a={id:'one',professionId:'MM',sourceAddSummon:npc()},b={id:'two',professionId:'MM',sourceAddSummon:npc(7,{yaw:147,aimZ:33,position:[-91,299,-71]})};
 await f.view.prewarmActors([a,b]);f.view.update([a,b]);
 for(let i=0;i<2;i++)closePoint(point(f.views[i]),sampler.summonPoseSampler([a,b][i].sourceAddSummon,{BONE_NAME:'Dummy_B15'}).position);
 const old=point(f.views[0]);b.sourceAddSummon.animationTime=1.9;b.sourceAddSummon.state='APOCALYPSE_ATTACK_B';f.view.update([a,b]);
 assert.deepEqual(point(f.views[0]),old);assert.notEqual(f.views[0].meshes[1].material,f.views[1].meshes[1].material);
 b.pvpDisconnected=true;f.view.update([a,b]);assert.equal(f.view.proof().instances,1);assert.equal(f.views[1].root.isEnabled(),false);
 await f.view.prewarmActors([a,b]);assert.equal(f.views[1].disposed,true);assert.deepEqual(f.view.proof().preparation.owners,['one']);
});
test('overlapping preparation shares owners; removal and clear invalidate queued creation and late publication',async t=>{
 const f=await fixture(t),actors=[{id:'one',professionId:'MM'}];
 const obsolete=f.view.prewarmActors(actors);f.view.clear();await obsolete;
 assert.equal(f.views.length,0);assert.deepEqual(counts(f.scene),f.before);
 await Promise.all([f.view.prewarmActors(actors),f.view.prewarmActors(actors)]);assert.equal(f.views.length,1);
 await f.view.prewarmActors([{id:'replacement',professionId:'MM'}]);
 assert.equal(f.views[0].disposed,true);assert.deepEqual(f.view.proof().preparation.ready,['replacement']);
 f.view.dispose();await f.view.prewarmActors(actors);f.view.update([{...actors[0],sourceAddSummon:npc()}]);
 assert.equal(f.view.proof().instances,0);assert.deepEqual(counts(f.scene),f.before);
});
test('a summon appearing before preparation completes is adopted without hidden or duplicate models',async t=>{
 const f=await fixture(t),a={id:'one',professionId:'MM',sourceAddSummon:npc()};
 const pending=f.view.prewarmActors([a]);f.view.update([a]);const displayed=f.views[0],before=point(displayed);
 await pending;assert.equal(f.views.length,1);assert.equal(displayed.root.isEnabled(),true);assert.deepEqual(point(displayed),before);
 assert.equal(f.view.proof().preparation.runtimeCreates,1);assert.equal(f.view.proof().preparation.preparationCreates,0);
 a.sourceAddSummon=npc(2);f.view.update([a]);assert.equal(f.views.length,1);assert.equal(f.view.proof().instances,1);
});
test('failed material preparation propagates, releases only its own clone and can be retried',async t=>{
 let fail=true;const f=await fixture(t,v=>{
  if(fail){const mesh=v.meshes.find(m=>m.material&&m.getTotalVertices());mesh.material.forceCompilationAsync=()=>Promise.reject(new Error('injected shader failure'));}
 });
 await assert.rejects(f.view.prewarmActors([{id:'one',professionId:'MM'}]),/injected shader failure/);
 assert.deepEqual(counts(f.scene),f.before);assert.equal(f.view.proof().preparation.residentViews,0);
 fail=false;await f.view.prewarmActors([{id:'one',professionId:'MM'}]);assert.deepEqual(f.view.proof().preparation.ready,['one']);
 f.view.clear();assert.deepEqual(counts(f.scene),f.before);
});
