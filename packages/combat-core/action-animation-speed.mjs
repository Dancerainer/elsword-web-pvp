/** State animation speed, shared by event clocks and the renderer's view.
 * Fixed V5 CommonStateStart Now/Future defaults the item-ability gate to true.
 * Its ResetAnimSpeed multiplies GetAnimSpeedValue only inside that gate.
 * The target declarations remain untouched. Mega Drill's fixed item-speed
 * gate and Spiral Blast/Rolling Smash gates are user-confirmed corrections, not
 * acquired 2016 consumer results. Raw target declarations stay untouched.
 * See contracts/rf-skill-animation-speed-source-v6.json and
 * contracts/lk-skill-animation-speed-source-v3.json.
 */
export const ACTION_ANIMATION_SPEED_VERSION='profession-action-speed-user-net-hurt-cap-v24.1';
export const MEGA_DRILL_FIXED_ANIMATION='SI_A_RF_MEGADRILL_BREAK';
export const SPIRAL_BLAST_FIXED_ANIMATION='SP2a_SpiralBlast';
const ROLLING_SMASH_FIXED_ANIMATIONS=new Set(['SI_A_ELK_ROLLING_SMASH_Ready','SI_A_ELK_ROLLING_SMASH','SI_A_ELK_ROLLING_SMASH_Landing']);
// User rule, not an assertion about the original2016 consumer. Stand-up and
// counterattack attacks retain ordinary speed. DAMAGE_REVENGE is the melee
// attacker being surprised by a counter and therefore is a hurt reaction.
const HURT_STATES=new Set(['RSI_DAMAGE_SMALL_FRONT','RSI_DAMAGE_SMALL_BACK',
  'RSI_DAMAGE_BIG_FRONT','RSI_DAMAGE_BIG_BACK','RSI_DAMAGE_GROGGY',
  'RSI_DAMAGE_DOWN_FRONT','RSI_DAMAGE_DOWN_BACK','RSI_DAMAGE_AIR_SMALL',
  'RSI_DAMAGE_AIR_UP','RSI_DAMAGE_AIR_FALL','RSI_DAMAGE_AIR_DOWN',
  'RSI_DAMAGE_AIR_DOWN_INVINCIBLE','RSI_DAMAGE_AIR_DOWN_LANDING',
  'RSI_DAMAGE_AIR_FLY_FRONT','RSI_DAMAGE_AIR_FLY_BACK','RSI_DAMAGE_REVENGE']);
export function isHurtAnimation(definition,state){
  return HURT_STATES.has(state??definition.state??definition.stateRole??definition.sourceState);
}
export function hurtAnimationMultiplier(actor){
  // Latest user instruction preserves the existing equipment/passive/Buff
  // formula. Only cap its final positive bonus; do not change composition.
  return Math.min(1,actor.stats.animationSpeedMultiplier);
}

export function actionUsesItemAnimationSpeed(definition){
  const raw=definition.raw;
  if(raw.ANIM_NAME===MEGA_DRILL_FIXED_ANIMATION||raw.ANIM_NAME===SPIRAL_BLAST_FIXED_ANIMATION||ROLLING_SMASH_FIXED_ANIMATIONS.has(raw.ANIM_NAME))return false;
  return raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY!==0&&raw.APPLY_ANIM_SPEED_BY_ITEM_ABILITY!==false;
}

export function actionAnimationSpeed(actor,definition,state=actor.state){
  if(actor.animationSpeedOverride!==undefined&&actor.animationSpeedOverride!==null)
    return actor.animationSpeedOverride;
  const authoredSpeed=definition.raw.ANIM_SPEED??1;
  const multiplier=isHurtAnimation(definition,state)?hurtAnimationMultiplier(actor):actor.stats.animationSpeedMultiplier;
  return authoredSpeed*(actionUsesItemAnimationSpeed(definition)?multiplier:1);
}
