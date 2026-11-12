import {PROFESSIONS} from '../../packages/professions/catalog.mjs';
import {isElswordProfession} from '../../packages/professions/identity.mjs';
import {createSkillSlot} from './skill-slot.mjs';
import {createSkillTree,createPickerTooltip,bindBattleSkillSlots,editPickerLoadout,cancelPickerDrag} from './skill-picker.mjs';
import {placeSkillSlot,quickEquipTarget,choosePickerBranch,applyPickerBranches} from './skill-picker-state.mjs';
import {coreKeyLabel} from '../../packages/input/key-bindings.mjs';

/** Reuses the battle picker and exact saved eight-slot representation while
 * keeping configuration independent of a running scene. */
export function createLobbyConfigurationPanel({document,host,configuration,getProfessionId,canEdit=()=>true,getKeyBindings=()=>undefined,
 onSound=()=>{},onOpen=()=>{},onClose=()=>{},onError=()=>{}}){
 const root=document.createElement('section');root.className='skill-picker lobby-config-panel';root.hidden=true;
 root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','Skill setup');
 root.innerHTML='<header><strong></strong><span>Enhanced · Max level</span><button type="button" aria-label="Close skill setup">×</button></header><div class="picker-body"><section class="picker-tree-panel"><div class="picker-tree-heading"><span>Active</span><span>Passive</span></div><div class="picker-tree-scroll"><div class="skill-catalog"></div></div></section></div><p class="picker-instructions">Right-click a skill to equip it, drag it to a specific slot, or right-click an equipped slot to clear it.</p><div class="skill-bar"></div><p class="picker-message" role="status"></p>';
 host.append(root);const query=selector=>root.querySelector(selector),tooltip=createPickerTooltip(document,host,{id:'lobby-picker-hover-detail'});
 let current=null,busy=false,disposed=false,selectedSlot=0,selectedSkillId=null,generation=0;
 const editable=()=>!disposed&&!root.hidden&&!busy&&canEdit()&&current?.id===getProfessionId();
 const message=value=>{query('.picker-message').textContent=value;};
 function render(){
  if(!current||disposed)return;
  const row=current;query('header strong').textContent='Skills · '+PROFESSIONS[row.id].label;
  query('.skill-catalog').replaceChildren(...createSkillTree(document,{definitions:row.definitions,supportFor:row.supportFor,
   grantedLabel:isElswordProfession(row.id)?'Granted by default':'Active by default',loadout:row.loadout,applied:row.passives,selectedSkillId,
   branchChoices:row.branchChoices,onChooseBranch:branch,onEquip:equip,onHideDetails:tooltip.hide,onInspectBranch:tooltip.trait,
   onInspect:(id,anchor)=>{const definition=row.definitions.find(skill=>skill.id===id);if(definition)tooltip.skill({...definition,disabledReason:row.supportFor(id)?.disabledReason},anchor,row.branchChoices[id]??'none');}}));
  const slots=row.skillKeys.map((key,index)=>{
   const slot=row.loadout[index],definition=row.definitions.find(skill=>skill.id===Number(slot?.skillId));
   const button=placeSkillSlot(createSkillSlot(document,{key,slot,definition}),key);button.dataset.sharedTooltip='true';
   button.onmouseenter=button.onfocus=()=>{if(definition)tooltip.skill(definition,button,slot?.branchId);};
   button.onmouseleave=button.onblur=tooltip.hide;
   const label=button.querySelector('.slot-key,.skill-key,.key');if(label)label.textContent=coreKeyLabel(key,getKeyBindings());return button;
  });query('.skill-bar').replaceChildren(...slots);
  bindBattleSkillSlots(document,{elements:slots,loadout:row.loadout,editable,onEdit:edit});
 }
 async function commit(loadout,branchChoices,sound=null){
  if(!editable())return false;const owner=current,epoch=generation;
  busy=true;root.inert=true;tooltip.hide();message('Saving…');
  try{
   await configuration.save(owner.id,{loadout,branchChoices});
   if(disposed||epoch!==generation)return false;
   if(sound)onSound(sound);message('Configuration saved · Max level');render();return true;
  }catch(error){if(!disposed&&epoch===generation){message(error.message);render();}return false;}
  finally{busy=false;root.inert=false;}
 }
 async function edit(operation){
  if(!editable())return false;
  try{const next=editPickerLoadout(current.loadout,operation.type==='equip'?{...operation,branchId:current.branchChoices[operation.skillId]??'none'}:operation,current.definitions,current.supportFor);
   selectedSlot=operation.target;selectedSkillId=Number(next[selectedSlot]?.skillId)||null;
   return commit(next,current.branchChoices,operation.type==='remove'?'skillUnequip':'skillEquip');
  }catch(error){message(error.message);return false;}
 }
 function equip(skillId){if(!editable())return false;try{return edit({type:'equip',skillId,target:quickEquipTarget(current.loadout,skillId)});}catch(error){message(error.message);return false;}}
 function branch(skillId,branchId){
  if(!editable())return false;
  try{const choices=choosePickerBranch(current.branchChoices,current.definitions.find(skill=>skill.id===skillId),branchId);selectedSkillId=skillId;
   return commit(applyPickerBranches(current.loadout,choices,current.definitions),choices);
  }catch(error){message(error.message);return false;}
 }
 function close({force=false}={}){if(busy&&!force)return false;generation++;tooltip.hide();cancelPickerDrag(document);root.hidden=true;onClose();return true;}
 const keyboard=event=>{
  if(event.code==='Escape'&&!root.hidden){event.preventDefault();event.stopImmediatePropagation();close();}
  else if(event.code==='KeyK'&&root.hidden&&!event.repeat&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.target?.closest?.('input,textarea,select,[contenteditable="true"]')){event.preventDefault();void open();}
 };
 async function open(){
  if(disposed||busy||!canEdit())return false;const epoch=++generation;busy=true;
  try{const row=await configuration.loadProfession(getProfessionId());if(disposed||epoch!==generation||!canEdit())return false;
   current=row;selectedSkillId=Number(row.loadout[selectedSlot]?.skillId)||null;message('');render();root.hidden=false;onOpen();query('header button').focus();return true;
  }catch(error){if(!disposed&&epoch===generation)onError(error);return false;}
  finally{busy=false;}
 }
 query('header button').onclick=close;query('.picker-tree-scroll').addEventListener('scroll',tooltip.hide);
 document.addEventListener('keydown',keyboard,true);
 return {root,open,close,get busy(){return busy;},get isOpen(){return !root.hidden;},
  dispose(){disposed=true;generation++;tooltip.hide();cancelPickerDrag(document);document.removeEventListener('keydown',keyboard,true);root.remove();}};
}
