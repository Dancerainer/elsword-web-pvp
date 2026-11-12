import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import profile from '../../packages/combat-core/mm-profile.json' with {type:'json'};
import preset from '../../config/mm-preset.json' with {type:'json'};
import {initializeAddSystems,commitAddSkillResources,advanceAddSystems} from '../../packages/combat-core/add-systems.mjs';
import {evaluateSkillAvailability} from '../../packages/combat-core/skill-availability.mjs';
import {createSkillSlot,updateSkillSlotAvailability} from '../../apps/web/skill-slot.mjs';
import {updateAddGeneratorSkillSlot} from '../../apps/web/add-generator-skill-slot.mjs';

// Actual production skill declarations and the real slot factory; this bounded
// DOM verifies observational updates. CSS/native frame pixels need GPU review.
class Element{
 constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.dataset={};this.style={};this.className='';this.hidden=false;
  this.classList={add:name=>this.classList.toggle(name,true),toggle:(name,on)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean));if(on)names.add(name);else names.delete(name);this.className=[...names].join(' ');},contains:name=>this.className.split(/\s+/).includes(name)};}
 append(...children){this.children.push(...children);}
 setAttribute(name,value){this.attributes[name]=String(value);}
 getAttribute(name){return this.attributes[name]??null;}
 querySelector(selector){const name=selector.slice(1);for(const child of this.children){if(child.classList.contains(name))return child;const nested=child.querySelector(selector);if(nested)return nested;}return null;}
}
const document={createElement:tag=>new Element(tag,document)};
const catalog=JSON.parse(readFileSync(new URL('../../artifacts/ui/skills/mm/catalog.json',import.meta.url)));
const definition=id=>catalog.skills.find(skill=>skill.id===id);
const source=id=>profile.skillCatalog.find(skill=>skill.skillId===id);
function fixture(){
 const actor={professionId:'MM',hp:100,mp:300,mpMax:300,state:'RSI_WAIT',grounded:true,animationTime:0,
  loadout:[{skillId:29017,branchId:'none'},{skillId:29035,branchId:'none'},...Array(6).fill(null)],cooldowns:{}};
 initializeAddSystems(actor,{preset:{initialDp:6000,initialMutation:0}});
 const slots=Object.fromEntries(['A','S'].map((key,index)=>[key,createSkillSlot(document,{key,slot:actor.loadout[index],definition:definition(actor.loadout[index].skillId)})]));
 const query=(key='A',currentProfile=profile)=>evaluateSkillAvailability({actor,profile:currentProfile,preset,slot:key});
 const update=(key='A',availability=query(key))=>{updateSkillSlotAvailability(slots[key],availability);return updateAddGeneratorSkillSlot(slots[key],{actor,definition:definition(availability.skillId),availability});};
 const commit=key=>{const availability=query(key);assert.equal(availability.available,true);actor.mp-=availability.mpCost;commitAddSkillResources(actor,source(availability.skillId),availability.addResourcePlan,{profile});};
 return {actor,slots,query,update,commit};
}

test('actual MM resource transitions select, fire and switch without replacing equipped skill or original icon',()=>{
 const {actor,slots,update,commit}=fixture(),initial=structuredClone(actor.loadout),icons=Object.fromEntries(Object.entries(slots).map(([key,slot])=>[key,slot.querySelector('.icon').src]));
 assert.equal(update('A').action,'Install');assert.equal(update('S').action,'Install');
 commit('A');let fire=update('A'),other=update('S');
 assert.equal(fire.action,'Fire');assert.equal(fire.selected,true);assert.match(fire.hint,/MP 200/);
 assert.equal(other.action,'Switch');assert.equal(other.selected,false);assert.match(other.hint,/DP 30/);
 assert.ok(slots.A.classList.contains('add-generator-selected'));assert.ok(!slots.S.classList.contains('add-generator-selected'));
 commit('A');assert.equal(update('A').phase,'firing');assert.match(slots.A.getAttribute('aria-label'),/Firing/);
 commit('S');assert.equal(update('S').selected,true);assert.match(update('S').hint,/MP 100/);assert.equal(update('A').action,'Switch');
 assert.deepEqual(actor.loadout,initial);
 for(const [key,slot]of Object.entries(slots)){assert.equal(slot.dataset.skill,String(initial[key==='A'?0:1].skillId));assert.equal(slot.querySelector('.icon').src,icons[key]);assert.equal(slot.querySelector('.key').textContent,key);assert.equal(slot.onclick,undefined);
  assert.equal(slot.querySelector('.add-generator-hint').hidden,true);assert.equal(slot.querySelector('.add-generator-hint').textContent,'');
  assert.match(slot.querySelector('.add-generator-action').innerHTML,/<svg.*<path/);}
});

