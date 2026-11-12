/** Original2016 BLACKHOLE_DATA opt-in. All motion is executed by the existing
 * qualified fixed-V5 consumer; this list never creates geometry or new values.
 * Bound by the effect's frozen skill identity, not the owner's current cast. */
const names=new Map([
 ['DamageEffect_ALP_Quicksilver_Accel_Blackhole',new Set([29011])],
 ['DamageEffect_ALP_Quicksilver_Accel_Blackhole_Back',new Set([29011])],
 ['DamageEffect_ALP_Psychic_Storm_Start_BlackHole',new Set([29009])],
 ['DamageEffect_AN_Nasod_Armor_CatchingAttack_Loop',new Set([null])],
 ['DamageEffect_APT_DASH_JUMP_COMBO_ZX',new Set([null])],
 ['DamageEffect_AMM_APOCALYPSE_Attack_B_Explosion_Blackhole',new Set([29601,29604])],
 ['DamageEffect_AMM_HA_Apocalypse_Finish_BlackHole',new Set([29601,29604])],
]);
export function isAddBlackHole(effect){
 const ids=names.get(effect?.name);
 return !!ids&&(ids.has(effect.skillId??null)||effect.name==='DamageEffect_AN_Nasod_Armor_CatchingAttack_Loop'&&
  Number.isInteger(effect.skillId)&&effect.skillId>=29000&&effect.skillId<=29604)&&!!effect.damage?.BLACKHOLE_DATA;
}
