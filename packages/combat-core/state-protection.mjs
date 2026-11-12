/** 2016 state fields evaluated with the pinned V5 consumers. Item/socket armor,
 * identity buffs and target-native macro differences are outside this subset.
 * See contracts/rf-state-protection-source.json. */
const enabled = value => value === 1 || value === true;
const table = value => value && typeof value === 'object';
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

export function evaluateStateProtection(raw, animationTime, {forceInvincible = 0, initial = false, customSuperArmor = false} = {}) {
  if (!Number.isFinite(animationTime) || !Number.isFinite(forceInvincible))
    throw new TypeError('Finite state protection clocks required');
  const inv = raw?.INVINCIBLE;
  const start = number(inv?.['1'], -1), end = number(inv?.['2'], -1);
  // Entry tests zero without the sentinel gate; frame move tests -1 first.
  const windowInvincible = table(inv) && (initial ? start <= 0 && end > 0 :
    start !== -1 && end !== -1 && animationTime >= start && animationTime < end);
  const stateArmor = enabled(raw?.SUPER_ARMOR);
  // State-start loads the ranges but does not execute CommonFrameMoveFuture.
  // Unlike INVINCIBLE, SUPER_ARMOR_TIME includes the end of each range.
  let timeArmor = false;
  if (!initial) for (let index = 0; table(raw?.['SUPER_ARMOR_TIME'+index]); index++) {
    const range = raw['SUPER_ARMOR_TIME'+index];
    if (animationTime >= number(range['1'],0) && animationTime <= number(range['2'],0)) timeArmor = true;
  }
  const superArmor = stateArmor || timeArmor || customSuperArmor;
  return {invincible: forceInvincible > 0 || Boolean(windowInvincible), superArmor,
    superArmorNotRed: customSuperArmor ? false : raw?.SUPER_ARMOR_NOT_RED !== 0 && raw?.SUPER_ARMOR_NOT_RED !== false};
}

/** Damage-react cleanup is conditional in X2GUUser.cpp 10033–10040.
 * An accepted hit can deal damage without interrupting an armored action. */
export function shouldDeleteDamageReactEffects({superArmor, invincible}, reactionType) {
  return !superArmor && !invincible && reactionType !== 7 && reactionType !== 22;
}
