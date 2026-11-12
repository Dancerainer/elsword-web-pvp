import {assetUrl} from './asset-urls.mjs';
import {cleanSkillText, skillDetails,createSkillDetailSections,createSkillDescription} from './skill-slot.mjs';
import {skillLabel, traitLabel as localizedTraitLabel, traitDescription} from '../../packages/localization/skills.mjs';
import {placeSkillSlot} from './skill-picker-state.mjs';

export const branchKey = branch => String(branch?.branchId ?? branch?.id ?? 'none');
export const traitLabel = branch => {
  const name=localizedTraitLabel(branch);
  return /^MI_|^memo-/.test(name)?'Unverified trait':cleanSkillText(name);
};
const passive = definition => [1,8].includes(definition?.type)
  || definition?.template?.m_eActiveSkillUseCondtion === 0;
const nameFor = definition => cleanSkillText(skillLabel(definition));
export const PICKER_DRAG_TYPE='application/x-elsword-rf-skill';
const dragControllers=new WeakMap();

/** One delegated pointer controller per document; rebuilding never adds listeners. */
export function createPickerDragController(document) {
  if(dragControllers.has(document))return dragControllers.get(document);
  if(typeof document.addEventListener!=='function')return null;
  const sources=new WeakMap();let targets=[],drop=null,active=null,suppressClick=false,enabled=()=>true;
  const cleanup=()=>{
    if(!active)return;
    active.target?.classList.remove('drop-target');active.ghost?.remove();
    document.body.classList.remove('picker-dragging');
    try{active.element.releasePointerCapture?.(active.pointerId);}catch{}
    active=null;
  };
  const sourceFor=element=>{
    for(let node=element;node;node=node.parentElement){if(sources.has(node))return {element:node,payload:sources.get(node)};}
    return null;
  };
  const targetAt=(x,y)=>{
    let element=document.elementFromPoint(x,y);
    while(element){const index=targets.indexOf(element);if(index>=0)return {element,index};element=element.parentElement;}
    return null;
  };
  const down=event=>{
    suppressClick=false;
    if(event.button!==0||event.isPrimary===false||!drop||!enabled())return;
    const source=sourceFor(event.target);if(!source||source.element.isConnected===false)return;
    cleanup();active={...source,pointerId:event.pointerId,x:event.clientX,y:event.clientY,started:false,target:null};
    try{source.element.setPointerCapture?.(event.pointerId);}catch{}
  };
  const move=event=>{
    if(!active||event.pointerId!==active.pointerId)return;
    if(!enabled()){cleanup();return;}
    if(!active.started&&Math.hypot(event.clientX-active.x,event.clientY-active.y)<6)return;
    event.preventDefault();
    if(!active.started){
      document.body.classList.add('picker-dragging');
      active.started=true;const ghost=document.createElement('div');ghost.className='picker-drag-ghost';
      const image=active.element.querySelector?.('img');
      if(image)ghost.append(image.cloneNode(true));else ghost.textContent='Skill';
      document.body.append(ghost);active.ghost=ghost;
    }
    active.ghost.style.left=(event.clientX+12)+'px';active.ghost.style.top=(event.clientY+12)+'px';
    const target=targetAt(event.clientX,event.clientY);
    if(active.target!==target?.element){active.target?.classList.remove('drop-target');active.target=target?.element??null;active.target?.classList.add('drop-target');}
  };
  const up=event=>{
    if(!active||event.pointerId!==active.pointerId)return;
    const started=active.started,payload=active.payload,target=started?targetAt(event.clientX,event.clientY):null;
    cleanup();if(!started)return;
    suppressClick=true;event.preventDefault();if(target&&enabled())drop({...payload},target.index);
  };
  const cancel=event=>{if(active?.pointerId===event.pointerId)cleanup();};
  const cancelNative=event=>{if(sourceFor(event.target))event.preventDefault();};
  const click=event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  const listeners={pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel,dragstart:cancelNative,click};
  for(const [type,listener] of Object.entries(listeners))document.addEventListener(type,listener,{capture:true,passive:false});
  const controller={
    cancel(){cleanup();suppressClick=false;},
    setEnabled(callback){enabled=callback??(()=>true);if(!enabled())cleanup();},
    registerSource(element,payload){sources.set(element,{...payload});element.draggable=false;element.style.touchAction='none';element.classList.add('picker-draggable');},
    setTargets(elements,onDrop){cleanup();targets=[...elements];drop=onDrop??null;},
    destroy(){cleanup();for(const [type,listener] of Object.entries(listeners))document.removeEventListener(type,listener,true);targets=[];drop=null;dragControllers.delete(document);},
  };
  dragControllers.set(document,controller);return controller;
}

