/** Source expectations are reparsed 2016 declarations, never captured simulation outputs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bmFixture,bmProfile,bmSampledFixture} from '../helpers/bm-feedback-fixture-v4.mjs';
import {encodeOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
const source=JSON.parse(readFileSync(new URL('../../contracts/bm-feedback-source-v4.json',import.meta.url)));
const dt=1/60,set='EffectSet_A_RF_XXX',damage='DamageEffect_RF_XXX';
const step=(f,count=1)=>{for(let i=0;i<count;i++)f.sim.step(dt,{});};

test('BM feedback keeps independently reparsed target declarations and distinguishes missing native2016 consumer',()=>{
  for(const [name,row]of Object.entries(source.targetStates))assert.deepEqual(bmProfile.states[name].raw,row.raw,name);
  for(const [name,row]of Object.entries(source.targetDamageEffects))assert.deepEqual(bmProfile.damageEffects[name].raw,row.raw,name);
  for(const [name,row]of Object.entries(source.targetSets))assert.deepEqual(bmProfile.effectSets[name].raw,row.raw,name);
  assert.equal(source.targetNativeConsumerAvailable,false);assert.equal(source.originalClientMeasurementCount,0);
  assert.equal(source.referenceSource.commit,'a8438f3ed18dd6f0944793de6c0d8bb9334e9633');
});

for(const facing of[-1,1])for(const gap of[-150,150,800])test(`BM XXX actual input shares finite RF source helpers, facing ${facing}, gap ${gap}`,()=>{
  const f=bmSampledFixture({facing,gap:Math.abs(gap),passives:[]});f.b.x=f.a.x+facing*gap;f.sim.rng=()=>.99;
  f.press('X');f.press('X');f.wait('RSI_COMBO_XX');f.press('X');f.wait('RSI_COMBO_XXX');
  assert.ok(f.a.xxxCandidate);f.step(180);
  const events=f.sim.state.events,hits=events.filter(e=>e.type==='hit'&&e.origin?.sourceCandidate?.damageName===damage);
  assert.equal(hits.length>0,gap===150);assert.ok(hits.length<=18);
  assert.ok(hits.every(e=>e.amount>0&&e.data.DAMAGE.MAGIC===1.2));
  assert.equal(events.filter(e=>e.type==='effectStarted'&&e.name===damage).length,1);
  assert.equal(events.filter(e=>e.type==='xxxCandidatePayment'&&e.accepted).length,1);
  assert.equal(events.filter(e=>e.type==='originalRecoveredParticle').length,0);
  assert.equal(f.sim.state.effects.filter(e=>e.setName===set).length,0);assert.equal(f.a.xxxCandidate,undefined);
});

test('BM XXX denies unpayable blast and preserves pending/active snapshot continuation',()=>{
  const f=bmFixture({gap:150,passives:[]});f.a.mp=6;f.sim.enter(f.a,'RSI_COMBO_XXX');step(f,120);
  assert.equal(f.sim.state.events.filter(e=>e.type==='xxxCandidatePayment'&&!e.accepted).length,1);
  assert.equal(f.sim.state.events.filter(e=>e.type==='effectStarted'&&e.setName===set).length,0);
  for(const phase of['pending','active']){
    const a=bmFixture({gap:150,passives:[]}),b=bmFixture({gap:150,passives:[]});a.sim.enter(a.a,'RSI_COMBO_XXX');
    if(phase==='active')for(let i=0;i<120&&!a.sim.state.effects.some(e=>e.name===damage&&e.active);i++)step(a);
    b.sim.restore(JSON.parse(JSON.stringify(a.sim.snapshot())));step(a,120);step(b,120);
    assert.deepEqual(JSON.parse(JSON.stringify(a.sim.snapshot())),JSON.parse(JSON.stringify(b.sim.snapshot())));
  }
});

for(const facing of[-1,1])for(const [state,limit]of[['RBM_COMBO_ZZZX',.033],['RBM_COMBO_ZZZXZ',.209]])
test(`BM ${state} actual fresh skill respects original strict ${limit}, facing ${facing}`,()=>{
  const f=bmFixture({skillId:24210,gap:4000,facing,passives:[]});f.sim.enter(f.a,state);f.a.animationTime=limit;
  assert.equal(f.sim.skillAvailability('bm',0).available,false);
  f.a.animationTime=limit+.0001;assert.equal(f.sim.skillAvailability('bm',0).available,true);
  f.sim.step(1e-9,{bm:{pressed:['A'],held:['A']}});assert.equal(f.a.skillId,24210);
  assert.equal(f.a.state,'RSI_A_RBM_SONIC_SLASH_LOOP');
});

for(const facing of[-1,1])test(`BM born black hole stops after a successful skill cancel through its retained handle, facing ${facing}`,()=>{
  const f=bmSampledFixture({skillId:24210,gap:4000,facing,passives:[]});f.zzz();f.press('X');f.wait('RBM_COMBO_ZZZX');f.at(.3);
  const ids=[...f.a.sourceBladeMaster.blackHoleEffectIds],remaining=f.a.sourceBladeMaster.blackHoleRemaining;
  assert.equal(ids.length,3);f.press('A');assert.equal(f.a.skillId,24210);
  assert.ok(remaining>0);assert.equal(f.a.sourceBladeMaster.blackHoleRemaining,0);
  f.step();for(const id of ids)assert.ok(!f.sim.state.effects.some(e=>e.id===id));
  assert.equal(f.sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId)).length,3);
  assert.ok(f.sim.state.events.filter(e=>e.type==='effectEnded'&&ids.includes(e.effectId)).every(e=>e.reason==='original-stop-effect-set'));
});

test('BM active XXX and cleared black-hole skill-cancel handles remain valid across owned packets',()=>{
  for(const kind of['xxx','black-hole']){
    const a=bmFixture({skillId:24210,gap:4000,passives:[]}),b=bmFixture({skillId:24210,gap:4000,passives:[]});
    a.sim.enter(a.a,kind==='xxx'?'RSI_COMBO_XXX':'RBM_COMBO_ZZZX');step(a,12);
    if(kind==='black-hole')a.sim.step(dt,{bm:{pressed:['A'],held:['A']}});
    const packet=encodeOwnedState(a.sim,'bm',{epoch:1,frameSeq:30});
    assert.doesNotThrow(()=>validateOwnedReferences(packet,b.a,b.profile,b.map));
    applyOwnedState(b.sim,'bm',packet);
    if(kind==='xxx')assert.ok(b.sim.state.effects.some(e=>e.name===damage&&e.active));
    else {assert.equal(b.a.sourceBladeMaster.blackHoleRemaining,0);step(b,1);assert.equal(b.a.sourceBladeMaster.blackHoleEffectIds.length,0);}
  }
});

for(const facing of[-1,1])for(const gap of[250,4000])test(`BM unawakened HypersonicStab keeps source contact then delayed global damage, facing ${facing}, gap ${gap}`,()=>{
  const f=bmFixture({skillId:24013,gap,facing,passives:[]});f.sim.rng=()=>.99;
  f.sim.step(dt,{bm:{pressed:['A'],held:['A']}});step(f,220);
  const events=f.sim.state.events,contacts=events.filter(e=>e.type==='effectContact'&&e.origin.skillId===24013),
    child=events.find(e=>e.type==='damageChildCreated'&&e.name==='RAVEN_HYPER_SONIC_STAB_Damage'),
    hits=events.filter(e=>e.type==='hit'&&e.origin.skillId===24013);
  if(gap===4000){assert.equal(contacts.length,0);assert.equal(hits.length,0);return;}
  assert.equal(contacts.length,1);assert.ok(contacts[0].origin.animationTime>.6&&contacts[0].origin.animationTime<.94);
  assert.ok(child);assert.ok(hits.length>0);assert.ok(hits[0].time-child.time>=.5);
  assert.ok(hits.every(e=>e.time-child.time<=.65+dt));
  assert.equal(events.find(e=>e.type==='worldStop').duration,2,'preserve the declared screen stop');
});
