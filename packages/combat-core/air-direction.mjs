/** Fixed V5 free-air callback priority, not a global opposite-key policy.
 * JumpFrameMoveFuture25726 and Raven DashJump Event6628 use pureRight
 * first, then pureLeft. DashJump Future6577 also tests Now facing and
 * is handled separately by integrate. Target2016 callback not acquired.
 */
const freeAir=new Set(['RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_DASH_JUMP']);
/** User policy: held device levels retain down-event insertion order. Resolve
 * simultaneous 4/6 before any native callback, including double-key macros.
 * Release events stay physical so the remaining key becomes active normally. */
export function prioritizeHorizontalInput(keys){
  if(!keys.held.has('LEFT')||!keys.held.has('RIGHT'))return keys;
  const first=[...keys.held].find(k=>['LEFT','RIGHT','ARROWLEFT','ARROWRIGHT'].includes(k));
  const loser=first==='LEFT'||first==='ARROWLEFT'?'RIGHT':'LEFT';
  keys.held.delete(loser);keys.held.delete('ARROW'+loser);keys.pressed.delete(loser);keys.pressed.delete('ARROW'+loser);
  keys[loser==='RIGHT'?'pureDoubleRight':'pureDoubleLeft']=false;
  return keys;
}
export function freeAirInputDirection(state,held){
  if(freeAir.has(state))return held.has('RIGHT')?1:held.has('LEFT')?-1:0;
  return (held.has('RIGHT')?1:0)-(held.has('LEFT')?1:0);
}
