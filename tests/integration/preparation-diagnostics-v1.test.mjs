import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine,Scene,FreeCamera,Vector3,ShaderMaterial} from '@babylonjs/core';
import {createPreparationDiagnostics} from '../../apps/web/render-preparation.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {performanceProbeCase,createPerformanceProbeProgress} from '../../tools/performance-probe-progress.mjs';

test('preparation telemetry identifies pending work and observes original success/failure without replacing promises',async()=>{
  let clock=0,resolve,reject;const updates=[];
  const d=createPreparationDiagnostics(p=>updates.push(p),{templates:2,now:()=>clock});
  const first=new Promise(r=>{resolve=r;}),second=new Promise((_,r)=>{reject=r;});
  d.phase('starting');d.template('original-fate-mesh');d.created();
  assert.equal(d.observe(first,'original-fate-mesh / child78'),first);
  d.observe(second,'original-fate-mesh / child79');clock=500;d.phase('awaiting-shaders');
  assert.equal(updates.at(-1).pendingJobs,2);assert.equal(updates.at(-1).createdViews,1);
  assert.equal(updates.at(-1).oldestPending.label,'original-fate-mesh / child78');
  assert.equal(updates.at(-1).oldestPending.ageMs,500);
  resolve();await first;reject(Error('shader rejection'));await assert.rejects(second,/shader rejection/);
  d.finish(Error('shader rejection'));const last=updates.at(-1);
  assert.equal(last.phase,'failed');assert.equal(last.pendingJobs,0);assert.equal(last.completedJobs,1);assert.equal(last.failedJobs,1);
  assert.match(last.error,/shader rejection/);assert.equal(createPreparationDiagnostics(undefined),null);
});

test('single-case query is zero based, explicit, and rejects invalid or out-of-range values',()=>{
  const cases=Array(6).fill(null);
  assert.equal(performanceProbeCase(new URLSearchParams('suite=1'),cases),null);
  assert.equal(performanceProbeCase(new URLSearchParams('case=5'),cases),5);
  for(const value of ['','-1','6','5x','1.2','01'])assert.throws(()=>performanceProbeCase(new URLSearchParams({case:value}),cases),/zero-based/);
});

test('production prewarm reports the failing source template and still rejects its original shader failure',async t=>{
  const read=file=>JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
  const full=read('packages/combat-core/rf-profile.json'),source=read('contracts/rf-buff-display-fx-index.json');
  const profile={...full,states:{},skillCatalog:[],effectSets:{},damageEffects:{},buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:['UnitStunB']};
  const index={...source,templates:{UnitStunB:source.templates.UnitStunB}},engine=new NullEngine(),scene=new Scene(engine);
  new FreeCamera('diagnostics',new Vector3(0,0,10),scene);t.after(()=>{scene.dispose();engine.dispose();});
  const updates=[];t.mock.method(ShaderMaterial.prototype,'forceCompilationAsync',async()=>{throw Error('injected terminal failure');});
  await assert.rejects(createEffectsView({scene,engine,index,profile,samplers:{},onPreparationProgress:p=>updates.push(p)}),/injected terminal failure/);
  const last=updates.at(-1);assert.equal(last.phase,'failed');assert.equal(last.template,'UnitStunB');
  assert.equal(last.failedJobs,1);assert.equal(last.pendingJobs,0);assert.match(last.error,/injected terminal failure/);
});

test('browser probe shows pending preparation before await and exposes failure without stale saved output',async()=>{
  const status={textContent:'previous saved'},output={textContent:'previous report',dataset:{report:'old'}},button={},select={},errors=[];
  let clock=0,tick,canceled=0,release;
  const reporter=createPerformanceProbeProgress({status,output,button,select,errors,now:()=>clock,
    interval:fn=>{tick=fn;return 1;},cancelInterval:()=>{canceled++;},readProgress:()=>({CA:{phase:'awaiting-shaders',template:'Fate',createdViews:3025,pendingJobs:78}})});
  const work=reporter.prepare('CA Fate',()=>new Promise((_,reject)=>{release=reject;}));
  assert.equal(button.disabled,true);assert.equal(select.disabled,true);assert.equal(output.dataset.report,undefined);
  assert.match(status.textContent,/Preparing.*CA Fate/);clock=1500;tick();assert.match(status.textContent,/1.5 s.*Pending: 78/);
  release(Error('injected prepare failure'));assert.equal(await work,false);
  assert.equal(button.disabled,false);assert.equal(select.disabled,false);assert.equal(canceled,1);
  assert.match(status.textContent,/Failed.*preparation/);assert.match(output.textContent,/injected prepare failure/);
  assert.equal(reporter.snapshot().phase,'preparation');
  assert.equal(await reporter.prepare('CA retry',async()=>{}),true);assert.equal(reporter.snapshot().phase,'ready');
  assert.equal(button.disabled,true,'successful preparation leaves controls disabled during the timed case');
  reporter.failed(Error('capture failed'),'capture-or-next-preparation');assert.match(output.textContent,/capture failed/);
});
