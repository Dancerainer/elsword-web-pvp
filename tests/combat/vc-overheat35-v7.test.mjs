/** User's35x rule, independent arithmetic, and actual production equipment.
 * These expectations are not original-client recordings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {vcProductionFixture as currentFixture,vcProductionPreset as currentPreset,runDeadlyRaid as currentRaid} from '../helpers/vc-production-fixture.mjs';
// Freeze the previous user rule as an explicit historical regression input.
// The current command2x/skill25x/hard-floor preset has separate v8 coverage.
const legacy={overheatHpCostMultiplier:35,overheatHpCostMultipliers:undefined,overheatSkillLayerHpCap:undefined,overheatHardProtection:false};
const vcProductionPreset={...currentPreset,...legacy};
const vcProductionFixture=(options={})=>currentFixture({...options,preset:{...legacy,...options.preset}});
const runDeadlyRaid=(options={})=>currentRaid({...options,preset:{...legacy,overheatHpCostMultiplier:options.multiplier??35}});
import {burnVeteranOverheat} from '../../packages/combat-core/vc-skills.mjs';
const near=(a,b,t=.06)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const shell='RAVEN_REVOLVER_CANNON_SHELL_OVERHEAT',command='RWT_COMBO_XXX_LOOP_OVERHEAT';
test('historical VC v7 input freezes35x with sourced equipment, guild and six passives',()=>{
  const {a}=vcProductionFixture();assert.equal(vcProductionPreset.overheatHpCostMultiplier,35);
  assert.equal(a.hpMax,233337);assert.equal(a.mpMax,330);assert.equal(a.stats.magicAttack,1667);
  near(a.passivePolicy.veteran.noDamageBelow,.21,1e-6);near(a.passivePolicy.veteran.hpCostMultiplier,.6,1e-6);
  assert.equal(a.passivePolicy.veteran.surviveOverheat,true);
});
for(const extra of[1,.5])test(`skill/command penalty applies35 once before survival, extra=${extra}`,()=>{
  const {sim,a}=vcProductionFixture(),hp=a.hp,mp=a.mp;
  const amount=burnVeteranOverheat(sim,a,shell,{power:1,extra});
  near(amount,1667*6.2272*.6*.2*.6*35*extra);
  near(hp-a.hp,amount);assert.equal(a.mp,mp);assert.equal(sim.drainEvents().filter(e=>e.type==='hit').length,0);
});
test('low-HP immunity is reevaluated per penalty, with no invented21% floor',()=>{
  const {sim,a}=vcProductionFixture();a.hp=a.hpMax*.22;
  assert.ok(burnVeteranOverheat(sim,a,shell,{power:1})>0);assert.ok(a.hp<a.hpMax*.21);
  const hp=a.hp;assert.equal(burnVeteranOverheat(sim,a,shell,{power:1}),0);assert.equal(a.hp,hp);
  a.hp=a.hpMax*a.passivePolicy.veteran.noDamageBelow;
  assert.ok(burnVeteranOverheat(sim,a,shell,{power:1})>0,'strict below threshold, not <=');
});
for(const protect of[false,true])test(`lethal scaled cost honors survival passive=${protect}`,()=>{
  const {sim,a}=vcProductionFixture({actor:{passives:protect?[24414]:[],guildPassives:[]}});a.hp=100;
  burnVeteranOverheat(sim,a,command,{power:100});assert.equal(a.hp,protect?1:0);
});
for(const awake of[false,true])test(`three actual Deadly Raid tiers on latest full-health preset, awake=${awake}`,()=>{
  const base=runDeadlyRaid({awake,multiplier:1}),scaled=runDeadlyRaid({awake});
  assert.equal(scaled.penalties.length,3);assert.equal(scaled.activationCount,3);
  near(scaled.cost,base.cost*35,2);assert.ok(scaled.percentOfMax>20&&scaled.percentOfMax<30);
  assert.deepEqual(scaled.states,base.states);assert.ok(scaled.penalties.every(e=>e.hpCostMultiplier===35));
});
test('three tiers at30% HP stop charging subsequent tier once protection becomes active',()=>{
  const r=runDeadlyRaid({hpFraction:.3});assert.equal(r.activationCount,3);
  assert.ok(r.penalties.length>0&&r.penalties.length<3);assert.ok(r.finalHp<r.initial.hpMax*.21);assert.ok(r.finalHp>1);
});
test('outgoing hit damage does not receive self-cost35 multiplier',()=>{
  const results=[1,35].map(overheatHpCostMultiplier=>{
    const {sim,a,b}=vcProductionFixture({preset:{overheatHpCostMultiplier}});
    b.invincible=false;b.forceInvincible=0;
    return sim.applyHit(a,b,{DAMAGE_TYPE:1,DAMAGE:{MAGIC:3},PVP_RATE:.6,REACT_TYPE:1,HIT_ADD_MP:0,STOP_TIME_ATT:0,STOP_TIME_DEF:0},{kind:'effect',powerMultiplier:1});
  });assert.deepEqual(results[0],results[1]);assert.equal(results[0].accepted,true);
});
