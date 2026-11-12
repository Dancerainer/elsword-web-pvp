import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildBuffRows,buffDurationLabel,buffRemainingSeconds,createBuffBar} from '../../apps/web/buff-bar.mjs';
import {installGuildBuffs,GUILD_CATALOG} from '../../packages/combat-core/guild-skills.mjs';
const profile=JSON.parse(readFileSync(new URL('../../packages/combat-core/rf-profile.json',import.meta.url)));
const contract=JSON.parse(readFileSync(new URL('../../contracts/rf-buff-bar-source-v1.json',import.meta.url)));
const buff=(templateId,remaining=10)=>({templateId,behaviors:[],finalizers:[{kind:'time',remaining}]});
class BuffElement{
  constructor(){this.children=[];this.dataset={};this.classList={toggle(){}};}
  setAttribute(name,value){this[name]=value;}
  append(...items){for(const item of items){item.parent?.children.splice(item.parent.children.indexOf(item),1);item.parent=this;this.children.push(item);}}
  replaceChildren(...items){for(const item of this.children)item.parent=null;this.children=[];this.append(...items);}
  remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
}
function buffHost(){const host=new BuffElement();host.ownerDocument={createElement:()=>new BuffElement()};return host;}

test('a declared but failed icon uses text across updates and recovers when its asset changes',()=>{
  const assets={buffIcons:{543:{file:'missing.png'}}},bar=createBuffBar({host:buffHost(),profile,assets});
  const actor={buffs:[buff(543),buff(544)]};bar.update(actor,{mode:'practice'});
  const [node]=bar.element.children[0].children,[image,fallback]=node.children;
  assert.equal(bar.element.children[0].children.length,1,'source-hidden states never get a placeholder');
  image.onerror();bar.update(actor,{mode:'practice'});
  assert.equal(image.hidden,true);assert.equal(fallback.hidden,false);assert.equal(fallback.textContent,'En');
  assert.equal(node.children[2].textContent,'10','timer continues with a failed image');
  bar.setAssets({buffIcons:{543:{file:'restored.png'}}});bar.update(actor,{mode:'practice'});
  assert.equal(image.hidden,false);assert.equal(fallback.hidden,true);assert.match(image.src,/restored.png$/);
  bar.destroy();
});

test('cross profession received buffs use the frozen source catalog for original display metadata',()=>{
  const lk=JSON.parse(readFileSync(new URL('../../packages/combat-core/lk-profile.json',import.meta.url))),profiles={RF:profile,LK:lk};
  const roster={r:{professionId:'RF'},l:{professionId:'LK'}},actor={buffs:[{...buff(31),sourceActorId:'r'},{...buff(78),sourceActorId:'l'}]};
  const rows=buildBuffRows(actor,{profile:lk,profileForBuff:buff=>profiles[roster[buff.sourceActorId].professionId]});
  assert.deepEqual(rows.map(row=>row.templateId),[31,78]);assert.equal(rows[0].name,'Wound');
  assert.equal(rows[1].iconKey,lk.buffTemplates[78].raw.BUFF_ICON_TEXTURE_KEY);assert.ok(rows.every(row=>row.isDebuff));
});
test('actual nine profile declarations cover all currently consumed buff identities, and invisible 544 stays hidden',()=>{
  assert.deepEqual(Object.keys(contract.currentTemplates),Object.keys(profile.buffTemplates));assert.equal(Object.keys(profile.buffTemplates).length,9);
  const actor={buffs:Object.keys(profile.buffTemplates).map(id=>buff(Number(id)))};const rows=buildBuffRows(actor,{profile});assert.equal(rows.length,8);assert.ok(!rows.some(row=>row.templateId===544));assert.equal(rows.filter(row=>row.isDebuff).length,5);
});
test('known states retain acquisition order within positive and negative rows; same template is one icon',()=>{
  const actor={buffs:[buff(37),buff(543),buff(31),buff(37),buff(48)]};const rows=buildBuffRows(actor,{profile});assert.deepEqual(rows.map(row=>row.templateId),[37,543,31,48]);assert.deepEqual(rows.filter(row=>row.isDebuff).map(row=>row.name),['Burn','Wound','Weapon Break']);
});
test('expired/unknown buffs are omitted; time/count finalizers and integer duration limits remain separate',()=>{
  assert.equal(buffRemainingSeconds({finalizers:[{kind:'received',remaining:2}]}),null);assert.equal(buffRemainingSeconds({finalizers:[{kind:'time',remaining:12},{kind:'time',remaining:3}]}),3);
  for(const [value,label] of [[0,''],[.01,'1s'],[4.9,'5s'],[998,'998s'],[999,''],[Infinity,''],[null,'']])assert.equal(buffDurationLabel(value),label);
  assert.equal(buildBuffRows({buffs:[buff(37,0),buff(99999)]},{profile}).length,0);assert.equal(buildBuffRows({buffs:[buff(37,4.9)]},{profile})[0].flashing,true);
});
test('tooltip reports supplied executable behaviors and counts without manufacturing unsupported effects',()=>{
  const live=buff(543);live.behaviors=[{kind:'empty'}];
  assert.equal(buildBuffRows({buffs:[live]},{profile})[0].description,'Cancels mana break when hit by Nasod hand (Command).');
  const untranslated={...profile,buffTemplates:{99991:profile.buffTemplates[543],99992:profile.buffTemplates[52]}};
  assert.equal(buildBuffRows({buffs:[{...live,templateId:99991}]},{profile:untranslated})[0].description,'');
  const stunned={templateId:99992,behaviors:[{kind:'stun'}],finalizers:[{kind:'received',remaining:2}]};
  assert.equal(buildBuffRows({buffs:[stunned]},{profile:untranslated})[0].description,'Cannot act. Hits taken: 2 until this effect ends');
});

