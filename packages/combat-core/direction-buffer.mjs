/** Ordered ZZXX cancellation adapter. The .6 cancel point is target2016
 * UPDOWN_CANCEL_AFTER. Retaining taps until that point is a web adapter for
 * the reported 82 preinput; the matching target input callback is unavailable.
 * There is no guessed time window or global command queue: state exit clears
 * it, apart from ZZX -> ZZXX and the immediately following jump/idle state.
 */
const chain=new Set(['RSI_COMBO_ZZX','RSI_COMBO_ZZXX']);
const air=new Set(['RSI_JUMP_UP','RSI_JUMP_DOWN','RSI_JUMP_COMBO_Z','RSI_JUMP_COMBO_X']);
export function cancelInputStateChange(a,next){
  if(!a.cancelInput)return;
  if(chain.has(a.state)&&(chain.has(next)||next==='RSI_WAIT'))return;
  if(next==='RSI_JUMP_UP'&&a.cancelInput.stage==='released-up')return;
  if(air.has(a.state)&&air.has(next))return;
  a.cancelInput=null;
}
export function captureCancelInput(a,keys){
  if(a.hp<=0||a.buffControls?.inputBlock||a.canNotJumpTime>0){a.cancelInput=null;return;}
  if(!chain.has(a.state))return;
  const downEdges=(keys.edges??[]).filter(e=>e.down&&keys.pressed.has(e.key)).map(e=>e.key);
  const ordered=[...downEdges,...[...keys.pressed].filter(k=>!downEdges.includes(k))];
  for(const key of ordered){
    if(key==='UP'&&!a.cancelInput)a.cancelInput={stage:'pending',commands:['UP']};
    else if(key==='DOWN'&&a.cancelInput&&!a.cancelInput.commands.includes('DOWN'))a.cancelInput.commands.push('DOWN');
    else if(['Z','X'].includes(key)&&!(a.canNotAttackTime>0)&&a.cancelInput?.commands.includes('DOWN')&&
      (a.state==='RSI_COMBO_ZZXX'||(a.sourceCommandFlags&1))&&a.cancelInput.commands.length<3){
      a.cancelInput.commands.push(key);keys.pressed.delete(key);
    }
  }
  if(a.cancelInput)for(const key of ['UP','DOWN']){keys.pressed.delete(key);keys.held.delete(key);}
}
export function releaseCancelInput(a,keys,raw,{attackBlocked=false}={}){
  const buffer=a.cancelInput;if(!buffer)return;
  if(buffer.stage==='pending'){
    const ready=a.grounded&&(a.state==='RSI_WAIT'||a.animationTime>=(raw.UPDOWN_CANCEL_AFTER??Infinity));
    if(!ready)return;
    buffer.stage='released-up';
  }else if(!air.has(a.state)){a.cancelInput=null;return;}
  const key=buffer.commands.shift();
  if(key&&!(attackBlocked&&['Z','X'].includes(key))){keys.pressed.add(key);keys.held.add(key);}
  if(!buffer.commands.length)a.cancelInput=null;
}
