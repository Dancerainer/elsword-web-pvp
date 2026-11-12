import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { createSkillSlot,skillDetails,cooldownText,updateSkillSlotAvailability } from '../../apps/web/skill-slot.mjs';
import { opponentGauges, manaBreakGauge, awakeningCountdown } from '../../apps/web/hud-values.mjs';
import {createPassiveCatalog} from '../../apps/web/passive-catalog.mjs';

// A bounded DOM surface for the authoring module. Real CSS hover is checked in
// the browser separately; this verifies icon construction has no activation API.
class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.classList={
    add:name=>this.className+=' '+name,
    toggle:(name,on)=>{const classes=new Set(this.className.split(' '));if(on)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}};}
  append(...children){this.children.push(...children);}
  setAttribute(name,value){this.attributes[name]=value;}
  dispatchEvent(event){return this['on'+event.type]?.(event);}
  querySelector(selector){return this.children.find(child=>child.className===selector.slice(1));}
}
const document={createElement:tag=>new Element(tag)};
const definition={id:42,name:'#Cffcc00[Enhanced]#CX Example',icon:'42.png',maxLevel:2,template:{
  m_MPConsumption:{1:10,2:30},m_SkillCoolTime:{1:9,2:4},m_EffectiveDesc:{1:'wrong-level',2:'confirmed <x> damage'},
  m_wstrMainDesc:'Exact #Cffcc00source#CX\nsecond line'},branches:[]};

test('passive catalog cannot equip or activate a passive and reflects actual actor grants',()=>{
  const passive={...definition,id:24400,template:{...definition.template,m_eActiveSkillUseCondtion:0}};
  const replaced={...passive,id:24401,replacedAtMax:true};
  const active={...definition,template:{...definition.template,m_eActiveSkillUseCondtion:1}};
  const [card]=createPassiveCatalog(document,{definitions:[active,replaced,passive],applied:[{skillId:24400}]});
  assert.ok(card.attributes['aria-label'].includes('Active by default'));
  assert.ok(card.attributes['aria-label'].includes('Cannot equip'));
  assert.equal(card.tagName,'DIV');assert.equal(card.onclick,undefined);assert.equal(card.onkeydown,undefined);
  assert.equal(card.dispatchEvent({type:'click'}),undefined);
  const pending=createPassiveCatalog(document,{definitions:[passive],applied:[]})[0];
  assert.ok(pending.attributes['aria-label'].includes('Unverified'));
});

test('skill hover details select only the given maximum level and original declaration text',()=>{
  const details=skillDetails(definition,'C','unknown');
  assert.equal(details.name,'[Enhanced] Example');
  assert.deepEqual(details.lines,['Max level 2','MP 30','Cooldown 4 s','Exact source\nsecond line','confirmed <x> damage']);
  assert.deepEqual(skillDetails(null,'E').lines,[]);
  const sparse=skillDetails({...definition,template:{}},'C');
  assert.deepEqual(sparse.lines,['Max level 2'],'unknown source fields are not replaced with simulated descriptions');
});

test('DOM skill icon is informational and cannot dispatch a mouse or button-key activation',()=>{
  const before=JSON.stringify(definition);
  const slot=createSkillSlot(document,{key:'C',slot:{skillId:42,branchId:'none'},definition});
  assert.equal(slot.tagName,'DIV');assert.equal(slot.attributes.role,'img');
  assert.equal(slot.onclick,undefined);assert.equal(slot.onkeydown,undefined);
  assert.equal(slot.dispatchEvent({type:'click'}),undefined);
  assert.equal(slot.dispatchEvent({type:'keydown',key:'Enter'}),undefined);
  const tooltip=slot.children.find(child=>child.attributes.role==='tooltip');
  assert.equal(slot.attributes['aria-describedby'],tooltip.id);
  const values=tooltip.children.find(child=>child.className.split(' ').includes('skill-description-values'));
  assert.ok(values,'v26 unified tooltip retains an explicit numerical-effect block');
  assert.equal(values.children.at(-1).textContent,'confirmed <x> damage','source text remains a literal text node inside the new hierarchy');
  const nodes=[tooltip];for(let index=0;index<nodes.length;index++)nodes.push(...nodes[index].children);
  assert.ok(nodes.every(node=>node.innerHTML===undefined),'source markup is never assigned to innerHTML');
  assert.ok(nodes.every(node=>node.tagName!=='X'),'source angle brackets do not create an element');
  assert.equal(JSON.stringify(definition),before,'informational tooltip cannot mutate combat/input definitions');
  assert.equal(createSkillSlot(document,{key:'Q',slot:null,definition:null}).dataset.skill,'');
});

test('skill cooldown follows native ceil seconds including the final partial second',()=>{
  assert.deepEqual([0,-1,.01,.99,1,1.01,4.7,NaN].map(cooldownText),['','','1','1','1','2','5','']);
});

test('awakening countdown uses source truncation-plus-one integer and source red threshold',()=>{
  assert.deepEqual([0,-1,NaN,Infinity].map(awakeningCountdown),Array(4).fill({seconds:0,text:'',urgent:false}));
  assert.deepEqual([.01,6.999,7,7.99,8,89.5,90].map(awakeningCountdown),[
    {seconds:1,text:'1s',urgent:true},{seconds:7,text:'7s',urgent:true},
    {seconds:8,text:'8s',urgent:false},{seconds:8,text:'8s',urgent:false},
    {seconds:9,text:'9s',urgent:false},{seconds:90,text:'90s',urgent:false},{seconds:91,text:'91s',urgent:false}]);
});

