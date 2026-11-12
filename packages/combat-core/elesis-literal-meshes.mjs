/** Audited target2016 detached X_SKIN_MESH declarations. Reuse the same
 * bounded binary32 velocity/fade/land executor as the other professions. */
export const ELESIS_LITERAL_MESH_NAMES=new Set([
 'EXTINCTION_ATTACK_DUMMY','SI_SA_EL_WILD_SHOCK_ATTACK','SI_SA_EL_WILD_SHOCK_ATTACK_Sub',
 'SPK_Fire_Ball_Damage_M01','Mesh_Elesis_SBH_Fire_Ball_Damage_M01',
 'Mesh_Elesis_SBH_Fire_Ball_Damage_M02','Mesh_Elesis_SBH_Fire_Ball_Damage_M03',
 'SA_SPK_SWORDFIRE_PROJECTILE','SPK_SwordFire_Ignitor','SPK_SwordFire_Ignitor_Reverse',
 'Mesh_Elesis_SBH_SCALDIC_SWORD_2nd','SGM_Dash_Combo_XX_LOOP',
 'Mesh_SPK_Dashjump_ZX_Projectile','Mesh_Elesis_SBH_Wall_of_Prominence_Projectile',
 'SDK_Combo_Projectile','SCA_Combo_ZZZ_Projectile_AttackBoX','SCA_Combo_ZZZ_Projectile_Finish_AttackBoX',
]);
export function usesElesisLiteralMesh(profile,effect){
 const d=effect.definition;
 return [120,121,125].includes(profile.target?.unitClass)&&ELESIS_LITERAL_MESH_NAMES.has(effect.mainEffectName)&&
   ![d.TRACE,d.TRACE_MORE,d.TRACE_MATRIX].some(v=>v===1);
}
/** SGM's audited template only adds a roll to cardinal actor yaw. Keep the
 * visual rotation separate, so its own original Rotate is not drawn twice. */
export function elesisLiteralMotionRotation(profile,effect){
 if(effect.mainEffectName!=='SGM_Dash_Combo_XX_LOOP')return undefined;
 const value=profile.effectTemplates[effect.mainEffectName]?.events.find(e=>e.property==='Rotate'&&e.start===0&&!e.fade)?.value;
 if(!Array.isArray(value)||value.length!==3||!value.every(Number.isFinite)||value[0]!==0||value[1]!==0)
  throw new TypeError('Original SGM sword direction requires audited literal roll');
 return [0,effect.birthAnchor.rotation?.[1]??0,value[2]];
}
