/** Legacy skill input consumers. Closed target2016 posts execute through the
 * explicit historical/common adapters first. Other literal skips below retain
 * their qualified fixed-V5 reference status; no original match trace is claimed.
 */
export const SKILL_COMMAND_CANCEL_VERSION='six-profession-skill-command-cancels-v1';
export const afterCancel=(time,limit)=>Number.isFinite(limit)&&limit>=0&&Math.fround(time)>Math.fround(limit);
const directions=['UP','DOWN','LEFT','RIGHT'],slots=['A','S','D','C','Q','W','E','R'];
// Explicit source call sites; no field-presence scan creates a held-key skip.
export const SKILL_HELD_SKIP_RULES=Object.freeze({
  ESSI_SI1_ES_ASSAULT_SLASH:{at:1.1,keys:'ZXC'},
  ESSI_SI_A_ES_KICK:{at:.5,keys:'C'},
  ESSI_SA_ESK_DOUBLE_SLASH:{at:3.667,inclusive:true,keys:'ZXC'},
  ESSI_SA_ESK_DOUBLE_SLASH_HYPER:{at:3.667,inclusive:true,keys:'ZXC'},
  ESSI_SA_ELK_SAND_STORM:{field:'ATTACK_CANCEL_AFTER',keys:'ZXC'},
  ESSI_SA_ESK_WINDMILL_END:{field:'ATTACK_CANCEL_AFTER',keys:'ZXC'},
  ESSI_SA_ESK_WINDMILL_END_HYPER:{field:'ATTACK_CANCEL_AFTER',keys:'ZXC'},
  ESSI_SA_EMK_BIG_BURST:{at:1.06,inclusive:true,keys:'ZXC'},
  RSI_A_ROT_ARMOR_BREAK:{at:.66,keys:'ZXC'},
  RSI_A_ROT_WEAPON_BREAK:{at:.66,keys:'ZXC'},
  RSI_A_RST_CUT_TENDON:{at:.66,keys:'ZXC'},
  RSI_A_RF_BREAKING_FIST:{field:'ATTACK_CANCEL_AFTER',keys:'ZX'},
});
// SKILL_CANCEL_BY_HYPER_MODE is enabled in the pinned Always.h. These are
// reviewed SKILL_CANCEL_AFTER call sites, including the passive guard's end.
// SKILL_CANCEL_AFTER_FLY has no awakening arm and is deliberately separate.
const awakenStates=new Set(['RSI_A_RF_MEGADRILL_BREAK','RSI_A_RRF_HELL_DIVE','RSI_A_RRF_HELL_DIVE_UPGRADE',
  'RSI_A_RRF_LIMIT_CRUSHER_AVOID_ATTACK','RSI_A_RRF_LIMIT_CRUSHER_REVENGE_ATTACK','RSI_A_RWT_FLAME_SWORD_GROUND',
  'ESSI_A_ELK_IMPACT_SMASH','ESSI_SI_P_ESK_AUTO_GUARD_END','ESSI_SI_P_ESK_AUTO_GUARD_END_SMALL',
  'RSI_A_RVC_NAPALM_GRENADE','RVC_SI_SA_DEADLY_RAID_END','RVC_SI_SA_DEADLY_RAID_FINISH','RVC_SI_SA_DEADLY_RAID_FINISH_OVERHEAT',
  'RVC_SI_SA_IGNITION_CROW_FIRE','RVC_SI_SA_IGNITION_CROW_INCINERATION_FIRE','RVC_SI_SA_IGNITION_CROW_OVERHEAT_END',
  'RVC_SI_SA_IGNITION_CROW_INCINERATION_OVERHEAT_END','ESSI_A_ES_SWORD_WAVE','RSI_A_RBM_SONIC_SLASH_FINISH',
  'RSI_SA_RBM_GIGA_DRIVE_BURST','RVC_SI_A_BLEEDING_SLICER_GROUND','ESSI_A_ETK_SWORD_SHIELD',
  'ESSI_SI_A_EIS_FATAL_SLAP','ESSI_SI_A_EIS_SPIRAL_STING','ESSI_SI_SA_EIS_RAGE_CUTTER','ESSI_SI_SA_ETK_HARSH_CHASER_PULL']);
