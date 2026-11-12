import {assetUrl} from './asset-urls.mjs';
import {cleanSkillText,skillDetails,createSkillDetailSections} from './skill-slot.mjs';

/** Passive skills have no slot-selection or activation handler. */
export function createPassiveCatalog(document,{definitions,applied=[]}){
  const activeIds=new Set(applied.map(p=>Number(p.skillId??p.id??p)));
  return definitions.filter(d=>!d.replacedAtMax&&d.template?.m_eActiveSkillUseCondtion===0).map(d=>{
    const card=document.createElement('div');card.className='passive-card';card.dataset.skill=String(d.id);
    card.setAttribute('role','img');card.setAttribute('tabindex','0');
    const name=cleanSkillText(d.name),enabled=activeIds.has(d.id);
    card.setAttribute('aria-label',`${name} · Max level ${d.maxLevel} · ${enabled?'Active by default':'Unverified'} · Cannot equip`);
    const icon=document.createElement('img');icon.src=assetUrl('/assets/ui/skills/'+d.icon);icon.alt='';
    const title=document.createElement('span');title.textContent=name;
    const status=document.createElement('small');status.textContent=`Max level ${d.maxLevel} · ${enabled?'Active by default':'Unverified'} · Cannot equip`;
    const tooltip=document.createElement('span');tooltip.className='skill-tooltip';tooltip.id='passive-tooltip-'+d.id;tooltip.setAttribute('role','tooltip');
    card.setAttribute('aria-describedby',tooltip.id);
    const detail=skillDetails(d,''),heading=document.createElement('strong');heading.textContent=detail.name;
    tooltip.append(heading,...createSkillDetailSections(document,detail));
    card.append(icon,title,status,tooltip);return card;
  });
}
