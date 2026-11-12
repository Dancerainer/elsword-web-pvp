import test from 'node:test';
import assert from 'node:assert/strict';
import {PROFESSION_PROFILES} from '../../packages/professions/profiles.mjs';
import {capabilityNotes, cleanSkillText, skillLabel, skillDisplayText, skillDescription, traitDescription, traitLabel} from '../../packages/localization/skills.mjs';
import lookup from '../../packages/localization/skill-text.json' with {type: 'json'};

test('every class uses the original NA names, descriptions and level values by skill ID', () => {
  const ids = new Set();
  for (const profile of Object.values(PROFESSION_PROFILES)) for (const skill of profile.skillCatalog) {
    const {raw, skillId, maxLevel} = skill;
    ids.add(skillId);
    const snapshot = JSON.stringify(skill);
    assert.equal(skillLabel(skill), cleanSkillText(raw.m_wstrName));
    assert.equal(skillLabel({id: skillId, name: 'legacy localized name'}), skillLabel(skill));
    const source = lookup[skillId];
    assert.equal(source.main, raw.m_wstrMainDesc);
    assert.equal(source.effect, raw.m_EffectiveDesc?.[maxLevel]);
    const rendered = skillDisplayText(skill);
    assert.doesNotMatch([rendered.name, rendered.main, rendered.effect].join(' '), /\p{Script=Han}|\uFFFD/u);
    for (const branch of skill.branches) {
      assert.match(traitLabel(branch), /[a-z]/i);
      const description = traitDescription(branch);
      assert.match(description, /[a-z]/i);
      assert.doesNotMatch(description, /\p{Script=Han}|NaN|undefined/u);
    }
    assert.equal(JSON.stringify(skill), snapshot);
  }
  assert.equal(ids.size, Object.keys(lookup).length);
});

test('project rules are distinct from canonical target descriptions', () => {
  assert.match(lookup[21017].effect, /Explosion.*1784%/i);
  assert.match(skillDisplayText(21017).effect, /explosion deals no HP damage.*30%/);
  assert.match(skillDisplayText(24405).main, /two stages.*21 seconds/);
  for (const [id,row] of Object.entries(lookup)) {
    if (/Requires 1 El's Essence/i.test(row.main)) assert.doesNotMatch(skillDisplayText(Number(id)).main, /El's Essence/i, id);
  }
  assert.match(skillDescription(24405,1), /Values for level 1 are unavailable/);
  assert.match(capabilityNotes({limitations:['maximum-strike-orbs']})[0], /25 MP or DP/);
});

test('a partial trait reference resolves by class and preserves the legacy RF default', () => {
  assert.equal(traitLabel({id:'memo-18'}), 'Light');
  assert.match(traitDescription({id:'memo-18'}), /70%/);
  assert.equal(traitLabel({id:'memo-18',classId:100}), 'Persistent');
  assert.match(traitDescription({id:'memo-18',classId:100}), /-20/);
});

test('localized labels and template prose in an older asset pack resolve to the same target skill', () => {
  const legacyText = '';
  const legacy = {id: 21026, name: legacyText, maxLevel: 1, template: {
    m_wstrName: legacyText, m_wstrMainDesc: legacyText, m_EffectiveDesc: {'1': legacyText},
    m_EffectiveDesc_PVP: {'1': legacyText},
  }};
  const current = skillDisplayText(21026);
  assert.deepEqual(skillDisplayText(legacy), current);
  assert.doesNotMatch(skillDescription(legacy), /\p{Script=Han}/u);
});