export function disposePickerDrag(document){dragControllers.get(document)?.destroy();}
export function cancelPickerDrag(document){dragControllers.get(document)?.cancel();}

export function highestTree(definitions) {
  const positions = new Set();
  return definitions.filter(definition => !definition.replacedAtMax).map(definition => {
    const row = definition.treeNode?.m_iRowIndex, column = definition.treeNode?.m_iColumnIndex;
    if (!Number.isSafeInteger(row) || row < 0 || !Number.isSafeInteger(column) || column < 0 || column > 4)
      throw Error(`Skill ${definition.id} has no confirmed skill tree position`);
    const key = `${row}:${column}`;
    if (positions.has(key)) throw Error(`Duplicate source skill tree position ${key}`);
    positions.add(key); return {definition,row,column,passive:passive(definition)};
  }).sort((a,b) => a.row-b.row || a.column-b.column);
}

/** Level comes from original base/replacement declarations, never row*5. */
export function treeGroups(definitions) {
  const groups=[];
  for(const node of highestTree(definitions)){
    let group=groups.find(g=>g.row===node.row);
    if(!group){group={row:node.row,level:null,nodes:[]};groups.push(group);}
    group.nodes.push(node);
    const family=definitions.filter(d=>d.id===node.definition.id || Number(d.maxUpgradeId)===node.definition.id);
    for(const member of family){
      const value=member.template?.m_RequireCharacterLevel?.['1'];
      if(Number.isSafeInteger(value)&&value>0)group.level=group.level===null?value:Math.min(value,group.level);
    }
  }
  return groups;
}

const copySlots = loadout => {
  if(!Array.isArray(loadout)||loadout.length!==8)throw Error('The skill bar needs eight slots');
  return loadout.map(slot=>slot==null?null:{...slot});
};
const validSlot = index => Number.isSafeInteger(index)&&index>=0&&index<8;

/** UI intent only. Core configureLoadout remains the final validator. */
export function editPickerLoadout(loadout,operation,definitions,supportFor) {
  const next=copySlots(loadout),target=operation?.target;
  if(!validSlot(target))throw Error('Choose a valid skill slot');
  if(operation.type==='remove'){next[target]=null;return next;}
  if(operation.type==='swap'){
    if(!validSlot(operation.source))throw Error('Invalid source slot');
    if(!next[operation.source] || (operation.skillId!==undefined && Number(next[operation.source].skillId)!==Number(operation.skillId)))
      throw Error('Skill setup changed. Drag again.');
    [next[operation.source],next[target]]=[next[target],next[operation.source]];
    return next;
  }
  if(operation.type!=='equip')throw Error('Unsupported equip action');
  const id=Number(operation.skillId),definition=definitions.find(d=>d.id===id);
  if(!definition)throw Error('Cannot equip this skill');
  if(definition.replacedAtMax)throw Error('Choose the corresponding max-level skill');
  if(passive(definition))throw Error('Passive skills cannot be equipped in skill slots');
  if(supportFor(id)?.supported!==true)throw Error(supportFor(id)?.disabledReason??'This skill is currently unavailable');
  const source=next.findIndex(slot=>Number(slot?.skillId)===id);
  if(source>=0){[next[source],next[target]]=[next[target],next[source]];}
  else next[target]={skillId:id,branchId:operation.branchId??'none'};
  return next;
}

export function readPickerDrag(event) {
  const raw=event?.dataTransfer?.getData(PICKER_DRAG_TYPE);
  if(typeof raw!=='string'||raw.length>1024)return null;
  try{
    const payload=JSON.parse(raw);
    if(payload.schema!=='elsword.rf-picker.v1'||!Number.isSafeInteger(payload.skillId)||payload.skillId<=0)return null;
    if(payload.kind==='skill')return {kind:'skill',skillId:payload.skillId};
    if(payload.kind==='slot'&&validSlot(payload.sourceSlot))return {kind:'slot',skillId:payload.skillId,sourceSlot:payload.sourceSlot};
  }catch{}
  return null;
}
function startDrag(event,payload){
  if(!event.dataTransfer)return;
  event.dataTransfer.effectAllowed='copyMove';
  event.dataTransfer.setData(PICKER_DRAG_TYPE,JSON.stringify({schema:'elsword.rf-picker.v1',...payload}));
}

