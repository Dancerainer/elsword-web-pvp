import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {highestTree,treeGroups,createSkillTree,createPickerSlots,createBranchButtons,createSkillDetail,createPickerTooltip,traitLabel,editPickerLoadout,readPickerDrag,PICKER_DRAG_TYPE,createPickerDragController,disposePickerDrag,cancelPickerDrag} from '../../apps/web/skill-picker.mjs';
import {createSkillSlot} from '../../apps/web/skill-slot.mjs';
import {skillSlotPosition,quickEquipTarget,readPickerBranches,choosePickerBranch,applyPickerBranches} from '../../apps/web/skill-picker-state.mjs';

class Element {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.style={};this.className='';this.classList={add:name=>{if(!this.className.split(' ').includes(name))this.className+=' '+name;},remove:name=>{this.className=this.className.split(' ').filter(n=>n!==name).join(' ');}};}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  setAttribute(name,value){this.attributes[name]=value;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
  setPointerCapture(id){this.captured=id;}
  releasePointerCapture(){this.captured=null;}
}
const document={createElement:tag=>new Element(tag)};
const definition=(id,row,column,extra={})=>({id,name:'Example '+id,icon:'icons/'+id+'.png',type:6,maxLevel:1,treeNode:{m_iRowIndex:row,m_iColumnIndex:column},template:{m_eActiveSkillUseCondtion:1},...extra});
const keys=['A','S','D','C','Q','W','E','R'];
const blank=()=>Array(8).fill(null);
const byClass=(parent,name)=>parent.children.find(c=>c.className.split(' ').includes(name));
const transfer=()=>{const values=new Map();return {get types(){return [...values.keys()];},setData:(k,v)=>values.set(k,v),getData:k=>values.get(k)??''};};
const eventFor=dataTransfer=>({dataTransfer,prevented:false,preventDefault(){this.prevented=true;},stopPropagation(){}});

