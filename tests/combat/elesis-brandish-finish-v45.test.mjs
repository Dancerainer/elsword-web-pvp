import test from 'node:test';
import assert from 'node:assert/strict';
import {elesisFixture} from '../helpers/elesis-fixture.mjs';
import {elesisBrandishTickCost} from '../../packages/combat-core/elesis-brandish-cost-v45.mjs';
test('18 selected self-cost uses original43.38/30/.6, owns defence, strict20% exemption and first-pass10% gate',()=>{
 const f=elesisFixture('CA',{skillId:28022,gap:5000}),a=f.a;a.hp=a.hpMax=1e6;a.stats.physicalAttack=1000;a.stats.physicalDefence=0;
 a.stats.finalDamageMultiplierRange=1;a.stats.finalDefenceMultiplier=1;a.equipmentAttributes.skillDamageBonus=0;a.skillScale=1;a.awakening.remaining=0;
 f.sim.rng=()=>{throw new Error('Self-cost must not roll critical/hit RNG');};
 assert.ok(Math.abs(elesisBrandishTickCost(f.sim,a).cost-867.6)<.001);
 const level=a.formulaRules.combatLevel,denominator=348+62*level*.1;
 a.stats.physicalDefence=denominator/2;assert.ok(Math.abs(elesisBrandishTickCost(f.sim,a).cost-433.8)<.001);
 f.b.stats.physicalDefence=1e8;assert.ok(Math.abs(elesisBrandishTickCost(f.sim,a).cost-433.8)<.001,'opponent defence cannot change self-cost');
 a.hp=a.hpMax=1000;a.stats.physicalDefence=0;a.stats.physicalAttack=1e8;assert.equal(elesisBrandishTickCost(f.sim,a).cost,900);
 a.hp=200;assert.equal(elesisBrandishTickCost(f.sim,a).exempt,false,'original ratio equal to float32.2 is not exempt');
 a.hp=199;assert.deepEqual(elesisBrandishTickCost(f.sim,a),{supported:true,cost:0,exempt:true});
 a.hp=1000;a.buffs.push({templateId:666});assert.ok(Math.abs(elesisBrandishTickCost(f.sim,a).cost-600.030029296875)<.001);
});
test('19 Burning Phantom finish keeps original raw knockdown source but user standing rule also skips threshold force-down',()=>{
 const f=elesisFixture('CA',{skillId:28021,gap:100});f.a.skillId=28021;f.b.hp=f.b.hpMax=1e9;f.b.knockdown.now=f.b.knockdown.max+100;
 const e=f.sim.createEffect(f.a,{NAME:'DamageEffect_SA_SDK_BURNING_PHANTOM_END'}),raw=e.damage.DAMAGE_DATA;
 assert.equal(raw.REACT_TYPE,5);const r=f.sim.applyHit(f.a,f.b,raw,{kind:'effect',id:e.id,skillId:28021,damageDirectionRight:true,attackPosition:[f.a.x,f.a.y,f.a.z]});
 assert.ok(r.accepted);assert.ok(!f.b.state.includes('DOWN'));assert.ok(!f.sim.state.events.some(e=>e.type==='knockdownTriggered'));
 assert.equal(raw.REACT_TYPE,5,'raw original declaration never rewritten');
});