export function createPickerSlots(document,{keys,loadout,definitions,selectedSlot,onDrop,onRemove}) {
  if(keys.length!==8)throw Error('The skill bar needs eight keys');
  const controller=createPickerDragController(document);
  const cells=keys.map((key,index) => {
    const cell=document.createElement('div');cell.className='picker-slot'+(index===selectedSlot?' selected':'');
    cell.dataset.key=key;cell.dataset.slot=String(index);
    placeSkillSlot(cell,key);
    const button=document.createElement('button');button.type='button';button.className='picker-slot-select';
    button.setAttribute('aria-pressed',String(index===selectedSlot));
    const definition=definitions.find(d=>d.id===Number(loadout[index]?.skillId));
    button.setAttribute('aria-label',`${key} · ${definition?nameFor(definition)+' · Right-click to remove':'Empty slot · Drop a skill here'}`);
    if(definition){const icon=document.createElement('img');icon.src=assetUrl('/assets/ui/skills/'+definition.icon);icon.alt='';icon.draggable=false;button.append(icon);}
    const label=document.createElement('span');label.className='key';label.textContent=key;button.append(label);
    const name=document.createElement('span');name.className='picker-slot-name';name.textContent=definition?nameFor(definition):'Empty slot';
    button.title=definition?`${nameFor(definition)} · Right-click to remove, drag to swap`:'Right-click a skill to fill the first empty slot, or drag a skill here';
    button.oncontextmenu=event=>{event.preventDefault();if(definition&&onRemove)onRemove(index);};
    button.onkeydown=event=>{
      if(definition&&onRemove&&['Delete','Backspace'].includes(event.key)){event.preventDefault();onRemove(index);}
    };
    cell.append(button,name);
    if(definition&&!passive(definition)){
      cell.draggable=true;button.draggable=true;
      cell.ondragstart=event=>startDrag(event,{kind:'slot',skillId:definition.id,sourceSlot:index});
      if(controller){cell.draggable=false;controller.registerSource(button,{kind:'slot',skillId:definition.id,sourceSlot:index});}
    }
    if(onDrop){
      cell.ondragover=event=>{
        if(!Array.from(event.dataTransfer?.types??[]).includes(PICKER_DRAG_TYPE))return;
        event.preventDefault();event.dataTransfer.dropEffect='move';cell.classList.add('drop-target');
      };
      cell.ondragleave=()=>cell.classList.remove('drop-target');
      cell.ondrop=event=>{
        event.preventDefault();cell.classList.remove('drop-target');
        const payload=readPickerDrag(event);if(payload)onDrop(payload,index);
      };
    }
    return cell;
  });
  controller?.setTargets(cells,onDrop);return cells;
}

/** Bind configuration gestures to the real eight HUD slots. Guards are live
 * callbacks so a queue admission disables an already registered drag source. */
export function bindBattleSkillSlots(document,{elements,loadout,editable,onEdit}){
 const controller=createPickerDragController(document);
 const canEdit=()=>editable()===true;
 for(const [index,element]of elements.entries()){
  element.dataset.slot=String(index);
  element.oncontextmenu=event=>{event.preventDefault();if(canEdit())onEdit({type:'remove',target:index});};
  element.onpointerdown=()=>{for(const panel of document.querySelectorAll?.('.picker-tooltip')??[])panel.hidden=true;};
  element.onkeydown=event=>{if(['Delete','Backspace'].includes(event.key)&&canEdit()){event.preventDefault();event.stopPropagation();onEdit({type:'remove',target:index});}};
  if(loadout[index])controller?.registerSource(element,{kind:'slot',skillId:Number(loadout[index].skillId),sourceSlot:index});
 }
 controller?.setTargets(elements,(payload,index)=>{
  if(canEdit())onEdit(payload.kind==='slot'?{type:'swap',source:payload.sourceSlot,skillId:payload.skillId,target:index}:{type:'equip',skillId:payload.skillId,target:index});
 });
 controller?.setEnabled(canEdit);
}

