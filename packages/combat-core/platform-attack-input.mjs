/** Preserve distinct ordered device taps when one web simulation packet contains
 * Down followed by Z/X. This is a web input adapter, not a recovered 2016 macro.
 * CanDown, the drop displacement, and the next airborne attack remain owned by
 * their existing source consumers. Simultaneous/unordered taps keep priority.
 */
const dropStates=new Set(['RSI_WAIT','RSI_WALK','RSI_DASH','RSI_DASH_END','RSI_JUMP_LANDING','RSI_DASH_JUMP_LANDING']);
const dropSuccessors=new Set(['RSI_JUMP_DOWN','RSI_DASH_JUMP']);

export function orderedPlatformAttack(a,keys){
  if(!a.grounded||!dropStates.has(a.state)||a.hp<=0||a.inputLock>0||a.buffControls?.inputBlock||
    a.canNotAttackTime>0||!keys.pressed.has('DOWN')||keys.pressed.has('UP'))return null;
  const edges=keys.edges??[],down=edges.find(e=>e.key==='DOWN'&&e.down&&Number.isFinite(e.time));
  if(!down)return null;
  const attacks=edges.filter(e=>['Z','X'].includes(e.key)&&e.down&&keys.pressed.has(e.key)&&
    Number.isFinite(e.time)&&e.time>down.time);
  // If an earlier attack exists, the source's ordinary attack priority wins.
  if(edges.some(e=>['Z','X'].includes(e.key)&&e.down&&keys.pressed.has(e.key)&&
    (!Number.isFinite(e.time)||e.time<=down.time)))return null;
  if(!attacks.length)return null;
  return {key:attacks.sort((l,r)=>l.time-r.time)[0].key,downTime:down.time};
}

export function releasePlatformAttack(a,keys){
  const pending=a.platformAttackInput;if(!pending)return;
  delete a.platformAttackInput;
  if(a.hp<=0||a.buffControls?.inputBlock||a.inputLock>0||a.canNotAttackTime>0||
    a.stateSerial!==pending.stateSerial||!dropSuccessors.has(a.state))return;
  keys.pressed.add(pending.key);
}
