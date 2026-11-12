import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile} from '../helpers/bm-fixture.mjs';
import {bladeMasterAcceptedHit} from '../../packages/combat-core/bm-skills.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);
const packet={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},ATTACK_TYPE:0,REACT_TYPE:1,HIT_TYPE:1,FORCE_DOWN:1};
test('Winning Strategy feedback accumulates past five until strictly-negative cooldown, then resets on request',()=>{
  const {sim,a,b}=bmFixture({passives:[24409],gap:4000}),hit=(origin)=>bladeMasterAcceptedHit(sim,a,b,packet,100,origin,true);
  const command={kind:'character',state:'RSI_COMBO_Z',skillId:null};
  for(let i=0;i<4;i++)hit(command);assert.ok(!a.buffs.length);
  for(let i=0;i<5;i++)hit({kind:'core'});assert.equal(a.sourceBladeMaster.winHits,4);
  hit(command);assert.equal(a.sourceBladeMaster.winHits,5);assert.equal(a.buffs.length,0,'original cooldown0 is not ready');
  a.sourceBladeMaster.winCooldown=-1/60;hit(command);assert.equal(a.buffs[0].templateId,546);assert.equal(a.buffs[0].accumulationCount,1);near(a.sourceBladeMaster.winCooldown,1);
  sim.state.effects.push({id:100000,name:'DamageEffect_RBM_DashJump_X'});a.skillId=24033;
  hit({kind:'effect',id:100000,skillId:null});assert.equal(a.sourceBladeMaster.winHits,0,'mere effect contact does not dispatch the child-success observer');
  hit({kind:'effect',id:100000,skillId:null,effectFeedbackDispatched:true});assert.equal(a.sourceBladeMaster.winHits,1);
  for(let stack=1;stack<7;stack++){
    a.sourceBladeMaster.winCooldown=-1/60;a.sourceBladeMaster.winHits=0;for(let i=0;i<5;i++)hit(command);
  }
  assert.equal(a.buffs[0].accumulationCount,5);near(a.buffs[0].behaviors.find(b=>b.stat==='criticalRate').value,1.25);
});
test('Bloody Accel target factor31 drains11.3% and adds original wound only on normal attacks',()=>{
  const {sim,a,b}=bmFixture({passives:[]});sim.rng=()=>0;a.hp=10000;
  assert.ok(sim.grantBuff(a,a,31,1));const old=a.hp;
  bladeMasterAcceptedHit(sim,a,b,packet,1000,{kind:'character',state:'RSI_COMBO_Z'},true);
  near(a.hp-old,113);assert.ok(b.buffs.some(b=>b.templateId===31));assert.equal(b.buffControls.dashBlock,true);
  const hp=a.hp;bladeMasterAcceptedHit(sim,a,b,{...packet,ATTACK_TYPE:1},1000,{kind:'character',skillId:24033},true);assert.equal(a.hp,hp);
});
test('GigaDrive target factor24 changes Active cooldown to1s and leaves SpecialActive cooldown intact',()=>{
  const {sim,a}=bmFixture({skillId:24220,passives:[]});assert.ok(sim.grantBuff(a,a,24,1));
  near(a.stats.finalDamageMultiplierMelee,1.2);near(a.stats.forceDownMultiplierMelee,.5);
  assert.equal(sim.skillAvailability('bm',0).cooldown,1);
  sim.configureLoadout([{skillId:24033},...Array(7).fill(null)],'bm');assert.equal(sim.skillAvailability('bm',0).cooldown,7);
});
test('Bloody Accel Effectiveness20% trait strengthens its20% damage buff and11.3% drain',()=>{
  const {sim,a}=bmFixture({passives:[]}),policy=createSkillTraitPolicy(bmProfile.skillCatalog.find(s=>s.skillId===24014),'memo-58');
  assert.ok(sim.grantBuff(a,a,31,1,policy));near(a.stats.finalDamageMultiplierMelee,1.24);near(a.stats.finalDamageMultiplierRange,1.24);
  near(a.buffs[0].behaviors.find(b=>b.kind==='normalHpDrain').value,.1356);
});
test('target FatalWound three-stack bleeding retains original8s factor duration (text says9s)',()=>{
  const {sim,a,b}=bmFixture({passives:[]});sim.rng=()=>0;
  for(let i=0;i<5;i++)assert.ok(sim.grantBuff(a,b,146,1));
  const buff=b.buffs.find(b=>b.templateId===99);assert.equal(buff.accumulationCount,3);assert.equal(buff.finalizers[0].sourceDuration,8);
  // BRT3 relates to the mean of physical and magic attack.
  near(buff.behaviors.find(b=>b.kind==='hpInterval').value,-.5*(a.stats.physicalAttack+a.stats.magicAttack)/2*3);
});
test('CutTendon target inline50% wound uses shared original inclusive probability comparison',()=>{
  const raw=bmProfile.states.RSI_A_RST_CUT_TENDON.raw.DAMAGE_DATA.BUFF_FACTOR;
  for(const [roll,applied]of [[.499,true],[.5,true],[.5001,false]]){
    const {sim,a,b}=bmFixture({passives:[]});sim.rng=()=>roll;
    assert.equal(Boolean(sim.grantBuff(a,b,raw,1)),applied);assert.equal(b.buffs.some(b=>b.templateId===31),applied);
  }
});
test('Shockwave ignore-reduction declaration bypasses equipment reduction without bypassing armor',()=>{
  const run=(ignore,reduction,defence)=>{
    const {sim,a,b}=bmFixture({passives:[]});sim.rng=()=>.99;b.equipmentAttributes.damageReduction=reduction;b.stats.physicalDefence=defence;
    return sim.applyHit(a,b,{...packet,IGNORE_DEFENCE_DECLINE:ignore},{kind:'character',state:'RSI_COMBO_Z'}).amount;
  };
  near(run(1,.5,356),run(0,0,356));assert.ok(run(0,.5,356)<run(1,.5,356));assert.ok(run(1,.5,1000)<run(1,.5,356));
});
