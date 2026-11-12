/** Literal Rune Slayer callback resource roots. The source2016 declarations
 * and qualified SwordMan callbacks are frozen in rs-feedback-review-source.
 * A callback resource is a command cue even when it is absent from state.raw. */
export const RS_COMMAND_EFFECT_SETS=Object.freeze([
  'EffectSet_ERS_COMBO_XZ','EffectSet_ERS_COMBO_XZZ','EffectSet_ERS_COMBO_FULL_CHARGE_XZZ',
  'EffectSet_ELSWORD_DASH_JUMP_XZ','EffectSet_ELSWORD_DASH_JUMP_XZZ',
]);
export const RS_COMMAND_DAMAGE_EFFECTS=Object.freeze([
  'ELSWORD_RUNE_SLAYER_DASH_JUMP_XZ','ELSWORD_RUNE_SLAYER_DASH_JUMP_XZZ',
  'ELSWORD_RUNE_SLAYER_DASH_ZZX','FIREBALL_SMALL_DOWN_ELSWORD',
]);
export function rsCommandEffectRoots(profile){
  return profile.target?.unitClass===101?[...RS_COMMAND_EFFECT_SETS,...RS_COMMAND_DAMAGE_EFFECTS]:[];
}