test('pointer drag uses one cleanable controller, ignores click-size movement, suppresses native image drag and cancels safely',()=>{
  const listeners=new Map(),doc={createElement:document.createElement,body:new Element('body'),hit:null,
    addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name),elementFromPoint(){return this.hit;}};
  const controller=createPickerDragController(doc);assert.equal(createPickerDragController(doc),controller);assert.equal(listeners.size,6);
  const dropped=[],slots=createPickerSlots(doc,{keys,loadout:blank(),definitions:[definition(10,0,0)],selectedSlot:0,onSelect:()=>{},onDrop:(payload,index)=>dropped.push([payload,index])});
  const rows=createSkillTree(doc,{definitions:[definition(10,0,0)],supportFor:()=>({supported:true}),loadout:blank(),onEquip:()=>{},onInspect:()=>{}});
  const card=byClass(byClass(rows[0],'skill-tree-nodes').children[0],'skill-card'),image=card.children[0];
  assert.equal(card.draggable,false);assert.equal(image.draggable,false);assert.equal(card.style.touchAction,'none');
  const event=(target,x,y,extra={})=>({...eventFor(),target,clientX:x,clientY:y,pointerId:1,button:0,isPrimary:true,stopImmediatePropagation(){this.stopped=true;},...extra});
  listeners.get('pointerdown')(event(image,10,10));listeners.get('pointermove')(event(image,12,12));listeners.get('pointerup')(event(image,12,12));assert.equal(dropped.length,0);
  const ordinaryClick=event(image,12,12);listeners.get('click')(ordinaryClick);assert.equal(ordinaryClick.prevented,false);
  doc.hit=slots[7].children[0];listeners.get('pointerdown')(event(image,10,10));assert.equal(card.captured,1);
  listeners.get('pointermove')(event(image,100,100));assert.equal(doc.body.children.length,1);
  const native=event(image,10,10);listeners.get('dragstart')(native);assert.equal(native.prevented,true,'image-native drag cannot interrupt pointer capture');
  listeners.get('pointerup')(event(image,100,100));assert.deepEqual(dropped,[[{kind:'skill',skillId:10},7]]);assert.equal(card.captured,null);assert.equal(doc.body.children.length,0);
  const accidentalClick=event(image,100,100);listeners.get('click')(accidentalClick);assert.equal(accidentalClick.prevented,true);assert.equal(accidentalClick.stopped,true);
  listeners.get('pointerdown')(event(image,10,10));listeners.get('pointermove')(event(image,100,100));listeners.get('pointercancel')(event(image,100,100));assert.equal(dropped.length,1);assert.equal(doc.body.children.length,0);
  listeners.get('pointerdown')(event(image,10,10));listeners.get('pointermove')(event(image,100,100));cancelPickerDrag(doc);
  assert.equal(doc.body.children.length,0);assert.equal(card.captured,null);listeners.get('pointerup')(event(image,100,100));assert.equal(dropped.length,1,'dialog close cancels an in-flight drag without equipment');
  createPickerSlots(doc,{keys,loadout:blank(),definitions:[],selectedSlot:0,onSelect:()=>{},onDrop:()=>{}});assert.equal(listeners.size,6,'rebuilding only replaces target references');
  disposePickerDrag(doc);assert.equal(listeners.size,0);
});

 test('literal tree locations reject collisions; groups use original unlock levels instead of invented row formula',()=>{
  const high=definition(2,2,1,{template:{m_RequireCharacterLevel:{'1':73}}});
  const base=definition(1,2,1,{replacedAtMax:true,maxUpgradeId:2,template:{m_RequireCharacterLevel:{'1':10}}});
  const other=definition(3,0,2);
  assert.deepEqual(highestTree([high,base,other]).map(n=>[n.definition.id,n.row,n.column]),[[3,0,2],[2,2,1]]);
  assert.deepEqual(treeGroups([high,base,other]).map(g=>[g.row,g.level]),[[0,null],[2,10]]);
  assert.throws(()=>highestTree([high,definition(4,2,1)]),/Duplicate/);
  assert.throws(()=>highestTree([{...high,treeNode:null}]),/has no confirmed/);
  assert.throws(()=>highestTree([definition(4,0,5)]),/has no confirmed/);
});

 test('compact tree keeps passive and unsupported nodes inspectable without allowing equipment or dragging',()=>{
  const granted=definition(24400,2,3,{type:1,template:{m_eActiveSkillUseCondtion:0}}),actions=[],inspect=[];
  const rows=createSkillTree(document,{definitions:[definition(10,0,0),definition(11,0,1),granted],
    supportFor:id=>({supported:id===10}),loadout:[{skillId:10}],applied:[24400],selectedSkillId:10,
    onEquip:id=>actions.push(id),onInspect:(id,anchor)=>{assert.ok(anchor);inspect.push(id);}});
  assert.equal(rows.length,2,'empty source rows are omitted in the simplified view');
  assert.deepEqual(rows.map(r=>r.dataset.row),['0','2']);
  const items=byClass(rows[0],'skill-tree-nodes'),first=items.children[0],active=byClass(first,'skill-card');
  assert.equal(active.disabled,false);assert.equal(active.onclick,undefined);
  const rightClick=eventFor();active.oncontextmenu(rightClick);assert.equal(rightClick.prevented,true);assert.deepEqual(actions,[10]);
  assert.equal(byClass(first,'equipped-marker').textContent,'Equipped');
  const blocked=byClass(items.children[1],'skill-card');
  assert.equal(blocked.disabled,true);assert.equal(blocked.onclick,undefined);assert.equal(blocked.ondragstart,undefined);
  items.children[1].onmouseenter();assert.deepEqual(inspect,[11]);
  items.children[1].onfocus();assert.deepEqual(inspect,[11,11]);
  const passiveNode=byClass(rows[1],'skill-tree-nodes').children[0],card=byClass(passiveNode,'passive-card');
  assert.equal(card.tagName,'DIV');assert.equal(card.onclick,undefined);assert.equal(card.ondragstart,undefined);
  assert.ok(card.attributes['aria-label'].includes('Active by default'));assert.ok(card.attributes['aria-label'].includes('Cannot equip'));
});

