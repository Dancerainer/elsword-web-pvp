/** Current simulation/network regressions using original geometry, not client gold. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisAssets,elesisFixture} from '../helpers/elesis-fixture.mjs';
import {encodeOwnedState,validateOwnedState,validateOwnedReferences,applyOwnedState} from '../../packages/online/owned-state.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';
for(const id of ['GM','BH','CA']){
 const profile=elesisAssets(id).profile;
 const skills=profile.skillCatalog.filter(s=>s.topTier&&!s.passive&&s.supported&&s.skillId!==900);
 test(`${id} exposes all twenty independent top-tier active skills`,()=>assert.equal(skills.length,20));
 for(const skill of skills)for(const awake of [false,true])test(`${id} ${skill.skillId}${awake?' awake':''} owns actual cast state, effects and buffs through recovery`,()=>{
  const source=elesisFixture(id,{skillId:skill.skillId,passives:profile.defaultPassiveSkillIds});
  const receiver=elesisFixture(id,{skillId:skill.skillId,passives:profile.defaultPassiveSkillIds});
  source.b.hp=source.b.hpMax=1e9;source.a.awakening.remaining=awake?60:0;
  receiver.sim.state.nextEffectId=500000;
  let began=false;
  for(let frame=0;frame<600;frame++){
    source.sim.step(1/60,{elesis:frame===0?{pressed:['A'],held:['A']}:frame<30?{held:['A']}:{held:[]}},{snapshot:false});
    began||=source.sim.drainEvents().some(e=>e.type==='skillStarted'&&e.actorId==='elesis');
    if(![0,10,30,60,120,240,480,599].includes(frame))continue;
    const packet=JSON.parse(JSON.stringify(encodeOwnedState(source.sim,'elesis',{epoch:1,frameSeq:frame+1})));
    assert.doesNotThrow(()=>validateOwnedState(packet),`frame ${frame}`);
    assert.doesNotThrow(()=>validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map,
      {profiles:{[id]:receiver.profile},actors:receiver.sim.state.actors}),`frame ${frame}`);
    applyOwnedState(receiver.sim,'elesis',packet);
    assert.deepEqual(receiver.a.wayOfSword,source.a.wayOfSword);
    assert.equal(receiver.a.sourceElesisBreakCharge,source.a.sourceElesisBreakCharge);
    const state=receiver.a.sourceElesisSkills;
    for(const key of ['drasticEffects','dreadEffects','extinctionEffects','juggernautEffects','stigmaEffects'])
      for(const effectId of state?.[key]??[])assert.ok(receiver.sim.state.effects.some(e=>e.id===effectId),'remapped '+key);
    if(state?.roseId!=null)assert.ok(receiver.sim.state.effects.some(e=>e.id===state.roseId));
    receiver.sim.step(1/60,{elesis:{held:[]}},{snapshot:false});
    for(const a of receiver.sim.state.actors)assert.ok([a.x,a.y,a.hp,a.mp].every(Number.isFinite));
  }
  assert.equal(began,true,'must enter through actual equipped input');
 });
}
test('Elesis packets reject foreign family state and invalid independent charge without applying it',()=>{
 const {sim,a,profile,map}=elesisFixture('GM'),packet=encodeOwnedState(sim,a.id,{epoch:1,frameSeq:1});
 const malformed=structuredClone(packet);malformed.actor.sourceElesisBreakCharge=2001;
 assert.throws(()=>validateOwnedState(malformed),/actor-shape/);
 const outside=structuredClone(packet);outside.actor.sourceElesisBreakCharge=100;
 assert.throws(()=>validateOwnedReferences(outside,a,profile,map),/elesis-break-charge/);
 const rage=structuredClone(packet);rage.actor.destructionRageRemaining=1;
 assert.throws(()=>validateOwnedReferences(rage,a,profile,map),/elesis-elsword-rage/);
 const foreign=structuredClone(profile);foreign.target.unitClass=100;
 assert.throws(()=>validateOwnedReferences(packet,a,foreign,map),/invalid-elesis-state/);
});

for(const [factor,change] of [[298,50],[657,-50]])test(`War Prelude factor ${factor} changes and restores the remote MP ceiling in its own report`,()=>{
 const source=elesisFixture('GM'),receiver=elesisFixture('GM');
 const base=source.a.mpMax;
 source.sim.grantBuff(source.a,source.a,factor,1,null);
 assert.equal(source.a.mpMax,base+change,'original factor changes fifty maximum MP');
 source.a.mp=source.a.mpMax;
 const packet=encodeOwnedState(source.sim,source.a.id,{epoch:1,frameSeq:1});
 assert.doesNotThrow(()=>validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map));
 const excessive=structuredClone(packet);excessive.actor.mp++;
 assert.throws(()=>validateOwnedReferences(excessive,receiver.a,receiver.profile,receiver.map),/out-of-range/);
 applyOwnedState(receiver.sim,receiver.a.id,packet);
 assert.equal(receiver.a.mpMax,base+change);assert.equal(receiver.a.mp,base+change);
 assert.ok(receiver.a.buffs.some(b=>b.behaviors.some(row=>row.kind==='attackByType')));
 source.a.buffs=[];synchronizeBuffStats(source.a);source.a.mp=base;
 const expired=encodeOwnedState(source.sim,source.a.id,{epoch:1,frameSeq:2});
 const stale=structuredClone(expired);stale.actor.mp=base+1;
 assert.throws(()=>validateOwnedReferences(stale,receiver.a,receiver.profile,receiver.map),/out-of-range/);
 assert.doesNotThrow(()=>validateOwnedReferences(expired,receiver.a,receiver.profile,receiver.map));
 applyOwnedState(receiver.sim,receiver.a.id,expired);
 assert.equal(receiver.a.mpMax,base);assert.equal(receiver.a.mp,base);
});

test('CA Blood Revenge additional attack buff retains its own template identity across ownership',()=>{
 const source=elesisFixture('CA'),receiver=elesisFixture('CA');
 source.sim.grantBuff(source.a,source.a,464,1,null);
 const packet=encodeOwnedState(source.sim,source.a.id,{epoch:1,frameSeq:1});
 assert.ok(packet.actor.buffs.some(b=>b.templateId===428&&b.behaviors.some(row=>row.stat==='additionalAttackPercent')));
 assert.doesNotThrow(()=>validateOwnedReferences(packet,receiver.a,receiver.profile,receiver.map));
 applyOwnedState(receiver.sim,receiver.a.id,packet);
 assert.equal(receiver.a.stats.additionalAttackPercent,source.a.stats.additionalAttackPercent);
});
