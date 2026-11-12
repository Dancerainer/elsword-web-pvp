/** Fixed Raven callback attachment identities. The wire carries only a key;
 * receivers rebuild bone/trace fields from this local source contract. */
const armNames=new Set(['RVC_OverHeat_Object_Start','RVC_OverHeat_Object_End']);
const scaledGroundNames=new Set(['UpLight_Raven_RRF_Ground_Impact01',
  'Ground_ShockWave_Raven_RRF_Ground_Impact01','UpLight_Raven_RRF_Ground_Impact02']);
export function veteranAttachmentKey(definition){
  if(armNames.has(definition.NAME)&&definition.BONE_NAME==='Bip01_L_Forearm')return 'overheat-arm';
  if(definition.NAME==='DAMAGE_EFFECT_OVERHEAT_EFFECT'){
    if(definition.BONE_NAME==='Bip01_L_Forearm')return 'overheat-forearm-fire';
    if(definition.BONE_NAME==='Bip01_L_Hand')return 'overheat-hand-fire';
  }
  return null;
}
export function veteranAttachmentDefinition(name,key){
  if(key==='overheat-arm'&&armNames.has(name))return {NAME:name,BONE_NAME:'Bip01_L_Forearm',TRACE:1,TRACE_MATRIX:1};
  if(name==='DAMAGE_EFFECT_OVERHEAT_EFFECT'&&['overheat-forearm-fire','overheat-hand-fire'].includes(key))
    return {NAME:name,BONE_NAME:key==='overheat-hand-fire'?'Bip01_L_Hand':'Bip01_L_Forearm',TRACE:1};
  return null;
}
export function veteranInstanceDefinition(profile,effect,definition){
  if(profile.target?.unitClass!==115)return definition;
  if(effect.sourceVeteranAttachment!=null)return veteranAttachmentDefinition(effect.name,effect.sourceVeteranAttachment);
  if(effect.skillId===24216&&scaledGroundNames.has(effect.name)){
    const skill=profile.skillCatalog.find(s=>s.skillId===24216);
    const scale=skill.raw.SA_PROJECTILE_SIZE[skill.maxLevel];
    return {...definition,SCALE_X:scale,SCALE_Y:scale,SCALE_Z:scale};
  }
  return definition;
}
