import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindBattleSkillSlots,createPickerDragController} from '../../apps/web/skill-picker.mjs';
import {traitDisplay} from '../../packages/localization/trait-display.mjs';
import {createOpeningPoseHandoff} from '../../apps/web/opening-pose-handoff.mjs';
import {buildBuffRows,createBuffBar} from '../../apps/web/buff-bar.mjs';
import {createMatchEntry} from '../../apps/web/match-entry.mjs';
import {createSkillDescription} from '../../apps/web/skill-slot.mjs';
import {createPickerDialogController} from '../../apps/web/skill-picker-dialog.mjs';
import {createAfterimageClock,PHOENIX_AFTERIMAGE_INTERVAL_SECONDS} from '../../packages/presentation/buff-afterimage.mjs';
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this.className='';this.classList={add(){},remove(){},toggle(){}};}
 append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}
 remove(){this.parentElement?.children.splice(this.parentElement.children.indexOf(this),1);}
 getBoundingClientRect(){return {left:0,right:800,top:0,bottom:100,width:1000,height:700};}
}
function document(){const listeners=new Map(),doc={listeners,createElement:tag=>new Element(tag),body:new Element(),addEventListener:(name,f)=>listeners.set(name,f),removeEventListener:name=>listeners.delete(name),elementFromPoint:()=>doc.hit};return doc;}
test('K toggles only permitted skill pages, ignores text inputs/repeat and queues a close during preparation',()=>{
 const target=document(),button={addEventListener(){},removeEventListener(){}},picker={hidden:true};let allowed=true,preparing=false;
 const dialog=createPickerDialogController({keyboardTarget:target,picker,closeButton:button,openKey:'KeyK',canOpen:()=>allowed,isPreparing:()=>preparing,onOpen:()=>picker.hidden=false,onClose:()=>picker.hidden=true});
 const key={code:'KeyK',preventDefault(){},stopImmediatePropagation(){}};
 target.listeners.get('keydown')(key);assert.equal(picker.hidden,false);target.listeners.get('keydown')({...key,repeat:true});assert.equal(picker.hidden,false);target.listeners.get('keyup')(key);
 preparing=true;target.listeners.get('keydown')(key);assert.equal(picker.hidden,false);target.listeners.get('keyup')(key);preparing=false;dialog.preparationSettled();assert.equal(picker.hidden,true);
 allowed=false;target.listeners.get('keydown')(key);assert.equal(picker.hidden,true);
 allowed=true;target.listeners.get('keydown')({...key,target:{closest:()=>({})}});assert.equal(picker.hidden,true);dialog.destroy();
});
const profile=JSON.parse(readFileSync('packages/combat-core/rf-profile.json'));
test('reference skill hierarchy carries selected trait and true upgrade without changing source values',()=>{
 const d={id:24217,classId:111,type:6,maxLevel:1,branches:profile.skillCatalog.find(s=>s.skillId===24217).branches};
 const children=createSkillDescription(document(),d,'memo-12'),header=children[0];
 assert.match(header.children[1].textContent,/Haste \[Enhanced\] Shadow Step/);
 assert.equal(header.children[2].children[1].textContent,'MP cost 20');
 assert.ok(children.some(e=>e.className.includes('true')));
 const trait=children.find(e=>e.className.endsWith('trait'));assert.match(trait.children[1].textContent,/Cooldown.*70%/);
});
test('traits distinguish duration enhancement from negative status and preserve signed knockdown / cooldown',()=>{
 assert.equal(traitDisplay({memoTypeName:'MI_CHECK_AND_KILL_1',parameters:[1.3]}).description,'Effect duration becomes 130% of its base value.');
 assert.match(traitDisplay({memoTypeName:'MI_HEAVY',parameters:[1.4,1.5]}).description,/Damage becomes 140%.*Cooldown becomes 150%/);
 assert.match(traitDisplay({memoTypeName:'MI_PERSISTENT',parameters:[-7.5]}).description,/knockdown per hit by -7.5/);
});
test('real HUD unequip/drop guards remain live after matching locks configuration',()=>{
 const doc=document(),elements=Array.from({length:8},()=>new Element()),loadout=[{skillId:24217},...Array(7).fill(null)],edits=[];
 let unlocked=true;bindBattleSkillSlots(doc,{elements,loadout,editable:()=>unlocked,onEdit:op=>edits.push(op)});
 const event={preventDefault(){},stopPropagation(){},pointerId:1,button:0,isPrimary:true,target:elements[0],clientX:0,clientY:0};
 elements[0].oncontextmenu(event);assert.deepEqual(edits,[{type:'remove',target:0}]);
 doc.listeners.get('pointerdown')(event);doc.hit=elements[7];doc.listeners.get('pointermove')({...event,clientX:60});
 unlocked=false;doc.listeners.get('pointerup')({...event,clientX:60});elements[0].oncontextmenu(event);assert.equal(edits.length,1);
 createPickerDragController(doc).destroy();
});
test('opening pose remains at its ending frame and blends to live stance once',()=>{
 const handoff=createOpeningPoseHandoff(),presentation={animationName:'Start',duration:2};
 assert.deepEqual(handoff.sample({phase:'intro',presentation,time:2,dt:.016}),{override:true,transition:null});
 const first=handoff.sample({phase:'fight',time:0,dt:.016});assert.equal(first.transition.fromTime,2);assert.equal(first.transition.fromSpeed,0);
 for(let i=0;i<20;i++)handoff.sample({phase:'fight',dt:.016});assert.equal(handoff.sample({phase:'fight'}).override,false);
});
test('awakening appears separately while source-hidden buffs stay hidden, with custom two-line hover',()=>{
 const doc=document(),host=new Element();host.ownerDocument=doc;
 const actor={professionId:'RF',awakening:{remaining:21},buffs:[{templateId:544,behaviors:[],finalizers:[{kind:'time',remaining:10}]}]};
 const rows=buildBuffRows(actor,{profile});assert.deepEqual(rows.map(r=>r.id),['awakening']);assert.match(rows[0].description,/20%/);
 const bar=createBuffBar({host,profile});bar.update(actor,{mode:'practice'});const node=bar.element.children[0].children[0];
 node.onmouseenter();const tooltip=host.children[1];assert.equal(tooltip.children.length,2);assert.equal(tooltip.children[0].textContent,'Awakening');
 actor.awakening.remaining=0;bar.update(actor,{mode:'practice'});assert.equal(tooltip.hidden,true);bar.destroy();
});
test('loading rows show four actual portraits and independent peer percentage, no fabricated advancement',()=>{
 const doc=document(),host=new Element();host.ownerDocument=doc;const entry=createMatchEntry({host});
 const match={id:'m',mode:'2v2',players:['a','b','c','d'].map((id,i)=>({id,username:id,professionId:'RF',team:i<2?0:1}))};
 entry.begin(match,{playerId:'a'});entry.progress(match,'a',85);
 const poster=entry.root.children[0],top=poster.children[0],bottom=poster.children[2];
 assert.equal(top.children[0].children[2].textContent,'85%');assert.equal(top.children[1].children[2].textContent,'0%');
 assert.equal(bottom.children[0].children[2].textContent,'0%');assert.equal(entry.admit(match,'intro'),false);
 assert.equal(top.children[0].children[0].src,'/assets/ui/loading/raven-avatar.png');
 for(const professionId of ['LK','IS','RS','RF','BM','VC']){
  match.players[0].professionId=professionId;entry.players(match);
  assert.equal(top.children[0].children[0].src,`/assets/ui/loading/${['LK','IS','RS'].includes(professionId)?'elsword':'raven'}-avatar.png`);
 }
 entry.prepared(match);assert.equal(entry.admit(match,'intro'),true);
});
test('Phoenix red silhouettes capture at 0.1 second cadence and retain bounded original fading',()=>{
 assert.equal(PHOENIX_AFTERIMAGE_INTERVAL_SECONDS,.1);const clock=createAfterimageClock(10);
 assert.equal(clock.step(.001,true).capture,0);assert.equal(clock.step(.09,true).capture,null);assert.equal(clock.step(.011,true).capture,1);
});
