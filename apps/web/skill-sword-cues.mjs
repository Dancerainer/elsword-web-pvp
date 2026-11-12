import {isElswordProfession,isElesisProfession} from '../../packages/professions/identity.mjs';
import {assetUrl} from './asset-urls.mjs';
import {createSwordHudFlicker} from './way-of-sword-hud.mjs';

/** Target2016 m_usWOSType + fixed-V5 UpdateElswordSkillSlotEffect. */
export function skillSwordCueState(actor,skill){
  if(!isElswordProfession(actor?.professionId)&&!isElesisProfession(actor?.professionId))return null;
  const type=(skill?.raw??skill?.template)?.m_usWOSType,state=actor?.wayOfSword?.state;
  return state===2&&type===2?'blue':state===-2&&type===1?'red':null;
}

export function createSkillSwordCues({document,index,getSlots,getSkill}){
  for(const side of ['blue','red']){
    const r=index.resources?.[side];
    if(!r?.file||!r.slotSize?.every(n=>Number.isFinite(n)&&n>0)||!r.displaySize?.every(Number.isFinite)||!r.offset?.every(Number.isFinite))
      throw new TypeError('Original sword skill-slot resource missing');
  }
  const slots=new Map();
  function update(actor){
    const current=new Set(getSlots());
    for(const [slot,row]of slots)if(!current.has(slot)){row.image.remove();slots.delete(slot);}
    for(const slot of current){
      let row=slots.get(slot);
      if(!row){const image=document.createElement('img');image.className='skill-sword-cue';image.alt='';image.draggable=false;image.hidden=true;
        image.setAttribute('aria-hidden','true');slot.append(image);row={image,side:null,identity:null,flicker:createSwordHudFlicker()};slots.set(slot,row);}
      const side=skillSwordCueState(actor,getSkill(Number(slot.dataset.skill))),identity=actor?.id+':'+slot.dataset.skill;
      const changed=side!==row.side||identity!==row.identity;
      if(changed)row.flicker.reset();
      row.identity=identity;row.side=side;row.image.hidden=side===null;
      slot.dataset.swordMode=side??'';
      if(side&&changed){const r=index.resources[side];row.image.src=assetUrl('/assets/ui/skill-sword/'+r.file);
        row.image.style.cssText=`left:${r.offset[0]}px;top:${r.offset[1]}px;width:${r.displaySize[0]}px;height:${r.displaySize[1]}px;`;
        row.image.dataset.mode=side;}
    }
  }
  // CPictureData::FrameMove overwrites color.a; it does not multiply the
  // declared .7 alpha by the flicker (.1..1).
  return {update,render(dt){for(const row of slots.values())if(row.side){
      row.image.style.opacity=String(Math.max(0,Math.min(1,row.flicker.step(dt))));}},
    proof(){return [...slots].filter(([,r])=>r.side).map(([e,r])=>({key:e.dataset.key,skillId:Number(e.dataset.skill),side:r.side}));},
    dispose(){for(const row of slots.values())row.image.remove();slots.clear();}};
}
