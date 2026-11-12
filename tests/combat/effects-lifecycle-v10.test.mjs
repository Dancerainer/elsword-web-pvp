import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NullEngine,Scene,FreeCamera,Vector3} from '@babylonjs/core';
import {createEffectRuntime} from '../../packages/effect-runtime/index.mjs';
import {createEffectsView} from '../../apps/web/effects-view.mjs';

const index=JSON.parse(readFileSync(new URL('../../contracts/rf-fx-index.json',import.meta.url)));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const pins={
  'X2Lib/X2EffectSet.cpp':'395a9f57eda3aec4011b65bbd186b612987c9e4f85e96766dd3c13b0d8288440',
  'KTDXLIB/KTDGParticleSystem.cpp':'43b5025740ed9c89a5f6f3617789abd68bcb18aaf8aaddef1b5ca9d3b9334050',
  'KTDXLIB/KTDGParticleSystem.h':'2146e70e9ca5e7a3a2d653923a7e7e6a2e0562fc07fba6ca8309c2c2cfa7ab74',
};
function source(name){const bytes=readFileSync(new URL('../../.cache/native-reference/'+name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pins[name]);return bytes.toString('latin1');}
function subset(names){return {...index,templates:Object.fromEntries(names.map(name=>[name,index.templates[name]]))};}
function actor(x=0){return {id:1,x,hp:800000,facing:1,stateSerial:1,awakening:{remaining:0}};}
async function viewFor(names){
  const engine=new NullEngine(),scene=new Scene(engine);scene.useRightHandedSystem=true;
  new FreeCamera('source-test-camera',new Vector3(0,0,10),scene);
  // This test exercises the production event adapter; it does not compile a GPU
  // shader or load geometry. The actual templates and EffectSet entries remain.
  const fixture={...profile,states:{},skillCatalog:[],buffTemplates:{},resourceOnlyEffectSets:[],resourceOnlyTemplates:[]};
  const view=await createEffectsView({engine,scene,index:subset(names),profile:fixture,
    samplers:{effectAnchorSampler:(_parent,a)=>({position:[a.x,0,0]})}});
  return {view,scene,dispose(){view.clear();scene.dispose();engine.dispose();}};
}
function begin(view,entry,id,state){view.event({type:'effectStarted',effectId:id,actorId:1,name:entry.NAME,
  definition:entry,birthAnchor:{position:[0,0,0],facing:1}},state);}

test('pinned V5 separates StopEffectSet destruction, Trace child AutoDie and TraceMore particle displacement',()=>{
  const effect=source('X2Lib/X2EffectSet.cpp'),particle=source('KTDXLIB/KTDGParticleSystem.cpp'),header=source('KTDXLIB/KTDGParticleSystem.h');
  const stop=effect.slice(effect.indexOf('void CX2EffectSet::StopEffectSet'),effect.indexOf('void CX2EffectSet::StopEffectSet')+3600);
  assert.match(stop,/SAFE_DELETE/,'StopEffectSet deletes the set instance');
  const destroy=effect.slice(effect.indexOf('CX2EffectSet::EffectInstance::~EffectInstance'),effect.indexOf('CX2EffectSet::EffectInstance::~EffectInstance')+10000);
  assert.match(destroy,/GetMajorParticle\(\)->DestroyInstanceHandle/);
  const clear=header.slice(header.indexOf('void ClearTraceSeqList()'),header.indexOf('void ClearTraceSeqList()')+1100);
  assert.match(clear,/pSeq->SetAutoDie\(\)/);assert.doesNotMatch(clear,/DestroyInstanceHandle/);
  const autoDie=header.slice(header.indexOf('void SetAutoDie()'),header.indexOf('void SetAutoDie()')+220);
  assert.match(autoDie,/SetEmitRate\(\s*CMinMax<float>\(0\.0f,\s*0\.0f\)\s*\)/);assert.match(autoDie,/SetTriggerTime\(\s*0\.0f\s*\)/);
  assert.match(effect,/pSeq->SetPosition\( vEffectPos, pEffectData->m_bTraceMore, pEffectData->m_bTraceMore \)/);
  const move=particle.slice(particle.indexOf('void CKTDGParticleSystem::CParticleEventSequence::SetPosition( const D3DXVECTOR3& pos, bool bUpdateOldPos'),particle.indexOf('void CKTDGParticleSystem::CParticleEventSequence::SetParticlePosition'));
  assert.match(move,/if\( true == bUpdateParticlePos \)/);assert.match(move,/particle\.SetPos\( particle\.GetPos\(\) \+ vDisplace \)/);
  assert.match(move,/if \( bUpdateOldPos == true \)\s*m_OldPosition = m_Position/);
});

test('actual 668X Flare and Impact particles are destroyed by the next original StopEffectSet event',async()=>{
  const set=profile.effectSets.EffectSet_RRF_DashJumpX.raw;
  const names=[set.EFFECT1.NAME,set.EFFECT2.NAME],{view,dispose}=await viewFor(names);
  try{
    const state={actors:[actor()]};begin(view,set.EFFECT1,11,state);begin(view,set.EFFECT2,12,state);
    view.step(.1,state);assert.equal(view.count,2,'actual 12/15 rates have both emitted');
    for(const effectId of [11,12])view.event({type:'effectEnded',effectId,reason:'original-stop-effect-set'},state);
    assert.equal(view.count,0,'native DestroyInstanceHandle retires existing main particles immediately');
    view.step(.1,state);assert.equal(view.count,0,'retired handles cannot emit again');
  }finally{dispose();}
});

test('ordinary stop emission keeps actual 668X particles until their original lifetime',async()=>{
  const entry=profile.effectSets.EffectSet_RRF_DashJumpX.raw.EFFECT1,{view,dispose}=await viewFor([entry.NAME]);
  try{const state={actors:[actor()]};begin(view,entry,11,state);view.step(.1,state);assert.equal(view.count,1);
    view.event({type:'effectEnded',effectId:11,reason:'time-bound'},state);assert.equal(view.count,1);
    view.step(.21,state);assert.equal(view.count,0);
  }finally{dispose();}
});

test('actual 668XX LimitCrusherAP05 expires but its 1.5-second RuneGuardFire child tail remains',()=>{
  assert.equal(index.templates.LimitCrusherAP05.fields.Lifetime,.2);
  assert.equal(index.templates.LimitCrusherAP05.fields.TraceParticleList,'RuneGuardFire_P03');
  assert.equal(index.templates.RuneGuardFire_P03.fields.Lifetime,1.5);
  const r=createEffectRuntime({index}),parent=r.emitParticle('LimitCrusherAP05',{position:[0,0,0]});
  r.step(.15,{});const child=[...r.particles.values()].find(p=>p.name==='RuneGuardFire_P03');assert.ok(child);
  r.step(.06,{});assert.equal(r.particles.has(parent.id),false);assert.equal(r.particles.has(child.id),true);
  const emitter=r.emitters.get(child.emitterId);assert.equal(emitter.done,true);assert.equal(emitter.options.parentParticleId,null);
  const emitted=emitter.count;r.step(.2,{});assert.equal(r.particles.has(child.id),true);assert.equal(emitter.count,emitted);
  r.step(1.3,{});assert.equal(r.count,0);assert.equal(r.emitters.size,0);
});

test('forced parent retirement uses AutoDie for actual RavenHandFireSP01; a global clear destroys every pool particle',()=>{
  const r=createEffectRuntime({index}),parent=r.emitParticle('Raven_Hand_FireSM');r.step(.02,{});
  const child=[...r.particles.values()].find(p=>p.name==='RavenHandFireSP01');assert.ok(child);
  r.stop(parent.emitterId,true);assert.equal(r.particles.has(parent.id),false);assert.equal(r.particles.has(child.id),true);
  assert.equal(r.emitters.get(child.emitterId).options.parentParticleId,null);
  r.clear();assert.equal(r.count,0);assert.equal(r.emitters.size,0);
});

test('668XX TRACE_MORE moves actual AP05 and AM01 particles once; ordinary TRACE does not override template Trace',()=>{
  const set=profile.effectSets.EffectSet_RRF_LandImpact.raw;
  for(const entry of [set.EFFECT3,set.EFFECT4,set.EFFECT0]){
    const control=createEffectRuntime({index}),moving=createEffectRuntime({index});
    for(const r of [control,moving])r.add(entry.NAME,{position:[0,0,0],anchor:s=>[s.x,0,0],follow:true,traceMore:entry.TRACE_MORE===1});
    for(const r of [control,moving])r.step(.02,{x:0});
    const ids=[...control.particles.values()].filter(p=>p.name===entry.NAME).map(p=>p.id);assert.ok(ids.length);
    control.step(.01,{x:0});moving.step(.01,{x:100});
    const expected=entry.TRACE_MORE===1?100:0;
    for(const id of ids){const a=control.particles.get(id),b=moving.particles.get(id);assert.ok(a&&b);
      assert.ok(Math.abs((b.position[0]-a.position[0])-expected)<1e-10,entry.NAME+' must apply exactly one position gap');}
    for(const e of moving.emitters.values())if(e.options.parentParticleId)assert.equal(e.options.traceMore,false,'independent trace children do not inherit EffectSet TRACE_MORE');
  }
});

test('production 668XX EffectSet adapter passes TRACE_MORE to original AP05 quad positions',async()=>{
  const entry=profile.effectSets.EffectSet_RRF_LandImpact.raw.EFFECT3,{view,scene,dispose}=await viewFor([entry.NAME,'RuneGuardFire_P03']);
  try{const state={actors:[actor()]};begin(view,entry,11,state);view.step(.02,state);
    state.actors[0].x=100;view.step(.01,state);view.render();
    const mesh=scene.meshes.find(m=>m.name.startsWith('native-particle:LimitCrusherAP05|'));assert.ok(mesh);
    assert.equal(mesh.thinInstanceCount,3);const matrices=mesh.thinInstanceGetWorldMatrices();
    assert.ok(Math.abs(matrices[0].m[12]-1)<1e-6,'existing particle follows 100 native units = 1 browser unit');
    assert.ok(Math.abs(matrices[1].m[12]-1)<1e-6);
  }finally{dispose();}
});
