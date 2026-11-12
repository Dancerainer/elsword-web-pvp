/** Escape and the close button share the same close transaction. A pending
 * resource preparation keeps the simulation paused until it settles. */
export function createPickerDialogController({keyboardTarget,picker,closeButton,onClose,isPreparing=()=>false,openKey=null,onOpen=()=>{},canOpen=()=>false}) {
  let requested=false,escapeHeld=false,toggleHeld=false;
  const close=()=>{
    if(picker.hidden)return false;
    if(isPreparing()){requested=true;return false;}
    requested=false;onClose();return true;
  };
  const keydown=event=>{
    if(openKey&&event.code===openKey){
      if(event.ctrlKey||event.altKey||event.metaKey||event.isComposing||event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(picker.hidden&&!toggleHeld&&!canOpen())return;
      event.preventDefault();event.stopImmediatePropagation();
      if(!toggleHeld&&!event.repeat){toggleHeld=true;if(picker.hidden)onOpen();else close();}
      return;
    }
    if(event.code!=='Escape'&&event.key!=='Escape')return;
    if(picker.hidden&&!escapeHeld)return;
    event.preventDefault();event.stopImmediatePropagation();
    // Browser key repeat must not close another surface after this dialog.
    if(!escapeHeld){escapeHeld=true;close();}
  };
  const keyup=event=>{
    if(openKey&&event.code===openKey&&toggleHeld){toggleHeld=false;event.preventDefault();event.stopImmediatePropagation();return;}
    if((event.code!=='Escape'&&event.key!=='Escape')||!escapeHeld)return;
    escapeHeld=false;event.preventDefault();event.stopImmediatePropagation();
  };
  const blur=()=>{escapeHeld=false;toggleHeld=false;};
  closeButton.addEventListener('click',close);
  keyboardTarget.addEventListener('keydown',keydown,true);
  keyboardTarget.addEventListener('keyup',keyup,true);
  keyboardTarget.addEventListener('blur',blur);
  return {close,preparationSettled(){if(requested)close();},destroy(){
    closeButton.removeEventListener('click',close);
    keyboardTarget.removeEventListener('keydown',keydown,{capture:true});
    keyboardTarget.removeEventListener('keyup',keyup,{capture:true});
    keyboardTarget.removeEventListener('blur',blur);
  }};
}
