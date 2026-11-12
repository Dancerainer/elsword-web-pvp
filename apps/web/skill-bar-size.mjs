export const SKILL_BAR_SIZE_KEY='elsword-skill-bar-size-v1';
export function skillBarScale(percent){
  const value=Number(percent);
  return 1.7*(.65+.35*Math.min(100,Math.max(0,Number.isFinite(value)?value:100))/100);
}
/** A display preference, available during play without changing the loadout. */
export function createSkillBarSizeControl({document,host,before,bar,storage,onFocus=()=>{}}){
  let saved;try{saved=storage?.getItem(SKILL_BAR_SIZE_KEY);}catch{}
  const percent=saved!==null&&saved!==undefined&&saved.trim()!==''&&Number.isFinite(Number(saved))?
    Math.min(100,Math.max(0,Math.round(Number(saved)))):100;
  const label=document.createElement('label');label.className='skill-bar-size-control';
  const input=document.createElement('input');input.type='range';input.min='0';input.max='100';input.step='1';input.value=String(percent);
  input.id='skill-bar-size';input.setAttribute('aria-label','Skill bar size');
  const value=document.createElement('output');value.htmlFor=input.id;
  label.append('Skill bar ',input,value);host.insertBefore(label,before);
  const apply=()=>{const p=Math.round(Number(input.value));bar.style.setProperty('--skill-hud-scale',String(skillBarScale(p)));value.textContent=p+'%';};
  apply();input.addEventListener('input',()=>{apply();try{storage?.setItem(SKILL_BAR_SIZE_KEY,input.value);}catch{}});
  input.addEventListener('focus',onFocus);
  for(const type of ['keydown','keyup'])input.addEventListener(type,event=>event.stopPropagation());
  return {input,value};
}
