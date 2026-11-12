import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {NullEngine,Scene,FreeCamera,Vector3,SceneLoader} from '@babylonjs/core';
import {collectEffectMeshBudget} from '../../apps/web/effect-prewarm.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';
import {make,profile,visualIndex,poses,fixtureRoot} from '../helpers/rf-passive-fixture-v12.mjs';
import {loadPoseContainer} from '../helpers/babylon-assets.mjs';

const high={level:'high',particleDivisor:1},medium={level:'medium',particleDivisor:8},slots=[{skillId:24025}];
const particle=(name,fields,extra={})=>({name,kind:'particle',fields:{NumParticles:1,Emitrate:200,Lifetime:.2,TriggerCount:1,...fields},events:[],repeated:{},...extra});
const source=templates=>({profile:{states:{source:{raw:'parent'}},skillCatalog:[]},index:{templates}});

test('Maximum Cannon pool sums the literal repeated Trace list with source-bounded parent births at both qualities',()=>{
  const parent=visualIndex.templates.MaximumCannon_PM,child=visualIndex.templates.MaximumCannon_P05;
  assert.deepEqual([parent.fields.NumParticles,parent.fields.Emitrate,parent.fields.Lifetime],[12,12,.8]);
  assert.equal(parent.fields.TriggerCount,undefined,'the live cap is not a cumulative birth limit');
  assert.ok(parent.repeated.TraceParticleList.includes('MaximumCannon_P05'),'the mesh is not the first Trace field');
  assert.deepEqual([child.fields.NumParticles,child.fields.TriggerCount,child.fields.Emitrate,child.fields.Lifetime],[20,20,200,.2]);
  const raw=profile.damageEffects.DamageEffect_SA_Raven_MaximumCannon.raw;
  assert.equal(raw.PASSIVE_PARTICLE0.PARTICLE_NAME,parent.name);
  assert.equal(visualIndex.templates[raw.MAIN_EFFECT_NAME].fields.LifeTime,1);
  // One source second plus two fixed boundary packets and one emission carry:
  // ceil(12*(1+2/60))+1 =14 parent births. Each source child can hold20 meshes.
  const full=collectEffectMeshBudget(profile,visualIndex,slots,{effectQuality:high});
  assert.deepEqual(full.demands.get(child.name),{views:280,peakParticles:20,drawCount:1,effectSetInstances:14});
  const reduced=collectEffectMeshBudget(profile,visualIndex,slots,{effectQuality:medium});
  assert.deepEqual(reduced.demands.get(child.name),{views:9,peakParticles:3,drawCount:1,effectSetInstances:3});
  assert.equal(reduced.demands.get('MaximumCannonP02').peakParticles,1,'singleton child keeps divisor1');
  assert.equal(reduced.demands.get('MaximumCannonP02').drawCount,2,'both authored singleton passes remain');
  assert.deepEqual(full.unsupported,[]);assert.deepEqual(reduced.unsupported,[]);
});

test('finite Final children sum source parent birth count, and repeated duplicate Trace entries stay distinct',()=>{
  const parent=particle('parent',{NumParticles:2,TriggerCount:3,FinalParticleList:'mesh',TraceParticleList:'mesh'},
    {repeated:{TraceParticleList:['mesh','mesh']}});
  const mesh=particle('mesh',{DrawCount:2},{glb:'original.glb'}),fixture=source({parent,mesh});
  const result=collectEffectMeshBudget(fixture.profile,fixture.index,[],{effectQuality:high});
  assert.deepEqual(result.demands.get('mesh'),{views:18,peakParticles:1,drawCount:2,effectSetInstances:9},'3 births times2 Trace +1 Final times2 draws');
});

test('an unbounded parent keeps finite basic prewarm without mistaking its live cap for a complete burst bound',()=>{
  const parent=particle('parent',{NumParticles:2,TriggerCount:-1,TraceParticleList:'mesh',FinalParticleList:'mesh'});
  const mesh=particle('mesh',{}, {glb:'original.glb'}),fixture=source({parent,mesh});
  const result=collectEffectMeshBudget(fixture.profile,fixture.index,[]);
  assert.deepEqual(result.demands.get('mesh'),{views:1,peakParticles:1,drawCount:1,effectSetInstances:1,
    burstUpperBound:false,budgetScope:'single-emitter-lower-bound'});
  assert.ok(result.unsupported.some(row=>row.name==='mesh'&&/finite.*birth count/.test(row.detail)));
});

