import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture,elesisAssets} from '../helpers/elesis-fixture.mjs';
const cast=({sim,a},seconds=6)=>{sim.processInput(a,{held:new Set(),pressed:new Set(['A'])});for(let i=0;i<seconds*60;i++)sim.step(1/60,{});};
test('War Prelude applies its original factor list through a real allied carrier collision',()=>{
 const f=elesisFixture('GM',{skillId:28009,gap:200}),initialMax=f.a.mpMax;cast(f);
 assert.ok(f.sim.state.events.some(e=>e.type==='skillRecovery'&&e.targetId===f.a.id));
 assert.ok(f.a.buffs.some(b=>b.templateId===297));assert.equal(f.a.mpMax,initialMax+50);
 assert.ok(!f.b.buffs.some(b=>b.templateId===297));
});
test('Blazing Dance emits ordinary conditional damage carriers without inventing transformation',()=>{
 const f=elesisFixture('BH',{skillId:28016,gap:200});cast(f);
 const sets=f.sim.state.events.filter(e=>e.type==='effectSet').map(e=>e.name);
 assert.ok(sets.includes('EffectSet_SA_SBH_BLAZING_DANCE_Damage'));
 assert.ok(!sets.some(n=>n.includes('BLAZING_DANCE_TRANS_Damage')));
 assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId===f.a.id&&e.amount>0));
});
test('Burning Phantom flat regular list resolves Dummy01 against its own original effect mesh',()=>{
 const f=elesisFixture('CA',{skillId:28021,gap:200});cast(f);
 const starts=f.sim.state.events.filter(e=>e.type==='effectStarted'&&e.name==='DamageEffect_SA_SDK_BURNING_PHANTOM_START');
 assert.equal(starts.length,1);assert.equal(starts[0].sourceBoneTargetMeshBound,true);assert.ok(starts[0].birthAnchor);
 assert.ok(f.sim.state.events.some(e=>e.type==='hit'&&e.actorId===f.a.id&&e.origin.id===starts[0].effectId&&e.amount>0));
});
for(const facing of [-1,1])test(`Fate Smasher ${facing}: forced owner missing-frame fallback preserves head+70 and each original offset`,()=>{
 const f=elesisFixture('CA',{skillId:28605,gap:1000,facing}),sampler=elesisAssets('CA').samplers.effectAnchorSampler;
 f.sim.enter(f.a,'SI_HA_SCA_FATE_SMASHER','fate-anchor-evidence');f.a.animationTime=1;
 const head=sampler({definition:{BONE_NAME:'_HEAD_BONE'}},f.a).position;
 for(let n=1;n<=4;n++){
  const setName='EffectSet_HA_SCA_FATE_SMASHER_Attack'+n,d=f.profile.effectSets[setName].raw.EFFECT1;
  const anchor=sampler({setName,definition:d},f.a);
  assert.equal(d.TRACE_USER_TARGET_FORCE,1);assert.equal(d.BONE_NAME,'Dummy0'+(n===1?1:n===4?3:2));
  assert.deepEqual(anchor.position,[head[0]+facing*(n===1?200:1000),head[1]-(n===1?250:100),head[2]]);
 }
 assert.equal(sampler({setName:'unverified-callback',definition:{BONE_NAME:'Dummy01',TRACE_USER_TARGET_FORCE:1}},f.a),null);
 const run=elesisFixture('CA',{skillId:28605,gap:1000,facing});cast(run,12);
 const starts=run.sim.state.events.filter(e=>e.type==='effectStarted'&&e.name.startsWith('DamageEffect_HA_SCA_FATE_SMASHER_'));
 assert.equal(starts.length,4);assert.ok(starts.every(e=>e.birthAnchor&&!e.sourceBoneTargetMeshBound));
 assert.ok(run.sim.state.events.some(e=>e.type==='hit'&&e.actorId===run.a.id&&e.amount>0));
});
test('Fate Smasher keeps the far target outside original native helpers',()=>{
 const f=elesisFixture('CA',{skillId:28605,gap:2200});cast(f,12);
 assert.ok(!f.sim.state.events.some(e=>e.type==='hit'&&e.actorId===f.a.id));
});
test('Fate FX child particles bind only to their own original dummy while forced carriers remain actor-owned',()=>{
 const f=elesisFixture('CA',{skillId:28605,gap:1000});cast(f,10);
 const starts=f.sim.state.events.filter(e=>e.type==='effectStarted');
 for(const name of ['SCA_FA_SM_P0M','SCA_FATE_SMASHER_P04','SCA_FATE_SMASHER_P00M','SCA_FATE_SMASHER_PT00','SCA_BR_BR_PA01']){
  const children=starts.filter(e=>e.name===name);assert.ok(children.length>0,name);
  assert.ok(children.every(e=>e.sourceBoneTargetMeshBound&&e.birthAnchor),name+' has a real per-instance mesh bone');
 }
 assert.ok(starts.filter(e=>e.name.startsWith('DamageEffect_HA_SCA_FATE_SMASHER_')).every(e=>!e.sourceBoneTargetMeshBound));
});
test('Ancient Fire preserves raw Bop01 and applies only its sourced owner head fallback',()=>{
 const f=elesisFixture('BH',{skillId:28604,gap:200}),sampler=elesisAssets('BH').samplers.effectAnchorSampler;
 f.sim.enter(f.a,'ESI_SI_HA_SBH_ANCIENT_FIRE','ancient-anchor-evidence');f.a.animationTime=.7;
 const setName='EffectSet_SA_SBH_ANCIENT_FIRE',d=f.profile.effectSets[setName].raw.EFFECT16;
 assert.equal(d.BONE_NAME,'Bop01');assert.deepEqual(sampler({setName,definition:d},f.a).position,sampler({definition:{BONE_NAME:'_HEAD_BONE'}},f.a).position);
 assert.equal(sampler({setName:'unverified-callback',definition:d},f.a),null);
 for(const [gap,expectHit]of [[200,true],[3000,false]]){const run=elesisFixture('BH',{skillId:28604,gap});cast(run,10);
  assert.equal(run.sim.state.events.some(e=>e.type==='hit'&&e.actorId===run.a.id&&e.amount>0),expectHit);}
});
