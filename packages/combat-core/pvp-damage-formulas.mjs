/** Fixed V5 PvP consumer candidate, not a target2016 runtime measurement.
 * Inputs are resolved combat stats. Equipment normalization, naked character
 * stats and level selection belong to the caller's explicit source contract.
 * See contracts/pvp-damage-formulas-source-v1.json for stages and limitations.
 */
const f = Math.fround;
const finite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new TypeError(`${label} must be a finite float32 number`);
  return f(value);
};
const nonnegative = (value, label) => {
  if (value < 0) throw new RangeError(`${label} must be nonnegative`);
  return finite(value, label);
};
const flag = (value, label) => {
  if (![true, false, 0, 1].includes(value)) throw new TypeError(`${label} must be boolean or 0/1`);
  return value === true || value === 1;
};
const unsupported = (reason, missing = []) => ({supported: false, multiplier: null, reason, missing});
const validType = value => Number.isInteger(value) && value >= 0 && value <= 5;

/** X2GameUnit2351..2518,2626..2630. The .1 applies only to the
 * level-dependent denominator term, never a second normalization of defense.
 * Physical/magic/weapon types share their matching defense; mix averages the
 * two defenses before converting to a reduction (not two separately clamped
 * damage values). Missing inputs remain unresolved rather than becoming zero.
 */
export function resolvePvpDefence({damageType = 0, physicalDefence, magicDefence,
  attackerLevel, penetrate = false, ignoreDefence = false,
  freezeDefenceMultiplier = 1, defencePierceMultiplier = 1} = {}) {
  if (!validType(damageType)) return unsupported('unsupported-damage-type');
  const penetrating = flag(penetrate, 'penetrate'), ignoring = flag(ignoreDefence, 'ignoreDefence');
  const bypass = penetrating || ignoring;
  const freeze = nonnegative(freezeDefenceMultiplier, 'freezeDefenceMultiplier');
  const pierce = nonnegative(defencePierceMultiplier, 'defencePierceMultiplier');
  if (physicalDefence !== undefined && physicalDefence !== null) nonnegative(physicalDefence, 'physicalDefence');
  if (magicDefence !== undefined && magicDefence !== null) nonnegative(magicDefence, 'magicDefence');
  if (attackerLevel !== undefined && attackerLevel !== null && (!Number.isSafeInteger(attackerLevel) || attackerLevel < 1))
    throw new RangeError('attackerLevel must be an explicit positive integer');
  if (bypass || freeze === 0 || pierce === 0)
    return {supported: true, multiplier: 1, defence: 0, denominator: null, bypassed: true};
  const kind = damageType % 3;
  const missing = [];
  if (kind !== 1 && physicalDefence == null) missing.push('physicalDefence');
  if (kind !== 0 && magicDefence == null) missing.push('magicDefence');
  if (missing.length) return unsupported('defence-undefined', missing);
  const defence = kind === 0 ? f(physicalDefence) : kind === 1 ? f(magicDefence)
    : f(f(f(physicalDefence) + f(magicDefence)) * f(.5));
  if (defence === 0) return {supported: true, multiplier: 1, defence, denominator: null, bypassed: false};
  if (attackerLevel == null) return {...unsupported('attacker-level-undefined', ['attackerLevel']), defence};
  // Preserve the reference float operation order instead of replacing 62*.1
  // by an independently rounded literal 6.2.
  const fullDefence = finite(f(348 + f(62 * f(attackerLevel))), 'fullDefence');
  const denominator = finite(f(348 + f(f(fullDefence - 348) * f(.1))), 'denominator');
  const ratio = f(defence / denominator);
  const multiplier = Math.max(0, f(1 - f(f(ratio * freeze) * pierce)));
  return {supported: true, multiplier, defence, denominator, bypassed: false};
}

/** Attack*motion coefficient followed by base defense. PVP_RATE, skill power,
 * sword mode, final stat channels, state guard and critical remain later stages.
 * Weapon-only types must supply weapon-only inputs: total attack is not a
 * source-equivalent substitute. DT6 and unknown types do not fall through MIX.
 */
export function computePvpBaseDamage(options = {}) {
  const {damageType = 0, physicalAttack, magicAttack, weaponPhysicalAttack, weaponMagicAttack,
    physicalMultiplier = 0, magicMultiplier = 0} = options;
  if (!validType(damageType)) return {supported: false, amount: null, reason: 'unsupported-damage-type', missing: []};
  const physicalRate = nonnegative(physicalMultiplier, 'physicalMultiplier');
  const magicRate = nonnegative(magicMultiplier, 'magicMultiplier');
  const weapon = damageType >= 3, kind = damageType % 3;
  const physical = weapon ? weaponPhysicalAttack : physicalAttack;
  const magic = weapon ? weaponMagicAttack : magicAttack;
  const missing = [];
  if (kind !== 1 && physical == null) missing.push(weapon ? 'weaponPhysicalAttack' : 'physicalAttack');
  if (kind !== 0 && magic == null) missing.push(weapon ? 'weaponMagicAttack' : 'magicAttack');
  if (missing.length) return {supported: false, amount: null, reason: weapon ? 'weapon-attack-undefined' : 'attack-undefined', missing};
  const physicalDamage = kind !== 1 ? finite(f(nonnegative(physical, 'physicalAttack') * physicalRate), 'physicalDamage') : 0;
  const magicDamage = kind !== 0 ? finite(f(nonnegative(magic, 'magicAttack') * magicRate), 'magicDamage') : 0;
  const attackBeforeDefence = kind === 0 ? physicalDamage : kind === 1 ? magicDamage
    : finite(f(f(physicalDamage + magicDamage) * f(.5)), 'mixedDamage');
  const defence = resolvePvpDefence(options);
  if (!defence.supported) return {supported: false, amount: null, reason: defence.reason, missing: defence.missing, defence};
  return {supported: true, amount: finite(f(attackBeforeDefence * defence.multiplier), 'amount'), attackBeforeDefence, defence};
}

/** X2GameUnit2700..2707. Each supplied channel is already internally composed.
 * Awakening is in attackFinalMultiplier; revenge attack is an attack STAT buff
 * before this stage. Physique, revenge defense and final-defense Buffs compose
 * in defenceFinalMultiplier. Do not put equipment reduction in this channel.
 * The source permits a negative intermediate here and clamps at the end of
 * GetFinalDamage (2921), after its other supported modifiers.
 */
export function applyPvpFinalDamageStage(amount, {attackFinalMultiplier = 1, defenceFinalMultiplier = 1} = {}) {
  amount = nonnegative(amount, 'amount');
  const attack = nonnegative(attackFinalMultiplier, 'attackFinalMultiplier');
  const defence = nonnegative(defenceFinalMultiplier, 'defenceFinalMultiplier');
  const decrease = f(amount * f(defence - 1));
  const increase = f(amount * f(attack - 1));
  return finite(f(f(amount + decrease) + increase), 'finalStageAmount');
}

/** X2GUUser9382..9385. Equipment additional-defense option is applied after
 * core parry and critical, before separately computed additional attack.
 * It is not bypassed by PENETRATE or IGNORE_STATE_DEFENCE. No integer rounding.
 */
export function applyPvpEquipmentReduction(amount, reduction) {
  amount = nonnegative(amount, 'amount');
  reduction = nonnegative(reduction, 'equipment damageReduction');
  return f(amount - Math.min(f(amount * reduction), amount));
}
