import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {skillSwordCueState,createSkillSwordCues} from '../../apps/web/skill-sword-cues.mjs';
const index=JSON.parse(readFileSync(new URL('../../contracts/lk-skill-sword-ui-source-v3.json',import.meta.url)));
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url)));
const actor=state=>({id:'local',professionId:'LK',wayOfSword:{state,point:state===2?4800:-4800}});
function element(){return {style:{},dataset:{},children:[],attributes:{},setAttribute(k,v){this.attributes[k]=v;},append(e){this.children.push(e);},remove(){this.removed=true;}};}
test('every LK skill uses its original WOS skill type; neutral/charging/foreign professions hide slot cues',()=>{
 for(const skill of profile.skillCatalog)for(const state of [-2,-1,0,1,2]){
  assert.equal(skillSwordCueState(actor(state),skill),state===2&&skill.raw.m_usWOSType===2?'blue':state===-2&&skill.raw.m_usWOSType===1?'red':null);
  assert.equal(skillSwordCueState({...actor(state),professionId:'RF'},skill),null);}
 assert.equal(skillSwordCueState(actor(2),null),null);
});
test('original slot pixels, offsets, alpha and flicker follow local state, loadout changes and profession switches',()=>{
 let slots=[21031,21205,21008,null].map((skill,i)=>{const e=element();e.dataset={skill:String(skill??''),key:['A','S','D','C'][i]};return e;});
 const getSkill=id=>profile.skillCatalog.find(s=>s.skillId===id),view=createSkillSwordCues({document:{createElement:element},index,getSlots:()=>slots,getSkill});
 view.update(actor(2));view.render(0);
 const first=view.proof();assert.ok(first.length>0);assert.ok(first.every(row=>getSkill(row.skillId).raw.m_usWOSType===2));
 for(const slot of slots){const image=slot.children[0];assert.equal(image.hidden,slot.dataset.swordMode==='');if(!image.hidden){
  assert.equal(image.src,'/assets/ui/skill-sword/skill-sword-blue.png');assert.match(image.style.cssText,/left:-6px;top:-5px/);assert.ok(Math.abs(Number(image.style.opacity)-.1)<1e-6);}}
 view.render(.4);for(const slot of slots)if(!slot.children[0].hidden)assert.ok(Math.abs(Number(slot.children[0].style.opacity)-1)<1e-6);
 view.update(actor(-2));view.render(0);assert.ok(view.proof().every(row=>row.side==='red'&&getSkill(row.skillId).raw.m_usWOSType===1));
 view.update(actor(-1));assert.equal(view.proof().length,0);assert.ok(slots.every(slot=>slot.children[0].hidden));
 view.update({...actor(2),professionId:'RF'});assert.equal(view.proof().length,0);
 const old=slots;slots=[element()];slots[0].dataset={skill:'21008',key:'R'};view.update(actor(2));assert.ok(old.every(slot=>slot.children[0].removed));
 assert.equal(view.proof()[0].key,'R');view.dispose();assert.ok(slots[0].children[0].removed);
});
