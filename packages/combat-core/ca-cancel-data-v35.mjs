/** Original2016 CA windows stay in its profile. These reviewed fixed EL
 * callbacks are version references, including2026 reconstruction, not a
 * client trace. v37's two ZZZX/ZZZXX exceptions use original executable
 * predicates instead; see contracts/elesis-native-consumers-v37.json.
 * No missing timer is supplied by this table. */
export const CA_CANCEL_REFERENCE_VERSION='ca-target-declarations-native-final-command-v37';
export const CA_SOURCE_FOOT_SUPPORT_STATES=Object.freeze([
 'ESI_COMBO_SDK_XX','ESI_COMBO_SDK_XXX','ESI_COMBO_SDK_XXXX',
 'ESI_COMBO_SDK_XXXXX','ESI_COMBO_SDK_XXXXXX','ESI_COMBO_SDK_XXXXXXX',
 'ESI_DASH_JUMP_COMBO_SDK_XXX',
 'ESI_DASH_COMBO_SCA_ZZ','ESI_DASH_COMBO_SCA_ZZZ_START',
 'ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2',
 'ESI_DASH_COMBO_SCA_ZZZ_END','ESI_DASH_COMBO_SCA_ZX_START',
 'ESI_DASH_COMBO_SCA_ZX_ATTACK','ESI_DASH_COMBO_SCA_ZX_END',
]);
const sourceFooting=new Set(CA_SOURCE_FOOT_SUPPORT_STATES);
export function caSourceOwnsFootSupport(actor,sourceState=actor.state){return actor.professionId==='CA'&&sourceFooting.has(sourceState);}
export const CA_BUFFERED_COMMAND_OVERRIDES=Object.freeze({
 // Original2016 callback327dfc60 checks fresh6457=X, not the guide's
 // category Z. Its early unsupported-foot branch subtracts30 before any
 // animation-end or input processing; these two states use the ground path.
 // See contracts/elesis-native-consumers-v37.json; supersedes2026 helper.
 ESI_COMBO_SDK_ZZZX:Object.freeze([{key:'X',window:0,flag:0,next:'ESI_COMBO_SDK_ZZZXX'}]),
 // Same authored window, separate flags and source X-before-Z priority.
 ESI_DASH_COMBO_SCA_ZZ:Object.freeze([
  {key:'X',window:0,flag:0,next:'ESI_DASH_COMBO_SCA_ZX_START'},
  {key:'Z',window:0,flag:1,next:'ESI_DASH_COMBO_SCA_ZZZ_START'},
 ]),
 // CA uses SDKComboChain8243, not GM's landing-latched SSK_XX callback.
 ESI_DASH_JUMP_COMBO_SDK_XX:Object.freeze([{key:'X',window:0,flag:0,next:'ESI_DASH_JUMP_COMBO_SDK_XXX'}]),
});
export const CA_BUFFERED_AIR_X_CHAIN='ESI_DASH_JUMP_COMBO_SDK_XX';
export const CA_SOURCE_END_FALL_SCALE=1.5;
export const CA_SOURCE_END_WAIT_WITHOUT_FOOT_QUERY=Object.freeze([
 'ESI_DASH_COMBO_SCA_ZZ','ESI_DASH_COMBO_SCA_ZX_START',
 'ESI_DASH_COMBO_SCA_ZZZ_START','ESI_DASH_COMBO_SCA_ZZZ_LOOP_1','ESI_DASH_COMBO_SCA_ZZZ_LOOP_2',
]);
export const CA_SKILL_MACRO_ORDER=Object.freeze([
 'SKILL_CANCEL_AFTER','WALK_CANCEL_AFTER','BWALK_CANCEL_AFTER','DASH_CANCEL_AFTER','ATTACK_CANCEL_AFTER_EX',
]);
export const CA_SHADE_SCRATCH_FOLLOWUP=Object.freeze({
 state:'SI_A_SCA_SHADE_SCRATCH',next:'SI_A_SCA_SHADE_SCRATCH_ATTACK',
 windowField:'EVENT_PROCESS_TIME0',key:'X',acceptHeld:true,startInclusive:true,endExclusive:true,
 evidence:'original2016 EVENT_PROCESS_TIME0 + fixed EL8040..8064',
});
export const CA_EJECTION_ATTACK_END=Object.freeze({
 state:'SI_SA_SDK_EJECTION_BUSTER_ATTACK',ground:'RSI_JUMP_LANDING',air:'RSI_JUMP_DOWN',fallScale:1.5,
 evidence:'fixed EL8068..8091; target numeric fields remain unchanged',
});