/** Catalog actions configure the real HUD slots. */
export function createSkillTree(document,{definitions,supportFor,loadout,applied=[],grantedLabel='Active by default',selectedSkillId,branchChoices={},onChooseBranch,onEquip,onInspect,onHideDetails=()=>{},onInspectBranch}) {
  const controller=createPickerDragController(document);
  const equipped=new Map(loadout.map((s,index)=>[Number(s?.skillId),index]));
  const granted=new Set(applied.map(p=>Number(p.skillId??p.id??p)));
  return treeGroups(definitions).map(group=>{
    const row=document.createElement('div');row.className='skill-tree-row';row.dataset.row=String(group.row);
    const heading=document.createElement('span');heading.className='skill-tree-level';
    heading.textContent=group.level===null?'Common':`Lv. ${group.level}`;row.append(heading);
    const items=document.createElement('div');items.className='skill-tree-nodes';row.append(items);
    const activeNodes=group.nodes.filter(n=>!n.passive),passiveNodes=group.nodes.filter(n=>n.passive);
    for(const {definition,column,passive:isPassive} of group.nodes){
      const support=supportFor(definition.id),item=document.createElement('div');item.className='skill-node';
      item.dataset.pvpDisabled=String(support?.pvpDisabled===true);
      item.dataset.skill=String(definition.id);item.dataset.row=String(group.row);item.dataset.column=String(column);
      const index=(isPassive?passiveNodes:activeNodes).findIndex(n=>n.definition.id===definition.id);
      // Keep original level rows/order; regroup active nodes into the reference's
      // three red columns and passive nodes into its two blue columns.
      const displayColumn=isPassive?3+index:activeNodes.length===1?1:activeNodes.length===2?index*2:index;
      item.style.gridColumn=String(displayColumn+1);item.dataset.passive=String(isPassive);
      if(definition.id===selectedSkillId)item.classList.add('inspected');
      const card=document.createElement(isPassive?'div':'button');card.className=isPassive?'passive-card':'skill-card';
      if(isPassive){
        card.tabIndex=0;card.setAttribute('role','img');
        card.setAttribute('aria-label',`${nameFor(definition)} · Max level ${definition.maxLevel} · ${granted.has(definition.id)?grantedLabel:'Unverified'} · Cannot equip`);
      }else{
        card.type='button';card.disabled=support?.supported!==true;
        card.setAttribute('aria-label',`${nameFor(definition)} · Max level ${definition.maxLevel} · ${support?.pvpDisabled?'Disabled in PvP':card.disabled?'Unavailable':'Right-click to equip or drag to a slot'}`);
        card.oncontextmenu=event=>{event.preventDefault();if(!card.disabled)onEquip(definition.id);};
        if(!card.disabled){
          card.draggable=true;
          card.ondragstart=event=>startDrag(event,{kind:'skill',skillId:definition.id});
          controller?.registerSource(card,{kind:'skill',skillId:definition.id});
        }else{item.tabIndex=0;item.onclick=item.onfocus=()=>onInspect?.(definition.id,item);item.onblur=onHideDetails;}
      }
      const icon=document.createElement('img');icon.src=assetUrl('/assets/ui/skills/'+definition.icon);icon.alt='';icon.draggable=false;
      const level=document.createElement('small');level.className='skill-node-level';level.textContent=isPassive?'Passive MAX':'MAX';
      const label=document.createElement('span');label.className='skill-node-name';label.textContent=nameFor(definition);
      card.append(icon,level,label);
      const inspect=()=>onInspect?.(definition.id,card);
      card.onfocus=inspect;card.onmouseenter=inspect;
      card.onmouseleave=onHideDetails;card.onblur=onHideDetails;card.onpointerdown=onHideDetails;
      // Disabled cards remain inspectable through their enclosing node.
      if(card.disabled){item.onmouseenter=inspect;item.onmouseleave=onHideDetails;}
      item.dataset.frame=isPassive?'passive':definition.type===12?'buff':[13,14,15,16].includes(definition.type)?'special':'active';
      if(equipped.has(definition.id)){const marker=document.createElement('span');marker.className='equipped-marker';marker.textContent='Equipped';item.append(marker);}
      item.append(card);
      if(support?.pvpDisabled){const marker=document.createElement('span');marker.className='pvp-disabled-marker';marker.textContent='Disabled in PvP';item.append(marker);}
      const branches=support?.branches??definition.branches??[];
      if(!isPassive&&branches.length&&onChooseBranch){
        const controls=document.createElement('div');controls.className='skill-node-traits';
        for(const branch of branches){
          const key=branchKey(branch),button=document.createElement('button');button.type='button';
          button.className='tree-trait';button.dataset.branch=key;
          button.disabled=!(branch.selectable===true||branch.supported===true);
          button.setAttribute('aria-pressed',String(branchChoices[definition.id]===key));
          button.setAttribute('aria-label',`${nameFor(definition)} · ${traitLabel(branch)}`);
          const image=document.createElement('img');image.alt='';image.draggable=false;
          image.src=assetUrl('/assets/ui/skill-picker/'+(button.disabled?'memo_lock':branchChoices[definition.id]===key?'memo_select':'memo_open')+'.png');
          button.append(image);
          if(onInspectBranch){
            button.onmouseenter=button.onfocus=()=>onInspectBranch(branch,button);
            button.onmouseleave=button.onblur=onHideDetails;
          }else button.title=`${traitLabel(branch)}\n${traitDescription(branch)}`;
          button.onclick=event=>{event.stopPropagation();onHideDetails();onChooseBranch(definition.id,branchChoices[definition.id]===key?'none':key);};
          controls.append(button);
        }
        item.append(controls);
      }
      items.append(item);
    }
    return row;
  });
}

