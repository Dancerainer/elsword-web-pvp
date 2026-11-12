import {assetUrl} from './asset-urls.mjs';
import {createSkillTraitPolicy} from '../../packages/combat-core/skill-traits.mjs';
import {addSkillResourceDetails} from './add-skill-display.mjs';
import {skillLabel,skillDisplayText,skillDescription,traitDescription,traitLabel,getSkillText,getTraitText,capabilityNotes,cleanSkillText} from '../../packages/localization/skills.mjs';

export {cleanSkillText};

export function skillDetails(definition, key, branch = null) {
  if (!definition) return { name: 'Empty slot', lines: [], key };
  const level = definition.maxLevel, template = definition.template ?? {};
  const atLevel = field => template[field]?.[String(level)];
  const lines = [`Max level ${level}`];
  const consumption = atLevel('m_MPConsumption'), cooldown = atLevel('m_SkillCoolTime');
  const addResources=addSkillResourceDetails(definition);
  if(addResources)lines.push(...addResources.costLines);
  else if (Number.isFinite(consumption)) lines.push(`MP ${consumption}`);
  if (Number.isFinite(cooldown)) lines.push(`Cooldown ${cooldown} s`);
  const summary=[...lines],description=[],multipliers=[],notes=[];
  if(addResources){lines.push(...addResources.notes);notes.push(...addResources.notes);}
  if(getSkillText(definition)) {
    const translated=getSkillText(definition),effects=new Set(String(translated.effect??'').split(/\n\n/).map(cleanSkillText));
    const content=skillDescription(definition,level).split(/\n\n/).filter(line=>!/^Max level \d+$|^MP cost:|^Cooldown:/.test(line)).map(cleanSkillText);
    lines.push(...content);
    for(const line of content)(effects.has(line)?multipliers:description).push(line);
  } else {
    if (template.m_wstrMainDesc) {const text=cleanSkillText(template.m_wstrMainDesc);lines.push(text);description.push(text);}
    const effect = atLevel('m_EffectiveDesc');
    if (typeof effect === 'string') {const text=cleanSkillText(effect);lines.push(text);multipliers.push(text);}
  }
  const limitations=capabilityNotes(definition);lines.push(...limitations);notes.push(...limitations);
  const selectedBranch = definition.branches?.find(b => (b.branchId ?? b.id) === branch);
  if (selectedBranch) {
    const description=getTraitText(selectedBranch)?traitDescription(selectedBranch):selectedBranch.description;
    if(description){const text=cleanSkillText(description);lines.push(text);notes.push(text);}
  }
  const sections=[['summary',summary],['description',description],['multipliers',multipliers],['notes',notes]]
    .filter(([,content])=>content.length).map(([kind,lines])=>({kind,lines}));
  return { name: cleanSkillText(skillLabel(definition)), key, level, lines, sections, sourceSkillId: definition.id };
}

/** The same paragraph groups are used by HUD, skill tree and passive details. */
export function createSkillDetailSections(document,detail,prefix='skill-detail') {
  return (detail.sections??[]).map(section=>{
    const text=document.createElement('span');text.className=prefix+'-'+section.kind;
    text.textContent=section.lines.join(section.kind==='summary'?' · ':'\n\n');return text;
  });
}