test('PvP-disabled skill keeps its original inspectable node and rejects click or drag equipment',()=>{
  const skill=definition(900,0,0),support=()=>({supported:false,pvpDisabled:true,disabledReason:'Unavailable in PvPHeavenly Love'}),inspect=[];
  const rows=createSkillTree(document,{definitions:[skill],supportFor:support,loadout:blank(),onEquip:()=>assert.fail('banned'),onInspect:id=>inspect.push(id)});
  const node=byClass(rows[0],'skill-tree-nodes').children[0],card=byClass(node,'skill-card');
  assert.equal(node.dataset.pvpDisabled,'true');assert.equal(card.disabled,true);
  assert.equal(card.onclick,undefined);assert.equal(card.ondragstart,undefined);
  assert.equal(byClass(node,'pvp-disabled-marker').textContent,'Disabled in PvP');
  node.onmouseenter();assert.deepEqual(inspect,[900]);
  assert.throws(()=>editPickerLoadout(blank(),{type:'equip',skillId:900,target:0},[skill],support),/Unavailable in PvPHeavenly Love/);
});

 test('both selectable traits remain operable independently of internal verification flags',()=>{
  const choices=[],branches=[{id:'memo-11',memoTypeName:'MI_MAXIMIZE',supported:true},{id:'memo-17',memoTypeName:'MI_CRITICAL',supported:false,selectable:true}];
  const [left,right]=createBranchButtons(document,{branches,selected:'memo-11',onChoose:id=>choices.push(id)});
  assert.equal(left.attributes['aria-pressed'],'true');assert.equal(right.attributes['aria-pressed'],'false');
  assert.equal(left.disabled,false);assert.equal(right.disabled,false);left.onclick();right.onclick();assert.deepEqual(choices,['memo-11','memo-17']);
  assert.equal(right.children[2].textContent,'Click to select');
  assert.ok(left.children[0].src.endsWith('memo_select.png'));assert.ok(right.children[0].src.endsWith('memo_open.png'));
  const notEquipped=createBranchButtons(document,{branches:[branches[0]],enabled:false,onChoose:()=>assert.fail('not equipped')})[0];
  assert.equal(notEquipped.disabled,true);assert.equal(notEquipped.children[2].textContent,'Unavailable');
  const unknown=createBranchButtons(document,{branches:[{id:'unknown',memoTypeName:'MI_UNKNOWN'}],onChoose:()=>assert.fail('unknown')})[0];
  assert.equal(unknown.onclick,undefined);assert.equal(traitLabel({memoTypeName:'MI_UNKNOWN'}),'Unverified trait');
  assert.equal(branches[0].memoTypeName,'MI_MAXIMIZE');
});

test('unequipped traits survive validation/equipment/slot swaps without changing combat slot indices',()=>{
  const skill=definition(10,0,0,{branches:[{id:'memo-11',selectable:true},{id:'memo-17',selectable:true}]}),second=definition(11,0,1,{branches:[]});
  const choices=choosePickerBranch({},skill,'memo-17');assert.deepEqual(choices,{10:'memo-17'});
  const saved=readPickerBranches(JSON.stringify({...choices,11:'forged',999:'memo-11'}),[skill,second]);assert.deepEqual(saved,choices);
  for(const broken of ['{bad','[]','null','"string"'])assert.deepEqual(readPickerBranches(broken,[skill]),{});
  assert.throws(()=>choosePickerBranch(choices,skill,'unknown'),/Invalid/);
  assert.throws(()=>choosePickerBranch({},definition(12,1,3,{type:8}),'none'),/Passive/);
  const equipped=editPickerLoadout(blank(),{type:'equip',skillId:10,branchId:saved[10],target:4},[skill],()=>({supported:true}));
  assert.deepEqual(equipped[4],{skillId:10,branchId:'memo-17'});
  const swapped=editPickerLoadout(equipped,{type:'swap',source:4,target:0},[skill],()=>({supported:true}));
  assert.equal(swapped[0].branchId,'memo-17');assert.equal(equipped[4].branchId,'memo-17');
  const cancelled=applyPickerBranches(swapped,choosePickerBranch(saved,skill,'none'),[skill]);assert.equal(cancelled[0].branchId,'none');
  assert.equal(swapped[0].branchId,'memo-17','configuration is transactional');
  assert.deepEqual(['Q','W','E','R','A','S','D','C'].map(skillSlotPosition),[
    {row:1,column:1,defaultRow:false},{row:1,column:2,defaultRow:false},{row:1,column:3,defaultRow:false},{row:1,column:4,defaultRow:false},
    {row:2,column:1,defaultRow:true},{row:2,column:2,defaultRow:true},{row:2,column:3,defaultRow:true},{row:2,column:4,defaultRow:true}]);
  assert.throws(()=>skillSlotPosition('Z'),/Unknown/);
  const nodes=createSkillTree(document,{definitions:[skill],supportFor:()=>({supported:true,branches:skill.branches}),loadout:blank(),branchChoices:choices,
    onChooseBranch:(id,key)=>{assert.equal(id,10);assert.equal(key,'none');},onInspect:()=>{},onEquip:()=>{}});
  const controls=byClass(byClass(nodes[0],'skill-tree-nodes').children[0],'skill-node-traits');
  assert.equal(controls.children[1].attributes['aria-pressed'],'true');controls.children[1].onclick(eventFor());
  assert.equal(controls.children[0].children[0].src,'/assets/ui/skill-picker/memo_open.png');
  assert.equal(controls.children[1].children[0].src,'/assets/ui/skill-picker/memo_select.png');
  assert.equal(controls.children[1].textContent,undefined,'no fabricated arrow duplicates the client icon');
});

