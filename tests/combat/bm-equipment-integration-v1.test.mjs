/** Production BM preset + real source skill-value WASM. Expectations are
 * independently worked source channels, not recorded simulation output. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {bmFixture,bmProfile,bmPreset} from '../helpers/bm-fixture.mjs';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {modifyOutgoingHit} from '../../packages/combat-core/passives.mjs';
import {synchronizeBuffStats} from '../../packages/combat-core/passive-attributes-v20.mjs';

const f=Math.fround,near=(a,b)=>assert.ok(Math.abs(a-b)<1e-4,`${a} != ${b}`);

test('BM current production equipment retains its own base and applies class stat grants once',()=>{
  const {a,b,native,map}=bmFixture();
  assert.equal(a.hpMax,271144);assert.equal(a.mpMax,360);
  // Focus Strength1000 passes through the independent .1 flat-grant channel.
  assert.equal(a.stats.physicalAttack,1838);assert.equal(a.stats.magicAttack,1579);
  assert.equal(a.stats.physicalDefence,356);assert.equal(a.stats.magicDefence,286);
  assert.equal(a.equipmentAttributes.criticalRate,50);assert.equal(a.stats.criticalRate,61);
  near(a.stats.animationSpeedMultiplier,1.35*1.09);
  assert.equal(a.stats.moveSpeedMultiplier,1.125);assert.equal(a.stats.jumpSpeedMultiplier,1.125);
  assert.equal(b.stats.criticalRate,50);near(b.stats.animationSpeedMultiplier,1.35);
  assert.equal(a.passivePolicy.awakening.canReawaken,false);
  assert.equal(a.passivePolicy.burning.enabled,false);
  assert.equal(a.passivePolicy.victory.enabled,false);
  const complete=createSimulation({profile:bmProfile,preset:bmPreset,map,nativeSkillValues:native.skillValues,
    actors:[{id:'bm',professionId:'BM',team:0,position:[0,3080,0],lineId:2,loadout:Array(8).fill(null)}]}).actor('bm');
  // Guild grants add10 to each attack and5 to each defence after BM grants.
  assert.equal(complete.stats.physicalAttack,1848);assert.equal(complete.stats.magicAttack,1589);
  assert.equal(complete.stats.physicalDefence,361);assert.equal(complete.stats.magicDefence,291);
  assert.equal(complete.stats.criticalRate,61);assert.equal(complete.hpMax,271144);
});

test('BM passive speed and critical retain their equipment units through buff recomposition and JSON continuation',()=>{
  const {sim,a}=bmFixture();
  const initial=structuredClone(a.stats);
  synchronizeBuffStats(a);synchronizeBuffStats(a);
  assert.deepEqual(a.stats,initial,'recomposition must neither lose nor compound the9% BM speed passive');
  a.awakening.pendingOrbs=1;a.awakening.pendingAvailableOrbs=1;sim.activateAwakening(a);
  near(a.awakening.remaining,36);a.awakening.gauge=17;
  const other=bmFixture().sim;other.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  for(let i=0;i<60;i++){sim.step(1/60,{});other.step(1/60,{});}
  assert.deepEqual(other.snapshot(),sim.snapshot());
  assert.equal(other.actor('bm').awakening.gauge,17);
  assert.equal(other.actor('bm').stats.criticalRate,61);
});

test('BM Victor Dignity uses own HP and includes the exact80% source-text boundary',()=>{
  const {a}=bmFixture({passives:[24408]});
  const packet={DAMAGE_TYPE:0,DAMAGE:{PHYSIC:1},ATTACK_TYPE:0,FORCE_DOWN:10};
  const apply=(actorHp,targetHp=1)=>modifyOutgoingHit(a.passivePolicy,{damageData:packet,actorHp,actorMaxHp:1000,targetHp,targetMaxHp:1000});
  assert.equal(apply(800).attackMultiplier,f(1.15));
  assert.equal(apply(799.9999).attackMultiplier,1);
  assert.equal(apply(1000,1000).attackMultiplier,f(1.15));
  assert.equal(apply(1,1000).attackMultiplier,1,'enemy full HP cannot activate the BM own-HP passive');
  // Original DD loading adds the passive delta and epsilon before multiplying.
  // Keep the expected source operations independent of the production helper.
  const forceDownMultiplier=f(1+f(f(.73)-1+4.999999873689376e-5));
  assert.equal(apply(1).damageData.FORCE_DOWN,f(10*forceDownMultiplier),'knockdown reduction is independent of the HP attack condition');
});
