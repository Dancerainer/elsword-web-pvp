/** Explicit product rules, never changes to target2016 raw declarations. */
export function stateProtectionOptions(preset,actor,options={}){
  const rule=preset?.customStateProtection?.[actor.state];
  return {...options,...(actor.manaBreak?.pendingDown?{forceInvincible:Math.max(options.forceInvincible??0,1)}:{}),
    customSuperArmor:rule?.superArmor===true||actor.skillContext?.traitPolicy?.superArmor===true||actor.buffs?.some(buff=>buff.behaviors.some(row=>row.kind==='superArmor'))===true};
}