test('hover descriptions escape the scrolling tree, flip near edges and clear old focus associations',()=>{
  const doc={createElement(tag){const element=new Element(tag);element.offsetWidth=300;element.offsetHeight=220;
    element.replaceChildren=(...children)=>{element.children=[];element.append(...children);};return element;}};
  const root=new Element('section');root.getBoundingClientRect=()=>({left:100,top:50,width:800,height:500});
  const anchor=new Element('button');anchor.getBoundingClientRect=()=>({left:800,right:850,top:500});
  anchor.removeAttribute=name=>delete anchor.attributes[name];
  const tooltip=createPickerTooltip(doc,root),panel=root.children[0];
  assert.equal(panel.hidden,true);assert.equal(panel.attributes.role,'tooltip');
  tooltip.skill(definition(10,0,0),anchor);assert.equal(panel.hidden,false);
  assert.equal(panel.style.left,'392px','right edge flips tooltip to the icon left');
  assert.equal(panel.style.top,'272px','bottom edge clamps tooltip inside dialog');
  tooltip.trait({id:'memo-18'},anchor);
  assert.equal(panel.children[1].textContent,'MP cost becomes 70% of its base value.');
  tooltip.hide({relatedTarget:panel});assert.equal(panel.hidden,false,'pointer can enter and scroll a long description');
  tooltip.hide();assert.equal(panel.hidden,true);assert.equal(anchor.attributes['aria-describedby'],undefined);
});

 test('eight bottom cells unload on right-click with no left-select action or remove-X button',()=>{
  const chosen=[],removed=[],loadout=blank();loadout[0]={skillId:10,branchId:'memo-11'};
  const slots=createPickerSlots(document,{keys,loadout,definitions:[definition(10,0,0)],selectedSlot:0,onSelect:i=>chosen.push(i),onRemove:i=>removed.push(i)});
  assert.equal(slots.length,8);const select=byClass(slots[0],'picker-slot-select');
  assert.ok(select.attributes['aria-label'].includes('Example 10'));assert.equal(select.attributes['aria-pressed'],'true');
  const empty=byClass(slots[7],'picker-slot-select');assert.equal(empty.onclick,undefined);
  const emptyRightClick=eventFor();empty.oncontextmenu(emptyRightClick);assert.equal(emptyRightClick.prevented,true);assert.deepEqual(chosen,[]);assert.deepEqual(removed,[]);assert.equal(slots[7].dataset.key,'R');
  assert.equal(byClass(slots[7],'picker-slot-remove'),undefined);
  assert.equal(byClass(slots[0],'picker-slot-remove'),undefined);assert.equal(select.onclick,undefined);
  const removeRightClick=eventFor();select.oncontextmenu(removeRightClick);assert.equal(removeRightClick.prevented,true);
  select.onkeydown({...eventFor(),key:'Delete'});assert.deepEqual(removed,[0,0]);
  assert.equal(select.children.some(c=>c.tagName==='BUTTON'),false,'remove button must not be nested in select button');
});

