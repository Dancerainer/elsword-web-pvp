/** Target2016 static consumers 31f7cf40/31f52640/32260250.
 * User MI_CRITICAL policy stays explicit;
 * recovering a public callback does not certify every skill-specific caller. */
const finite=(v,n)=>{if(typeof v!=='number'||!Number.isFinite(v))throw new TypeError('Invalid trait '+n);return v;};
export function createSkillTraitPolicy(skill,branchId='none'){
  const policy={branchId,mpMultiplier:1,cooldownMultiplier:1,damageMultiplier:1,
    hitGapMultiplier:1,rangeMultiplier:1,forceCritical:false,ignoreDefence:false,defencePierceMultiplier:1,
    ignoreDefensiveEffects:false,forceDownAdd:0,targetMpBurn:0,
    buffDurationMultiplier:1,buffStrengthMultiplier:1,unsupported:[],
    evidenceClass:'target2016-static-consumer-with-web-caller-adapter',targetConsumerVerified:true};
  if(branchId==='none')return policy;
  const branch=skill?.branches?.find(b=>(b.id??b.branchId)===branchId);
  if(!branch)throw new RangeError('Unknown trait '+branchId+' for skill '+skill?.skillId);
  const p=branch.parameters.map((v,i)=>finite(v,'parameter '+i));
  policy.skillId=skill.skillId;policy.originalSkillId=branch.originalSkillId??skill.skillId;policy.memoType=branch.memoType;
  policy.memoTypeName=branch.memoTypeName;policy.rawParameters=[...p];
  switch(branch.memoTypeName){
    case 'MI_ENHANCE':policy.damageMultiplier=p[0];break;
    case 'MI_HEAVY':policy.damageMultiplier=p[0];policy.cooldownMultiplier=p[1];break;
    case 'MI_LIGHT':policy.mpMultiplier=p[0];break;
    case 'MI_BRILLIANT':policy.mpMultiplier=p[0];policy.cooldownMultiplier=p[1];break;
    case 'MI_FASTEST':policy.cooldownMultiplier=p[0];break;
    case 'MI_TOUGH':policy.cooldownMultiplier=p[0];policy.superArmor=true;break;
    case 'MI_MAXIMIZE':policy.criticalRateAdd=p[0];policy.damageMultiplier=p[1];break;
    case 'MI_CRITICAL':policy.mpMultiplier=p[0];policy.defencePierceMultiplier=.75;policy.ignoreDefensiveEffects=true;
      policy.evidenceClass='user-custom-lethal-25-percent-defence-v2';
      policy.unsupported.push('MI_CRITICAL defensive-effect bypass consumer unavailable; no fabricated core-guard/passive bypass');break;
    case 'MI_HUGE':policy.rangeMultiplier=p[0];break;
    case 'MI_PERSISTENT':policy.forceDownAdd=p[0];break;
    case 'MI_WICKED':policy.targetMpBurn=p[0];break;
    // Target General.ess35585: "Targets cannot use mana break." The damage
    // NO_DETONATION flag already enters the original native charge gate.
    case 'MI_BRUTAL':
      if([101,8,29,30,35,120,121,125].includes(skill.unitClass))policy.preventManaBreak=true;
      else policy.unsupported.push('Unimplemented target trait '+branch.memoTypeName);break;
    case 'MI_CHECK_AND_KILL_1':policy.buffDurationMultiplier=p[0];break;
    case 'MI_CHECK_AND_KILL_2':policy.buffStrengthMultiplier=p[0];break;
    case 'MI_USEFUL':policy.damageMultiplier=p[1];policy.hitGapMultiplier=p[0];break;
    case 'MI_LONGSHOT':policy.meshLifetimeMultiplier=p[0];break;
    case 'MI_ABSORB':
      // Target text says MP gained per hit increases to @1. The existing
      // DamageData HIT_ADD_MP is the independent source base; this is the
      // declared target adapter, not a claim of matching V6 native controlflow.
      policy.hitMpMultiplier=p[0];break;
    case 'MI_TRANSCENDENCE_1':
      if(!(skill.unitClass===121&&skill.skillId===28016&&p[0]===28032))policy.unsupported.push('Unimplemented target trait '+branch.memoTypeName);
      // Exact target Dance-Endless replacement is consumed by the Elesis
      // state host and its original EFFECT_SET_LIST_EX_TRANS_1 branch.
      break;
    case 'MI_REGENERATE_1':
      if([100,101,106,112,115,8,29,30,35,120,121,125,123].includes(skill.unitClass)){policy.mpRefundChance=p[0];policy.mpRefundFraction=p[1];}
      else policy.unsupported.push('Unimplemented target trait '+branch.memoTypeName);break;
    case 'MI_REGENERATE_2':
      if([8,29,30,35,120,121,125].includes(skill.unitClass)){policy.cooldownResetChance=p[0];policy.cooldownResetMultiplier=p[1];}
      else policy.unsupported.push('Unimplemented target trait '+branch.memoTypeName);break;
    default:policy.unsupported.push('Unimplemented target trait '+branch.memoTypeName);
  }
  for(const k of ['mpMultiplier','cooldownMultiplier','damageMultiplier','hitGapMultiplier','rangeMultiplier','buffDurationMultiplier','buffStrengthMultiplier'])
    if(!(finite(policy[k],k)>0))throw new RangeError('Nonpositive trait '+k);
  return policy;
}
export function skillTraitDamageData(data,policy){
  if(!policy||!data)return data;
  if(!skillTraitAppliesToData(data,policy))return data;
  const result={...data};
  if(policy.forceDownAdd)result.FORCE_DOWN=(data.FORCE_DOWN??0)+policy.forceDownAdd;
  if(policy.ignoreDefence)result.IGNORE_DEFENCE=1;
  if(policy.forceCritical)result.traitForceCritical=true;
  if(policy.criticalRateAdd!==undefined)result.CRITICAL_RATE=policy.criticalRateAdd;
  if(policy.preventManaBreak)result.NO_DETONATION=1;
  if(policy.hitGapMultiplier!==1&&Number.isFinite(data.HIT_GAP))result.HIT_GAP=data.HIT_GAP*policy.hitGapMultiplier;
  return result;
}
/** Native hook queries the DD's own skill ID and optional type discriminator.
 * Legacy isolated policies without a skill ID remain usable by pure fixtures. */