test('cleared stun identities and exhausted hit counts cannot leave icons beside unrelated live debuffs',()=>{
  const stun={templateId:52,behaviors:[{kind:'stun',identityCleared:true}],finalizers:[{kind:'time',remaining:10}]};
  const counter={...buff(408),finalizers:[{kind:'hit',remaining:0}]};
  assert.deepEqual(buildBuffRows({buffs:[stun,counter,buff(37)]},{profile}).map(row=>row.templateId),[37]);
});
test('online buffs use stable IDs and preserve supplied English text',()=>{
  const actor={pvpModifiers:{outnumbered:1,hitMpBonus:3,receivedMpBonus:2},onlineBuffs:[
    {id:'pvp-outnumbered',name:'',description:'Existing description'},
    {id:'foreign',name:'',description:''},
    {id:'custom',name:'Custom effect',description:'A custom server description.'},
  ]};
  const before=structuredClone(actor);
  const rows=buildBuffRows(actor,{profile});
  assert.equal(rows[0].name,'Outnumbered');
  assert.equal(rows[0].description,'Existing description');
  assert.equal(rows[1].name,'PvP status');assert.equal(rows[1].description,'');
  assert.equal(rows[2].name,'Custom effect');assert.equal(rows[2].description,'A custom server description.');
  assert.deepEqual(actor,before);
});
test('online revenge uses original icon metadata while numerical disadvantage uses its own supplied label',()=>{
  const assets={pieces:{'buff:Buff_Icon_PVP_Revenge':{file:'revenge.png'}}};const actor={buffs:[],onlineBuffs:[{id:'pvp-revenge',name:'Revenge',description:'Attack +10%',stackCount:1,isDebuff:false,iconKey:'Buff_Icon_PVP_Revenge',remaining:null},{id:'pvp-outnumbered',name:'Team compensation',description:'MP per hit +3, MP when hit +2',stackCount:1,isDebuff:false,remaining:null}]};const before=structuredClone(actor);
  const rows=buildBuffRows(actor,{profile,assets});assert.equal(rows[0].icon,'revenge.png');assert.equal(rows[1].icon,null);assert.equal(rows[1].description,'MP per hit +3, MP when hit +2');assert.equal(rows[0].durationLabel,'');assert.deepEqual(actor,before);
});