test('green MP_ACTIVE uses the source three-charge denominator, not maximum MP or a UI timer',()=>{
  assert.deepEqual(manaBreakGauge({}),{charge:0,fraction:0,maximum:300});
  assert.deepEqual(manaBreakGauge({mp:1000,mpMax:1000,manaBreak:{charge:100,maxCharge:300}}),{charge:100,fraction:1/3,maximum:300});
  assert.equal(manaBreakGauge({manaBreak:{charge:250,maxCharge:300}}).fraction,5/6);
  assert.equal(manaBreakGauge({manaBreak:{charge:0,maxCharge:300,pendingCost:150,active:true}}).fraction,0);
});

test('unavailable icon retains tooltip and focus, returns to color, and Shadow return hides cast CD',()=>{
  const slot=createSkillSlot(document,{key:'C',slot:{skillId:42},definition});
  const tooltip=slot.children.find(child=>child.attributes.role==='tooltip');
  updateSkillSlotAvailability(slot,{available:false,reason:'insufficient-mp',mode:'cast',cooldownRemaining:0});
  assert.ok(slot.className.includes('unavailable'));assert.equal(slot.attributes['aria-disabled'],'true');
  assert.equal(slot.dataset.availability,'insufficient-mp');assert.equal(slot.attributes.tabindex,'0');
  assert.equal(slot.attributes['aria-describedby'],tooltip.id);assert.equal(slot.disabled,undefined);
  assert.equal(slot.onclick,undefined);assert.equal(slot.onkeydown,undefined);
  updateSkillSlotAvailability(slot,{available:false,reason:'cooldown',mode:'cast',cooldownRemaining:1.01});
  assert.equal(slot.querySelector('.cooldown').textContent,'2');
  updateSkillSlotAvailability(slot,{available:true,reason:null,mode:'shadow-return',cooldownRemaining:7});
  assert.ok(!slot.className.includes('unavailable'));assert.equal(slot.attributes['aria-disabled'],'false');
  assert.equal(slot.querySelector('.cooldown').textContent,'');assert.equal(slot.dataset.availabilityMode,'shadow-return');
  assert.equal(slot.children.find(child=>child.attributes.role==='tooltip'),tooltip);
});

test('air-ground eligibility rejects casting but keeps icon color and tooltip; independent MP/CD still gray',()=>{
  const slot=createSkillSlot(document,{key:'C',slot:{skillId:42},definition});
  const tooltip=slot.children.find(child=>child.attributes.role==='tooltip');
  updateSkillSlotAvailability(slot,{available:false,reason:'state-or-ground-condition',mode:'cast',
    displayUnavailable:false,displayReason:null,cooldownRemaining:0});
  assert.ok(!slot.className.includes('unavailable'));assert.equal(slot.attributes['aria-disabled'],'true');
  assert.equal(slot.dataset.displayAvailability,'normal');assert.equal(slot.children.find(child=>child.attributes.role==='tooltip'),tooltip);
  updateSkillSlotAvailability(slot,{available:false,reason:'state-or-ground-condition',mode:'cast',
    displayUnavailable:true,displayReason:'cooldown',cooldownRemaining:3});
  assert.ok(slot.className.includes('unavailable'));assert.equal(slot.dataset.displayAvailability,'cooldown');
  assert.equal(slot.querySelector('.cooldown').textContent,'3');
});

test('enemy life remains visible and MP is empty without the explicit item-derived permission',()=>{
  const target={hp:200,hpMax:1000,mp:75,mpMax:300};
  assert.deepEqual(opponentGauges({},target),{hpFraction:.2,hpText:'200 / 1000',mpFraction:0,mpText:'',showMp:false});
  assert.deepEqual(opponentGauges({uiAbilities:{showOpponentMp:true}},target),{hpFraction:.2,hpText:'200 / 1000',mpFraction:.25,mpText:'75 / 300',showMp:true});
  assert.equal(opponentGauges({uiAbilities:{showOpponentMp:'true'}},target).showMp,false);
  assert.equal(opponentGauges({}, {...target,hp:0}).hpFraction,0);
});

const catalogPath=new URL('../../artifacts/ui/skills/catalog.json',import.meta.url);
test('actual 2016 Enhanced Hell Dive hover displays its own confirmed fields, not the base node', {skip:!existsSync(catalogPath)},()=>{
  const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
  const enhanced=catalog.skills.find(s=>s.id===24219),details=skillDetails(enhanced,'C','none');
  assert.equal(details.level,1);assert.ok(details.lines.includes('MP 30'));assert.ok(details.lines.includes('Cooldown 4 s'));
  assert.ok(details.name.includes('Hell Dive'));
  assert.ok(details.lines.some(line=>line.includes('Super Armor')));
  assert.ok(details.lines.some(line=>line.includes('284%')&&line.includes('2')));
  const before=structuredClone(enhanced),slot=createSkillSlot(document,{key:'C',slot:{skillId:enhanced.id},definition:enhanced});
  assert.ok(slot.attributes['aria-label'].includes('Hell Dive'));
  assert.equal(slot.onclick,undefined);assert.deepEqual(enhanced,before,'display translation never mutates combat definitions');
});
