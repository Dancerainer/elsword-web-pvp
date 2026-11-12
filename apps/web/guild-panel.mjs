import {GUILD_CATALOG} from '../../packages/combat-core/guild-skills.mjs';
import {createPickerTooltip} from './skill-picker.mjs';
import {createSkillDescription} from './skill-slot.mjs';



/** Original 2016 icon tree; ranks describe the existing default passive rules. */
export function createGuildPanel({document=globalThis.document,host=document?.body,onOpen=()=>{},onClose=()=>{},assetUrl=url=>url}={}){
  if(!document||!host)throw new TypeError('Guild page document and host required');
  const overlay=document.createElement('div');overlay.className='guild-skill-overlay';overlay.hidden=true;
  const panel=document.createElement('section');panel.className='guild-skill-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Guild skills');
  const header=document.createElement('header');header.className='guild-skill-header';
  const title=document.createElement('h2');title.textContent='Guild information';
  const note=document.createElement('p');note.className='guild-skill-note';note.textContent='All guild passive skills mastered';
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Close guild skills');
  header.append(title,note,dismiss);
  const body=document.createElement('div');body.className='guild-skill-body';
  const tabs=document.createElement('nav');tabs.className='guild-skill-tabs';tabs.setAttribute('aria-label','Current tab: Guild skills');
  for(const label of ['Guild information','Guild members','Guild skills']){const tab=document.createElement('span');tab.textContent=label;tab.className=label==='Guild skills'?'current':'inactive';tabs.append(tab);}
  const points=document.createElement('div');points.className='guild-skill-points';
  for(const [index,text]of ['Available GSP: 0',`Spent GSP: ${GUILD_CATALOG.skills.length*5}`,'Skill resets: 0'].entries()){const field=document.createElement('span');field.textContent=text;if(index===2)field.className='guild-skill-reset';points.append(field);}
  const tooltip=createPickerTooltip(document,overlay,{id:'guild-hover-detail'});
  const grid=document.createElement('div');grid.className='guild-skill-grid';
  for(const skill of [...GUILD_CATALOG.skills].sort((a,b)=>a.treeRow-b.treeRow||a.treeColumn-b.treeColumn)){
    const card=document.createElement('article');card.className='guild-skill-card';card.dataset.skillId=String(skill.skillId);card.tabIndex=0;
    const icon=document.createElement('img');icon.className='guild-skill-icon';icon.src=assetUrl('/assets/ui/lobby/guild/'+skill.skillId+'.png');icon.alt=skill.name;
    const passive=document.createElement('span');passive.className='guild-skill-passive';passive.textContent='PASSIVE';
    const level=document.createElement('span');level.className='guild-skill-level';level.textContent='Lv.5';
    const master=document.createElement('img');master.className='guild-skill-master';master.src=assetUrl('/assets/ui/guild-window/master_normal.png');master.alt='Mastered';
    const rank=document.createElement('span');rank.className='guild-skill-rank';rank.textContent='5 / 5';
    const name=document.createElement('h3');name.textContent=skill.name;
    const description=document.createElement('p');description.className='guild-skill-description';description.textContent=skill.description;
    if(skill.precedingSkillId)card.dataset.predecessor=String(skill.precedingSkillId);
    const hero=skill.skillId===510,restore=skill.abilities.SA_HP_GAIN_REL_MAX_HP;
    const inspect=()=>tooltip.content(createSkillDescription(document,{id:skill.skillId,name:skill.name,type:8,passive:true,maxLevel:5,
      iconUrl:'/assets/ui/lobby/guild/'+skill.skillId+'.png',
      ...(hero?{pvpDescription:`Restores allies’ HP by ${restore*50}% of their maximum HP.`}:{}),
      template:hero?{m_wstrMainDesc:'On death, restore HP to living allies within 15 meters. This cannot heal the caster or revive fallen allies.',m_EffectiveDesc:{'5':`Restores allies’ HP by ${restore*100}% of their maximum HP.`}}:{m_wstrMainDesc:skill.description}}),card);
    card.addEventListener('mouseenter',inspect);card.addEventListener('focus',inspect);
    card.addEventListener('mouseleave',tooltip.hide);card.addEventListener('blur',tooltip.hide);
    card.setAttribute('aria-label',`${skill.name}, passive, mastered, level 5 / 5`);
    card.append(icon,passive,level,master,rank,name,description);grid.append(card);
  }
  body.append(tabs,points,grid);panel.append(header,body);overlay.append(panel);host.append(overlay);
  let opened=false,previousFocus=null;
  const close=()=>{if(!opened)return;tooltip.hide();opened=false;overlay.hidden=true;onClose();previousFocus?.focus?.();};
  const open=()=>{if(opened)return;previousFocus=document.activeElement;opened=true;overlay.hidden=false;onOpen();dismiss.focus?.();};
  const escape=event=>{if(opened&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};
  const background=event=>{if(event.target===overlay)close();};
  dismiss.addEventListener('click',close);overlay.addEventListener('click',background);document.addEventListener('keydown',escape,true);
  return {open,close,isOpen:()=>opened,element:overlay,
    dispose(){close();dismiss.removeEventListener('click',close);overlay.removeEventListener('click',background);document.removeEventListener('keydown',escape,true);overlay.remove();}};
}
