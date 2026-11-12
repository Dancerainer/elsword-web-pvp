import {createKeyboardPreview} from './keyboard-layout.mjs';
import {DEFAULT_KEY_BINDINGS,KEY_BINDING_ACTIONS,KEY_BINDING_LABELS,normalizeKeyBindings,validateKeyBindings,keyCodeLabel} from '../../packages/input/key-bindings.mjs';

/** A small web presentation of the original keyboard action list and keyboard
 * panel, with only the actions supported by this project's combat contract. */
export function createKeyBindingsDialog({host=document.body,value=DEFAULT_KEY_BINDINGS,onSave=async()=>{},onOpen=()=>{},onClose=()=>{},assets=null,assetBase='/assets/online-ui/'}={}){
  const doc=host.ownerDocument??document,dialog=doc.createElement('dialog');dialog.className='rf-key-dialog';dialog.setAttribute('aria-label','Key bindings');
  let committed=normalizeKeyBindings(value),draft=normalizeKeyBindings(value),capture=null,locked=false,saving=false;
  const title=doc.createElement('h2');title.textContent='Key bindings';
  const intro=doc.createElement('p');intro.className='rf-key-intro';intro.textContent='Choose an action, then press a key. Blue keys are assigned. Press Esc to cancel.';
  const body=doc.createElement('div');body.className='rf-key-layout';const list=doc.createElement('div');list.className='rf-key-list';
  const panel=doc.createElement('div');panel.className='rf-key-panel';panel.setAttribute('aria-label','Keyboard layout preview');
  const keyboard=createKeyboardPreview(doc);panel.append(keyboard);
  const buttons=new Map();
  for(const action of KEY_BINDING_ACTIONS){const row=doc.createElement('div');row.className='rf-key-row';row.dataset.action=action;const label=doc.createElement('span');label.textContent=KEY_BINDING_LABELS[action];const button=doc.createElement('button');button.type='button';button.setAttribute('aria-label','Set '+KEY_BINDING_LABELS[action]);button.addEventListener('click',()=>{if(locked||saving)return;capture=action;render();});row.append(label,button);list.append(row);buttons.set(action,button);}
  body.append(list,panel);const status=doc.createElement('p');status.className='rf-key-status';status.setAttribute('role','status');
  const footer=doc.createElement('footer');const defaults=doc.createElement('button');defaults.type='button';defaults.textContent='Restore defaults';const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='Cancel';const save=doc.createElement('button');save.type='button';save.textContent='Save';save.className='rf-key-primary';footer.append(defaults,cancel,save);dialog.append(title,intro,body,status,footer);host.append(dialog);
  const render=()=>{
    for(const [action,button] of buttons){button.textContent=capture===action?'Press a key…':keyCodeLabel(draft.bindings[action]);button.classList.toggle('capturing',capture===action);button.disabled=locked||saving;}
    const assigned=new Set(Object.values(draft.bindings));for(const key of panel.querySelectorAll('[data-code]')){
      key.classList.toggle('assigned',assigned.has(key.dataset.code));
      key.classList.toggle('capturing',capture!==null&&draft.bindings[capture]===key.dataset.code);
      const action=KEY_BINDING_ACTIONS.find(action=>draft.bindings[action]===key.dataset.code);
      key.title=action?KEY_BINDING_LABELS[action]+' · '+keyCodeLabel(key.dataset.code):key.textContent;
    }
    defaults.disabled=locked||saving;save.disabled=locked||saving;cancel.disabled=saving;
  };
  const dismiss=()=>{capture=null;dialog.close();onClose();};
  const onKey=event=>{
    if(!dialog.open||saving)return;
    if(event.code==='Escape'){event.preventDefault();event.stopPropagation();if(capture){capture=null;status.textContent='Key selection canceled';render();}else dismiss();return;}
    if(capture){event.preventDefault();event.stopPropagation();if(event.repeat||event.isComposing)return;
      const next=normalizeKeyBindings(draft);next.bindings[capture]=event.code;const validation=validateKeyBindings(next);
      if(!validation.valid){status.textContent=validation.errors.map(e=>e.message).join('. ');return;}
      draft=next;capture=null;status.textContent='Binding changed. Save to apply it.';render();
    }
  };
  dialog.addEventListener('keydown',onKey,true);dialog.addEventListener('cancel',event=>{event.preventDefault();if(!saving)dismiss();});
  defaults.addEventListener('click',()=>{draft=normalizeKeyBindings();capture=null;status.textContent='Defaults restored. Save to apply them.';render();});cancel.addEventListener('click',dismiss);
  save.addEventListener('click',async()=>{if(locked||saving)return;capture=null;saving=true;status.textContent='Saving…';render();try{const next=normalizeKeyBindings(draft);await onSave(next);committed=next;status.textContent='Saved';saving=false;render();dismiss();}catch(error){saving=false;status.textContent=String(error.message??error);render();}});
  render();
  return {
    open(){if(locked)return false;draft=normalizeKeyBindings(committed);capture=null;status.textContent='';render();onOpen();dialog.showModal();return true;},
    close(){if(dialog.open)dismiss();},
    setValue(next){committed=normalizeKeyBindings(next);if(!dialog.open){draft=normalizeKeyBindings(committed);render();}},
    setLocked(value){locked=!!value;if(locked&&dialog.open&&!saving)dismiss();render();},
    get value(){return normalizeKeyBindings(committed);},get isOpen(){return dialog.open;},element:dialog,
    destroy(){dialog.remove();},
  };
}