test('right-click quick equip fills ASDC before QWER without moving an already equipped skill or overwriting a full bar',()=>{
  const loadout=blank();loadout[0]={skillId:10,branchId:'memo-11'};loadout[3]={skillId:11};
  assert.equal(quickEquipTarget(loadout,12),1);
  loadout[1]={skillId:12};loadout[2]={skillId:13};assert.equal(quickEquipTarget(loadout,14),4);
  const before=structuredClone(loadout);assert.throws(()=>quickEquipTarget(loadout,10),/already equipped/);assert.deepEqual(loadout,before);
  assert.throws(()=>quickEquipTarget(Array.from({length:8},(_,i)=>({skillId:i+10})),99),/full/);
  assert.throws(()=>quickEquipTarget([],10),/eight/);
});

 test('native drag payloads distinguish catalog assignment from full-slot movement; unrelated/forged input is ignored',()=>{
  const data=transfer(),loadout=blank(),drops=[];loadout[0]={skillId:10,branchId:'memo-11'};
  const rows=createSkillTree(document,{definitions:[definition(10,0,0)],supportFor:()=>({supported:true}),loadout,onEquip:()=>{},onInspect:()=>{}});
  const card=byClass(byClass(rows[0],'skill-tree-nodes').children[0],'skill-card');card.ondragstart(eventFor(data));
  assert.deepEqual(readPickerDrag(eventFor(data)),{kind:'skill',skillId:10});
  const slots=createPickerSlots(document,{keys,loadout,definitions:[definition(10,0,0)],selectedSlot:0,onSelect:()=>{},onDrop:(p,i)=>drops.push([p,i])});
  slots[0].ondragstart(eventFor(data));assert.deepEqual(readPickerDrag(eventFor(data)),{kind:'slot',skillId:10,sourceSlot:0});
  const over=eventFor(data);slots[7].ondragover(over);assert.equal(over.prevented,true);assert.ok(slots[7].className.includes('drop-target'));
  slots[7].ondrop(eventFor(data));assert.deepEqual(drops,[[{kind:'slot',skillId:10,sourceSlot:0},7]]);assert.ok(!slots[7].className.includes('drop-target'));
  const external=transfer();external.setData('text/plain','10');slots[7].ondrop(eventFor(external));assert.equal(drops.length,1);
  for(const raw of ['{broken',JSON.stringify({schema:'elsword.rf-picker.v1',kind:'slot',sourceSlot:8,skillId:10}),JSON.stringify({schema:'other',kind:'skill',skillId:10}),'x'.repeat(1025)]){data.setData(PICKER_DRAG_TYPE,raw);assert.equal(readPickerDrag(eventFor(data)),null);}
});

 test('equipment edits are atomic eight-slot copies and swaps preserve branch choices without duplicate skills',()=>{
  const definitions=[definition(10,0,0),definition(11,0,1),definition(12,0,2),definition(13,0,3,{type:1}),definition(14,0,4,{replacedAtMax:true})];
  const supportFor=id=>({supported:id!==12}),loadout=blank();loadout[0]={skillId:10,branchId:'left'};loadout[7]={skillId:11,branchId:'right'};
  const swapped=editPickerLoadout(loadout,{type:'swap',source:0,target:7},definitions,supportFor);
  assert.deepEqual(swapped[0],loadout[7]);assert.deepEqual(swapped[7],loadout[0]);assert.equal(loadout[0].skillId,10);
  assert.notEqual(swapped[0],loadout[7]);
  const clicked=editPickerLoadout(loadout,{type:'equip',skillId:10,target:7},definitions,supportFor);assert.deepEqual(clicked,swapped);
  const moved=editPickerLoadout(loadout,{type:'swap',source:0,target:3},definitions,supportFor);assert.equal(moved[0],null);assert.deepEqual(moved[3],loadout[0]);
  assert.equal(editPickerLoadout(loadout,{type:'remove',target:7},definitions,supportFor)[7],null);
  assert.deepEqual(editPickerLoadout(blank(),{type:'equip',skillId:10,target:2},definitions,supportFor)[2],{skillId:10,branchId:'none'});
  for(const id of [12,13,14,999])assert.throws(()=>editPickerLoadout(loadout,{type:'equip',skillId:id,target:2},definitions,supportFor));
  assert.throws(()=>editPickerLoadout(loadout,{type:'swap',source:8,target:0},definitions,supportFor));
  assert.throws(()=>editPickerLoadout(loadout,{type:'swap',source:0,target:1,skillId:11},definitions,supportFor),/Drag again/);
  assert.throws(()=>editPickerLoadout(loadout,{type:'swap',source:1,target:0},definitions,supportFor),/Drag again/);
  assert.throws(()=>editPickerLoadout(loadout.slice(1),{type:'remove',target:0},definitions,supportFor));
});

 test('configuration work does not add mouse activation to battle skill slots; displayed numbers stay original',()=>{
  const d=definition(10,0,0,{maxLevel:2,template:{m_MPConsumption:{'2':120},m_SkillCoolTime:{'2':7.5}}});
  const slot=createSkillSlot(document,{key:'A',slot:{skillId:10},definition:d});assert.equal(slot.onclick,undefined);assert.equal(slot.ondragstart,undefined);
  const detail=createSkillDetail(document,{definition:d});assert.deepEqual(detail[0].children[2].children.slice(1).map(node=>node.textContent),['MP cost 120','Cooldown 7.5s']);
});

const catalogPath=new URL('../../artifacts/ui/skills/catalog.json',import.meta.url);
 test('actual 2016 RF highest tree preserves 26 nodes/six passives and uses original base levels',{skip:!existsSync(catalogPath)},()=>{
  const catalog=JSON.parse(readFileSync(catalogPath,'utf8')),nodes=highestTree(catalog.skills),groups=treeGroups(catalog.skills);
  assert.equal(nodes.length,26);assert.equal(nodes.filter(n=>n.passive).length,6);assert.equal(groups.length,14);
  assert.deepEqual(groups.map(g=>g.level),[1,5,10,15,20,25,30,35,40,45,50,55,60,65]);
  const charged=nodes.find(n=>n.definition.id===24032);assert.deepEqual([charged.row,charged.column],[5,1]);
});
