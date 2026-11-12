/** Target NA names and a readable Long Shot enum label. Percentages use the combat parameters. */
const names = {
  MI_ENHANCE: 'Empowered', MI_HEAVY: 'Heavy', MI_LIGHT: 'Light', MI_BRILLIANT: 'Reversed',
  MI_FASTEST: 'Haste', MI_TOUGH: 'Powerful', MI_MAXIMIZE: 'Enhanced', MI_CRITICAL: 'Critical',
  MI_HUGE: 'Gigantic', MI_PERSISTENT: 'Persistent', MI_WICKED: 'Evil', MI_BRUTAL: 'Ruthless',
  MI_USEFUL: 'Useful', MI_ABSORB: 'Absorbing', MI_CHECK_AND_KILL_1: 'Killing Blow (1)',
  MI_CHECK_AND_KILL_2: 'Killing Blow (2)', MI_REGENERATE_1: 'Regenerating (1)',
  MI_REGENERATE_2: 'Regenerating (2)', MI_LONGSHOT: 'Long Shot', MI_TRANSCENDENCE_1: 'Awakened',
};
const percent = value => `${Number((100 * value).toFixed(4))}%`;
const change = (what, ratio) => `${what} becomes ${percent(ratio)} of its base value.`;

export function traitDisplay(branch, fallback = {}) {
  const type = branch?.memoTypeName ?? fallback?.memoTypeName;
  const p = branch?.parameters ?? fallback?.parameters ?? [];
  let description;
  if (p.every(Number.isFinite)) switch (type) {
    case 'MI_ENHANCE': description = change('Damage', p[0]); break;
    case 'MI_HEAVY': description = change('Damage', p[0]) + ' ' + change('Cooldown', p[1]); break;
    case 'MI_LIGHT': description = change('MP cost', p[0]); break;
    case 'MI_BRILLIANT': description = change('MP cost', p[0]) + ' ' + change('Cooldown', p[1]); break;
    case 'MI_FASTEST': description = change('Cooldown', p[0]); break;
    case 'MI_TOUGH': description = 'Gain Super Armor while casting. ' + change('Cooldown', p[0]); break;
    case 'MI_MAXIMIZE': description = `Critical chance becomes ${percent(p[0])}. ` + change('Damage', p[1]); break;
    case 'MI_CRITICAL': description = change('MP cost', p[0]) + ' Ignore 25% of enemy defense.'; break;
    case 'MI_HUGE': description = change('Attack range', p[0]); break;
    case 'MI_PERSISTENT': description = `Adjust knockdown per hit by ${p[0]}.`; break;
    case 'MI_WICKED': description = `Drain ${Math.abs(p[0])} MP from the target per hit.`; break;
    case 'MI_ABSORB': description = change('MP gained per hit', p[0]); break;
    case 'MI_USEFUL': description = 'Increase the number of hits. ' + change('Damage per hit', p[1]); break;
    case 'MI_CHECK_AND_KILL_1': description = change('Effect duration', p[0]); break;
    case 'MI_CHECK_AND_KILL_2': description = change('Effect strength', p[0]); break;
    case 'MI_REGENERATE_1': description = `${percent(p[0])} chance to refund ${percent(p[1])} of the MP spent.`; break;
    case 'MI_REGENERATE_2': description = `${percent(p[0])} chance to reduce cooldown to ${percent(p[1])}.`; break;
    case 'MI_BRUTAL': description = 'Targets hit by this skill cannot use Mana Break.'; break;
    case 'MI_LONGSHOT': description = change('Projectile lifetime', p[0]); break;
    case 'MI_TRANSCENDENCE_1':
      if (p[0] === 28032) description = 'Changes the skill to Endless Fire Dance. Each dash deals 497% magic damage, with 1290% extra on the first hit. Each dash after the eighth costs 20 MP, until MP runs out or there are no more targets.';
      else if (Number.isSafeInteger(p[0])) description = `Changes the skill to #${p[0]}. This replacement is not implemented.`;
      break;
  }
  return {name: names[type] ?? fallback?.name, description: description && !/NaN|undefined/.test(description) ? description : fallback?.description};
}
