/** MM selected-slot display. The frame is original BG_ADD_SKILLSLOT; the
 * geometric action symbols are the user-requested Web presentation.
 * This observer never equips, switches, fires or changes an availability gate.
 */
import {ADD_DP_DISPLAY_SCALE,isAddGeneratorSkill} from '../../packages/combat-core/add-systems.mjs';

const views=new WeakMap();
const modes=new Set(['generator-select','generator-switch','generator-fire']);
const modeIcons={
 'generator-select':'<path d="M12 2 21 7v10l-9 5-9-5V7zM12 7v10M7 12h10"/>',
 'generator-switch':'<path d="M5 8h14m-4-4 4 4-4 4M19 16H5m4-4-4 4 4 4"/>',
 'generator-fire':'<path d="m8 4 12 8-12 8z"/>',
};
const number=value=>Number.isFinite(value)&&value>=0?String(Number(value.toFixed(3))):null;
const attribute=(element,name)=>element.getAttribute?.(name)??element.attributes?.[name]??'';

export function generatorSkillSlotState({actor,definition,availability}={}){
 const skillId=definition?.id??definition?.skillId;
 if(actor?.professionId?.toUpperCase()!=='MM'||!(actor.hp>0)||!actor.sourceAdd||!definition||
   !isAddGeneratorSkill({raw:definition.raw??definition.template})||availability?.skillId!==skillId)return null;
 const generator=actor.sourceAdd.generator,live=generator&&generator.remaining>0;
 const selected=Boolean(live&&generator.skillId===skillId),plan=availability.addResourcePlan;
 const mode=modes.has(plan?.mode)?plan.mode:selected?'generator-fire':live?'generator-switch':'generator-select';
 const action=mode==='generator-fire'?'Fire':mode==='generator-switch'?'Switch':'Install';
 const prices=[];
 if(plan){
  if(plan.mpCost>0)prices.push('MP '+number(plan.mpCost));
  if(plan.dpCost>0)prices.push('DP '+number(plan.dpCost/ADD_DP_DISPLAY_SCALE));
  if(plan.mutationCost>0)prices.push('Mutation points '+number(plan.mutationCost));
  if(!prices.length&&plan.mpCost===0&&plan.dpCost===0)prices.push('No MP or DP cost');
 }
 const cooldown=availability.resourceCooldownRemaining??availability.cooldownRemaining;
 const status=availability.reason==='unsupported-skill'?'Skill unavailable':availability.reason==='pvp-disabled'?'Unavailable in this match':
   cooldown>0?'Cooldown '+Math.ceil(cooldown)+' s':availability.resourceMpInsufficient?'Insufficient MP':
   availability.resourceDpInsufficient?'Insufficient DP':availability.resourceMutationInsufficient?'Insufficient mutation points':
   availability.available?'Ready':'Unavailable';
 const selectedText=selected?'Selected. '+(generator.phase==='firing'?'Firing. ':'')+'Press again to fire (remaining: '+Math.ceil(generator.remaining)+' s)':
   live?'Press to switch to this Dynamo Factory mode':'Press to install this Dynamo Factory mode';
 return {skillId,mode,action,selected,phase:selected?generator.phase:null,remaining:selected?generator.remaining:null,
   available:availability.available===true,hint:[selectedText,prices.length?prices.join(' + '):'Cost depends on the current skill state',status].join(' · ')};
}

export function updateAddGeneratorSkillSlot(element,context){
 const state=generatorSkillSlotState(context);
 let view=views.get(element);
 if(!state){
  element.classList.toggle('add-generator-slot',false);element.classList.toggle('add-generator-selected',false);
  delete element.dataset.generatorMode;delete element.dataset.generatorSelected;delete element.dataset.generatorPhase;
  if(view){view.action.hidden=true;view.hint.hidden=true;view.hint.textContent='';
   if(attribute(element,'aria-label')===view.appliedLabel)element.setAttribute('aria-label',view.baseLabel);view.appliedLabel=null;}
  return null;
 }
 if(!view){
  const document=element.ownerDocument;
  if(!document?.createElement)throw new TypeError('MM skill slot requires its owner document');
  const action=document.createElement('span');action.className='add-generator-action';action.setAttribute('aria-hidden','true');
  const hint=document.createElement('span');hint.className='add-generator-hint';
  element.append(action);element.querySelector('.skill-tooltip')?.append(hint);
  view={action,hint,baseLabel:attribute(element,'aria-label'),appliedLabel:null};views.set(element,view);
 }
 const currentLabel=attribute(element,'aria-label');if(currentLabel!==view.appliedLabel)view.baseLabel=currentLabel;
 element.classList.toggle('add-generator-slot',true);element.classList.toggle('add-generator-selected',state.selected);
 element.dataset.generatorMode=state.mode;element.dataset.generatorSelected=String(state.selected);
 if(state.phase)element.dataset.generatorPhase=state.phase;else delete element.dataset.generatorPhase;
 // State is visible through distinct symbols and the original selected frame.
 // Detailed action words remain available to assistive technology only.
 view.action.hidden=false;
 if(view.mode!==state.mode){view.action.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+modeIcons[state.mode]+'</svg>';view.mode=state.mode;}
 view.hint.hidden=true;view.hint.textContent='';
 view.appliedLabel=view.baseLabel+' · Dynamo Factory:'+state.hint;element.setAttribute('aria-label',view.appliedLabel);
 return state;
}
