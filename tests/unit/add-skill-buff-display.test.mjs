import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addSkillResourceDetails} from '../../apps/web/add-skill-display.mjs';
import {buildBuffRows,createBuffBar} from '../../apps/web/buff-bar.mjs';
import {createSkillDescription,skillDetails} from '../../apps/web/skill-slot.mjs';
const read=path=>JSON.parse(readFileSync(new URL('../../'+path,import.meta.url)));
const catalogs=Object.fromEntries(['lp','mm','de'].map(job=>[job,read(`artifacts/ui/skills/${job}/catalog.json`)]));
const definition=(job,id)=>catalogs[job].skills.find(s=>s.id===id);
const addAssets=read('artifacts/ui/add/index.json');
class Element{
 constructor(){this.children=[];this.dataset={};this.style={};this.className='';this.classList={toggle(){}};}
 setAttribute(name,value){this[name]=value;}removeAttribute(name){delete this[name];}
 append(...items){for(const item of items){item.parent?.children.splice(item.parent.children.indexOf(item),1);item.parent=this;this.children.push(item);}}
 replaceChildren(...items){for(const item of this.children)item.parent=null;this.children=[];this.append(...items);}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
}
const document={createElement:()=>new Element()};
const host=()=>Object.assign(new Element(),{ownerDocument:document});
const flatten=node=>[node.textContent??'',...(node.children??[]).flatMap(flatten)].filter(Boolean).join('\n');

test('all original Add UI declarations have independent mode-aware display without mutation',()=>{
 for(const catalog of Object.values(catalogs))for(const d of catalog.skills){
  const before=structuredClone(d),details=addSkillResourceDetails(d);assert.ok(details);assert.equal(details.basis,'original-skill-declarations');assert.deepEqual(d,before);
  assert.equal(details.dp,(d.template.m_usFPConsumtion??0)/20);
 }
 assert.equal(addSkillResourceDetails({id:21008,classId:100}),null);
});
test('2016 raw 1200 DP shows 60 displayed DP with MP and no formation DP charge',()=>{
 const d=definition('lp',29028),r=addSkillResourceDetails(d);assert.equal(r.rawDp,1200);assert.equal(r.dp,60);
 assert.deepEqual(r.costLines,['Normal mode base cost: MP 230 + DP 60','Awakening base cost: MP 230 . No DP cost']);
 const detail=skillDetails(d,'A');assert.ok(detail.lines.includes(r.costLines[0]));assert.ok(!detail.lines.includes('MP 230'));
});
test('DE and the shared Pylon explicitly exchange MP for displayed DP at formation',()=>{
 for(const [job,id,amount] of [['de',29033,180],['de',29213,94],['lp',29204,12]]){
  const r=addSkillResourceDetails(definition(job,id));assert.deepEqual(r.costLines,[`Normal mode base cost: MP ${amount}`,`Awakening base cost: DP ${amount} (in place of MP)`]);
 }
});
test('MM installations keep their 30 DP select cost and distinct MP firing cost',()=>{
 for(const [id,mp] of [[29035,100],[29016,200],[29017,200],[29018,130]]){
  const d=definition('mm',id),r=addSkillResourceDetails(d);assert.equal(r.generator,true);assert.equal(r.dp,30);assert.equal(r.mp,undefined);
  assert.deepEqual(r.costLines,['Install or switch cost: Normal mode: DP 30. Awakening uses no DP',`Press again to fire: base MP ${mp}`]);
  const content=createSkillDescription(document,d).map(flatten).join('\n');assert.ok(content.includes(`Press again to fire: base MP ${mp}`));assert.doesNotMatch(content,/MP cost —/);
 }
});
test('passives and optional mutation enhancement prose do not gain manufactured required costs',()=>{
 const passive=catalogs.lp.skills.find(d=>[1,8].includes(d.type));assert.deepEqual(addSkillResourceDetails(passive).costLines,[]);
 const enhanced=definition('lp',29028);assert.equal(enhanced.template.SA_MUTATION_CONSUME_MAX_COUNT['1'],4);
 assert.ok(!addSkillResourceDetails(enhanced).costLines.some(s=>s.includes('Required mutation points')));
 const custom=structuredClone(enhanced);custom.template.m_usCBConsumption=2;assert.ok(addSkillResourceDetails(custom).costLines.includes('Required mutation points 2'));
});
test('three source-owned Add statuses use exact original icons without duplicate buff rows',()=>{
 const actor={professionId:'DE',awakening:{remaining:99999},sourceAdd:{formation:true},sourceTimeRing:{remaining:21.1},sourceTimeSickness:4.1,
  buffs:[320,436,673].map(templateId=>({templateId,behaviors:[],finalizers:[{kind:'time',remaining:20}]})),onlineBuffs:[{id:'wire-ring',templateId:436,remaining:20}]};
 const before=structuredClone(actor),rows=buildBuffRows(actor,{addAssets});assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.templateId),[320,436,673]);
 assert.deepEqual(rows.map(r=>r.icon),['buff_icon_hyper.png','buff_icon_crest_of_time.png','debuff_icon_crest_of_time.png']);
 assert.ok(rows.every(r=>r.originalIcon&&r.iconBase==='/assets/ui/add/'));assert.deepEqual(rows.map(r=>r.durationLabel),['','22s','5s']);assert.equal(rows[2].isDebuff,true);assert.deepEqual(actor,before);
});
test('received Time Ring also displays on non-Add actors and icon attachment never creates status',()=>{
 assert.deepEqual(buildBuffRows({professionId:'LK',buffs:[]},{addAssets}),[]);
 const rows=buildBuffRows({professionId:'LK',sourceTimeRing:{remaining:10},sourceTimeSickness:0},{addAssets});assert.equal(rows.length,1);assert.equal(rows[0].templateId,436);
 assert.equal(buildBuffRows({professionId:'DE',sourceTimeRing:{remaining:0},sourceTimeSickness:0},{addAssets}).length,0);
});
test('setAddAssets refreshes real URLs, preserves online icons and recovers from load failures',()=>{
 const bar=createBuffBar({host:host(),assets:{pieces:{'buff:Buff_Icon_PVP_Revenge':{file:'revenge.png'}}}});
 const actor={professionId:'DE',sourceTimeRing:{remaining:9},onlineBuffs:[{id:'revenge',name:'Revenge',iconKey:'Buff_Icon_PVP_Revenge',remaining:10}]};
 bar.update(actor,{mode:'practice'});let nodes=bar.element.children[0].children;assert.equal(nodes[0].children[0].hidden,true);
 bar.setAddAssets(addAssets);bar.update(actor,{mode:'practice'});nodes=bar.element.children[0].children;
 assert.equal(nodes[0].children[0].src,'/assets/ui/add/buff_icon_crest_of_time.png');assert.equal(nodes[1].children[0].src,'/assets/ui/online/revenge.png');
 nodes[0].children[0].onerror();bar.update(actor,{mode:'practice'});assert.equal(nodes[0].children[0].hidden,true);
 bar.setAddAssets(addAssets,'/assets/ui/add-v2/');bar.update(actor,{mode:'practice'});assert.equal(nodes[0].children[0].hidden,false);assert.equal(nodes[0].children[0].src,'/assets/ui/add-v2/buff_icon_crest_of_time.png');
 actor.sourceTimeRing.remaining=0;bar.update(actor,{mode:'practice'});assert.equal(bar.element.children[0].children.length,1);bar.destroy();
});