test('runtime guild Template57 uses its acquired icon key and falls back to the matching original408 crop',()=>{
  const runtime=installGuildBuffs(profile),raw=GUILD_CATALOG.buffTemplates[57].raw;
  assert.equal(raw.BUFF_ICON_TEXTURE_KEY,profile.buffTemplates[408].raw.BUFF_ICON_TEXTURE_KEY);
  const actor={buffs:[{templateId:57,behaviors:[{kind:'stat',stat:'criticalRate',changeType:0,value:1}],
    finalizers:[{kind:'time',remaining:29.5},{kind:'hit',remaining:15}]}]};
  assert.deepEqual(buildBuffRows(actor,{profile}),[],'imported base profile alone does not declare runtime57');
  const assets={buffIcons:{408:{file:'original408.png'}}},rows=buildBuffRows(actor,{profile:runtime,assets});
  assert.equal(rows.length,1);assert.equal(rows[0].name,'A Chance to Turn the Tables');assert.equal(rows[0].icon,'original408.png');
  assert.equal(rows[0].originalIcon,true);assert.equal(rows[0].durationLabel,'30s');assert.equal(rows[0].isDebuff,false);
  assert.match(rows[0].description,/Hits dealt: 15 until this effect ends/);
  const custom=structuredClone(runtime);custom.buffTemplates[57].raw.BUFF_ICON_TEXTURE_KEY='Unknown_Original_Icon';
  assert.equal(buildBuffRows(actor,{profile:custom,assets})[0].icon,null,'unknown icons never borrow408');
});

test('Buff bar accepts the current simulation profile on every render instead of freezing the base import',()=>{
  const host=buffHost();
  const bar=createBuffBar({host,profile,assets:{buffIcons:{408:{file:'original408.png'}}}}),actor={buffs:[buff(57)]};
  bar.update(actor,{mode:'practice'});assert.equal(bar.element.children[0].children.length,0);
  bar.update(actor,{mode:'practice',profile:installGuildBuffs(profile)});
  const icon=bar.element.children[0].children[0];assert.equal(icon.dataset.buffId,'57');assert.match(icon['aria-label'],/A Chance to Turn the Tables/);
  assert.equal(icon.children[0].src,'/assets/ui/online/original408.png');
  actor.buffs=[];bar.update(actor,{mode:'practice',profile:installGuildBuffs(profile)});
  assert.equal(bar.element.children[0].children.length,0,'empty authoritative state removes the actual icon node');
  bar.update(actor,{mode:'practice',profile});assert.equal(bar.element.children[0].children.length,0);
  const source=readFileSync(new URL('../../apps/web/game.mjs',import.meta.url),'utf8');
  assert.match(source,/buffBar\?\.update\(actor,\{mode,profile:simulation\.profile\}\)/,'production render passes the actual runtime profile');
  bar.destroy();
});

test('right-corner status rows render real stacks, seconds and count-only lifetimes, then remove cleared states',()=>{
  const vc=JSON.parse(readFileSync(new URL('../../packages/combat-core/vc-profile.json',import.meta.url)));
  const host=buffHost(),runtime=installGuildBuffs(vc),bar=createBuffBar({host,profile:runtime});
  const actor={buffs:[{...buff(250,19.2),accumulationCount:2},buff(37,18.2),
    {templateId:57,behaviors:[],finalizers:[{kind:'hit',remaining:7}]}]};
  const before=structuredClone(actor);bar.update(actor,{mode:'online'});
  const [positive,negative]=bar.element.children,[stacked,counter]=positive.children;
  assert.equal(bar.element.hidden,false);assert.equal(stacked.dataset.buffId,'250');
  assert.equal(stacked.children[2].textContent,'20');assert.equal(stacked.children[3].textContent,'x2');
  assert.match(stacked['aria-label'],/20s\nStacks: 2/);assert.equal(counter.children[2].textContent,'7 uses');
  assert.deepEqual(negative.children.map(node=>node.dataset.buffId),['37']);assert.deepEqual(actor,before);
  const cached=positive.children[0];bar.update(actor,{mode:'online'});assert.equal(positive.children[0],cached);
  actor.buffs.reverse();bar.update(actor,{mode:'online'});assert.deepEqual(positive.children.map(node=>node.dataset.buffId),['57','250']);
  actor.buffs[2].accumulationCount=1;bar.update(actor,{mode:'online'});assert.equal(positive.children[1].children[3].textContent,'');
  actor.buffs=[];bar.update(actor,{mode:'online'});assert.equal(positive.children.length,0);assert.equal(negative.children.length,0);
  bar.update(actor,{mode:'lobby'});assert.equal(bar.element.hidden,true);bar.destroy();
});
