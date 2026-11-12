/** Explicit user-requested Web timing/reaction adapters. Original raw tables
 * remain frozen separately; see contracts/is-feedback-source-v2.json. */
export const IS_FEEDBACK_VERSION='is-feedback-v2';
export const IS_COMMAND_CANCEL=Object.freeze({
  ESSI_COMBO_Z2:{skill:.24,dash:.24,walk:.24},
  ESSI_ETK_COMBO_ZZZZ:{skill:.24,dash:.34,walk:.34},
  ESSI_ETK_COMBO_ZZZZZ:{skill:.44,dash:.54,walk:.54},
  ESSI_ETK_COMBO_XX:{skill:.5},
  ESSI_ETK_COMBO_XXX_LOOP:{dash:.44,walk:.44},
  ESSI_ETK_COMBO_XXX_END:{skill:.3,dash:.44,walk:.44},
  // These are input cancellation windows. An idle XXXZ must finish its
  // authored animation; the previous .4 forced recovery cut it short.
  ESSI_ETK_COMBO_XXXZ:{skill:.37,dash:.37,walk:.37},
});
export function isCommandCancelAfter(name,raw,kind){
  return IS_COMMAND_CANCEL[name]?.[kind]??raw[{skill:'SKILL_CANCEL_AFTER',dash:'DASH_CANCEL_AFTER',walk:'WALK_CANCEL_AFTER'}[kind]];
}
