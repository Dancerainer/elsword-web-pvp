/** Reviewed fixed V5 EL callbacks. These are control-flow references, not
 * measured target2016 behavior; the target profile owns the numeric windows.
 * No absent target timer is supplied by this table. */
export const BH_CANCEL_REFERENCE_VERSION='bh-fixed-el-callback-cancels-v35';

// These callbacks do not have the common early !IsOnSomethingFuture arm.
// A web-wide ground-command guard used to erase their buffered follow-ups.
const sourceOwnsFootSupport=new Set([
  'ESI_COMBO_SBH_XZ','ESI_COMBO_SBH_XZZ','ESI_COMBO_SBH_XZZZ',
  'ESI_DASH_COMBO_SBH_X','ESI_DASH_COMBO_SBH_XX',
  'ESI_DASH_COMBO_SBH_XXX','ESI_DASH_COMBO_SBH_XXXZ',
  'ESI_DASH_COMBO_SPK_ZX','ESI_DASH_COMBO_SPK_ZZ','ESI_DASH_COMBO_SPK_ZZZ',
]);
export const BH_SOURCE_FOOT_SUPPORT_STATES=Object.freeze([...sourceOwnsFootSupport]);
export function bhSourceOwnsFootSupport(actor,sourceState=actor.state){
  return actor.professionId==='BH'&&sourceOwnsFootSupport.has(sourceState);
}

/** EL35,3646-3652,9445-9462,9495-9506: two additional Z requests reuse the
 * original XZ declaration, effect callback and EVENT_PROCESS_TIME0. */
export const BH_DASH_JUMP_XZ_REATTACK=Object.freeze({
  sourceState:'ESI_DASH_JUMP_COMBO_SPK_XZ',
  sourceRuntimeState:'ESI_DASH_JUMP_COMBO_SPK_XZ_REATTACK',
  additionalAttacks:2,
  input:'Z',
  windowField:'EVENT_PROCESS_TIME0',
});

// Explicit macros in the reviewed skill callbacks run in this order.
// Skill-slot/awakening processing happens at the common input boundary.
export const BH_SKILL_MACRO_ORDER=Object.freeze([
  'SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER',
  'DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX',
]);
