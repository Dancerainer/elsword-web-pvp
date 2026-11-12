/** Original2016 327fb3a0/.15 and327fa520 outer wrapper, with selected GUEL
 * self/type1 arithmetic. Current Web attributes remain instance arguments;
 * no original battle numeric fidelity or full all-type damage claim. */
import {evaluateTargetSelfDamage2016,calculateBrandishSelfCost} from './target-self-damage-v53.mjs';
const f=Math.fround;
export function elesisBrandishTickCost(sim,a,{evaluateDamage}={}){
 // Original Bleeding is attempted before even the HP exemption branch.
 sim.spawnSet?.(a,'EffectSet_B_EL_SDC_Bleeding');
 const data=sim.profileFor(a).damageEffects.DamageEffect_SA_SDK_BRANDISH_BREAKER_LOOP_DUMMY?.raw.DAMAGE_DATA;
 if(!data||!Number.isFinite(data.DAMAGE?.PHYSIC))return {supported:false,reason:'missing-original-brandish-dummy'};
 const assembled={...data,DAMAGE:{...data.DAMAGE,PHYSIC:f(data.DAMAGE.PHYSIC*f(a.skillScale)),MAGIC:f((data.DAMAGE.MAGIC??0)*f(a.skillScale))}};
 const evaluate=evaluateDamage??(dd=>evaluateTargetSelfDamage2016({data:dd,
  physicalAttack:a.stats.physicalAttack,magicAttack:a.stats.magicAttack,physicalDefence:a.stats.physicalDefence,
  magicDefence:a.stats.magicDefence,ownerLevel:a.formulaRules?.combatLevel,mode:1,
  ownerDamageDelta:f((a.awakening.remaining>0?sim.profileFor(a).referenceSemantics.awakening.powerMultiplier:1)*(a.stats.finalDamageMultiplierRange??1))-1,
  receiverDamageDelta:(a.stats.finalDefenceMultiplier??1)-1,swordMultiplier:1,
  attackTypeMultiplier:1+(a.equipmentAttributes?.skillDamageBonus??0),percentReduction:0,receiverMultiplier:1,ownerMultiplier:1}));
 return calculateBrandishSelfCost({hp:a.hp,hpMax:a.hpMax,data:assembled,buff666:a.buffs.some(b=>b.templateId===666),evaluate});
}