/** Equipment is not a prerequisite for choosing either alternative. */
export function createBranchButtons(document,{branches=[],selected='none',enabled=true,onChoose}) {
  return branches.map((branch,index)=>{
    const key=branchKey(branch),button=document.createElement('button');button.type='button';
    const selectable=branch.selectable===true||branch.supported===true;
    button.className='trait-choice';button.dataset.branch=key;button.disabled=!selectable||!enabled;
    button.setAttribute('aria-pressed',String(selected===key));
    const icon=document.createElement('img');icon.alt='';
    icon.src=assetUrl('/assets/ui/skill-picker/'+(button.disabled?'memo_lock':selected===key?'memo_select':'memo_open')+'.png');
    const name=document.createElement('strong');name.textContent=traitLabel(branch)||`Trait ${index+1}`;
    const status=document.createElement('small');status.textContent=!enabled?'Unavailable':selected===key?'Selected':'Click to select';
    const description=document.createElement('span');description.className='trait-description';description.textContent=cleanSkillText(traitDescription(branch));
    button.append(icon,name,status,description);button.title=[name.textContent,description.textContent,status.textContent].filter(Boolean).join('\n');
    if(!button.disabled)button.onclick=()=>onChoose(key);
    return button;
  });
}

export function createSkillDetail(document,{definition,branchId=null}) {
  if(!definition){const prompt=document.createElement('p');prompt.className='picker-detail-prompt';prompt.textContent='Right-click a skill to equip it, right-click a slot to clear it, or drag the skill to any key.';return [prompt];}
  return createSkillDescription(document,definition,branchId);
}

/** One hover panel outside the scrolling tree, so descriptions are not clipped. */
export function createPickerTooltip(document,root,{id='picker-hover-detail'}={}) {
  const panel=document.createElement('div');panel.className='picker-tooltip';panel.hidden=true;
  panel.id=id;panel.tabIndex=0;panel.setAttribute('role','tooltip');root.append(panel);
  let described=null;
  const hide=event=>{
    if(event?.relatedTarget&&(event.relatedTarget===panel||panel.contains?.(event.relatedTarget)))return;
    panel.hidden=true;described?.removeAttribute?.('aria-describedby');described=null;
  };
  panel.onmouseleave=panel.onblur=hide;
  const show=(children,anchor)=>{
    if(document.body?.classList.contains?.('picker-dragging'))return;
    hide();panel.replaceChildren(...children);panel.hidden=false;described=anchor;
    anchor.setAttribute('aria-describedby',panel.id);
    // Keep the source node's adjacent memo buttons reachable while its skill
    // description is visible; aria-describedby still belongs to the icon.
    const bounds=root.getBoundingClientRect(),target=(anchor.closest?.('.skill-node')??anchor).getBoundingClientRect();
    panel.style.maxWidth=Math.max(120,bounds.width-20)+'px';
    panel.style.maxHeight=Math.max(80,bounds.height-20)+'px';
    const width=panel.offsetWidth,height=panel.offsetHeight;
    const right=target.right-bounds.left+8,left=target.left-bounds.left-width-8;
    panel.style.left=Math.max(8,Math.min(right+width<=bounds.width-8?right:left,bounds.width-width-8))+'px';
    panel.style.top=Math.max(8,Math.min(target.top-bounds.top,bounds.height-height-8))+'px';
  };
  return {hide,
    content:show,
    skill(definition,anchor,branchId){show(createSkillDetail(document,{definition,branchId}),anchor);},
    trait(branch,anchor){
      const title=document.createElement('strong');title.className='picker-skill-title';title.textContent=traitLabel(branch);
      const text=document.createElement('p');text.textContent=cleanSkillText(traitDescription(branch));
      show([title,text],anchor);
    },
  };
}
