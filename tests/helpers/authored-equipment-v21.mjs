/** The previous user-authored equipment is an explicit regression input.
 * It is no longer the production preset. Keep arithmetic/Buff regressions
 * independent of the selected source gear and test that gear separately.
 * Preserve historical1x self cost here; production35x and all protections
 * have independent end-to-end coverage in vc-overheat35-v7.test.mjs. */
export function authoredEquipmentPreset(preset){
  return {...preset,initialAwakeningGauge:0,overheatHpCostMultiplier:1,overheatHpCostMultipliers:undefined,
    overheatHardProtection:false,overheatSkillLayerHpCap:undefined,sourceEquipment:undefined,attributeSemantics:'equipment-combat-values-and-final-options',
    attributes:{hpMax:800000,mpMax:300,physicalAttack:1000,magicAttack:1000,
      animationSpeedMultiplier:1.4,moveSpeedMultiplier:1.23,jumpSpeedMultiplier:1.23,
      damageReduction:.3,awakeningChargeBonus:.5}};
}
