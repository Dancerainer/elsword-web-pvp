/** Saved Time Ring resources describe an earlier instant. A current maximum
 * cannot bound them after a stat buff expires or a maximum-MP debuff arrives.
 * This protocol bound uses the frozen passive base and the only implemented
 * positive temporary MP-maximum grant, target2016 War Prelude (one stack).
 * It is a possible-history bound, not proof of a prior cast or native packets.
 */
function warPreludeMpGrant(source,recipient,profile){
  if(source.team!==recipient.team||profile?.target?.unitClass!==120||
    source.profileId&&source.profileId!==profile.profileId||!source.loadout?.some(slot=>slot?.skillId===28009))return 0;
  const skill=profile.skillCatalog?.find(row=>row.skillId===28009),
    set=profile.effectSets?.EffectSet_SA_SGM_WAR_PRELUDE?.raw,
    carrier=profile.damageEffects?.DamageEffect_SA_SGM_War_Prelude_Buff?.raw?.DAMAGE_DATA,
    factor=profile.buffFactors?.[298]?.raw,template=profile.buffTemplates?.[297]?.raw;
  if(!skill||!Number.isInteger(skill.maxLevel)||!Object.values(set??{}).some(row=>row?.NAME==='DamageEffect_SA_SGM_War_Prelude_Buff')||
    carrier?.APPLIED_SKILL_ID!==28009||carrier.ATTACK_OUR_TEAM!==1||carrier.NO_DAMAGE!==1||
    !Object.values(carrier.BUFF_FACTOR_ID??{}).includes(298)||factor?.BUFF_TEMPLET_ID!==297||
    template?.BUFF_TEMPLET_ID!==297||template.ACCUMULATION_LIMIT!==1)return 0;
  const change=factor.BEHAVIOR?.BBT_CHANGE_MAX_MP,base=template.BEHAVIOR?.BBT_CHANGE_MAX_MP;
  if(change?.BUFF_CHANGE_TYPE!==1||base?.BUFF_CHANGE_TYPE!==1||base.BUFF_RELATION_TYPE!==7)return 0;
  const amount=typeof change.FIX_VALUE==='number'?change.FIX_VALUE:change.FIX_VALUE?.[String(skill.maxLevel)];
  return Number.isFinite(amount)&&amount>0?Math.fround(amount):0;
}
export function timeRingSavedMpLimit(actor,profile,{actors=[],profiles={}}={}){
  const base=actor.buffBaseStats?.mpMax??actor.mpMax;
  if(!Number.isFinite(base)||base<0)return NaN;
  let bonus=warPreludeMpGrant(actor,actor,profile);
  for(const source of actors){
    if(source.id===actor.id)continue;
    bonus=Math.max(bonus,warPreludeMpGrant(source,actor,profiles[source.professionId]));
  }
  // Two Grand Masters refresh the same template, never add two +50 grants.
  return Math.fround(base+bonus);
}
