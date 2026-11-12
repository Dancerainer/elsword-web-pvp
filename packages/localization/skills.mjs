import targetText from './skill-text.json' with {type: 'json'};
import targetTraits from './trait-text.json' with {type: 'json'};
import {traitDisplay} from './trait-display.mjs';
import {capabilityNotes} from './capability-notes.mjs';

export {capabilityNotes};
export const cleanSkillText = text => String(text ?? '').replace(/#C[0-9a-f]{6}|#CX/gi, '').trim();
// Older converted catalogs sometimes put the localized label in the template itself.
// Resolve display strings by their stable target ID without modifying the supplied catalog.
const englishText = (...candidates) => candidates.find(text => typeof text === 'string' && text.trim() && !/\p{Script=Han}/u.test(text)) ?? '';
const idOf = skill => Number(skill?.skillId ?? skill?.id ?? skill);
export const isAddSkill = skill => [122, 123, 126].includes(skill?.classId ?? skill?.unitClass)
  || (idOf(skill) >= 29000 && idOf(skill) < 30000);

// Display-only project rules supplement the original NA declarations.
const projectText = {
  21017: {
    main: 'Summon a giant sword to strike the enemy. The explosion staggers the target and drains MP.',
    effect: 'Moon Blade (Magic): 1784%. The explosion deals no HP damage. It staggers the target and drains 30% of maximum MP.',
  },
  24405: {
    main: 'Spend one Awakening Bead to reawaken. Charge the core by two stages, up to its maximum. Each bead adds one bead’s duration (about 21 seconds at max level). Reawakening with three beads activates the electric field.',
  },
  28018: {
    effect: 'Flame (Magic): 550% continuous hits per second. Heat (Magic, no stagger): 110% × 3 per second. The listed duration is 5 seconds. The actual duration still needs verification.',
  },
  28038: {
    effect: 'Blade (Physical): 181% continuous hits. Double attack chance: 20% (25% when enhanced). Duration: 15 seconds (23 seconds when enhanced). The enhancement is not implemented.',
  },
};

export function skillLabel(skill) {
  const raw = skill?.template ?? skill?.raw;
  const id = idOf(skill);
  return cleanSkillText(englishText(raw?.m_wstrName, targetText[id]?.name, skill?.originalName, skill?.name, Number.isFinite(id) ? `Skill ${id}` : ''));
}

export function skillDisplayText(skill) {
  const id = idOf(skill), source = targetText[id], raw = skill?.template ?? skill?.raw;
  if (!source && !raw) return null;
  const maxLevel = skill?.maxLevel ?? source?.maxLevel;
  const main = cleanSkillText(englishText(raw?.m_wstrMainDesc, source?.main));
  const row = {
    name: skillLabel(skill),
    main: main.split(/\r?\n\r?\n/).filter(p => !/^Requires 1 El's Essence \(Item\)/i.test(p)).join('\n\n'),
    effect: cleanSkillText(englishText(raw?.m_EffectiveDesc?.[maxLevel], source?.effect)),
    pvpEffect: cleanSkillText(englishText(raw?.m_EffectiveDesc_PVP?.[maxLevel], raw?.m_EffectiveDescPVP?.[maxLevel], skill?.pvpDescription, source?.pvpEffect)),
    maxLevel,
    passive: skill?.passive ?? source?.passive ?? [1, 8].includes(skill?.type),
    mpCost: raw?.m_MPConsumption?.[maxLevel] ?? source?.mpCost,
    cooldown: raw?.m_SkillCoolTime?.[maxLevel] ?? source?.cooldown,
    ...projectText[id],
  };
  return row;
}
export const getSkillText = skillDisplayText;

export function skillDescription(skill, level = skill?.maxLevel) {
  const text = skillDisplayText(skill);
  if (!text) return cleanSkillText(englishText(skill?.description));
  if (level != null && Number(level) !== text.maxLevel) {
    return `This description is for max level ${text.maxLevel}. Values for level ${level} are unavailable.`;
  }
  const summary = [`Max level ${text.maxLevel}`];
  if (text.passive) summary.push('Passive skill. Granted at max level and cannot be equipped in a skill slot.');
  else {
    if (Number.isFinite(text.mpCost)) summary.push(`MP cost: ${text.mpCost}`);
    if (Number.isFinite(text.cooldown)) summary.push(`Cooldown: ${text.cooldown} seconds`);
  }
  return [...summary, text.main, text.effect].filter(Boolean).join('\n\n');
}

// Older RF callers supply just a memo ID. Declared branches always take precedence.
function resolveTrait(branch) {
  if (branch?.memoTypeName) return branch;
  const job = branch?.classId ?? branch?.unitClass ?? 107;
  return targetTraits[job]?.[branch?.branchId ?? branch?.id ?? branch] ?? branch;
}
export const getTraitText = branch => traitDisplay(resolveTrait(branch), branch);
export const traitLabel = branch => englishText(getTraitText(branch).name, branch?.memoTypeName);
export function traitDescription(branch) {
  branch = resolveTrait(branch);
  const vcCrow = branch?.unitClass === 115 && branch?.originalSkillId === 24022 && branch?.memoTypeName === 'MI_USEFUL';
  const description = vcCrow ? 'The initial hit and lingering flames deal 70% of their usual damage per hit. The flames hit twice as often for the same duration.' : getTraitText(branch).description;
  return [englishText(description), ...capabilityNotes(branch)].filter(Boolean).join('\n\n');
}