export function skillTraitAppliesToData(data,policy){
  if(!policy?.skillId)return true;
  return [policy.skillId,policy.originalSkillId].includes(data?.APPLIED_SKILL_ID)&&
    (!data.APPLIED_MEMO_ID||data.APPLIED_MEMO_ID===policy.memoType);
}
export function appliedSkillTraitPolicy(actor,profile,data,fallback=null){
  if(!data?.APPLIED_SKILL_ID)return fallback?.skillId?null:fallback;
  if(fallback?.skillId&&skillTraitAppliesToData(data,fallback))return fallback;
  for(const slot of actor.loadout??[]){
    const skill=profile.skillCatalog.find(row=>row.skillId===slot?.skillId);
    if(!skill)continue;
    const policy=createSkillTraitPolicy(skill,slot.branchId??'none');
    if(skillTraitAppliesToData(data,policy)&&[skill.skillId,policy.originalSkillId].includes(data.APPLIED_SKILL_ID))return policy;
  }
  return null;
}
/** Existing cast scalar stores the selected damage trait. Remove that factor
 * when a child DD has no APPLIED ID, or replace it with the actual DD skill's
 * equipped trait. Native effect1c8 scalar itself is independent of that hook. */
export function appliedSkillTraitPower(power,previous,next){
  if(previous&&!previous.skillId&&previous===next)return power;
  const from=previous?.skillId?previous.damageMultiplier??1:1,to=next?.damageMultiplier??1;
  return power/from*to;
}
export function applySkillTraitMeshLifetime(effect){
  const policy=effect.traitPolicy;
  if(policy?.meshLifetimeMultiplier!==undefined&&skillTraitAppliesToData(effect.damage?.DAMAGE_DATA,policy)&&Number.isFinite(effect.lifeTimeSeconds))
    effect.lifeTimeSeconds=Math.fround(effect.lifeTimeSeconds*policy.meshLifetimeMultiplier);
}
export function scaleSkillAttackShapes(shapes,origin,policy){
  const scale=policy?.rangeMultiplier??1;if(scale===1)return shapes;
  const point=v=>v.map((x,i)=>origin[i]+(x-origin[i])*scale);
  return shapes.map(s=>s.kind==='sphere'?{...s,center:point(s.center),radius:s.radius*scale}:
    s.kind==='line'?{...s,start:point(s.start),end:point(s.end),radius:s.radius*scale}:s);
}
export function skillTraitBuffFactor(factor,policy){
  if(!policy||policy.buffDurationMultiplier===1&&policy.buffStrengthMultiplier===1)return factor;
  const result=structuredClone(factor);
  for(const [name,v] of Object.entries(result.FINALIZER??{}))if(name==='BFT_TIME'&&v.NORMAL_TIME)
    for(const level of Object.keys(v.NORMAL_TIME))v.NORMAL_TIME[level]*=policy.buffDurationMultiplier;
  for(const [name,v] of Object.entries(result.BEHAVIOR??{}))if(['BBT_CHANGE_PHYSIC_ATTACK','BBT_CHANGE_MAGIC_ATTACK','BBT_CHANGE_CRITICAL_RATE','BBT_CHANGE_CRITICAL_ATTACK','BBT_CHANGE_PHYSIC_DEFENCE','BBT_CHANGE_MAGIC_DEFENCE','BBT_CHANGE_FINAL_DEFENCE_MULTIPLIER','BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_MELEE_ATTACK','BBT_CHANGE_FINAL_DAMAGE_MULTIPLIER_RANGE_ATTACK'].includes(name)&&v.PERCENT)
    for(const level of Object.keys(v.PERCENT)){
      // Percent-stat factors encode final stat ratio, e.g. .57 is 43% reduction.
      // Enhance the effect's difference from neutral 1, not the final ratio.
      v.PERCENT[level]=Math.fround(v.PERCENT[level]+(v.PERCENT[level]-1)*Math.abs(policy.buffStrengthMultiplier-1));
    }
  const drain=result.BEHAVIOR?.BBT_DRAIN_HP_NORMAL_ATTACK?.FIX_VALUE;
  if(drain)for(const level of Object.keys(drain))drain[level]*=policy.buffStrengthMultiplier;
  return result;
}
