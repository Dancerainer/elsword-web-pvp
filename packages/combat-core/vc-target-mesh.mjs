// Bounded target2016 Incineration sets. The target is the original moving
// damage mesh; its authored Dummy bones never refer to the player's skeleton.
export const veteranTargetSets=Object.freeze({
  Effectset_SA_RVC_IGNITION_CROW_INCINERATION_DAMAGE:'DAMAGE_EFFECT_IGNITION_CROW_INCINERATION',
  Effectset_SA_RVC_IGNITION_CROW_INCINERATION_OVERHEAT_DAMAGE:'DAMAGE_EFFECT_IGNITION_CROW_INCINERATION_OVERHEAT',
});
export const hasVeteranTarget=e=>Object.hasOwn(e,'sourceVeteranTargetId');
export function bindVeteranTargetSet(effects,profile){
  if(profile.target?.unitClass!==115)return;
  const target=effects.find(e=>veteranTargetSets[e.setName]===e.name&&e.definition.BONE_TRACE_TARGET_MESH===1);
  if(!target)return;
  for(const e of effects)if(e!==target&&e.definition.TRACE===1&&e.definition.TRACE_USER_TARGET_FORCE!==1)
    e.sourceVeteranTargetId=target.id;
}
export function updateVeteranTarget(sim,e,a){
  if(!hasVeteranTarget(e))return null;
  const target=sim.state.effects.find(t=>t.id===e.sourceVeteranTargetId&&t.ownerId===e.ownerId&&
    t.setName===e.setName&&t.name===veteranTargetSets[e.setName]&&t.active&&!t.dead);
  if(target){
    const position=sim.effectBoneSampler?.(target,a,e.definition.BONE_NAME);
    if(position){
      const base=target.currentAnchor??target.birthAnchor;
      e.currentAnchor={position:[...position],rotation:[...(base?.rotation??[0,0,0])],facing:base?.facing??a.facing};
      [e.x,e.y,e.z]=position;
    }
  }
  // X2EffectSet1299-1313 breaks before SetPos when the target disappears.
  // Particle tails therefore keep their last source position, never the user.
  return e.currentAnchor??e.birthAnchor;
}
export function veteranTargetLifetime(profile,e){
  if(!hasVeteranTarget(e))return null;
  const f=profile.effectTemplates[e.name]?.fields;
  return Number.isFinite(f?.TriggerTime)&&Number.isFinite(f?.Lifetime)?f.TriggerTime+f.Lifetime:null;
}