test('Final descendants are detached and cannot borrow the expired parent particle emission window',()=>{
  const parent=particle('parent',{FinalParticleList:'tail'});
  const tail=particle('tail',{NumParticles:2,TriggerCount:-1,TraceParticleList:'mesh'});
  const mesh=particle('mesh',{}, {glb:'original.glb'}),fixture=source({parent,tail,mesh});
  const result=collectEffectMeshBudget(fixture.profile,fixture.index,[]);
  assert.equal(result.demands.get('mesh').views,1);
  assert.equal(result.demands.get('mesh').burstUpperBound,false);
  assert.ok(result.unsupported.some(row=>/for tail;/.test(row.detail)));
});

test('recursive Trace descendants report an unsupported pool bound',()=>{
  const parent=particle('parent',{TraceParticleList:'mesh'});
  const mesh=particle('mesh',{FinalParticleList:'parent'}, {glb:'original.glb'}),fixture=source({parent,mesh});
  const result=collectEffectMeshBudget(fixture.profile,fixture.index,[]);
  assert.equal(result.demands.get('mesh').views,1);
  assert.equal(result.demands.get('mesh').burstUpperBound,false);
  assert.ok(result.unsupported.some(row=>/Recursive/.test(row.detail)));
});

test('actual Wild Charge source keeps its original high40/medium6 one-emitter pool while reporting incomplete burst coverage',()=>{
  const parent=visualIndex.templates.Raven_ReadyS_PML1,mesh=visualIndex.templates.Raven_ReadyS_PML01;
  assert.deepEqual([parent.fields.Emitrate,parent.fields.Lifetime,parent.fields.NumParticles,parent.fields.TriggerCount],[5,.8,5,undefined]);
  assert.ok(parent.repeated.TraceParticleList.includes(mesh.name));
  assert.deepEqual([mesh.fields.NumParticles,mesh.fields.TriggerCount,mesh.fields.DrawCount],[20,20,2]);
  for(const [effectQuality,views]of [[high,40],[medium,6]]){
    const result=collectEffectMeshBudget(profile,visualIndex,[{skillId:24009}],{effectQuality});
    assert.equal(result.demands.get(mesh.name).views,views);
    assert.equal(result.demands.get(mesh.name).effectSetInstances,1);
    assert.equal(result.demands.get(mesh.name).burstUpperBound,false);
    assert.equal(result.demands.get(mesh.name).budgetScope,'single-emitter-lower-bound');
    assert.ok(result.unsupported.some(row=>row.name===mesh.name&&/parent-particle birth/.test(row.detail)));
  }
});

test('actual native Wild Charge first Trace birth reuses its retained basic pool at both qualities without claiming a whole charge bound',async t=>{
  const parent=visualIndex.templates.Raven_ReadyS_PML1,mesh=visualIndex.templates.Raven_ReadyS_PML01;
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,s)=>loadPoseContainer(s,resolve(fixtureRoot,'artifacts/rf',file)));
  for(const [effectQuality,views]of [[high,40],[medium,6]]){
    const sim=await make({skillId:24009,passives:[],positions:[[2022.98,2840,0],[3200,2840,0]]});sim.drainEvents();
    // Keep the real source Trace declarations/native hold; omit quad/image IO.
    const index={templates:{[parent.name]:{...parent,fields:{...parent.fields,DrawCount:0}},[mesh.name]:mesh}};
    const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
    new FreeCamera('wild-trace-basic-pool',new Vector3(20,32,85),scene);
    const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,loadout:[{skillId:24009}],effectQuality,
      samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler}});
    try{
      assert.equal(view.proof().meshInstances,views);
      assert.equal(view.proof().meshPoolBudgets[mesh.name].burstUpperBound,false);
      let firstBirth=false,actualRequests=0;
      for(let frame=0;frame<360&&!firstBirth;frame++){
        sim.step(1/60,frame===0?{pressed:['A'],held:['A']}:{held:['A']},{snapshot:false});
        for(const event of sim.drainEvents()){
          if(event.type==='effectStarted'&&event.name===parent.name)actualRequests++;
          view.event(event,sim.state);
        }
        view.step(1/60,sim.state);view.render();
        assert.equal(view.proof().meshInstances,views,'the first real child birth must not lose its existing basic preparation');
        firstBirth=(view.proof({includeDraws:true}).nativeParticleDraws.counts[mesh.name]??0)>0;
      }
      assert.ok(actualRequests>0);assert.ok(firstBirth,'the native held cast must exercise its original mesh Trace route');
      // This verifies the retained first-birth capability; an arbitrary long
      // charge's whole-child concurrency remains explicitly unsupported.
      t.diagnostic(JSON.stringify({skillId:24009,quality:effectQuality.level,preparedBasicViews:views,burstUpperBound:false,firstBirthClones:0}));
    }finally{view.clear();scene.dispose();engine.dispose();}
  }
});

