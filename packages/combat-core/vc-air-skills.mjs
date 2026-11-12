/** Target air skill declarations + explicitly user-confirmed end-pose cancels.
 * Keep availability and command dispatch on the same, allocation-free query.
 */
const haze='RSI_A_RWT_BARRAGE_ATTACK_AIR',flame='RSI_A_RWT_FLAME_SWORD_FLY';
export function vcHeldAirSkill(def){const n=def?.sourceState;return n===haze||n===flame;}
export function vcAirSkillEnded(a,def){
  const d=def.clip.durationSeconds;
  return a.animationStopped||Math.fround(a.animationTime)>Math.fround(d-Math.max(d/10,.03));
}
export function vcAirSkillCancelAllowed(a,def){
  if(def?.sourceState!==haze)return null;
  // Target Lua omits SKILL_CANCEL_AFTER_FLY. The older callback cannot prove
  // an earlier window. User-confirmed air follow-ups open at animation end.
  return !a.grounded&&vcAirSkillEnded(a,def);
}

/** Original2016 stand196 uses .93 only for its direction branch. Ordinary
 * S still reads the enter field, whose missing value is9999. */
export function vcSkillSourceCancelAllowed(a,def){
  if(def?.sourceState!=='RSI_A_RWT_BARRAGE_ATTACK_STAND')return null;
  return a.grounded&&Math.fround(a.animationTime)>Math.fround(Math.max(Math.fround(def.raw.SKILL_CANCEL_AFTER??9999),.10000000149011612));
}

/** Named target2016 skill recovery fields, with the browser's physical66
 * packet accepted alongside its dedicated DASH key. Run this before the
 * shared dispatcher so Z/X can reuse the existing free-state command path.
 */
export function vcSkillCommandCancel(a,def,input){
  if(!a.skillId)return null;
  const n=def?.sourceState??a.state,raw=def?.raw??{},t=Math.fround(a.animationTime);
  const after=value=>Number.isFinite(value)&&value>=0&&t>Math.fround(value);
  const direction=input.pureDoubleRight?1:input.pureDoubleLeft?-1:
    input.pressed.has('DASH')?(input.held.has('RIGHT')?1:input.held.has('LEFT')?-1:0):0;
  if(direction&&!a.buffControls?.dashBlock&&after(raw.DASH_CANCEL_AFTER))
    return {state:a.grounded?'RSI_DASH':'RSI_DASH_JUMP',facing:direction,reason:'target-vc-skill-dash-cancel'};
  if(!(a.canNotAttackTime>0)&&after(raw.ATTACK_CANCEL_AFTER)&&(input.pressed.has('Z')||input.pressed.has('X')))
    return {state:a.grounded?'RSI_WAIT':'RSI_JUMP_DOWN',reason:'target-vc-skill-attack-cancel'};
  if(n==='RSI_A_RWT_BARRAGE_ATTACK_STAND'&&a.grounded&&after(.93)){
    const walk=input.held.has('RIGHT')?1:input.held.has('LEFT')?-1:0;
    if(walk)return {state:'RSI_WALK',facing:walk,reason:'fixedV5-vc-haze-walk-cancel'};
  }
  return null;
}
