/** Project rule: Prism's declared1.5 sustained
 * layers/helpers use instance scale1. Original2016 profile/raw remains1.5.
 * Derive locally and on owner reconstruction; never accept a peer scale. */
import {ADD_PRISM_SET,ADD_PRISM_DAMAGE_SET} from './add-prism-v45.mjs';
const members=new Map([
 [ADD_PRISM_SET,new Set(['AN_PARTICLE_PRISM_04','AN_PARTICLE_PRISM_02','AN_PARTICLE_PRISM_01','DamageEffect_Particle_Prism_Debuff'])],
 [ADD_PRISM_DAMAGE_SET,new Set(['DamageEffect_Particle_Prism'])],
]);
export function addPrismProjectDefinition(profile,effect,definition){
 if(![122,123,126].includes(profile?.target?.unitClass)||![29003,29029].includes(effect?.skillId)||
  !members.get(effect.setName)?.has(definition?.NAME))return definition;
 return {...definition,SCALE_X:1,SCALE_Y:1,SCALE_Z:1};
}
