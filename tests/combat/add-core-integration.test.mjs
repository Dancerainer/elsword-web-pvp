import test from 'node:test';
import assert from 'node:assert/strict';
import {addFixture,tick} from '../helpers/add-fixture.mjs';
import {PROFESSION_PRESETS} from '../../packages/professions/profiles.mjs';
import {applyAddTimeRing,startAddFormation} from '../../packages/combat-core/add-systems.mjs';
import {addHudState} from '../../apps/web/add-hud.mjs';
import {buildBuffRows} from '../../apps/web/buff-bar.mjs';

for(const id of ['LP','MM','DE']){
 test(id+' equipment copies requested option family while DP gets its own two50% options',()=>{
  const {a}=addFixture(id),parent=PROFESSION_PRESETS[id==='LP'?'RF':'VC'].attributes;
  for(const key of ['criticalRate','animationSpeedMultiplier','moveSpeedMultiplier','jumpSpeedMultiplier','mpMax','hpBonus','skillDamageBonus'])if(parent[key]!==undefined)assert.equal(a.equipmentAttributes[key],parent[key],key);
  assert.equal(a.equipmentAttributes.addDpGainBonus,.5);assert.equal(a.equipmentAttributes.addDpConsumptionReduction,.5);
  assert.equal(a.equipmentAttributes.awakeningChargeBonus,0);assert.equal(a.equipmentAttributes.awakeningDurationBonus,0);
  assert.equal(a.sourceAdd.dp,0);assert.equal(a.awakening.gauge,0);assert.equal(a.core.phase,'absent');
 });
 test(id+' formation pays at input, applies at .46 once, and never counts99999 down',()=>{
  const {sim,a}=addFixture(id);a.sourceAdd.dp=1999;assert.equal(sim.tryAwakening(a),false);
  a.sourceAdd.dp=2000;assert.equal(sim.tryAwakening(a),true);
  assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);assert.equal(a.sourceAdd.formationPending,true);assert.equal(a.sourceAdd.formation,false);
  sim.processStateEvents(a,.45,.459);assert.equal(a.sourceAdd.formation,false);
  sim.processStateEvents(a,.459,.461);assert.equal(a.sourceAdd.formation,true);assert.equal(a.sourceAdd.switchCooldown,5);
  sim.processStateEvents(a,.459,.461);assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);
  tick(sim,2);assert.equal(a.awakening.remaining,99999);assert.equal(a.sourceAdd.formation,true);
  assert.equal(addHudState(a).amount,'DP 75 / 400');assert.ok(!buildBuffRows(a,{profile:sim.profileFor(a)}).some(r=>r.id==='awakening'));
 });
 test(id+' interrupting pending awakening clears it without refunding paid DP or point',()=>{
  const {sim,a}=addFixture(id);a.sourceAdd.dp=2000;sim.tryAwakening(a);sim.enter(a,'RSI_DAMAGE_SMALL_FRONT','fixture-interruption');
  assert.equal(a.sourceAdd.formationPending,false);assert.equal(a.awakening.remaining,0);assert.equal(a.sourceAdd.dp,1500);assert.equal(a.sourceAdd.mutation,1);
 });
 test(id+' state JSON continuation preserves deterministic command and DP evolution',()=>{
  const one=addFixture(id),two=addFixture(id);one.a.sourceAdd.dp=8000;one.sim.step(1/60,{add:{pressed:['X'],held:['X']}});
  two.sim.restore(JSON.parse(JSON.stringify(one.sim.snapshot())));
  for(let i=0;i<150;i++){one.sim.step(1/60,{});two.sim.step(1/60,{});}
  assert.deepEqual(two.sim.snapshot(),one.sim.snapshot());
 });
}
test('MM generator selection costs DP without firing and selected action then costs MP',()=>{
 const {sim,a}=addFixture('MM',{skillId:29035});a.sourceAdd.dp=8000;const beforeMp=a.mp;
 let available=sim.skillAvailability(a.id,0);assert.equal(available.mode,'generator-select');assert.equal(available.mpCost,0);
 sim.step(1/60,{add:{pressed:['A'],held:['A']}});assert.equal(a.state,'ANSI_AAT_CREATE_DYNAMO_FACTORY');assert.equal(a.mp,beforeMp);assert.equal(a.sourceAdd.generator.skillId,29035);
 assert.ok(!sim.state.effects.some(e=>e.name==='DamageEffect_AAT_Dynamo_Factory_Projectile'));
 tick(sim,3.5);available=sim.skillAvailability(a.id,0);assert.equal(available.mode,'generator-fire');assert.equal(available.available,true);
 sim.step(1/60,{add:{pressed:['A'],held:['A']}});assert.equal(a.mp,beforeMp-available.mpCost);assert.equal(a.sourceAdd.generator.phase,'firing');
});

