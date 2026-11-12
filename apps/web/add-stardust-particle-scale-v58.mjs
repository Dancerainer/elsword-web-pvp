const BIG='DamageEffect_ATT_Stardust_Shower_Ball_Big';
/** Audited End EffectSet passes scale3 into CEffect::SetScale. The passive
 * factory multiplies entry scales by that factor (DamageEffect.cpp4868).
 * TIME/START entries do not go through that passive-only multiplication. */
export function addStardustParticleScale(entry,parent,{passive=false}={}){
  const scale=['X','Y','Z'].map(axis=>entry['SCALE_'+axis]??1);
  return passive&&parent.name===BIG?scale.map((value,i)=>value*(parent.definition['SCALE_'+['X','Y','Z'][i]]??1)):scale;
}
