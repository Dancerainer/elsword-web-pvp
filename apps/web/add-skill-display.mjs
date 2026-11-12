import {ADD_DP_DISPLAY_SCALE,isAddGeneratorSkill} from '../../packages/combat-core/add-systems.mjs';
import {isAddSkill} from '../../packages/localization/skills.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const text=value=>finite(value)?String(Number(value.toFixed(4))):'—';
/** Source prices only: no actor, equipment, passive, or generator state is
 * inferred from a tooltip. The actual cast query remains addSkillResourceCost. */
export function addSkillResourceDetails(definition){
  if(!isAddSkill(definition))return null;
  const raw=definition.template??definition.raw??{},level=String(definition.maxLevel??1);
  const at=key=>typeof raw[key]==='number'?raw[key]:raw[key]?.[level];
  const passive=definition.passive===true||[1,8].includes(definition.type??raw.m_eType);
  const mp=at('m_MPConsumption'),rawDp=at('m_usFPConsumtion'),dp=finite(rawDp)?rawDp/ADD_DP_DISPLAY_SCALE:null;
  const formationRatio=at('SA_USE_DP_REL_AT_FORMATION_MODE'),mutation=at('m_usCBConsumption');
  const generator=isAddGeneratorSkill({raw}),costLines=[];
  if(!passive){
    if(generator){
      costLines.push(`Install or switch cost: ${dp===null?'See skill description':`Normal mode: DP ${text(dp)}. Awakening uses no DP`}`);
      costLines.push(`Press again to fire: base MP ${text(at('SA_MP_CONSUMPTION'))}`);
    }else if(finite(formationRatio)&&formationRatio>0){
      const normal=finite(mp)?`MP ${text(mp)}${dp>0?` + DP ${text(dp)}`:''}`:'See skill description';
      costLines.push(`Normal mode base cost: ${normal}`);
      costLines.push(`Awakening base cost: DP ${text(finite(mp)?mp*formationRatio:null)} (in place of MP)`);
    }else if(dp>0){
      costLines.push(`Normal mode base cost: ${finite(mp)?`MP ${text(mp)} + `:''}DP ${text(dp)}`);
      costLines.push(`Awakening base cost: ${finite(mp)?`MP ${text(mp)}. `:''}No DP cost`);
    }else if(finite(mp))costLines.push(`Base MP cost ${text(mp)}`);
    // m_usCBConsumption is required upfront. Optional enhancement consumption
    // remains in the original skill prose, not fabricated from its maximum.
    if(finite(mutation)&&mutation>0)costLines.push(`Required mutation points ${text(mutation)}`);
  }
  return {basis:'original-skill-declarations',passive,generator,rawDp,dp,mp,formationRatio,
    costLines,notes:!passive&&costLines.length?['Traits, character stats and passives can modify these base costs.']:[]};
}
