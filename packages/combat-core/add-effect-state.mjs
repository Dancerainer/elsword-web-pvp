/** Frozen target skill29009 scalar payload for Web effect reconstruction. */
export function validateAddStormEffectState(effect,profile){
  const collapse=effect?.sourceAddVoidCollapse;
  if(collapse!==undefined&&(!collapse||typeof collapse!=='object'||Object.keys(collapse).length!==2||!Number.isFinite(collapse.scale)||collapse.scale<=0||collapse.scale>1||!Number.isFinite(collapse.alpha)||collapse.alpha<0||collapse.alpha>1||effect.name!=='DamageEffect_ATT_Void_Field'||effect.skillId!==29023||profile&&profile.target?.unitClass!==126))throw new TypeError('invalid-owner-add-void-collapse');
  const mutation=effect?.sourceAddEnergyBoomMutation;
  if(mutation!==undefined&&(mutation!==true||effect.name!=='DamageEffect_SI_SA_AN_Energy_Boom_Projectile'||![29000,29026].includes(effect.skillId)||profile&&profile.target?.unitType!==9))
    throw new TypeError('invalid-owner-add-energy-boom-mutation');
  const stasis=effect?.sourceAddStasisSize;
  if(stasis!==undefined&&(!Number.isFinite(stasis)||stasis<1||stasis>1.5||!(effect.name==='DamageEffect_APT_Stasis_Field_Activate'||effect.setName==='EffectSet_SA_APT_Stasis_Field_Activate')||effect.skillId!==29007||profile&&profile.target?.unitClass!==122))
    throw new TypeError('invalid-owner-add-stasis-size');
  const size=effect?.sourceAddStormSize;if(size===undefined)return true;
  if(!Number.isFinite(size)||![1,1.31,1.62,1.93].some(value=>Math.abs(size-value)<1e-7))
    throw new TypeError('invalid-owner-add-storm-size');
  if(!profile)return true;
  if(profile.target?.unitClass!==122||!(effect.name==='DamageEffect_ALP_Psychic_Storm_Loop'&&effect.setName==null||
    effect.setName==='EffectSet_SI_SA_ALP_Psychic_Storm_Loop'))throw new TypeError('invalid-owner-add-storm-effect');
  const values=profile.skillCatalog?.find(skill=>skill.skillId===29009)?.raw?.SA_PROJECTILE_SIZE;
  if(!values||!Object.values(values).some(value=>Number.isFinite(value)&&[0,1,2,3].some(n=>Math.abs(1+(value-1)*n-size)<1e-7)))
    throw new TypeError('invalid-owner-add-storm-source');
  return true;
}
export function addInstanceDefinition(profile,effect,definition){
  if(effect.sourceAddVoidCollapse!==undefined){validateAddStormEffectState(effect,profile);const result={...definition};for(const axis of ['X','Y','Z'])result['SCALE_'+axis]=(definition['SCALE_'+axis]??1)*effect.sourceAddVoidCollapse.scale;return result;}
  if(effect.sourceAddEnergyBoomMutation!==undefined||effect.sourceAddStasisSize!==undefined){
    validateAddStormEffectState(effect,profile);const size=effect.sourceAddEnergyBoomMutation?1.5:effect.sourceAddStasisSize;
    const result={...definition};for(const axis of ['X','Y','Z'])result['SCALE_'+axis]=(definition['SCALE_'+axis]??1)*size;
    return result;
  }
  if(effect.sourceAddStormSize===undefined)return definition;
  validateAddStormEffectState(effect,profile);
  const result={...definition};
  for(const axis of ['X','Y','Z'])result['SCALE_'+axis]=(definition['SCALE_'+axis]??1)*effect.sourceAddStormSize;
  if(effect.name==='DamageEffect_ALP_Psychic_Storm_Loop'&&effect.setName==null){
    result.BONE_NAME='Bip01_Footsteps';
    delete result.POSITION_OFFSET_Y;
  }
  return result;
}
