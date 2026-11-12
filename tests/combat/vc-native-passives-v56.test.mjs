/** Independent original2016 contract expectations from VC_PASSIVE_CONSUMERS;
 * these are current Web regressions, not captured original PvP trajectories. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcFixture,vcProfile} from '../helpers/vc-fixture.mjs';
import {canVeteranOverheat,veteranPassives,veteranState,veteranEvents,veteranCastState,veteranEffectFactoryPower} from '../../packages/combat-core/vc-skills.mjs';
test('24414 requires the same strict high-to-low crossing as24413, including equality sampling and no automatic regrant',()=>{
 const {sim,a}=vcFixture({passives:[24413,24414]});const s=veteranState(a);
 a.hp=a.hpMax*.49;s.previousHp=a.hp;veteranPassives(sim,a);assert.equal(a.buffs.length,0,'starting low is not a crossing');
 a.hp=a.hpMax*.5;s.previousHp=a.hpMax*.6;veteranPassives(sim,a);assert.equal(a.buffs.length,0,'exactly50% does not cross');
 a.hp=a.hpMax*.49;veteranPassives(sim,a);assert.equal(a.buffs.length,0,'sampled equality updates previousHP');
 s.previousHp=a.hpMax*.6;veteranPassives(sim,a);assert.deepEqual(a.buffs.map(b=>b.templateId).sort((x,y)=>x-y),[2,104]);
 a.buffs=[];veteranPassives(sim,a);assert.equal(a.buffs.length,0,'no low-HP continuous grant');assert.equal(s.previousHp,a.hp);
});
test('overheat original permission rejects exact2% and25% gates, preserving explicit preset hard-protection policy',()=>{
 for(const passives of [[24412],[]]){
  const {a}=vcFixture({passives}),limit=a.passivePolicy.veteran.hpLimit;
  a.hp=a.hpMax*limit;assert.equal(canVeteranOverheat(a),false);
  a.hp+=1;assert.equal(canVeteranOverheat(a),true);a.hp-=2;assert.equal(canVeteranOverheat(a),false);
 }
});
test('air Flame Sword body retains original10.215 without a second1.5; its Effect factory scalar is separate',()=>{
 const {sim,a}=vcFixture({skillId:24218});a.grounded=false;a.lineId=null;a.skillScale=2;
 a.skillContext={traitPolicy:{mpRefundChance:0}};
 const skill=sim.skill(24218,a),state=veteranCastState(sim,a,skill);assert.equal(state,'RSI_A_RWT_FLAME_SWORD_FLY');
 assert.equal(a.skillScale,2,'body power retains its pre-enter scalar');
 sim.enter(a,state,'original239-test');a.skillScale=2;
 assert.equal(veteranEffectFactoryPower(sim,a),3);
 assert.equal(vcProfile.states.RSI_A_RWT_FLAME_SWORD_FLY.raw.DAMAGE_DATA.DAMAGE.MAGIC,10.215);
 assert.equal(vcProfile.states.RSI_A_RWT_FLAME_SWORD_GROUND.raw.DAMAGE_DATA.DAMAGE.MAGIC,6.81);
 const effect=sim.createEffect(a,{NAME:'RAVEN_BARRAGE_ATTACK_STAND'});assert.equal(effect.powerMultiplier,3);
 const other=vcFixture();assert.equal(veteranEffectFactoryPower(other.sim,other.a),other.a.skillScale);
});
for(const air of [false,true])test('Haze original'+(air?'197':'196')+' produces STAND DD at its own timer and carries one factory multiplier',()=>{
 const {sim,a}=vcFixture({skillId:24221}),skill=sim.skill(24221,a);a.grounded=!air;
 a.skillContext={traitPolicy:{mpRefundChance:0}};a.skillScale=1;
 const state=veteranCastState(sim,a,skill);sim.enter(a,state,'original-haze-route');a.skillId=24221;a.skillScale=air?1.5:1;
 const threshold=air?.1:.4;a.animationTime=threshold-.001;veteranEvents(sim,a,threshold-.002,threshold-.001);
 assert.equal(sim.state.effects.some(e=>e.name==='RAVEN_BARRAGE_ATTACK_STAND'),false);
 a.animationTime=threshold+.001;veteranEvents(sim,a,threshold-.001,threshold+.001);
 const e=sim.state.effects.find(e=>e.name==='RAVEN_BARRAGE_ATTACK_STAND');assert.ok(e);assert.equal(e.powerMultiplier,air?1.5:1);
 assert.equal(sim.state.effects.some(e=>e.name==='RAVEN_BARRAGE_ATTACK_AIR'),false);
 assert.equal(e.damage.DAMAGE_DATA.DAMAGE.MAGIC,vcProfile.damageEffects.RAVEN_BARRAGE_ATTACK_STAND.raw.DAMAGE_DATA.DAMAGE.MAGIC);
});
