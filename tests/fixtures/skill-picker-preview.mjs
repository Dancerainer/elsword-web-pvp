/** Independent UI preview: reads existing assets; executes no combat/client. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const port=Number(process.env.RF_PICKER_PREVIEW_PORT??4203);
const assets=path.resolve(process.env.RF_PICKER_PREVIEW_ASSETS??path.join(root,'artifacts'));
const catalog=JSON.parse(await readFile(path.join(assets,'ui/skills/catalog.json'),'utf8'));
const profile=JSON.parse(await readFile(path.join(root,'packages/combat-core/rf-profile.json'),'utf8'));
const preset=JSON.parse(await readFile(path.join(root,'config/rf-preset.json'),'utf8'));
const preview={skills:catalog.skills,support:profile.skillCatalog,keys:preset.skillKeys,loadout:profile.loadout??Array(8).fill(null),passives:preset.passives,bannedSkillIds:preset.bannedSkillIds,bannedSkillReasons:preset.bannedSkillReasons};
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RF skill setup · Interaction preview</title><link rel="stylesheet" href="/apps/web/login.css"><link rel="stylesheet" href="/apps/web/game.css"><div id="app"><main class="workbench"><header class="workbench-header"><strong>RF · skill setup</strong><span>Skill setup preview</span></header><section class="viewport"><section class="skill-picker" role="dialog" aria-label="RF skill setup" aria-modal="true"><header><strong>Skills · RF Reckless Fist</strong><span>Enhanced · Max level</span></header><div class="picker-body"><section class="picker-tree-panel"><div class="picker-tree-heading"><span>Active</span><span>Passive</span></div><div class="picker-tree-scroll"><div class="skill-catalog"></div></div></section></div><div class="picker-loadout"><div class="picker-slot-heading">Skill bar · Right-click to equip or remove, or drag to a slot</div><div class="picker-slots"></div><div class="picker-slot-actions"><span class="picker-current-slot"></span></div></div><p class="picker-message" role="status">Max-level passives apply automatically without using a skill slot.</p></section></section></main></div><output id="preview-evidence" hidden></output><script type="module" src="/preview.mjs"></script></html>`;
const previewHtml=html.replace('<div id="app">','<link rel="stylesheet" href="/apps/web/window-theme.css"><link rel="stylesheet" href="/apps/web/skill-details.css"><div id="app">');
const script=`import {createPickerSlots,createSkillTree,createPickerTooltip,editPickerLoadout} from '/apps/web/skill-picker.mjs';
import {choosePickerBranch,applyPickerBranches,quickEquipTarget} from '/apps/web/skill-picker-state.mjs';
const data=await fetch('/preview-data.json').then(r=>r.json()),find=s=>document.querySelector(s),supportFor=id=>{const s=data.support.find(s=>Number(s.id??s.skillId)===Number(id));return s&&data.bannedSkillIds?.includes(Number(id))?{...s,supported:false,pvpDisabled:true,disabledReason:data.bannedSkillReasons?.[id]}:s;};
let loadout=data.keys.map((_,i)=>{const s=data.loadout[i];return s==null?null:typeof s==='object'?s:{skillId:Number(s),branchId:'none'};}),selectedSlot=0,selectedSkillId=Number(loadout[0]?.skillId)||null,branchChoices={},actions=[],pointerEvents=[];
for(const slot of loadout)if(slot&&!Object.hasOwn(branchChoices,slot.skillId))branchChoices[slot.skillId]=slot.branchId??'none';
const pickerTooltip=createPickerTooltip(document,find('.skill-picker'));
find('.picker-tree-scroll').addEventListener('scroll',hideDetails);
function pickerDefinitions(){return data.skills.map(s=>({...s,branches:supportFor(s.id)?.branches??s.branches,disabledReason:supportFor(s.id)?.disabledReason}));}
function evidence(){find('#preview-evidence').textContent=JSON.stringify({loadout,selectedSlot,selectedSkillId,branchChoices,tooltipHidden:find('#picker-hover-detail').hidden,actions,pointerEvents});}
function hideDetails(){pickerTooltip.hide();evidence();}
for(const type of ['pointerdown','pointermove','pointerup','pointercancel','dragstart','drop'])document.addEventListener(type,event=>{pointerEvents.push({type,id:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,target:event.target.className});pointerEvents=pointerEvents.slice(-30);evidence();},true);
function apply(operation){
  try{
    const next=editPickerLoadout(loadout,operation.type==='equip'?{...operation,branchId:branchChoices[operation.skillId]??'none'}:operation,data.skills,supportFor);
    loadout=next;selectedSlot=operation.target;selectedSkillId=Number(loadout[selectedSlot]?.skillId)||null;actions.push(operation);
    rebuild();find('.picker-message').textContent='Configuration saved · '+data.keys[selectedSlot]+' · Max level';
  }catch(error){find('.picker-message').textContent=error.message;}
}
function selectBranch(skillId,branchId){
  try{
    const definitions=pickerDefinitions(),definition=definitions.find(s=>s.id===skillId);
    const choices=choosePickerBranch(branchChoices,definition,branchId);
    const next=applyPickerBranches(loadout,choices,definitions);
    branchChoices=choices;loadout=next;selectedSkillId=skillId;actions.push({type:'branch',skillId,branchId});rebuild();
    find('.picker-message').textContent=loadout.some(s=>s?.skillId===skillId)?'Trait saved · Max level':'Trait saved. It will apply when the skill is equipped.';
  }catch(error){find('.picker-message').textContent=error.message;}
}
function rebuild(){
  pickerTooltip.hide();if(selectedSkillId===null)selectedSkillId=Number(loadout[selectedSlot]?.skillId)||null;
  find('.picker-slots').replaceChildren(...createPickerSlots(document,{keys:data.keys,loadout,definitions:data.skills,selectedSlot,
    onRemove:i=>apply({type:'remove',target:i}),
    onDrop:(payload,target)=>apply(payload.kind==='slot'?{type:'swap',source:payload.sourceSlot,skillId:payload.skillId,target}:{type:'equip',skillId:payload.skillId,target})}));
  find('.picker-current-slot').textContent='Current key '+data.keys[selectedSlot];
  find('.skill-catalog').replaceChildren(...createSkillTree(document,{definitions:data.skills,supportFor,loadout,applied:data.passives??[],selectedSkillId,
    branchChoices,onChooseBranch:selectBranch,onEquip:skillId=>{try{apply({type:'equip',skillId,target:quickEquipTarget(loadout,skillId)});}catch(error){find('.picker-message').textContent=error.message;}},onHideDetails:hideDetails,
    onInspectBranch:(branch,anchor)=>{pickerTooltip.trait(branch,anchor);evidence();},
    onInspect:(id,anchor)=>{pickerTooltip.skill(pickerDefinitions().find(s=>s.id===id),anchor,branchChoices[id]??'none');evidence();}}));
  evidence();
}
rebuild();`;
const mime={'.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(previewHtml);}
    if(pathname==='/preview.mjs'){res.setHeader('Content-Type',mime['.mjs']);return res.end(script);}
    if(pathname==='/preview-data.json'){res.setHeader('Content-Type',mime['.json']);return res.end(JSON.stringify(preview));}
    const base=pathname.startsWith('/assets/')?assets:root,relative=pathname.startsWith('/assets/')?pathname.slice(8):pathname.slice(1);
    const file=path.resolve(base,relative);if(!file.startsWith(base+path.sep))throw Error('outside preview root');
    const data=await readFile(file);res.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');res.end(data);
  }catch(error){res.statusCode=404;res.end('Unavailable preview file');}
});
server.listen(port,'127.0.0.1',()=>console.log('Independent RF picker preview: http://127.0.0.1:'+port+'/'));
