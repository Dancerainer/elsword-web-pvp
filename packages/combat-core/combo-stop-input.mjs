/** User-feedback web adaptation. Fixed V5 skips EventProcess during stops;
 * this bounded latch is deliberately not presented as original input buffering.
 * Acceptance still comes from the unchanged native callback at the frozen
 * animation time. Only its command flags are retained, never a state request,
 * timer, movement result, direction gesture, skill or global pending edge.
 */
export const COMBO_STOP_INPUT_VERSION='sampled-native-combo-hitstop-latch-v7';
const attackKeys=['Z','X'];
const isCombo=state=>typeof state==='string'&&/^(?:RSI|RRF)_.*COMBO_/.test(state);
const permitted=(actor,native)=>actor.hp>0&&!actor.inputLock&&!actor.buffControls?.inputBlock&&
  !(actor.canNotAttackTime>0)&&isCombo(actor.state)&&native?.handlesEvent(actor);

function probe(actor,keys,native,profile,flags){
  const pressed=new Set(attackKeys.filter(key=>keys.pressed.has(key)));
  if(!pressed.size)return null;
  // Validation sees the actual native priority, including pureDouble and
  // awakening. Those keys can reject an attack; none are retained in a latch.
  const input={...keys,pressed:new Set(keys.pressed),held:new Set(keys.held)};
  // Starting at zero distinguishes a newly accepted attack from an old latch
  // surviving an otherwise too-late input. The composed probe below preserves
  // the native last-selection / independent-bit rules for accepted packets.
  const result=native.runEvent({...actor,sourceCommandFlags:flags},input,profile);
  return result.handled&&result.flags>0&&(!result.state||isCombo(result.state))?result:null;
}

export function captureComboStopInput(actor,keys,native,profile){
  if(!keys.sampledDevice||actor.worldStop>0||!permitted(actor,native)){
    actor.comboStopInput=null;
    return null;
  }
  if(!(actor.hitStop>0))return null;
  const accepted=probe(actor,keys,native,profile,0);
  if(!accepted)return null;
  const prior=actor.comboStopInput;
  const previousFlags=prior?.stateSerial===actor.stateSerial&&prior.state===actor.state?prior.flags:actor.sourceCommandFlags;
  const composed=probe(actor,keys,native,profile,previousFlags??0);
  const latch={state:actor.state,stateSerial:actor.stateSerial,flags:composed?.flags??accepted.flags,
    animationTime:actor.animationTime,pressed:attackKeys.filter(key=>keys.pressed.has(key))};
  actor.comboStopInput=latch;
  return latch;
}

export function replayComboStopInput(actor,keys,native,profile){
  const latch=actor.comboStopInput;
  actor.comboStopInput=null;
  if(!latch||!keys.sampledDevice||actor.worldStop>0||latch.stateSerial!==actor.stateSerial||
    latch.state!==actor.state||!permitted(actor,native))return null;
  // A fresh accepted attack uses the actual callback's selection and composes
  // against the stopped flags: ZZ replaces them, while 668Z keeps independent
  // bits. An invalid late/different key does not
  // destroy an already accepted latch. Normal EventProcess still runs after
  // physics and can clear it on reverse direction or choose landing first.
  const fresh=probe(actor,keys,native,profile,0);
  if(fresh){
    const composed=probe(actor,keys,native,profile,latch.flags);
    actor.sourceCommandFlags=composed?.flags??fresh.flags;
    return {...latch,flags:actor.sourceCommandFlags,fresh:true};
  }
  actor.sourceCommandFlags=latch.flags;
  return {...latch,fresh:false};
}
