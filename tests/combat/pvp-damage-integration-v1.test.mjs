/** Source-expression expectations through the real createSimulation/applyHit
 * pipeline. The tiny collision fixture and explicit level99 isolate formulas;
 * they do not define the product's level or stand in for original-map/client
 * acceptance. Native critical and skill-value consumers use existing fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createSimulation} from '../../packages/combat-core/index.mjs';
import {PVP_FORMULA_VERSION} from '../../packages/combat-core/equipment-attributes.mjs';
import {instantiateNativeCritical} from '../../packages/native-source/critical.mjs';
import {instantiateNativeSkillValues} from '../../packages/native-source/skill-values.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = process.env.RF_PVP_FORMULA_FIXTURE_ROOT ??
  (existsSync(resolve(root, 'artifacts/native/critical.wasm')) ? root :
    resolve(root, '../../rf-native-v11/elsword_2016_webpvp'));
const profile = JSON.parse(readFileSync(resolve(root, 'packages/combat-core/rf-profile.json')));
const criticalModule = await WebAssembly.compile(readFileSync(resolve(fixtureRoot, 'artifacts/native/critical.wasm')));
const valuesModule = await WebAssembly.compile(readFileSync(resolve(fixtureRoot, 'artifacts/native/skill-values.wasm')));
const map = {lines: [{lineId: 0, start: [-5000, 0, 0], end: [5000, 0, 0], type: 'LT_NORMAL', nativeFields: {CAN_DOWN: false}}]};
const rawHit = Object.freeze({DAMAGE_TYPE: 0, DAMAGE: {PHYSIC: 1}, REACT_TYPE: 7, HIT_TYPE: 1, HIT_ADD_MP: 0, FORCE_DOWN: 0});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < Math.max(1e-5, Math.abs(expected) * 8e-7), `${actual} != ${expected}`);

async function fixture({attacker = {}, defender = {}, attackerPassives = [], defenderPassives = [], online = false} = {}) {
  const originalCritical = await instantiateNativeCritical(criticalModule);
  const calls = {critical: [], reduction: []};
  const nativeCritical = {
    evaluate(input) { calls.critical.push(structuredClone(input)); return originalCritical.evaluate(input); },
    reduceDamage(amount, options) { calls.reduction.push({amount, ...options}); return originalCritical.reduceDamage(amount, options); },
  };
  const equipment = {hpMax: 800000, mpMax: 300, physicalAttack: 1000, magicAttack: 2000,
    physicalDefence: 0, magicDefence: 0, animationSpeedMultiplier: 1.4, moveSpeedMultiplier: 1.23,
    jumpSpeedMultiplier: 1.23, damageReduction: 0, awakeningChargeBonus: .5, criticalRate: 0};
  const s = createSimulation({profile, map, nativeCritical,
    nativeSkillValues: await instantiateNativeSkillValues(valuesModule),
    effectAnchorSampler: () => ({position: [0, 170, 0]}), seed: 2016,
    preset: {formulaVersion: PVP_FORMULA_VERSION, attributeSemantics: 'equipment-combat-values-and-final-options',
      combatLevel: 99, attributes: equipment, passives: [], guildPassives: [], onlineMatch: online,
      ravenCoreEnabled: true, awakeningEnabled: true, loadout: Array(8).fill(null)},
    actors: [{id: 'rf', team: 0, position: [0, 0, 0], lineId: 0, facing: 1, passives: attackerPassives, guildPassives: [], attributes: attacker},
      {id: 'target', team: 1, position: [100, 0, 0], lineId: 0, facing: -1, passives: defenderPassives, guildPassives: [], attributes: defender}]});
  s.rng = () => .5;
  s.drainEvents();
  return {s, a: s.actor('rf'), b: s.actor('target'), calls};
}

function hit({s, a, b}, data = rawHit, origin = {}) { return s.applyHit(a, b, data, {kind: 'character', ...origin}); }

test('new formula uses explicitly supplied equipment attack without an invented divide-by-ten', async () => {
  const f = await fixture();
  assert.equal(f.a.equipmentAttributes.physicalAttack, 1000);
  assert.equal(f.a.formulaRules.combatLevel, 99);
  const initialHp = f.b.hp;
  const result = hit(f);
  assert.equal(result.accepted, true); close(result.amount, 1000);
  close(initialHp - f.b.hp, 1000);
});

test('actual physical, magic and mixed hits consume explicit nonzero defenses', async () => {
  // At test level99, PvP denominator=348+62*99*.1=961.8.
  for (const [type, damage, expected] of [
    [0, {PHYSIC: 1}, 500], [1, {MAGIC: 1}, 1500], [2, {PHYSIC: 1, MAGIC: 1}, 937.5],
  ]) {
    const f = await fixture({defender: {physicalDefence: 480.9, magicDefence: 240.45}});
    const result = hit(f, {...rawHit, DAMAGE_TYPE: type, DAMAGE: damage});
    assert.equal(result.accepted, true); close(result.amount, expected);
  }
});

test('penetration and ignore-defense bypass base defense; state-only ignore keeps it', async () => {
  for (const [flags, expected] of [[{PENETRATE: true}, 1000], [{IGNORE_DEFENCE: 1}, 1000], [{IGNORE_STATE_DEFENCE: 1}, 500]]) {
    const f = await fixture({defender: {physicalDefence: 480.9}});
    close(hit(f, {...rawHit, ...flags}).amount, expected);
  }
});

test('state reduction executes after base defense and its bypass cannot remove equipment reduction', async () => {
  for (const [flags, expected] of [[{}, 245], [{IGNORE_STATE_DEFENCE: true}, 350], [{PENETRATE: 1}, 700]]) {
    const f = await fixture({defender: {physicalDefence: 480.9, damageReduction: .3}});
    f.b.skillDamageReducePercent = 30;
    const result = hit(f, {...rawHit, ...flags});
    close(result.amount, expected);
    assert.equal(f.calls.reduction.length, 1);
    close(f.calls.reduction[0].amount, flags.PENETRATE ? 1000 : 500);
  }
});

test('awakening and actual RF physique use additive final attack/defense stage', async () => {
  const f = await fixture({defenderPassives: [24404]});
  f.a.awakening.remaining = 10;
  // 1000 +1000*(.76-1) +1000*(1.2-1) =960, not912.
  close(hit(f).amount, 960);
  close(f.b.passivePolicy.received.damageMultiplier, .76);
});

test('revenge attack modifies attack stats while revenge defense joins the final-defense channel', async () => {
  const f = await fixture({online: true, defenderPassives: [24404]});
  f.a.awakening.remaining = 10;
  f.a.pvpModifiers = {damageMultiplier: 1.1};
  f.b.pvpModifiers = {receivedMultiplier: .9};
  // D=1100; defenseFinal=.76*.9=.684; attackFinal=1.2 =>972.4.
  close(hit(f).amount, 972.4);
  assert.equal(f.a.equipmentAttributes.physicalAttack, 1000, 'ephemeral revenge does not rewrite equipment');
});

test('melee and ranged final-damage Buff channels compose with awakening separately', async () => {
  for (const [melee, expected] of [[true, 1500], [false, 1800]]) {
    const f = await fixture();
    f.a.awakening.remaining = 10;
    f.a.stats.finalDamageMultiplierMelee = 1.25;
    f.a.stats.finalDamageMultiplierRange = 1.5;
    close(hit(f, {...rawHit, MELEE_ATTACK: melee}).amount, expected);
  }
});

test('source melee defaults distinguish character hitboxes from damage effects and allow explicit override', async () => {
  // X2DamageManager.h908 distinguishes character=true/effect=false, while
  // X2DamageManager.cpp79 retains that prior value if MELEE_ATTACK is absent.
  for (const [origin, flags, expected] of [
    [{kind: 'character'}, {}, 1250], [{kind: 'effect'}, {}, 1500],
    [{kind: 'character'}, {MELEE_ATTACK: false}, 1500], [{kind: 'effect'}, {MELEE_ATTACK: 1}, 1250],
  ]) {
    const f = await fixture();
    f.a.stats.finalDamageMultiplierMelee = 1.25;
    f.a.stats.finalDamageMultiplierRange = 1.5;
    close(hit(f, {...rawHit, ...flags}, origin).amount, expected);
  }
});

test('actual awakening activation grants exactly one final attack factor', async () => {
  const f = await fixture();
  f.a.awakening.pendingOrbs = 1; f.a.awakening.pendingAvailableOrbs = 1;
  f.s.activateAwakening(f.a);
  assert.ok(f.a.awakening.remaining > 0);
  close(hit(f).amount, 1200);
  assert.equal(f.s.state.events.filter(e => e.type === 'awakeningStarted').length, 1);
});

test('critical receives final-stage amount before equipment reduction', async () => {
  const f = await fixture({attacker: {criticalRate: 1}, defender: {damageReduction: .3}, defenderPassives: [24404]});
  f.a.awakening.remaining = 10;
  const result = hit(f);
  close(f.calls.critical[0].amount, 960);
  // 960 *critical1.5 *equipment.7 =1008.
  close(result.amount, 1008);
  assert.equal(f.s.state.events.filter(e => e.type === 'hit').at(-1).critical, true);
});

test('actual core guard is applied before critical and after final damage stage', async () => {
  const f = await fixture({attacker: {criticalRate: 1}, defender: {damageReduction: .3}});
  f.b.awakening.remaining = 20; f.b.core.gauge = 40; f.s.updateCoreLevel(f.b);
  const result = hit(f, {...rawHit, REACT_TYPE: 1});
  assert.equal(f.s.state.events.filter(e => e.type === 'hit').at(-1).guarded, true);
  close(f.calls.critical[0].amount, 250);
  close(result.amount, 262.5);
});

test('ordinary fully defended and NO_DAMAGE hits stay exactly zero', async () => {
  const blocked = await fixture({defender: {physicalDefence: 10000}});
  const hp = blocked.b.hp;
  assert.equal(hit(blocked).amount, 0); assert.equal(blocked.b.hp, hp);
  const noDamage = await fixture({attacker: {criticalRate: 1}});
  assert.equal(hit(noDamage, {...rawHit, NO_DAMAGE: 1}).amount, 0);
  assert.equal(noDamage.calls.critical.length, 0);
});

test('unsupported type6 is rejected rather than silently treated as mixed damage', async () => {
  const f = await fixture(), hp = f.b.hp;
  const result = hit(f, {...rawHit, DAMAGE_TYPE: 6, DAMAGE: {PHYSIC: 1, MAGIC: 1}});
  assert.equal(result.accepted, false); assert.match(result.reason, /unsupported/);
  assert.equal(f.b.hp, hp); assert.equal(f.calls.critical.length, 0);
});
