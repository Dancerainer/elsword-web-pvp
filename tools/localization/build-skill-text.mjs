// Store display fields only. Lightweight menus also receive records containing only a skill ID.
import {readFile, writeFile} from 'node:fs/promises';
import {PROFESSION_IDS} from '../../packages/professions/catalog.mjs';

const skills = {};
const traits = {};
for (const job of PROFESSION_IDS) {
  const file = new URL('../../packages/combat-core/' + job.toLowerCase() + '-profile.json', import.meta.url);
  const {target, skillCatalog} = JSON.parse(await readFile(file, 'utf8'));
  const jobTraits = traits[target.unitClass] = {};
  for (const {skillId, maxLevel, passive, raw, branches} of skillCatalog) {
    const row = {
      name: raw.m_wstrName,
      main: raw.m_wstrMainDesc,
      effect: raw.m_EffectiveDesc?.[maxLevel],
      pvpEffect: raw.m_EffectiveDesc_PVP?.[maxLevel] ?? raw.m_EffectiveDescPVP?.[maxLevel],
      mpCost: raw.m_MPConsumption?.[maxLevel],
      cooldown: raw.m_SkillCoolTime?.[maxLevel],
      maxLevel, passive,
    };
    if (skills[skillId] && JSON.stringify(row) !== JSON.stringify(skills[skillId])) {
      throw Error('Conflicting target display data for skill ' + skillId);
    }
    skills[skillId] = row;
    for (const {id, memoTypeName, parameters, originalSkillId, unitClass} of branches) {
      const memo = {memoTypeName, parameters, originalSkillId, unitClass};
      if (jobTraits[id] && JSON.stringify(jobTraits[id]) !== JSON.stringify(memo)) {
        throw Error('Conflicting target trait for ' + job + '/' + id);
      }
      jobTraits[id] = memo;
    }
  }
}
await writeFile(new URL('../../packages/localization/skill-text.json', import.meta.url), JSON.stringify(skills, null, 2) + '\n');
await writeFile(new URL('../../packages/localization/trait-text.json', import.meta.url), JSON.stringify(traits) + '\n');
