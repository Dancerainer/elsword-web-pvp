/** Enhanced Rushing Drone's target upgrade changes its explosion radius.
 * Derive from frozen skill identity on both local creation and wire restore;
 * no peer-provided scale or duplicated actor state is needed. */
export function addDynamoInstanceDefinition(profile,effect,definition){
 if(effect.sourceAddFissionSplit){
  validateAddFissionSplit(effect,profile);
  const raw=profile.damageEffects[effect.sourceAddFissionSplit.parentName].raw[effect.sourceAddFissionSplit.member];
  return {...definition,...Object.fromEntries(['SCALE_X','SCALE_Y','SCALE_Z'].map(key=>[key,raw[key]]))};
 }
 if(profile.professionId!=='mm'||effect.skillId!==29219||effect.name!=='DamageEffect_AAT_Rushing_Drone_Explosion')return definition;
 const skill=profile.skillCatalog.find(s=>s.skillId===29219),scale=skill?.raw.SA_PROJECTILE_SIZE?.[skill.maxLevel];
 if(!Number.isFinite(scale)||scale<=0)throw new TypeError('Original enhanced Rushing Drone radius missing');
 const result={...definition};for(const axis of ['X','Y','Z'])result['SCALE_'+axis]=(definition['SCALE_'+axis]??1)*scale;
 return result;
}
export const ADD_FISSION_DRONE_NAMES=new Set(['DamageEffect_ADD_Dividing_Missile_Dynamo_DA','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA','DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA']);
const fissionParents=new Set(['DamageEffect_ADD_Dividing_Missile_Dynamo','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation',
 'DamageEffect_ADD_Dividing_Missile_Dynamo_DA','DamageEffect_ADD_Dividing_Missile_Dynamo_Mutation_DA']);
const fissionChildren=new Set(['DamageEffect_ADD_Dividing_Missile_Dynamo_Small','DamageEffect_ADD_Dividing_Missile_Dynamo_Small_DA']);
export function isOriginalFissionSplit(profile,parent,member,kind){
 const raw=parent.damage?.[member];return profile.target?.unitClass===123&&parent.skillId===29209&&kind==='DIE_DAMAGE_EFFECT'&&
   fissionParents.has(parent.name)&&fissionChildren.has(raw?.DAMAGE_EFFECT_NAME)&&raw.APPLY_ROTATE===0&&raw.POSITION_TYPE===3;
}
/** Strictly scoped to target2016 Fission DA DIE fields. The target requests
 * lock inheritance explicitly; the reference copies that same field on
 * CREATE, but lacks a DIE copy branch. This is a declaration-bound Web
 * adapter, separately qualified in mm-fission-drone-v32, not client proof. */
export function inheritAddFissionDroneLock(parent,child){
 if(!parent?.sourceAddMarkedDrone||!parent.sourceAddLockOn||!child?.sourceAddFissionSplit||
   !ADD_FISSION_DRONE_NAMES.has(parent.name)||!ADD_FISSION_DRONE_NAMES.has(child.name))return false;
 const raw=parent.damage?.[child.sourceAddFissionSplit.member];
 if(raw?.INHERITLOCKONDATA!==1||raw.DAMAGE_EFFECT_NAME!==child.name)return false;
 child.sourceAddLockOn={...parent.sourceAddLockOn,manualDirDegree:[...parent.sourceAddLockOn.manualDirDegree]};
 child.sourceAddMarkedDrone={targetEpoch:parent.sourceAddMarkedDrone.targetEpoch,unlockRemaining:0};
 return true;
}
export function validateAddFissionSplit(effect,profile){
 const s=effect.sourceAddFissionSplit;if(s===undefined)return;
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==2||!fissionParents.has(s.parentName)||!/^DIE_DAMAGE_EFFECT[0-7]$/.test(s.member??'')||
   effect.skillId!==29209||!fissionChildren.has(effect.name)||effect.name.endsWith('_DA')!==s.parentName.endsWith('_DA'))throw new TypeError('invalid-owner-add-fission-split');
 if(profile&&(profile.target?.unitClass!==123||profile.damageEffects[s.parentName]?.raw[s.member]?.DAMAGE_EFFECT_NAME!==effect.name))throw new TypeError('invalid-owner-add-fission-source');
}
