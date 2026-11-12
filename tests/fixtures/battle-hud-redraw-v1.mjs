/** Display samples only. Production HUD modules/styles and original crops;
 * no combat execution, generated expected combat result or client 1:1 claim. */
import {createPvpHud} from '../../apps/web/pvp-hud.mjs';
import {createBuffBar} from '../../apps/web/buff-bar.mjs';
import {createSkillSlot} from '../../apps/web/skill-slot.mjs';
import {placeSkillSlot} from '../../apps/web/skill-picker-state.mjs';
import {installGuildBuffs} from '../../packages/combat-core/guild-skills.mjs';
import rf from '../../packages/combat-core/rf-profile.json' with {type:'json'};
import lk from '../../packages/combat-core/lk-profile.json' with {type:'json'};
import vc from '../../packages/combat-core/vc-profile.json' with {type:'json'};
import preset from '../../config/rf-preset.json' with {type:'json'};

const frame=document.querySelector('#hud-frame');
if(frame){
  function render(){
    const form=document.querySelector('#display-controls'),values=new FormData(form);
    frame.style.width=values.get('width')+'px';
    frame.src='/stage.html?'+new URLSearchParams(values);
    const output=document.querySelector('#measurements');delete output.dataset.metrics;output.textContent='Reading display results…';
    document.querySelector('#ready').textContent='Loading source UI assets…';
  }
  document.querySelector('#display-controls').addEventListener('change',render);
  addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='battle-hud-redraw')return;
    const metrics=event.data.value,output=document.querySelector('#measurements');
    const values=new FormData(document.querySelector('#display-controls'));
    if(metrics.mode!==values.get('mode')||metrics.team!==Number(values.get('team'))||metrics.viewport.width!==Number(values.get('width'))
      ||metrics.icons!==values.get('icons')||metrics.statuses!==values.get('statuses'))return;
    output.textContent=JSON.stringify(metrics,null,2);output.dataset.metrics=JSON.stringify(metrics);
    document.querySelector('#ready').textContent='Production HUD and source atlas sprites loaded.';
  });
  render();
}else{
  const parameters=new URLSearchParams(location.search),mode=parameters.get('mode')??'3v3',team=Number(parameters.get('team')??0);
  const host=document.querySelector('#stage');
  const [assets,hudAssets,catalog]=await Promise.all(['/assets/ui/pvp-hud/manifest.json','/assets/ui/manifest.json','/assets/ui/skills/catalog.json'].map(async url=>{
    const response=await fetch(url);if(!response.ok)throw Error(url+': '+response.status);return response.json();
  }));
  const names=['Reckless Fist','Opponent Lord Knight','Ally Veteran Commander','Opponent Reckless Fist','Ally Lord Knight','Opponent Veteran Commander'];
  const players=names.slice(0,Number(mode[0])*2).map((nickname,index)=>({id:'hud-'+index,nickname,team:index%2===0?team:1-team,professionId:['RF','LK','VC'][index%3],kills:index+1,assists:index,deaths:index%2,connected:true}));
  const actors=players.map((player,index)=>({id:player.id,team:player.team,professionId:player.professionId,formulaRules:{combatLevel:85},hp:142080-index*12000,maxHp:142080,mp:150-index*18,maxMp:300}));
  const hud=createPvpHud({host,localId:players[0].id,pvpAssets:assets,hudAssets});
  hud.show(true);hud.update({mode,players,score:[2,1],scoreLimit:mode==='3v3'?6:4,remaining:256,phase:'fight'},{actors});hud.toggle(true);
  const iconAssets={buffIcons:{},pieces:{}};
  if(parameters.get('icons')!=='text'){
    for(const [id,piece]of Object.entries(assets.buffIcons))iconAssets.buffIcons[id]={...piece,file:'../pvp-hud/'+piece.file};
  }
  const runtime=installGuildBuffs(vc),profileForBuff=buff=>[52,544].includes(buff.templateId)?rf:buff.templateId===232?lk:runtime;
  const bar=createBuffBar({host:host.querySelector('.hud-root'),profile:runtime,profileForBuff,assets:iconAssets});
  const timed=(templateId,remaining,extra={})=>({templateId,behaviors:[],finalizers:[{kind:'time',remaining}],...extra});
  const statuses=[timed(250,19.2,{accumulationCount:2}),{templateId:57,behaviors:[],finalizers:[{kind:'hit',remaining:7}]},timed(37,18.2),timed(52,4.8),timed(544,20),timed(232,20,{accumulationCount:5})];
  // Hidden source declarations are present in the sample to prove they never
  // become placeholders, including when all visible icons are unavailable.
  bar.update({buffs:parameters.get('statuses')==='empty'?[]:statuses},{mode:'online'});
  const skills=[24000,24010,24001,24002,24003,24004,24005,24006];
  host.querySelector('.skill-bar').replaceChildren(...preset.skillKeys.map((key,index)=>{
    const definition=catalog.skills.find(skill=>skill.id===skills[index]);
    return placeSkillSlot(createSkillSlot(document,{key,slot:{skillId:skills[index]},definition}),key);
  }));
  function rect(node){if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}
  const overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
  function measure(){
    const buffs=[...bar.element.querySelectorAll('.rf-buff-item')].map(node=>({id:node.dataset.buffId,isDebuff:node.dataset.isDebuff==='true',time:node.querySelector('.rf-buff-time').textContent,stacks:node.querySelector('.rf-buff-stack').textContent,fallback:!node.querySelector('.rf-buff-fallback').hidden,bounds:rect(node)}));
    const score=host.querySelector('.pvp-scoreboard'),enemies=host.querySelector('.pvp-opponents');
    const numbers=[...host.querySelectorAll('.hud-number,.pvp-member-hp-number,.pvp-member-mp-number')].map(node=>({kind:node.className,text:node.textContent,
      align:getComputedStyle(node).textAlign,weight:getComputedStyle(node).fontWeight}));
    const value={evidenceClass:'simulation-browser-display-fixture',originalClientMeasured:false,mode,team,icons:parameters.get('icons'),statuses:parameters.get('statuses'),viewport:{width:innerWidth,height:innerHeight},score:rect(score),scoreLabel:host.querySelector('.pvp-score').getAttribute('aria-label'),time:host.querySelector('.pvp-time').dataset.seconds,goal:host.querySelector('.pvp-goal').getAttribute('aria-label'),buffBounds:rect(bar.element),enemyBounds:rect(enemies),enemyBelowStatuses:rect(enemies).top>=rect(bar.element).bottom,buffs,hiddenIdsAbsent:!buffs.some(row=>['544','232'].includes(row.id)),allyBuffCount:host.querySelectorAll('.pvp-allies .rf-buff-item').length,numbers,members:[...host.querySelectorAll('.pvp-member')].map(node=>({id:node.dataset.playerId,relationship:node.dataset.relationship,level:node.querySelector('.pvp-member-level').textContent,bounds:rect(node)})),boardBounds:rect(host.querySelector('.pvp-board')),skills:{count:host.querySelectorAll('.skill-slot').length,bounds:rect(host.querySelector('.skill-bar')),transform:getComputedStyle(host.querySelector('.skill-bar')).transform},images:{count:host.querySelectorAll('img:not([hidden])').length,failed:[...host.querySelectorAll('img:not([hidden])')].filter(img=>img.complete&&!img.naturalWidth).map(img=>img.src)}};
    value.scoreOverlapsMember=value.members.some(member=>overlaps(member.bounds,value.score));
    value.boardOverlapsSkills=overlaps(value.boardBounds,value.skills.bounds);
    parent.postMessage({type:'battle-hud-redraw',value},location.origin);
  }
  await document.fonts.ready;
  await Promise.all([...host.querySelectorAll('img:not([hidden])')].map(img=>img.decode().catch(()=>{})));
  measure();
  addEventListener('resize',measure);
}
