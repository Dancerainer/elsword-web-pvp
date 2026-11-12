/** Selected target declaration / fixed macro binding. This is a candidate,
 * because matching target2016 ZZX/ZZZ EventProcess has not been obtained.
 * Do not extend this list from the presence of a *_CANCEL_AFTER field alone.
 */
export const RF_BACKWARD_CANCEL_VERSION='raven-zzz-backward-target-v3';
export const targetZzxBackwardCancel=(a,keys,raw)=>a.state==='RSI_COMBO_ZZX'&&backwardCancel(a,keys,raw);
// Explicitly reviewed third Z: target .45 differs from V5's generic .6 skip.
// Identical target ZZZ declarations are shared by RF, VC and BM. Class-specific
// follow-up callbacks keep priority for simultaneous non-direction presses.
export const targetZzzBackwardCancel=(a,keys,raw)=>a.state==='RSI_COMBO_ZZZ'&&backwardCancel(a,keys,raw);
function backwardCancel(a,keys,raw){
  if(!a.grounded||a.cancelInput)return false;
  const at=raw.BWALK_CANCEL_AFTER;
  // Unchanged GUUser.h BWALK_CANCEL_AFTER: negative disables; strict >;
  // reverse pure direction; StateChange(USI_WAIT), retaining current facing.
  if(!(Number.isFinite(at)&&at>=0&&Number.isFinite(a.animationTime)&&Math.fround(a.animationTime)>Math.fround(at)))return false;
  const back=a.facing===1?'LEFT':'RIGHT';
  if(!keys.held.has(back)||keys.pureDoubleLeft||keys.pureDoubleRight||keys.pressed.has('DASH'))return false;
  // The target callback's insertion order is unknown. Keep simultaneous
  // attacks/skills/awakening on the existing consumer instead of guessing.
  if([...keys.pressed].some(k=>!['LEFT','RIGHT','UP','DOWN'].includes(k)))return false;
  return true;
}