test('current MP and cooling gates remain authoritative while the selected frame stays visible',()=>{
 const {actor,slots,query,update,commit}=fixture();commit('A');actor.mp=199;actor.cooldowns[29017]=1.1;
 const before=structuredClone(actor),availability=query(),display=update('A',availability);
 assert.equal(availability.available,false);assert.equal(slots.A.getAttribute('aria-disabled'),'true');
 assert.equal(slots.A.querySelector('.cooldown').textContent,'2');assert.ok(slots.A.classList.contains('unavailable'));
 assert.equal(display.selected,true);assert.match(display.hint,/MP 200/);assert.match(display.hint,/Cooldown 2 s/);
 for(let i=0;i<30;i++)update('A',availability);
 assert.deepEqual(actor,before,'slot updates never spend resources or advance generator time');
 assert.equal(slots.A.children.filter(child=>child.className==='add-generator-action').length,1);
 assert.equal(slots.A.querySelector('.skill-tooltip').children.filter(child=>child.className==='add-generator-hint').length,1);
 assert.equal((slots.A.getAttribute('aria-label').match(/Dynamo Factory: /g)??[]).length,1);
});

test('expiry, death, role changes and ordinary skills remove stale selection without changing key or cooldown',()=>{
 const {actor,slots,query,update,commit}=fixture(),baseLabel=slots.A.getAttribute('aria-label');
 commit('A');update();advanceAddSystems(actor,31,{profile});assert.equal(actor.sourceAdd.generator,null);
 assert.equal(update().action,'Install');assert.ok(!slots.A.classList.contains('add-generator-selected'));
 commit('A');update();actor.hp=0;assert.equal(update(),null);assert.ok(slots.A.querySelector('.add-generator-action').hidden);assert.equal(slots.A.getAttribute('aria-label'),baseLabel);
 assert.equal(query().skillId,29017,'early death rejection retains the equipped source identity');
 actor.hp=100;actor.professionId='LP';assert.equal(update(),null);assert.ok(!slots.A.classList.contains('add-generator-slot'));
 actor.professionId='MM';update();const before=structuredClone(actor);
 assert.equal(updateAddGeneratorSkillSlot(slots.A,{actor,definition:{...definition(29017),template:{m_wstrIconTexturePieceName:'SI_SA_ADD_ENERGY_BOOM'}},availability:query()}),null);
 assert.deepEqual(actor,before);assert.equal(slots.A.dataset.key,'A');assert.equal(slots.A.dataset.skill,'29017');
 assert.ok(!('generatorMode'in slots.A.dataset));assert.ok(slots.A.querySelector('.add-generator-hint').hidden);
});

test('source unsupported and PvP forbidden skills remain rejected; overlay observation cannot enable them',()=>{
 const {actor,slots,query,update}=fixture();
 const unsupported=structuredClone(profile);unsupported.skillCatalog.find(skill=>skill.skillId===29017).supported=false;
 const blocked=query('A',unsupported),before=structuredClone(actor);
 assert.equal(blocked.reason,'unsupported-skill');assert.equal(blocked.skillId,29017);update('A',blocked);
 assert.equal(slots.A.getAttribute('aria-disabled'),'true');assert.match(slots.A.getAttribute('aria-label'),/Skill unavailable/);
 const forbidden=evaluateSkillAvailability({actor,profile,preset:{...preset,bannedSkillIds:[29017]},slot:'A'});
 assert.equal(forbidden.reason,'pvp-disabled');update('A',forbidden);
 assert.equal(slots.A.getAttribute('aria-disabled'),'true');assert.match(slots.A.getAttribute('aria-label'),/Unavailable in this match/);
 assert.deepEqual(actor,before);assert.equal(slots.A.dataset.skill,'29017');
 actor.inputLock=1;const early=query();assert.equal(early.reason,'input-blocked');assert.equal(early.skillId,29017);
 const lockedBefore=structuredClone(actor);assert.equal(update('A',early).action,'Install');
 assert.equal(slots.A.getAttribute('aria-disabled'),'true');assert.deepEqual(actor,lockedBefore);
});
