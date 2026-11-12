/** Qualified fixed-V5 EL callbacks; named clocks remain original2016 raw.
 * These are callback branch identities, not invented cancel times. */
export const GM_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY=Object.freeze([
 'ESI_DASH_COMBO_Z','ESI_DASH_COMBO_X','ESI_DASH_COMBO_ZZ',
 'ESI_DASH_COMBO_SSK_ZZ','ESI_DASH_COMBO_SSK_ZZZ','ESI_DASH_COMBO_SSK_ZZX',
 'ESI_COMBO_SGM_XX_DOWN_X_END','ESI_DASH_JUMP_COMBO_SGM_XZ_DOWN',
 'ESI_QUICK_STANDUP_ATTACK_FRONT_ADVANCED','ESI_QUICK_STANDUP_ATTACK_BACK_ADVANCED',
]);
export const GM_SOURCE_END_RESOLVES_FOOT_QUERY=Object.freeze(['ESI_DASH_JUMP_COMBO_SSK_XXX']);
const ownsFoot=new Set([...GM_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY,...GM_SOURCE_END_RESOLVES_FOOT_QUERY]);
export const gmSourceOwnsFootSupport=(actor,sourceState)=>actor.professionId==='GM'&&ownsFoot.has(sourceState);
/** EL common Z/ZZ/ZZZ callbacks share this condition in all three jobs. */
export const ELESIS_SOURCE_AIR_COMMAND_END_LANDING=Object.freeze([
 'ESI_DASH_JUMP_COMBO_Z','ESI_DASH_JUMP_COMBO_ZZ','ESI_DASH_JUMP_COMBO_ZZZ',
]);
export const GM_CANCEL_CALLBACK_SOURCE=Object.freeze({
 commit:'a8438f3ed18dd6f0944793de6c0d8bb9334e9633',
 sha256:'f4f5a74f45688259f052c5b26fa667d9f781a59b3c771fc2f7ec7f24575714dc',
 evidenceClass:'qualified-fixedV5-including-2026-reconstruction; target2016-client-unmeasured',
 endWaitMethods:Object.freeze({DashComboZEventProcess:6607,DashComboXEventProcess:6658,DashComboZZEventProcess:6645,
  ESI_DASH_COMBO_SSK_ZZ_EventProcess:8692,ESI_DASH_COMBO_SSK_ZZZ_EventProcess:8708,ESI_DASH_COMBO_SSK_ZZX_EventProcess:8722,
  ESI_COMBO_SGM_XX_DOWN_X_END_EventProcess:9847,ESI_DASH_JUMP_COMBO_SGM_XZ_DOWN_EventProcess:9751,
  ESI_QUICK_STANDUP_ATTACK_FRONT_ADVANCED_EventProcess:9863,ESI_QUICK_STANDUP_ATTACK_BACK_ADVANCED_EventProcess:9879}),
 endResolvesFootMethod:Object.freeze({ESI_DASH_JUMP_COMBO_SSK_XXX_EventProcess:8766}),
 endLandingMethods:Object.freeze({DashJumpComboZEventProcess:6671,DashJumpComboZZEventProcess:6682,DashJumpComboZZZEventProcess:6693}),
});
