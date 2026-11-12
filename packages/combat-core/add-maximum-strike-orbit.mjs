/** Retired v32 circle adapter. Kept only to validate/retire historical wire
 * markers; active Maximum Strike steering uses the recovered v53 LOT8 path. */
const SHOT='DamageEffect_ATT_Maximum_Strike_Bullet_Attack';
export function validateMaximumStrikeOrbit(e,owner,profile){
 const s=e.sourceAddMaximumStrikeOrbit;if(s===undefined)return;
 if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==3||
  !Number.isInteger(s.sphereIndex)||s.sphereIndex<0||s.sphereIndex>255||
  !Number.isSafeInteger(s.targetEpoch)||s.targetEpoch<0||!Number.isFinite(s.angle)||Math.abs(s.angle)>Math.fround(Math.PI)||
  e.name!==SHOT||e.skillId!==29022||!e.sourceAddLockOn||owner&&owner.professionId!=='DE')
  throw new TypeError('invalid-owner-maximum-strike-orbit');
 if(profile&&(profile.target?.unitClass!==126||profile.damageEffects[SHOT]?.raw.LOCK_ON_DATA?.LOCK_ON_TYPE!==8))
  throw new TypeError('invalid-owner-maximum-strike-orbit-source');
}