test('MM regeneration trait refunds only the actual paid generator fire cost',()=>{
 const {sim,a}=addFixture('MM',{skillId:29035,branchId:'memo-41',passives:PROFESSION_PRESETS.MM.passives});
 a.sourceAdd.dp=8000;const keys={pressed:new Set(['A']),held:new Set(),released:new Set(),ordered:[]};
 sim.rng=()=>0; // Also fixes independent state-entry sound selection.
 const firstMp=a.mp;sim.processInput(a,keys);assert.equal(a.mp,firstMp);
 assert.equal(sim.drainEvents().filter(e=>e.type==='traitMpRefund').length,0);
 tick(sim,3.5);const price=sim.skillAvailability(a.id,0),mp=a.mp,dp=a.sourceAdd.dp;
 assert.equal(price.mode,'generator-fire');assert.ok(price.mpCost>0);
 sim.processInput(a,keys);assert.equal(a.sourceAdd.dp,dp);
 assert.equal(a.mp,mp-price.mpCost+Math.fround(price.mpCost*.33));
 assert.equal(sim.drainEvents().filter(e=>e.type==='traitMpRefund').length,1);
});
test('DE skill price and UI share DP insufficiency and never spend on a failed cast',()=>{
 const {sim,a,profile}=addFixture('DE',{skillId:29033});a.sourceAdd.dp=2000;startAddFormation(a,{profile});a.sourceAdd.dp=1;
 const before=structuredClone(a.sourceAdd),mp=a.mp,gate=sim.skillAvailability(a.id,0);
 assert.equal(gate.resourceDpInsufficient,true);assert.equal(gate.reason,'insufficient-dp');
 sim.step(1/60,{add:{pressed:['A'],held:['A']}});assert.equal(a.sourceAdd.dp,before.dp);assert.equal(a.mp,mp);assert.equal(a.cooldowns[29033],undefined);
});
test('time ring lethal restore does not increment life epoch and presents knockdown',()=>{
 const {sim,a,b,profile}=addFixture('DE',{skillId:29213,targetProfession:'LK',targetTeam:0});b.hp=b.hpMax;b.mp=45;
 assert.equal(applyAddTimeRing(sim,a,profile.skillCatalog.find(s=>s.skillId===29213)),2);const hp=b.hpMax*.5;b.hp=1;b.mp=0;
 a.team=1;const epoch=b.lifeEpoch;
 sim.injectHit({attackerId:a.id,targetId:b.id,damageData:{DAMAGE_TYPE:1,DAMAGE:{MAGIC:100},ATTACK_TYPE:1,REACT_TYPE:0,IGNORE_DEFENCE:1,BACK_SPEED_X:0,BACK_SPEED_Y:0}});
 assert.equal(b.hp,hp);assert.equal(b.mp,45);assert.equal(b.lifeEpoch,epoch);assert.equal(b.sourceTimeRing,null);assert.equal(b.sourceTimeSickness,120);
 assert.match(b.state,/DAMAGE_(?:DOWN|AIR_DOWN)/);assert.equal(b.death,false);
});