/** The tree, real HUD and guild tree share the reference tooltip hierarchy. */
export function createSkillDescription(document,definition,branchId=null){
 const translated=skillDisplayText(definition),template=definition.template??{};
 const selected=definition.branches?.find(b=>String(b.branchId??b.id)===String(branchId));
 const policy=selected?createSkillTraitPolicy({skillId:definition.id,unitClass:definition.classId,branches:definition.branches},selected.branchId??selected.id):null;
 const level=definition.maxLevel,at=field=>template[field]?.[String(level)];
 const name=skillLabel(definition);
 const type=definition.type,passive=definition.passive===true||[1,8].includes(type);
 const category=passive?'Passive':type===6||type===12?'Active: Flexibility':type===13?'Hyper Active':`Special Active: ${type===14?'Tenacity':type===15?'Strength':type===16?'Bravery':'Skill'}`;
 const header=document.createElement('div');header.className='skill-description-header';
 const icon=document.createElement('img');icon.className='skill-description-icon';icon.src=assetUrl(definition.iconUrl??('/assets/ui/skills/'+definition.icon));icon.alt='';
 const title=document.createElement('strong');title.className='skill-description-title';title.textContent=(selected?traitLabel(selected)+' ':'')+name;
 const meta=document.createElement('div');meta.className='skill-description-meta';
 const kind=document.createElement('span');kind.className='skill-description-category';kind.textContent=`[${category}]`;
 meta.append(kind);
 if(passive){const rank=document.createElement('span');rank.textContent=`Lv. ${level} / ${level}`;meta.append(rank);}
 const price=(value,multiplier=1)=>Number.isFinite(value)?Number((value*multiplier).toFixed(4)):'—';
 const addResources=addSkillResourceDetails(definition);
 if(!passive)for(const text of [...(addResources?addResources.costLines:[`MP cost ${price(at('m_MPConsumption')??translated?.mpCost,policy?.mpMultiplier)}`]),`Cooldown ${price(at('m_SkillCoolTime')??translated?.cooldown,policy?.cooldownMultiplier)}s`]){const p=document.createElement('span');p.textContent=text;meta.append(p);}
 header.append(icon,title,meta);
 const content=[header];
 const add=(kind,text,label)=>{
  if(!text)return;const block=document.createElement('div');block.className='skill-description-block skill-description-'+kind;
  if(label){const heading=document.createElement('span');heading.className='skill-description-heading';heading.textContent=label;block.append(heading);}
  const prose=document.createElement('span');prose.textContent=cleanSkillText(text);block.append(prose);content.push(block);
 };
 const main=cleanSkillText(translated?.main??template.m_wstrMainDesc);
 const split=main.split(/(?:\n\n)?Final Enhanced Skill:?/i);
 add('prose',split[0]);
 // Display-only, using the target skill's declared sword category.
 // Keep all existing prose and numerical sections unchanged.
 const swordType=template.m_usWOSType;
 const elsword=[100,101,112].includes(definition.classId),elesis=[120,121,125].includes(definition.classId);
 if(!passive&&(elsword||elesis)&&[1,2].includes(swordType)){
  const label=elesis?(swordType===2?'Gale':'Annihilation'):(swordType===2?'Vitality':'Destruction');
  const effect=elesis?(swordType===2?'reduces MP cost and cooldown':'guarantees critical hits and ignores guard and knockdown defense'):(swordType===2?'reduces MP cost and increases MP recovery':'increases attack power');
  add(swordType===2?'sword-vitality':'sword-destruction',`${label} skill: ${label} ${effect} while active.`);
 }
 if(split.length>1)add('true',split.slice(1).join('\n'),'Final Enhanced Skill');
 const effect=translated?.effect??at('m_EffectiveDesc');
 // Some target tables have one shared numerical description. Do not invent
 // a PvP reduction from unrelated damage packets or newer wiki versions.
 const pvp=translated?.pvpEffect;
 add(pvp?'pve':'values',effect,pvp?'[Dungeon]':'[Skill Effect]');
 if(pvp)add('pvp',cleanSkillText(pvp),'[PvP]');
 if(selected)add('trait',traitDescription(selected),`Applied trait: ${traitLabel(selected)}`);
 for(const note of addResources?.notes??[])add('notes',note);
 if(definition.disabledReason)add('notes',definition.disabledReason);
 for(const note of capabilityNotes(definition))add('notes',note);
 return content;
}

// X2Game::UpdateSkillCoolTime line11133: int(ceil(m_fCoolTimeLeft)).
export function cooldownText(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? String(Math.ceil(seconds)) : '';
}

/** User v17 display rule: only MP/CD gray; actual cast gates remain separate. */
export function updateSkillSlotAvailability(element,availability){
  const cooldown=availability.resourceCooldownRemaining??(availability.mode==='shadow-return'?0:availability.cooldownRemaining);
  const mpInsufficient=availability.resourceMpInsufficient??availability.reason==='insufficient-mp';
  const displayReason=mpInsufficient?'insufficient-mp':availability.resourceDpInsufficient?'insufficient-dp':availability.resourceMutationInsufficient?'insufficient-mutation':cooldown>0?'cooldown':null;
  element.classList.toggle('unavailable',displayReason!==null);
  element.setAttribute('aria-disabled',String(!availability.available));
  element.dataset.availability=availability.available?'available':availability.reason;
  element.dataset.displayAvailability=displayReason??'normal';
  element.dataset.availabilityMode=availability.mode;
  // An already-paid Shadow return is usable while the next cast is cooling.
  element.querySelector('.cooldown').textContent=cooldownText(cooldown);
}

/** An informational icon has no activation event. Combat input is keyboard only. */
export function createSkillSlot(document, { key, slot, definition }) {
  const element = document.createElement('div');
  element.className = 'skill-slot'; element.dataset.key = key;
  element.dataset.skill = String(slot?.skillId ?? '');
  element.setAttribute('role', 'img'); element.setAttribute('tabindex', '0');
  const detail = skillDetails(definition, key, slot?.branchId);
  element.setAttribute('aria-label', `${key} · ${detail.name}`);
  if (!definition) element.classList.add('empty');
  if (definition) {
    const icon = document.createElement('img'); icon.className = 'icon';
    icon.src = assetUrl('/assets/ui/skills/' + definition.icon); icon.alt = ''; element.append(icon);
  }
  const keyLabel = document.createElement('span'); keyLabel.className = 'key'; keyLabel.textContent = key;
  const cooldown = document.createElement('span'); cooldown.className = 'cooldown';
  const tooltip = document.createElement('span'); tooltip.className = 'skill-tooltip';
  tooltip.id = `skill-tooltip-${key}`; tooltip.setAttribute('role', 'tooltip');
  element.setAttribute('aria-describedby', tooltip.id);
  if(definition)tooltip.append(...createSkillDescription(document,definition,slot?.branchId));
  else{const title=document.createElement('strong');title.textContent=detail.name;tooltip.append(title);}
  element.append(keyLabel, cooldown, tooltip);
  return element;
}