// These callbacks supply explicit literals, not missing Lua defaults. The
// VC XX ASDC branch accepts skills only; the other three use the enabled
// SKILL_CANCEL_AFTER macro and therefore also accept fresh awakening.
const literalSkillGates=Object.freeze({RSI_PARRYING:.3,RSI_PARRYING_SMALL:.3,
  RRF_DASH_JUMP_COMBO_XX_LANDING:.4,
  RSI_WEAPON_TAKER_COMBO_XX:.466});
export function referenceSkillCancelAfter(a,def){
  return literalSkillGates[def?.sourceState??a.state]??literalSkillGates[a.state]??null;
}
export function skillMacroAwakeningAllowed(a,def){
  const literal=referenceSkillCancelAfter(a,def);
  if(literal!==null&&(def?.sourceState??a.state)!=='RSI_WEAPON_TAKER_COMBO_XX')return afterCancel(a.animationTime,literal);
  return awakenStates.has(def?.sourceState??a.state)&&afterCancel(a.animationTime,def?.raw?.SKILL_CANCEL_AFTER);
}
function skillState(a,def){
  const n=def?.sourceState??a.state;
  return !!a.skillId&&!/COMBO|JUMP_ATTACK|DASH_ATTACK/.test(n)&&
    /^(?:ESSI|RSI|RVC|SI)_(?:SI[123]?_|SA_|A_|HA_)/.test(n);
}
/** Pure query shared by the source host. A double direction is already a
 * device gesture; keeping it alongside DASH fixes the actual keyboard path.
 */
export function skillCommandCancel(a,def,input){
  if(!skillState(a,def))return null;
  const raw=def.raw,n=def.sourceState??a.state,d=def.clip?.durationSeconds;
  if(a.animationStopped||Number.isFinite(d)&&Math.fround(a.animationTime)>Math.fround(d-Math.max(d/10,.03)))return null;
  const direction=input.pureDoubleRight?1:input.pureDoubleLeft?-1:
    input.pressed.has('DASH')?(input.held.has('RIGHT')?1:input.held.has('LEFT')?-1:0):0;
  if(direction&&!a.buffControls?.dashBlock&&afterCancel(a.animationTime,raw.DASH_CANCEL_AFTER))
    return {state:a.grounded?'RSI_DASH':'RSI_DASH_JUMP',facing:direction,reason:'target-skill-direction-double-cancel'};
  // These identical common skill declarations already have a reviewed VC
  // fresh-Z/X adapter. RF and BM share the same target action and input gate.
  if(['RSI_SI1_MAXIMUM_CANNON','RSI_A_RWT_MENTAL_BREAK'].includes(n)&&!(a.canNotAttackTime>0)&&
    afterCancel(a.animationTime,raw.ATTACK_CANCEL_AFTER)&&(input.pressed.has('Z')||input.pressed.has('X')))
    return {state:a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN',reason:'target-skill-fresh-attack-cancel',continueInput:true};
  const rule=SKILL_HELD_SKIP_RULES[n];if(!rule)return null;
  const at=rule.field?raw[rule.field]:rule.at;
  const ready=rule.inclusive?Number.isFinite(at)&&at>=0&&Math.fround(a.animationTime)>=Math.fround(at):afterCancel(a.animationTime,at);
  const keys=rule.keys==='ZX'?['Z','X']:[...directions,...slots,...(rule.keys==='ZXC'?['Z','X']:[])];
  if(ready&&!(a.canNotAttackTime>0&&rule.keys==='ZX')&&keys.some(k=>input.held.has(k)))
    return {state:a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN',reason:rule.field?'target-skill-held-skip':'reference-skill-held-skip',
      continueInput:rule.keys==='ZX'&&(input.pressed.has('Z')||input.pressed.has('X'))};
  return null;
}