test('two real high Maximum Cannon casts reuse prepared original Trace meshes through birth, parent stop and tail expiry',async t=>{
  const sim=await make({skillId:24025,passives:[],positions:[[2022.98,2840,0],[3200,2840,0]]});sim.drainEvents();
  const parent=visualIndex.templates.MaximumCannon_PM,mesh=visualIndex.templates.MaximumCannon_P05;
  const mainName=profile.damageEffects.DamageEffect_SA_Raven_MaximumCannon.raw.MAIN_EFFECT_NAME;
  // Omit quad/image IO; preserve real parent cap/rate/lifetime/repeated lists,
  // native callback events, main lifetime and actual child GLB/pose topology.
  const index={templates:{[parent.name]:{...parent,fields:{...parent.fields,DrawCount:0}},
    [mesh.name]:mesh,[mainName]:{...visualIndex.templates[mainName],glb:undefined}}};
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('trace-pool',new Vector3(20,32,85),scene);
  t.mock.method(SceneLoader,'LoadAssetContainerAsync',async(_url,file,s)=>loadPoseContainer(s,resolve(fixtureRoot,'artifacts/rf',file)));
  const view=await createEffectsView({scene,engine,index,profile,effectPoses:poses,loadout:slots,effectQuality:high,
    samplers:{effectAnchorSampler:sim.effectAnchorSampler,effectBoneSampler:sim.effectBoneSampler}});
  try{
    const prepared=view.proof().meshInstances;assert.equal(prepared,280);
    let starts=0,ends=0,peak=0;
    for(let cast=0;cast<2;cast++){
      const actor=sim.actor('rf');actor.mp=300;actor.cooldowns={};actor.inputLock=0;
      sim.enter(actor,'RSI_WAIT','independent-recast-fixture');
      for(let frame=0;frame<360;frame++){
        sim.step(1/60,frame===0?{pressed:['A'],held:['A']}:{},{snapshot:false});
        for(const event of sim.drainEvents()){
          if(event.name==='DamageEffect_SA_Raven_MaximumCannon'&&event.type==='effectStarted')starts++;
          if(event.name==='DamageEffect_SA_Raven_MaximumCannon'&&event.type==='effectEnded')ends++;
          view.event(event,sim.state);
        }
        view.step(1/60,sim.state);view.render();
        peak=Math.max(peak,view.proof({includeDraws:true}).nativeParticleDraws.counts[mesh.name]??0);
        assert.equal(view.proof().meshInstances,prepared,`no battle-tick model clone in cast${cast} frame${frame}`);
      }
      assert.equal(view.count,0,'all actual Trace tails expire after the native parent stop');
      assert.equal(view.proof().activeEmitters,0);assert.equal(view.proof().activeEffectParents,0);
    }
    assert.equal(starts,2);assert.equal(ends,2);
    assert.ok(peak>childCap(mesh),'exercise more meshes than the old single-child-emitter20 pool');
    t.diagnostic(JSON.stringify({quality:'high',casts:starts,preparedMeshViews:prepared,observedMeshPeak:peak,battleTickClones:0}));
  }finally{view.clear();scene.dispose();engine.dispose();}
});
function childCap(template){return template.fields.NumParticles;}
