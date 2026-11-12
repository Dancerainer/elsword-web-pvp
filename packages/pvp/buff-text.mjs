import source from '../../contracts/rf-pvp-rules-source-v1.json' with {type:'json'};

// Older snapshots may carry translated text. Recover the display from stable IDs
// and actual modifier values without altering the saved buff or its duration.
export function pvpBuffText(id, modifiers = {}) {
  if (id === 'pvp-outnumbered') {
    const {outnumbered, hitMpBonus, receivedMpBonus} = modifiers;
    const description = [outnumbered, hitMpBonus, receivedMpBonus].every(Number.isFinite)
      ? `Outnumbered by ${outnumbered}: base MP on hit +${hitMpBonus}, base MP when hit +${receivedMpBonus}` : '';
    return {name: 'Outnumbered', description};
  }
  const level = source.revenge.levels.findIndex(row => String(row.templateId) === String(id)) + 1;
  if (level || id === 'pvp-revenge') {
    const {damageMultiplier, receivedMultiplier, receivedMpMultiplier} = modifiers;
    const description = [damageMultiplier, receivedMultiplier, receivedMpMultiplier].every(Number.isFinite)
      ? `Attack +${Math.round((damageMultiplier - 1) * 100)}%, incoming damage ×${receivedMultiplier}, MP recovered when hit ×${receivedMpMultiplier}` : '';
    return {name: level ? `Revenge ${level}` : 'Revenge', description};
  }
  return {name: 'PvP status', description: ''};
}
