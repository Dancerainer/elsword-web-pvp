/** Target2016 RF Z is a TRACE damage-effect proxy for the body melee attack.
 * Fixed V5 DamageReactStateChange accepts the owner's near-ground height only
 * for AT_UNIT, while this target declaration routes Z through AT_EFFECT.
 * This bounded web adapter restores the reported low-air X -> ground Z pickup.
 * It is not a recovered 2016 native consumer and never changes positions, KD,
 * RT_DOWN or the source projectile reaction policy.
 * Evidence and the explicit target-consumer gap: rf-ground-pickup-source-v15.
 */
export const RF_Z_PICKUP_ADAPTER=Object.freeze({
  id:'rf-z-trace-near-ground-owner-v15',
  evidence:'target2016 RF Z TRACE proxy + fixed-V5 90/150/200 branches + user low-air pickup feedback; target native consumer unverified',
  sourceState:'RSI_COMBO_Z',
  effectSet:'EffectSet_RF_COMBO_Z',
  effect:'DamageEffect_RF_COMBO_Z',
  mainEffect:'Raven_WeaponDummy01',
});

export function rfGroundPickupOwner({effect,actor,origin,data,ownerHeightAboveLand,victimHeightAboveLand,lineRadius}){
  const p=RF_Z_PICKUP_ADAPTER;
  if(origin?.kind!=='effect'||origin.skillId!=null||data?.REACT_TYPE!==1||
    actor?.state!==p.sourceState||effect?.ownerId!==actor?.id||effect?.skillId!=null||
    effect?.name!==p.effect||effect?.setName!==p.effectSet||effect?.mainEffectName!==p.mainEffect||
    effect?.definition?.TRACE_MORE!==1)return null;
  if(!Number.isFinite(lineRadius)||lineRadius<=0||!Number.isFinite(ownerHeightAboveLand)||
    !Number.isFinite(victimHeightAboveLand)||ownerHeightAboveLand<0||ownerHeightAboveLand>=lineRadius*3||
    victimHeightAboveLand<lineRadius*5)return null;
  return {heightAboveLand:ownerHeightAboveLand,adapter:p.id,evidence:p.evidence};
}
