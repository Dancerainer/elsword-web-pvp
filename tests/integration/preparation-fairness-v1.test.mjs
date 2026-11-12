import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {createPreparationScheduler} from '../../apps/web/render-preparation.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
function particleFixture(){
  const source=read('contracts/rf-buff-display-fx-index.json'),template=source.templates.UnitStunB;
  const names=Array.from({length:48},(_,i)=>`FairnessStun${i}`);
  const index={...source,templates:Object.fromEntries(names.map(name=>[name,{...template,name}]))};
  const full=read('packages/combat-core/rf-profile.json'),profile={...full,states:{},skillCatalog:[],effectSets:{},damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:names};
  return {names,index,profile};
}

test('cached preparation yields to a waiting timer within a bounded batch across producers',async()=>{
  const schedule=createPreparationScheduler({maxBatchSize:4,maxBatchMs:1000});
  let completed=0,atTimer;
  const timer=new Promise(resolve=>setTimeout(()=>{atTimer=completed;resolve();},0));
  await Promise.all(Array.from({length:4},async()=>{
    for(let i=0;i<8;i++)await schedule(()=>{completed++;});
  }));
  await timer;assert.equal(completed,32);assert.ok(atTimer>0&&atTimer<=4,`timer ran after ${atTimer} jobs`);
});

test('elapsed preparation time also yields before the operation cap and failures do not block the queue',async()=>{
  let clock=0,completed=0,atTimer;
  const schedule=createPreparationScheduler({maxBatchSize:100,maxBatchMs:8,now:()=>clock});
  const timer=new Promise(resolve=>setTimeout(()=>{atTimer=completed;resolve();},0));
  const jobs=Array.from({length:10},(_,i)=>schedule(()=>{clock+=5;completed++;if(i===3)throw Error('failed preparation');return i;}));
  const results=await Promise.allSettled(jobs);await timer;
  assert.equal(atTimer,2);assert.equal(completed,10);assert.equal(results[3].status,'rejected');
  assert.equal(results[9].value,9);
});

test('production resource prewarm services timers even when shader preparation resolves immediately',async t=>{
  const {names,index,profile}=particleFixture();
  const engine=new NullEngine(),scene=new Scene(engine);new FreeCamera('fairness',new Vector3(0,0,10),scene);
  let view;t.after(()=>{view?.clear();scene.dispose();engine.dispose();});
  let compiled=0,atTimer;
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{compiled++;});
  const timer=new Promise(resolve=>setTimeout(()=>{atTimer=compiled;resolve();},0));
  view=await createEffectsView({scene,engine,index,profile,samplers:{}});await timer;
  assert.equal(view.proof().prewarmedTemplates,names.length);assert.equal(compiled,names.length);
  assert.ok(atTimer<compiled,`timer waited for all ${compiled} shader preparations`);
});

test('an early shader rejection remains observed while later production batches yield',async t=>{
  const {index,profile}=particleFixture(),engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('fairness-failure',new Vector3(0,0,10),scene);
  t.after(()=>{scene.dispose();engine.dispose();});
  let calls=0,timerRan=false;
  t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{if(++calls===1)throw Error('first shader failed');});
  const timer=new Promise(resolve=>setTimeout(()=>{timerRan=true;resolve();},0));
  await assert.rejects(createEffectsView({scene,engine,index,profile,samplers:{}}),/first shader failed/);
  await timer;assert.equal(timerRan,true);assert.ok(calls>16,'failure was retained across subsequent preparation batches');
});
