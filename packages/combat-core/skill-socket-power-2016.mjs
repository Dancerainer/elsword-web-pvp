/** Target31fa8f10 exact-key delta map. Missing key defaults0; only a first
 * miss may consult one upgrade predecessor. This is distinct from Buff
 * multiplicative lists and the generic equipment skill-damage channel. */
export function sourceSkillPowerDelta(actor,profile,skillId){
 const values=actor.equipmentAttributes?.skillPowerDeltas??{};
 const read=id=>{const n=values[id];if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError('Invalid source socket skill delta');return n;};
 if(Object.hasOwn(values,skillId))return read(skillId);
 const predecessor=profile.skillCatalog?.find(s=>s.skillId===skillId)?.raw.m_DeleteSkillIDByUpgrade;
 if(predecessor&&Object.hasOwn(values,predecessor))return read(predecessor);
 return 0;
}
