/** Freeze the v9-v19 input attributes used by historical source regressions.
 * These are explicit test inputs, not outputs sampled from today's executor.
 * New user equipment and default guild grants are verified in separate tests.
 */
export function historicalRfPreset(preset){
  return {...preset,formulaVersion:null,guildPassives:[],attributes:{hpMax:800000,mpMax:300,physicalAttack:1000,magicAttack:1000,
    animationSpeedMultiplier:1.3,moveSpeedMultiplier:1.3,jumpSpeedMultiplier:1.21,
    damageReduction:0,awakeningChargeBonus:0},
    fixtureEvidence:'historical RF 30% action/move,21% jump; neutral equipment reduction/charge and no guild grants'};
}
